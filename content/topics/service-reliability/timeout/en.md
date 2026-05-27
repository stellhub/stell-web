## Abstract

Timeout in network communication is not a single `timeout` parameter. It is a set of time boundaries distributed across clients, servers, proxy gateways, connection pools, transport protocols, and RPC frameworks. A single request may pass through DNS resolution, connection-pool queueing, TCP connection establishment, TLS handshake, request write, server queueing and processing, upstream proxy forwarding, response-header return, response-body transfer, and keep-alive idle periods. Any of those stages can exceed its time boundary and appear as a "timeout," but the root cause, handling method, and configuration point are different.

This article redefines the major timeout categories in network communication and focuses on how to distinguish and locate timeout root causes. The central conclusion is: **effective timeout governance is not about assigning one uniform number of seconds to every request. It is about building a stage-based timeout model, end-to-end deadlines, layered logging, stage-duration observability, and cross-service trace correlation.** The AWS Builders Library recommends setting timeouts for every remote call and notes that excessive timeout values weaken resource protection, while overly small values create false timeouts and retry amplification. Its recommended method is to start from downstream latency percentiles, for example selecting an acceptable false-timeout rate such as 0.1 percent and using downstream p99.9 latency as the baseline. ([Amazon Web Services, Inc.][1])

---

## 1. Research Background

Distributed systems cannot assume that networks, servers, proxies, middleware, and operating systems are always stable. Failures in network communication may come from servers, networks, load balancers, software, operating systems, or human operations. Many failures first appear as abnormally long request duration or requests that never return. While a client waits, it holds resources such as threads, connections, memory, and ephemeral ports. For that reason, remote calls must have explicit time boundaries. ([Amazon Web Services, Inc.][1])

In practice, timeout errors are often misattributed. For example, when a client sees `SocketTimeoutException`, that does not automatically mean "the network is slow." It may actually be slow downstream processing, a gateway waiting for its upstream, interrupted response-body transfer, connection-pool saturation, server thread-pool queueing, slow database queries, stalled TLS handshake, or an HTTP/2 stream closed by idle timeout. Java defines `SocketTimeoutException` only as a timeout during socket read or accept. It does not identify the business root cause. ([Oracle Documentation][2])

So timeout governance must move from "exception-name driven" thinking to "stage-location driven" diagnosis. This article divides network timeout into four layers:

1. Client-side timeout: DNS, connection pool, TCP connect, TLS, request write, response read, and full-call deadline.
2. Server-side timeout: request-header read, request-body read, business processing, response write, and keep-alive.
3. Proxy or gateway timeout: connect upstream, send upstream request, read upstream response, route total timeout, per-try timeout, and stream idle timeout.
4. Protocol and connection-lifecycle timeout: HTTP/2 stream timeout, gRPC deadline, TCP idle timeout, keep-alive, and maximum connection lifetime.

---

## 2. A Complete Timeout Taxonomy

### 2.1 Client-Side Timeout

Client-side timeout constrains how long the caller is willing to wait and how long local caller-side resources may be blocked. It includes far more than `connectTimeout`, `readTimeout`, and `writeTimeout`. It also includes connection-pool acquisition, DNS, TLS, whole-call deadline, and per-attempt retry timeout.

| Timeout type | Common configuration name | Stage | Behavior after timeout | Main root causes |
| --- | --- | --- | --- | --- |
| Connection-pool acquire timeout | `connectionRequestTimeout`, `acquireTimeout` | Waiting for an available connection from pool | Local client failure, request may not have been sent yet | Pool too small, connection leak, downstream latency holding connections too long |
| DNS resolution timeout | resolver timeout, DNS timeout | Name resolution | Target address cannot be obtained | DNS outage, wrong domain configuration, blocked network path |
| TCP connect timeout | `connectTimeout` | TCP three-way handshake | Connection not established, request never enters HTTP stage | Unreachable target port, dropped traffic, false health, routing issue |
| TLS handshake timeout | handshake timeout, transport socket timeout | TLS negotiation | HTTPS or gRPC TLS connection fails | Slow certificate-chain validation, SNI mismatch, TLS incompatibility, CPU jitter |
| Request write timeout | `writeTimeout`, socket write timeout | Sending request headers or body | Request write fails, server may have received only part of the data | Slow client uplink, slow server receive, large request body, TCP window blocking |
| Response read timeout | `readTimeout`, socket timeout | Reading response headers or body | Client read fails, server may already have completed processing | Slow server processing, large response body, network interruption, downstream delay |
| Full-call timeout | `callTimeout`, deadline, request timeout | Entire call lifecycle | Call is cancelled or fails | Total budget too small, retries stacked, missing stage timeout |
| Per-attempt timeout | `perTryTimeout`, per-attempt timeout | One attempt during retry | Current try fails and another try may start | Per-try budget too long or too short |

Apache HttpClient separates connection-pool acquisition timeout, connection establishment timeout, and socket data waiting timeout. `getConnectionRequestTimeout()` is the wait time for a connection from the connection manager, `getConnectTimeout()` is the connection establishment time, and `getSocketTimeout()` is the maximum inactivity time while waiting for data or between data packets. ([Apache HttpComponents][3])

Java Socket also reflects a stage-based model. `connect(endpoint, timeout)` limits connection establishment, where timeout `0` means wait forever. If connection setup exceeds the limit, `SocketTimeoutException` is thrown. `SO_TIMEOUT` applies to reads and limits how long `read()` may block, while the socket itself remains valid after timeout. ([Oracle Documentation][4])

OkHttp uses the same staged model. By default it has no full-call timeout, but connect, read, and write timeouts all default to 10 seconds. `callTimeoutMillis` covers the complete call, while `connectTimeoutMillis`, `readTimeoutMillis`, and `writeTimeoutMillis` cover only their own phases. ([square.github.io][5])

---

### 2.2 Server-Side Timeout

Server-side timeout does not exist to choose on behalf of the client how long to wait. Its purpose is to protect server resources from slow clients, malformed connections, oversized request headers, slow uploads, slow downloads, and idle keep-alive connections.

| Timeout type | Common configuration name | Stage | Behavior after timeout | Main root causes |
| --- | --- | --- | --- | --- |
| Request-header read timeout | `client_header_timeout`, `request_headers_timeout` | Server reading request line and headers | Usually 408 or connection close | Slow client, network jitter, slowloris-style requests |
| Request-body read timeout | `client_body_timeout`, upload timeout | Server reading request body | Usually 408 or connection close | Slow upload, large file, client interruption |
| Business-processing timeout | servlet async timeout, controller timeout, RPC deadline | Application processing stage | 5xx, timeout error, or cancellation | Thread-pool queueing, slow DB query, slow downstream dependency |
| Response-send timeout | `send_timeout` | Server writing response | Connection closed | Slow client receive, network congestion, large response body |
| Keep-alive timeout | `keepAliveTimeout`, `keepalive_timeout` | Waiting for next request on a reused connection | Idle connection closed | Keep-alive window too long or too short |

Nginx `client_header_timeout` defaults to 60 seconds and limits header reading. If the client fails to send the complete header in time, the request is terminated with 408. `client_body_timeout` also defaults to 60 seconds but limits the time between two successive body reads rather than total body-transfer time. ([Nginx][6])

Tomcat has the same distinction. `connectionTimeout` is the time after a connection is accepted to wait for the request URI line. The default is 60 seconds, but the standard `server.xml` commonly sets it to 20 seconds. `connectionUploadTimeout` applies to upload and defaults to 300 seconds. `keepAliveTimeout` controls how long the connector waits for the next HTTP request and defaults to `connectionTimeout`. ([tomcat.apache.org][7])

---

### 2.3 Proxy and Gateway Timeout

Proxy or gateway timeout constrains the wait boundary between client and gateway and between gateway and upstream service. It is different from client timeout: client timeout expresses how long the caller is willing to wait, while proxy timeout expresses how long the proxy is willing to spend resources forwarding the request.

| Timeout type | Common configuration name | Stage | Behavior after timeout | Main root causes |
| --- | --- | --- | --- | --- |
| Upstream connect timeout | `proxy_connect_timeout`, cluster `connect_timeout` | Gateway connecting to backend | Commonly 502, 503, or 504 | Backend unreachable, port not listening, ACL issue, bad instance |
| Upstream send timeout | `proxy_send_timeout` | Gateway sending request to backend | Connection close or upstream error | Backend receives slowly, large request body, blocked upstream connection |
| Upstream read timeout | `proxy_read_timeout`, route timeout | Gateway reading backend response | Commonly 504 | Slow backend processing, slow dependency chain, no progress in response |
| Route total timeout | Envoy route `timeout` | Waiting for complete upstream response | Envoy returns timeout response | Upstream response exceeds total route budget |
| Per-try timeout | Envoy `per_try_timeout` | One retry attempt | Current try fails and retry may continue | Retry budget split is unreasonable |
| Stream idle timeout | `stream_idle_timeout`, route `idle_timeout` | No activity on HTTP stream | Stream reset or close | Streaming API lacks heartbeat, peer stops reading or writing |
| TCP idle timeout | TCP proxy `idle_timeout` | No activity on TCP connection | Connection closed | Long-lived connections lack heartbeat or stay idle too long |

Nginx `proxy_connect_timeout` defaults to 60 seconds for establishing a connection to the proxied server. `proxy_read_timeout` defaults to 60 seconds for reading upstream response and applies only to the interval between two successive reads. `proxy_send_timeout` defaults to 60 seconds for sending the request upstream and likewise applies between write operations rather than to the whole transfer. ([Nginx][8])

Envoy groups timeout into HTTP/gRPC connection timeout, stream timeout, route timeout, TCP timeout, and transport-socket timeout. Envoy route `timeout` defaults to 15 seconds and means the time allowed for a complete upstream response. It is not suitable for never-ending streaming responses. Streaming APIs should use stream idle timeout instead. Envoy cluster `connect_timeout` is the limit for upstream TCP connection establishment, defaulting to 5 seconds if not configured; for TLS upstreams that duration includes the TLS handshake. ([envoyproxy.io][9])

---

### 2.4 gRPC and Deadline Timeout

The core timeout concept in gRPC is deadline. A deadline is the latest point in time the client is willing to wait for a response. A timeout is a duration, and a deadline can be calculated from now plus that duration. gRPC does not set a deadline by default, so clients may wait for a very long time unless one is configured explicitly. ([gRPC][10])

When the deadline is exceeded, the client fails with `DEADLINE_EXCEEDED`. The server also cancels the call after the client deadline expires, but server application code still needs to check the cancellation signal and stop any background work it launched. gRPC also supports deadline propagation: when an upstream service calls a downstream service, it should inherit the original deadline. gRPC converts the remaining budget into a timeout value to avoid clock-skew issues. ([gRPC][10])

The .NET gRPC documentation explains the same behavior. When deadline is exceeded, the client aborts the underlying HTTP request and raises `DeadlineExceeded`. The server-side HTTP request is aborted and `ServerCallContext.CancellationToken` is triggered, but the gRPC method itself still continues until application code cooperates and stops its downstream DB or HTTP operations. ([Microsoft Learn][11])

---

## 3. A Root-Cause Model for Timeout

Timeout diagnosis should revolve around the question "which stage timed out?" From the client perspective, the phase chain looks like:

```text
Call start
  -> Dispatcher / connection pool queue
  -> DNS lookup
  -> TCP connect
  -> TLS handshake
  -> Request headers write
  -> Request body write
  -> Server / gateway / upstream processing
  -> Response headers read
  -> Response body read
  -> Call end
```

OkHttp `EventListener` exposes nearly the same stages, including dispatcher queue, proxy selection, DNS, connect, secure connect, connection acquired, request headers or body, and response headers or body. Those events can be used to measure stage count, size, and duration for HTTP calls. ([square.github.io][12])

### 3.1 DNS Resolution Timeout

DNS timeout usually occurs before the client even attempts to connect to the target service. Typical causes include DNS outage, nonexistent domain, network reachability failure to DNS servers, local resolver misconfiguration, container-level DNS issues, overloaded CoreDNS in Kubernetes, or firewall rules blocking DNS traffic.

Diagnostic clues:

| Symptom | Judgment |
| --- | --- |
| `UnknownHostException`, name-resolution timeout | Check DNS first |
| curl `time_namelookup` is high | DNS stage is slow |
| Access by IP succeeds but access by domain fails | DNS or SNI or Host configuration issue |
| Some Pods fail while host machines are normal | Container DNS, CoreDNS, or network-policy problem |

curl `--write-out` exposes `time_namelookup`, `time_connect`, `time_appconnect`, and `time_starttransfer`, which map directly to name resolution, TCP connect, SSL/SSH handshake, and time to first byte. ([Curl][13])

---

### 3.2 TCP Connect Timeout

TCP connect timeout occurs after DNS has already returned an address but before the TCP connection is established within the configured window. The cause is usually not slow business logic. It is more often a network-path, target-port, instance-health, or firewall issue.

Common causes:

| Root cause | Explanation |
| --- | --- |
| Target service is not listening | Often appears as connection refused rather than timeout |
| Firewall or security group drops SYN | Often appears as connect timeout |
| Route is unreachable | Cross-network, cross-VPC, or cross-region routing issue |
| False-healthy target instance | Health check is wrong, port is unavailable |
| SYN backlog overflow | Server-side connection queue is overloaded |
| NAT or SNAT resource exhaustion | Too many short-lived connections exhaust ports or conntrack state |

Diagnostic clues:

| Signal | Judgment |
| --- | --- |
| curl `time_connect - time_namelookup` is high | TCP connect stage is slow |
| `telnet` or `nc` to target port times out | Network or port-reachability problem |
| No server request logs | Request never reached application layer |
| Packet capture shows SYN retransmit without SYN-ACK | Packet loss, ACL, firewall, or unreachable target |
| Only new connections fail while reused connections succeed | Problem is in connect or TLS stage |

Java Socket connect timeout occurs before connection setup completes and should not be interpreted as slow server-side business execution. ([Oracle Documentation][4])

---

### 3.3 TLS Handshake Timeout

TLS handshake timeout occurs after TCP is connected but before application-layer request data is sent. It is related to HTTPS, gRPC TLS, mTLS, certificate-chain validation, SNI, and cipher-suite negotiation.

Common causes:

| Root cause | Explanation |
| --- | --- |
| Certificate chain is long or validation is slow | Client-side validation cost rises |
| SNI mismatch | Server returns wrong certificate or handshake fails |
| Protocol incompatibility | TLS version or cipher suites do not match |
| Server CPU jitter | TLS handshake requires CPU |
| Bad mTLS client certificate | Expired certificate or missing trust chain |
| New instance cold start | Connection pool is not warm and handshakes happen in a burst |

AWS Builders Library mentions a real production issue where a system saw timeouts right after deployment because the configured timeout included establishing a new secure connection and that setup sometimes exceeded 20 ms. Reusing connections hid the problem later, and pre-establishing connections at process startup reduced the issue. ([Amazon Web Services, Inc.][1])

Diagnostic clues:

| Signal | Judgment |
| --- | --- |
| curl `time_appconnect - time_connect` is high | TLS or SSL handshake stage is slow |
| HTTP is fast but HTTPS is slow | TLS or certificate problem |
| Timeout appears only right after new instances come online | Connection warmup is insufficient |
| OkHttp `secureConnectStart` to `secureConnectEnd` is slow | TLS stage is abnormal |

---

### 3.4 Connection-Pool Acquire Timeout

Connection-pool acquire timeout is a local client timeout. The request may not have been sent at all. It is often misread as "the downstream is slow," but the root cause is often on the caller side: pool too small, connections not released, concurrency above pool capacity, response bodies not closed, or downstream latency holding connections for too long.

Apache HttpClient `connectionRequestTimeout` exists specifically for waiting on a connection manager. It is different from TCP connect timeout and socket data wait timeout. ([Apache HttpComponents][3])

Diagnostic clues:

| Signal | Judgment |
| --- | --- |
| High number of pending connections in pool | Local caller-side connection resource shortage |
| No corresponding server logs | Request has not reached the server |
| Many client threads waiting on connection lease | Pool-acquisition blocking |
| Problem becomes worse when response bodies are not closed | Connection leak |
| Increasing pool size alleviates symptoms | Pool capacity or release issue |

Recommended treatment:

```text
1. Record connection acquired and released timestamps.
2. Verify response bodies are closed in finally blocks.
3. Distinguish maxTotal, maxPerRoute, and HTTP/2 stream concurrency limits.
4. Connection-pool acquire timeout should be shorter than the full-call deadline.
5. If the pool is exhausted, do not only enlarge the pool. Also examine downstream latency and connection release behavior.
```

---

### 3.5 Request Write Timeout

Request write timeout happens while the client is sending the request to the server or proxy. It may happen while writing request headers or request body. Small JSON requests rarely hit prolonged write timeout; it is more common with large uploads, slow client uplinks, server receive-side pressure, or blocked TCP windows.

Typical causes:

| Root cause | Explanation |
| --- | --- |
| Large request body | Upload duration exceeds write timeout |
| Slow client uplink | Sending progress is too slow |
| Server receives slowly | Backpressure increases |
| Proxy buffering mismatch | Middle-layer buffering delays progress |
| TCP flow-control blocking | Peer does not read fast enough |

Nginx `proxy_send_timeout` and `send_timeout` both emphasize that they limit the interval between two successive write operations rather than total request or response duration. That means write timeout is more accurately a transfer-progress timeout than a simple wall-clock limit. ([Nginx][8])

---

### 3.6 Response Read Timeout

Read timeout is one of the most frequently misunderstood timeout classes. It may happen before the first response byte arrives or while the response body is already being transferred.

Typical causes:

| Root cause | Explanation |
| --- | --- |
| Slow server processing | Time to first byte is high |
| Slow gateway upstream | Proxy waits too long for backend |
| Large response body | Body transfer is slow |
| Network interruption | Read progress stops |
| Peer does not flush | Response stalls mid-stream |

Diagnostic clues:

| Signal | Judgment |
| --- | --- |
| No response headers received | Likely server processing or upstream wait |
| Response headers received but body stalls | Body transfer or peer-read problem |
| Gateway upstream response time is high | Backend or dependency chain is slow |
| Large response only times out under weak networks | Transfer stage is the bottleneck |

Nginx `proxy_read_timeout` limits the interval between two successive reads of the upstream response rather than total response-transfer time. A very large response may still succeed if data keeps flowing continuously. ([Nginx][8])

---

### 3.7 408, 504, and Deadline Exceeded

The observed timeout symptom should be mapped back to the stage model instead of being interpreted literally.

| Surface symptom | Primary layer | Common stage | Typical meaning |
| --- | --- | --- | --- |
| `connect timed out` | Client | TCP connect | Backend unreachable or connect path blocked |
| `read timed out` | Client | Response wait or response body | Slow processing, upstream delay, or stalled transfer |
| `408 Request Timeout` | Server | Header or body read | Server did not receive a complete request in time |
| `504 Gateway Timeout` | Gateway | Upstream response wait | Gateway did not receive upstream response in time |
| `DEADLINE_EXCEEDED` | gRPC client | Full-call budget | End-to-end budget is exhausted |

RFC 9110 defines 504 as the case where a gateway or proxy did not receive a timely response from an upstream server. That means diagnosing 504 should focus on the gateway-to-upstream path rather than the client-to-gateway path. ([RFC Editor][14])

RFC 9110 also defines 408 as the case where the server did not receive a complete request within the time it was prepared to wait. So 408 should first lead engineers toward request-send stages, large request bodies, or slow-client problems. ([RFC Editor][14])

---

## 4. Timeout Observability and Diagnosis

### 4.1 Stage-Based Logging and Metrics

Timeouts cannot be diagnosed correctly from exception names alone. Each stage needs explicit timing and result tags. At minimum, logs and metrics should break down:

```text
DNS duration
connection-pool acquire duration
TCP connect duration
TLS handshake duration
request-write duration
server queue duration
business-processing duration
upstream connect duration
upstream response duration
response-first-byte duration
response-body duration
full-call duration
deadline remaining
```

OpenTelemetry defines semantic conventions for HTTP metrics and spans, including HTTP client or server request duration, active requests, request and response body size, open connections, and connection duration. Those are the right building blocks for standardizing timeout observability. ([OpenTelemetry][15])

Suggested metrics:

```text
http.client.request.duration
http.server.request.duration
http.client.active_requests
http.server.active_requests
http.client.open_connections
http.client.connection.duration
rpc.client.duration
db.client.duration
timeout_total
timeout_by_phase
deadline_exceeded_total
upstream_timeout_total
connection_pool_acquire_timeout_total
```

---

## 5. Root-Cause Judgment for Typical Timeout Scenarios

### 5.1 Client Connect Timeout

Observed symptom:

```text
connect timed out
ConnectTimeoutException
java.net.SocketTimeoutException: connect timed out
```

Priorities for diagnosis:

| Check | Explanation |
| --- | --- |
| Does the server have request logs at all? | If not, the request never reached application layer |
| Is the target IP and port reachable? | Verify with `nc`, `telnet`, or `curl` |
| Does the issue happen only on some nodes? | Check service discovery, load balancing, and bad instances |
| Does packet capture show only SYN retransmits? | Check packet loss, firewall, or security group |
| Is the path cross-region or over the public internet? | Check whether network path is slow or timeout is too small |

Conclusion: connect timeout should generally lead engineers first toward reachability, network path, service discovery, health checks, and port-listening state rather than business logic.

---

### 5.2 Client Read Timeout

Observed symptom:

```text
read timed out
SocketTimeoutException: Read timed out
```

Priorities for diagnosis:

| Check | Explanation |
| --- | --- |
| Were response headers already received? | Distinguish first-byte timeout from body-transfer stall |
| Is server access-log duration high? | Check whether business logic is slow |
| Is gateway upstream timing high? | Check whether backend or upstream is slow |
| Is the response body large? | Check download stage |
| Does it happen only on POST or write-heavy paths? | Check locks, DB, or downstream dependency cost |

Conclusion: read timeout may occur before processing finishes, after processing finishes, or during body transfer. Exception text alone is not enough.

---

### 5.3 Gateway 504

Observed symptom:

```text
HTTP 504 Gateway Timeout
upstream timed out
```

Priorities for diagnosis:

| Check | Explanation |
| --- | --- |
| Gateway-to-upstream connect time | If high, inspect instance health and network path |
| Gateway-to-upstream response time | If high, inspect backend processing and dependency chain |
| Did the backend complete the request? | If yes but gateway still timed out, timeout layering may be inconsistent |
| Is this a streaming API? | Route timeout may be incompatible with streaming |
| Did the entry client abandon the request even earlier? | Deadline layering may be inconsistent |

Conclusion: 504 should shift attention to gateway-upstream timing and backend dependency chains rather than client timeout settings.

---

### 5.4 Server 408

Observed symptom:

```text
HTTP 408 Request Timeout
client timed out while sending request
```

Priorities for diagnosis:

| Check | Explanation |
| --- | --- |
| Are headers too large or arriving too slowly? | Inspect header timeout |
| Is the body a large upload? | Inspect body or upload timeout |
| Is the client network weak? | Slow clients can trigger 408 |
| Is the gateway buffering the request body? | Inspect buffering settings |
| Are many connections sending only partial requests? | Could be slow-request attack or client interruption |

Conclusion: 408 should lead first toward request-send stages and slow-client protection rather than backend SQL tuning.

---

### 5.5 gRPC `DEADLINE_EXCEEDED`

Observed symptom:

```text
StatusCode.DEADLINE_EXCEEDED
DeadlineExceeded
context deadline exceeded
```

Priorities for diagnosis:

| Check | Explanation |
| --- | --- |
| Is the client deadline too short? | gRPC has no default deadline and must be configured explicitly |
| Is deadline propagated across services? | Missing propagation leaves downstream still working |
| Do retries consume the full deadline? | Deadline includes all retries |
| Does the server handle cancellation? | Unhandled cancellation wastes resources |
| Do downstream spans exceed the remaining budget? | Budget allocation may be unreasonable |

Conclusion: gRPC timeout should be treated as an end-to-end budget problem, not only a local socket problem.

---

### 5.6 Streaming Interface Timeout

Streaming includes SSE, WebSocket, gRPC server streaming, bidirectional streaming, large-file download, and long polling. Those interfaces cannot reuse the same short route-timeout model that fits ordinary unary HTTP APIs.

Common causes:

| Root cause | Explanation |
| --- | --- |
| Gateway route timeout is not suitable for streaming | Envoy route timeout defaults to 15 seconds and is incompatible with never-ending streaming responses |
| Stream idle timeout is too short | Heartbeat or data interval exceeds idle timeout |
| No application heartbeat | Middle layers assume the connection is inactive |
| HTTP/2 flow-control blocking | Peer is not reading data |
| Client cancels early | Server fails to react quickly to cancellation |

Envoy explicitly documents that route `timeout` is not compatible with streaming responses and that stream idle timeout should be used instead. ([envoyproxy.io][9])

---

## 6. Timeout Configuration Principles

### 6.1 Use Percentiles Instead of Fixed Folklore Values

There is no universal timeout value that fits all systems. AWS recommends starting from downstream latency metrics, selecting an acceptable false-timeout rate such as 0.1 percent, and then using the corresponding latency percentile such as p99.9. If the request goes over public networks, add appropriate worst-case network latency. If p99.9 is close to p50, add padding to avoid large numbers of false timeouts caused by small latency fluctuations. ([Amazon Web Services, Inc.][1])

Formalized:

```text
timeout = downstream_latency_percentile + network_padding + safety_margin
```

Where:

| Parameter | Meaning |
| --- | --- |
| `downstream_latency_percentile` | Target downstream percentile such as p99 or p99.9 |
| `network_padding` | Extra cost from cross-AZ, public internet, mobile network, and similar paths |
| `safety_margin` | Margin for jitter, GC, scheduler delay, TLS cold start, connection rebuild, and similar noise |

---

### 6.2 Configure Both Stage Timeouts and Total Deadline

Stage timeout constrains and diagnoses a specific stage. Total deadline constrains the entire call. The two serve different purposes.

| Configuration | Purpose |
| --- | --- |
| DNS timeout | Prevent name resolution from blocking too long |
| Connect timeout | Detect unreachable instances quickly |
| TLS handshake timeout | Bound secure-connection negotiation |
| Write timeout | Bound request-send progress |
| Read timeout | Bound response-read progress |
| Call timeout / deadline | Bound full call lifecycle |
| Per-try timeout | Bound one retry attempt |
| Idle timeout | Bound inactive connection or stream lifetime |

OkHttp has connect, read, and write timeouts by default but no full-call timeout by default. That means full-call duration may remain unbounded unless configured explicitly. ([square.github.io][5])

---

### 6.3 Deadlines Must Stay Consistent Across Layers

A request commonly passes through client, gateway, service A, service B, and database. A good configuration ensures outer budgets cover inner budgets, and every layer subtracts time already spent before calling further downstream.

Example:

```text
Client total deadline: 3000ms
Gateway upstream timeout: 2800ms
Service A local budget: 2500ms
Service A -> Service B deadline: 1500ms
Service B -> DB timeout: 500ms
```

This arrangement makes inner-layer timeout visible early enough to return a controlled error before the outer deadline expires. gRPC deadline propagation exists precisely for this reason. ([gRPC][10])

---

### 6.4 Retry Must Count Against the Total Timeout

Retry must never bypass the total deadline. If the total budget is 2 seconds, but each read timeout is 2 seconds and you allow 3 retries, the worst-case duration exceeds the caller's waiting budget.

The correct relationship is:

```text
per_try_timeout * attempts + backoff <= total_deadline
```

Envoy `per_try_timeout` exists exactly for this pattern. It should be shorter than the full request timeout and should keep each retry attempt bounded within the overall deadline. ([envoyproxy.io][9])

---

### 6.5 Configure Ordinary Requests, Uploads, Downloads, and Streaming Separately

Different interface types require different timeout models:

| Interface type | Timeout model |
| --- | --- |
| Ordinary JSON API | Relatively short connect, read, write, and total deadline |
| Large upload | Longer request-body or write timeout, possibly asynchronous processing |
| Large download | Longer response-body or send timeout, resumable transfer support |
| SSE or streaming | Not suitable for short route timeout; use idle timeout and heartbeat |
| WebSocket | Focus on ping/pong, idle timeout, and connection lifetime |
| gRPC unary | Explicit deadline and propagation |
| gRPC streaming | Use deadline, idle timeout, keepalive, and cancellation together |

Both Nginx and Envoy show the distinction between "total time" and "progress time." Many Nginx timeouts limit the interval between two successive reads or writes, while Envoy route timeout is not appropriate for never-ending streaming response. ([Nginx][8])

---

## 7. Recommended Baseline Configurations

These values are not universal standards. They are engineering starting points. Final values must depend on business SLO, downstream p99 or p99.9 latency, error budget, network environment, and load-test data.

| Scenario | DNS | Connect | TLS | Write | Read / TTFB | Total deadline | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Internal RPC in the same zone | 100ms~500ms | 100ms~500ms | 100ms~1s | 500ms~2s | p99.9 + padding | 500ms~3s | Fits high-frequency microservices |
| Cross-AZ call | 500ms~1s | 300ms~1s | 500ms~2s | 1s~3s | p99.9 + cross-AZ padding | 1s~5s | Must consider network jitter |
| Public third-party API | 1s~5s | 1s~3s | 1s~5s | 2s~10s | 3s~15s | 5s~30s | Follow provider SLA |
| User-facing synchronous request | 500ms~2s | 300ms~1s | 500ms~2s | 1s~5s | 1s~5s | 2s~8s | Timeout should lead to degrade or explicit failure |
| Background job | 1s~5s | 1s~5s | 1s~5s | 5s~30s | 10s~60s | 30s~180s | Retry can be asynchronous |
| Large upload | 1s~5s | 1s~5s | 1s~5s | 30s~300s | 30s~300s | Prefer asynchronous design | Focus on transfer progress |
| Streaming interface | 1s~5s | 1s~5s | 1s~5s | protocol-specific | idle + heartbeat | Avoid short total timeout | Use heartbeat and cancellation |

Important caveat: official default values are usually not business-optimal values. OkHttp defaults connect, read, and write timeout to 10 seconds and leaves full-call timeout disabled; Nginx defaults several client and proxy read or write timeouts to 60 seconds; Envoy route timeout defaults to 15 seconds; Tomcat `connectionTimeout` defaults to 60 seconds though common standard config sets it to 20 seconds. Those defaults are useful for understanding framework behavior, not for replacing business-level design. ([square.github.io][5])

---

## 8. Debugging Checklist

### 8.1 Client Side

| Tool or signal | Purpose |
| --- | --- |
| curl `--write-out` | Break down DNS, TCP, TLS, TTFB, and total duration |
| OkHttp `EventListener` | Stage events for Java HTTP clients |
| Client connection-pool metrics | Judge acquire timeout, connection leak, and insufficient pool capacity |
| Exception classification metrics | Separate connect, read, write, deadline, and DNS timeout |
| Trace ID propagation | Correlate client, gateway, server, and downstream logs |
| Packet capture | Judge SYN retransmit, TLS handshake, TCP reset, and window blocking |

### 8.2 Gateway Side

| Tool or signal | Purpose |
| --- | --- |
| Access-log total duration | Full client-to-gateway duration |
| Upstream connect time | Whether gateway-to-upstream connect is slow |
| Upstream response time | Whether the upstream service is slow |
| Upstream status | Whether 502, 503, or 504 came from upstream path |
| Route-timeout metrics | Detect route-level timeout |
| Stream-idle reset metrics | Detect idle problems on streaming APIs |

### 8.3 Server Side

| Tool or signal | Purpose |
| --- | --- |
| Access log | Whether the request entered the application |
| Request queue time | Thread pool, event loop, or servlet-container pressure |
| Handler execution time | Business-logic duration |
| DB, RPC, or cache span duration | Downstream dependency duration |
| Cancellation-handling logs | Whether the server keeps running after client timeout |
| Slow queries and lock-wait metrics | Storage-layer root cause |

### 8.4 Infrastructure Side

| Tool or signal | Purpose |
| --- | --- |
| DNS query logs | Diagnose slow or failed resolution |
| tcpdump | Diagnose SYN retransmit, RST, FIN, and TCP-window issues |
| conntrack or NAT metrics | Diagnose SNAT port exhaustion or connection-tracking limits |
| CPU or GC metrics | Diagnose server jitter and slow TLS handshake |
| Packet-loss and retransmit metrics | Diagnose link quality |
| Load-balancer health checks | Diagnose bad instances or false-healthy instances |

---

## 9. Common Misjudgments and Corrections

| Misjudgment | Correction |
| --- | --- |
| Seeing read timeout means the network is slow | Read timeout may actually mean slow server processing, slow gateway upstream, or stalled body transfer |
| Seeing 504 means the client timeout should be enlarged | 504 is gateway waiting on upstream and should first lead to gateway-upstream diagnosis |
| Seeing 408 means backend slow queries | 408 means the server did not receive a complete request in time and should first lead to request-send diagnosis |
| The fix is always to increase timeout | Larger timeout may only hide resource exhaustion; stage root cause should be found first |
| Every API should use one identical timeout | Ordinary API, upload, download, streaming, and third-party API require different models |
| No total deadline is needed if stage timeouts exist | Stage timeouts do not replace the full-call upper bound |
| Deadline does not need propagation | Without propagation, downstream may keep consuming resources after upstream timeout |
| Retry does not need to count against deadline | Total duration can exceed caller budget |
| Server does not need to process cancellation | The client may already be gone while the server still burns resources |

---

## 10. Conclusion

Timeout definition and configuration in network communication must be upgraded from a single-parameter habit to a staged, layered, and observable system design. The full conclusion is:

1. **Timeout types must be understood by layer.** Clients, servers, gateways, RPC frameworks, and connection pools all have their own timeout semantics, phases, and configuration points.
2. **Root-cause diagnosis must be based on stage duration.** DNS, TCP, TLS, connection pool, request write, server processing, upstream proxy, response transfer, and stream idle all require separate observation. Exception names alone are not enough.
3. **HTTP 408 and 504 must be distinguished.** 408 means the server did not receive the full request in time, so request-send stages come first. 504 means a gateway did not receive the upstream response in time, so gateway-upstream and backend dependency paths come first.
4. **gRPC should use deadline as the core model.** Deadlines should be set explicitly and propagated downstream. Server-side cancellation must be handled, or client timeout will not actually stop resource consumption.
5. **Timeout values should not come from one universal second count.** A more reliable approach is to derive them from downstream latency percentiles, acceptable false-timeout rate, network padding, and business SLO.
6. **Total deadline and stage timeout must both exist.** Stage timeout protects and diagnoses local phases. Total deadline limits the whole call lifecycle.
7. **Debugging techniques should be standardized.** Client stage logs, curl timing, gateway upstream timing, OpenTelemetry traces, connection-pool metrics, packet capture, and infrastructure metrics should form a closed diagnostic loop.

The final conclusion can be summarized as:

> **The core of timeout governance is not "how many seconds should we configure?" but "at which layer, at which stage, while waiting for what, terminated by whom, observed how, and how the remaining budget is propagated." Only when stage-based location exists do timeout settings gain real engineering value.**

[1]: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/ "Timeouts, retries and backoff with jitter"
[2]: https://docs.oracle.com/javase/8/docs/api/java/net/SocketTimeoutException.html "SocketTimeoutException (Java Platform SE 8 )"
[3]: https://hc.apache.org/httpcomponents-client-4.5.x/current/httpclient/apidocs/org/apache/http/client/config/RequestConfig.html "RequestConfig (Apache HttpClient 4.5.14 API)"
[4]: https://docs.oracle.com/javase/8/docs/api/java/net/Socket.html "Socket (Java Platform SE 8 )"
[5]: https://square.github.io/okhttp/5.x/okhttp/okhttp3/-ok-http-client/index.html "OkHttpClient"
[6]: https://nginx.org/en/docs/http/ngx_http_core_module.html "Module ngx_http_core_module"
[7]: https://tomcat.apache.org/tomcat-9.0-doc/config/http.html "Apache Tomcat 9 Configuration Reference (9.0.117) - The HTTP Connector"
[8]: https://nginx.org/en/docs/http/ngx_http_proxy_module.html "Module ngx_http_proxy_module"
[9]: https://www.envoyproxy.io/docs/envoy/latest/faq/configuration/timeouts "How do I configure timeouts? - Envoy documentation"
[10]: https://grpc.io/docs/guides/deadlines/ "Deadlines | gRPC"
[11]: https://learn.microsoft.com/en-us/aspnet/core/grpc/deadlines-cancellation?view=aspnetcore-10.0 "Reliable gRPC services with deadlines and cancellation | Microsoft Learn"
[12]: https://square.github.io/okhttp/5.x/okhttp/okhttp3/-event-listener/index.html "EventListener"
[13]: https://curl.se/docs/manpage.html "curl - How To Use"
[14]: https://www.rfc-editor.org/rfc/rfc9110.html "RFC 9110: HTTP Semantics"
[15]: https://opentelemetry.io/docs/specs/semconv/http/ "Semantic conventions for HTTP | OpenTelemetry"
