## Abstract

Connection governance is a foundational part of distributed-system stability governance. Its scope includes TCP connections, HTTP/gRPC connections, database connections, connection pools, proxy-layer connections, kernel connection-tracking tables, and application-side resource handles. Connection problems often appear as too many connections, connection timeouts, accumulated `CLOSE_WAIT`, accumulated `TIME_WAIT`, exhausted connection pools, exhausted file descriptors, listen-queue overflow, and full NAT/conntrack tables. According to the TCP standard, `CLOSE-WAIT` means that the local endpoint is waiting for the local user to initiate connection termination, and `TIME-WAIT` means that the endpoint is waiting long enough to ensure that the remote endpoint has received the acknowledgement of connection termination. These states are not abnormal by themselves; the abnormality lies in count, duration, and business impact exceeding system capacity boundaries. ([IETF Datatracker][1])

This article explains connection governance from five perspectives: connection lifecycle, capacity model, timeout model, state-machine anomalies, and standardized handling flow. It also provides troubleshooting SOPs for development and SRE teams.

**Keywords**: connection governance; TCP; connection pool; CLOSE_WAIT; TIME_WAIT; timeout; connection leak; capacity governance; SOP

---

## 1. Introduction

In a microservice system, a single business request usually crosses a client connection pool, gateway, reverse proxy, server listen queue, application thread pool, database connection pool, cache connection pool, message-queue connection, and kernel network stack. The goal of connection governance is not simply to increase connection limits. It is to make connection creation, reuse, idleness, timeout, closing, and reclamation observable, bounded, degradable, and recoverable.

The wrong governance method is to directly increase `max_connections`, `ulimit -n`, or `somaxconn` when connection counts are high. These actions only enlarge the failure radius. They do not explain why connections grow, whether they are reused, whether they leak, whether they are held by a slow downstream, or whether a short-connection storm exists. Correct connection governance should start from four dimensions: application-layer connection pools, protocol-layer keep-alive, operating-system TCP states, and downstream service capacity boundaries.

---

## 2. Theoretical Foundations of Connection Governance

### 2.1 TCP Connection State Is the Basic Observation Object

A TCP connection is not a single state; it is a finite-state machine. RFC 9293 defines states such as `ESTABLISHED`, `FIN-WAIT-1`, `FIN-WAIT-2`, `CLOSE-WAIT`, and `TIME-WAIT`. `ESTABLISHED` means the connection is open and can transmit data, `CLOSE-WAIT` means waiting for the local user to initiate close, and `TIME-WAIT` means waiting long enough to ensure that the remote endpoint has received the connection-termination acknowledgement. ([IETF Datatracker][1])

On Linux, `ss` can be used to view socket statistics. Its official manual states that it dumps socket statistics and can show more TCP and state information than the traditional `netstat`. ([man7.org][2])

```bash
# Overall socket summary
ss -s

# Count TCP states
ss -ant | awk 'NR > 1 {count[$1]++} END {for (s in count) print s, count[s]}'

# Established connections by peer
ss -tan state established | awk 'NR > 1 {print $5}' | sort | uniq -c | sort -nr | head

# CLOSE-WAIT connections
ss -tanp state close-wait

# TIME-WAIT connections
ss -tan state time-wait
```

`lsof` can show files opened by a process. In Linux, sockets are also a kind of file descriptor, so it helps locate which process holds many connections. ([man7.org][3])

```bash
# Show network files opened by a process
lsof -nP -p <PID> -i

# Count opened file descriptors
ls /proc/<PID>/fd | wc -l
```

### 2.2 Connection Capacity Is Determined by Multiple Layers

Connection capacity is not a single configuration. It is the minimum of these boundaries:

1. Application connection-pool limits, such as HTTP client pools, JDBC pools, and Redis pools.
2. Server-side connection limits, such as MySQL `max_connections` and PostgreSQL `max_connections`.
3. Operating-system file descriptor limits, such as process `ulimit -n`.
4. TCP listen-queue capacity, such as `listen(backlog)` and `somaxconn`.
5. NAT/conntrack table capacity, such as `nf_conntrack_max`.
6. Proxy-layer connection reuse strategy, such as NGINX upstream keepalive.
7. Downstream service thread pools, workers, I/O model, and resource-isolation capability.

The Linux `listen(2)` documentation explains that `backlog` defines the maximum length of the pending-connections queue. When the queue is full, clients may receive an error, or protocols that support retransmission may behave as if the request was ignored and wait for later retry. ([man7.org][4])

The MySQL documentation explains that `Too many connections` means all available connections are occupied by other clients, and that the allowed connection count is controlled by `max_connections`. ([MySQL Developer Zone][5]) PostgreSQL documentation also states that `max_connections` determines the maximum number of concurrent connections to the database server, usually defaults to 100, and takes effect at server start. ([PostgreSQL][6])

---

## 3. Governance for Too Many Connections

### 3.1 Problem Definition

Too many connections is not a root cause. It is a result. It is usually caused by:

| Type | Typical Symptom | Root-Cause Direction |
| --- | --- | --- |
| Normal high concurrency | High `ESTABLISHED`, stable RT and error rate | Capacity planning |
| Connection leak | `ESTABLISHED` or `CLOSE_WAIT` grows monotonically | Application does not close connections |
| Short-connection storm | High `TIME_WAIT` | Connection reuse not enabled or frequent active close |
| Connection pool exhaustion | Business reports pool timeout | Downstream slow, pool too small, connection not returned |
| Database connection saturation | MySQL `Too many connections` | App instances × pool limit exceeds DB capacity |
| NAT table full | Packet loss and random connection failures | Insufficient conntrack capacity or too many short connections |
| Listen-queue overflow | connect timeout / reset | Slow accept, small backlog, high server load |

### 3.2 Governance Principles

When connection counts are too high, the first action is not to increase limits. It is to attribute connections. A reasonable attribution order is:

```bash
# 1. Observe total socket states
ss -s

# 2. Count TCP states
ss -ant | awk 'NR > 1 {count[$1]++} END {for (s in count) print s, count[s]}'

# 3. Find hot remote peers
ss -tan state established | awk 'NR > 1 {print $5}' | sort | uniq -c | sort -nr | head -20

# 4. Find process owners
ss -tanp | head -100

# 5. Check process file descriptors
ls /proc/<PID>/fd | wc -l
```

If connections concentrate on a database, check the application instance count, each instance's connection-pool limit, and database `max_connections`. For example, if 20 application instances each have HikariCP `maximumPoolSize=50`, the application can theoretically create 1000 database connections. If the database `max_connections=500`, the system does not have "occasional connection failures"; its capacity model is wrong.

HikariCP official configuration states that `maximumPoolSize` controls the maximum pool size, and `connectionTimeout` controls the longest time an application waits to obtain a connection from the pool. Oracle's HikariCP best practices also explain that when `connection-timeout` is reached, a "connection acquisition timed out" type of error is thrown, and the default is 30 seconds. ([GitHub][7])

### 3.3 Standard Governance Actions

Actions for too many connections should be executed by priority:

**First, reduce unnecessary connections.** HTTP, gRPC, database, Redis, and Kafka clients should reuse long-lived connections rather than creating a new connection for every request. NGINX documentation states that `keepalive_timeout` controls how long idle keepalive connections remain open, and the upstream module also supports control over idle upstream keepalive connections. ([Nginx][8])

**Second, bound connection-pool limits at every layer.** Application-side pool limits must be lower than downstream capacity and must reserve space for management connections, operations connections, and bursts. Database pools are not better when larger. Oversized pools move queuing from the application layer into the database, worsening CPU, memory, lock waits, and context switching.

**Third, establish a connection budget.** A recommended formula is:

```text
Downstream maximum supported connections >= application instance count × per-instance pool limit + reserved connections
```

If this formula does not hold, lower the per-instance pool size, add an intermediate pooling proxy, or rate-limit callers before blindly increasing database connections.

**Fourth, fix connection leaks.** For Java services, focus on whether HTTP response bodies, JDBC ResultSet/Statement/Connection objects, Redis connections, gRPC channels, and file streams are correctly closed. A leak is usually characterized by monotonically increasing connection counts that do not fully follow QPS.

**Fifth, adjust system limits last.** Only after confirming that the connections are valid business connections, the downstream can bear them, the application has no leak, and pool configuration is reasonable should system parameters such as `ulimit -n`, `somaxconn`, `nf_conntrack_max`, and database `max_connections` be adjusted. Linux kernel documentation states that `nf_conntrack_max` is the size of the connection-tracking table, with a default related to `nf_conntrack_buckets`. ([Linux Kernel][9])

---

## 4. Locating and Governing Frequent Connection Timeouts

### 4.1 Timeout Classification

Connection timeouts must be classified first. Mixing timeout types leads to wrong handling.

| Timeout Type | Stage | Common Exception Direction | Main Investigation Target |
| --- | --- | --- | --- |
| Connection-pool acquire timeout | Borrowing from pool | pool timeout | Pool exhaustion, connection not returned, slow downstream |
| DNS timeout | Name resolution | UnknownHost / DNS timeout | DNS, CoreDNS, cache |
| TCP connect timeout | Three-way handshake | connect timeout | Network, firewall, listen queue, service not listening |
| TLS handshake timeout | TLS negotiation | SSL handshake timeout | Certificate, CPU, proxy, network |
| read / response timeout | Request sent, waiting for response | socket timeout / read timeout | Slow downstream, full thread pool, slow SQL |
| idle timeout | Idle connection closed | connection reset / broken pipe | keepalive mismatch, proxy recycle |
| request deadline timeout | End-to-end budget exceeded | deadline exceeded | Whole call chain exceeds budget |

The Java `HttpClient` API provides `connectTimeout()`, which returns the connection timeout configured in the client builder, or empty if unset. ([Oracle Docs][10]) In Apache HttpClient 5, `connectionRequestTimeout` is the wait timeout for requesting a connection from the connection manager, `connectTimeout` is the timeout before a new connection is fully established and may include SSL/TLS negotiation, and `responseTimeout` is the timeout waiting for the peer response. ([hc.apache.org][11])

### 4.2 Diagnosis Flow

Connection-timeout diagnosis should be divided into four segments: client, network path, server, and downstream dependency.

**Step 1: confirm the timeout type.**
If logs contain "connection acquisition timed out," it is usually a connection-pool acquire timeout. If they contain "connect timed out," it usually failed during TCP connection establishment. If they contain "Read timed out" or "response timeout," the connection may already be established, but the peer did not return data in time.

**Step 2: confirm the timeout target.**
Aggregate timeout target domain names, IPs, ports, APIs, callers, error codes, and latency distributions. Do not look only at total error rate; aggregate by peer.

```bash
# Connections to a target
ss -tanp | grep ':<PORT>'

# SYN-SENT often indicates connection establishment is blocked or slow
ss -tan state syn-sent

# Established connections to a peer
ss -tan state established | grep '<TARGET_IP>'
```

**Step 3: confirm whether the server can accept connections.**
If the server is in `LISTEN` but the client sees connect timeout, check server CPU, accept speed, listen backlog, load balancer, and iptables/security group. The Linux `listen(2)` documentation explains that when the pending-connection queue is full, clients may receive errors or wait for retransmission, which appears as slow connection or timeout on the client. ([man7.org][4])

**Step 4: confirm whether the connection pool is exhausted.**
Pool exhaustion is usually not as simple as "the pool is too small." Common root causes include slow downstream responses that hold connections for a long time, or business code that does not release connections. HikariCP's `connectionTimeout` is the maximum time an application waits for a pool connection; when reached, a connection-acquisition timeout is thrown. ([Oracle Blog][12])

**Step 5: check idle connection invalidation.**
If many errors appear as `connection reset by peer`, `broken pipe`, or the first request fails while the second succeeds, the idle connection kept by the client pool has usually been closed by an intermediate proxy or server. Linux TCP keepalive starts probing only after a default 7200 seconds of idleness, and probes are sent only when `SO_KEEPALIVE` is enabled on the socket. ([man7.org][13]) Therefore, application-layer pool idle timeout, max lifetime, and keepalive time should be lower than or aligned with the idle recycle time of proxies, load balancers, NAT, and servers.

### 4.3 Solutions

Connection-timeout governance should follow the principle of layered timeouts, end-to-end deadlines, and fast resource release on failure.

Recommended minimum model:

```yaml
http-client:
  poolAcquireTimeout: 100ms-500ms
  connectTimeout: 300ms-1000ms
  tlsHandshakeTimeout: 1000ms-3000ms
  readTimeout: 1000ms-5000ms
  requestDeadline: 1500ms-6000ms
  maxConnections: bounded
  maxIdleTime: less-than-lb-idle-time
```

For core paths, distinguish connection-pool wait time, connection establishment time, response wait time, and end-to-end total duration. Setting only read timeout is not enough. Setting only connect timeout is also not enough. Without a pool-acquire timeout, threads queue on the pool. Without an end-to-end deadline, automatic retries, DNS multi-IP rotation, and proxy retries may make real duration exceed the business SLA.

---

## 5. Causes and Governance of Excessive CLOSE_WAIT

### 5.1 State Meaning

`CLOSE_WAIT` is a state in the TCP passive-close path. RFC 9293 defines `CLOSE-WAIT` as waiting for the local user to initiate a connection-termination request. ([IETF Datatracker][1]) In engineering language, the remote endpoint has already sent FIN, the local kernel has received the close signal, but the local application has not called close to release the socket.

Therefore, excessive `CLOSE_WAIT` is usually an application problem, not a kernel-parameter problem. Increasing kernel parameters cannot solve `CLOSE_WAIT` buildup; it only lets the leak last longer.

### 5.2 Common Causes

Excessive `CLOSE_WAIT` usually comes from:

1. HTTP client response body is not closed.
2. JDBC Connection / Statement / ResultSet is not closed.
3. Netty channel is not closed on exception paths.
4. gRPC channel or stream lifecycle is managed incorrectly.
5. Exception branch returns early and skips finally close.
6. Connection-pool eviction is unreasonable and invalid connections remain.
7. Thread blocking prevents close logic from executing.
8. Long-connection protocols handle only read/write errors and not peer-close events.

### 5.3 Diagnosis

```bash
# Find CLOSE-WAIT sockets with process info
ss -tanp state close-wait

# Inspect process descriptors
lsof -nP -p <PID> -iTCP

# Count CLOSE-WAIT by process
ss -tanp state close-wait | awk -F'pid=' '/pid=/ {split($2,a,","); print a[1]}' | sort | uniq -c | sort -nr
```

After locating the process, continue with three checks:

1. Inspect the remote peer address to identify the downstream.
2. Check application logs for read timeout, EOF, or connection reset followed by unreleased connections.
3. Collect Java thread dumps to see whether threads are blocked on I/O, locks, connection pools, database drivers, or before business finally blocks.

```bash
# Capture Java thread dump
jcmd <PID> Thread.print > thread-dump.txt

# Or use jstack
jstack <PID> > thread-dump.txt
```

### 5.4 Solutions

The core solution for `CLOSE_WAIT` is to fix application close semantics.

Java HTTP client code must ensure the response body is closed:

```java
try (CloseableHttpResponse response = client.execute(request)) {
    // Consume response body here
}
```

JDBC code must use try-with-resources:

```java
try (Connection conn = dataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    // Handle result set here
}
```

Netty code must close the channel on exceptions, peer close, and business timeout paths:

```java
@Override
public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
    ctx.close();
}
```

The conclusion is clear: when there is too much `CLOSE_WAIT`, check code and connection-pool release paths first. Do not tune system parameters first.

---

## 6. Causes and Governance of Excessive TIME_WAIT

### 6.1 State Meaning

`TIME_WAIT` is entered by the active closer. In RFC 9293, `TIME-WAIT` means waiting long enough to ensure that the remote endpoint has received the acknowledgement of connection termination. ([IETF Datatracker][1]) Therefore, `TIME_WAIT` is part of normal TCP close semantics and should not be treated simply as an error.

### 6.2 Common Causes

Excessive `TIME_WAIT` usually means the local host is actively closing many connections. Common causes include:

1. Client does not use a connection pool or keep-alive and creates short connections for every request.
2. HTTP proxy does not enable connection reuse to upstream.
3. Server actively closes many short connections.
4. Health checks are too frequent.
5. Crawlers, probes, or load tests cause short-connection storms.
6. NAT, LB, Sidecar, and gateway connection-reuse strategies are inconsistent.
7. Application quickly retries after exceptions, creating a loop of connection creation and close.

### 6.3 Diagnosis

```bash
# Count TIME-WAIT
ss -tan state time-wait | wc -l

# Find hot remote peers in TIME-WAIT
ss -tan state time-wait | awk 'NR > 1 {print $5}' | sort | uniq -c | sort -nr | head -20

# Compare established and time-wait
ss -s
```

If `TIME_WAIT` concentrates on one downstream IP:PORT, check whether the caller enables connection pooling, whether HTTP keep-alive is enabled, and whether there is a retry storm. If it concentrates between NGINX and upstream, check upstream keepalive configuration. NGINX upstream documentation provides `keepalive_timeout` to set the time that idle keepalive connections to upstream servers remain open. ([Nginx][14])

### 6.4 Solutions

The priority for `TIME_WAIT` governance is:

**First, enable connection reuse.**
HTTP clients, gRPC clients, and database clients should reuse connections. Short connections are not the default option for high-concurrency systems.

**Second, move the active closer backward.**
If the client has many `TIME_WAIT` connections, the client is usually actively closing. Connection pools, keep-alive, and proxy reuse can reduce the client's active-close frequency.

**Third, govern retry storms.**
Retries must have backoff, jitter, and total budget. Retries without backoff create connection storms and amplify `TIME_WAIT`.

**Fourth, tune kernel parameters carefully.**
Linux TCP keepalive, TIME_WAIT, and FIN_WAIT parameters have system-wide impact and should not be the first solution. Linux `tcp(7)` states that the default TCP keepalive idle time is 7200 seconds and probes are sent only when `SO_KEEPALIVE` is enabled. ([man7.org][13]) This shows that system defaults do not automatically protect every business connection pool; applications still need correct connection-lifecycle configuration.

---

## 7. Other Typical Connection Problems and SOPs

### 7.1 Connection Pool Exhaustion SOP

**Symptom**: application logs show connection acquisition timeout, pool exhausted, or get connection timeout.

**Diagnosis flow**:

```bash
# Check app connections to downstream
ss -tanp | grep '<DOWNSTREAM_PORT>'

# Check process fd count
ls /proc/<PID>/fd | wc -l

# Check CLOSE-WAIT leakage
ss -tanp state close-wait | grep '<PID>'
```

**Handling steps**:

1. Confirm connection-pool acquire timeout, not TCP connect timeout.
2. Check pool metrics: active, idle, pending, max.
3. If active approaches max and pending grows, the pool is occupied.
4. Check downstream RT, slow SQL, slow API, and lock waits.
5. Check whether connections are not released.
6. Temporarily degrade non-core calls to reduce pool occupation.
7. Long-term fix: set reasonable `maximumPoolSize`, `connectionTimeout`, `idleTimeout`, `maxLifetime`, leak detection, and call isolation.

### 7.2 Database Too Many Connections SOP

**Symptom**: MySQL reports `Too many connections`. MySQL official documentation states that this error means all available connections are occupied by other clients, and connection count is controlled by `max_connections`. ([MySQL Developer Zone][5])

**Diagnosis flow**:

```sql
SHOW VARIABLES LIKE 'max_connections';
SHOW STATUS LIKE 'Threads_connected';
SHOW STATUS LIKE 'Max_used_connections';
SHOW PROCESSLIST;
```

**Handling steps**:

1. Count application instances and per-instance connection-pool limits.
2. Calculate theoretical maximum connections.
3. Find the application with the most connections.
4. Kill abnormal idle long transactions or abnormal sessions.
5. Temporarily reduce call traffic or scale read-only instances.
6. Long-term: introduce connection-pool governance, read/write isolation, slow-query governance, and database connection budgets.

The wrong approach is only increasing `max_connections`. If database CPU, memory, and lock waits are already bottlenecks, increasing connection count only moves queuing from the application layer into the database.

### 7.3 Listen Backlog Overflow SOP

**Symptom**: client connect timeout, connection refused, occasional connection failure, while the server port is in LISTEN.

Linux `listen(2)` explains that when the pending-connection queue is full, clients may receive errors or requests may be ignored and rely on later retry. ([man7.org][4])

**Diagnosis flow**:

```bash
# Check listening sockets
ss -ltnp

# Check SYN-SENT on client
ss -tan state syn-sent

# Check system backlog setting
sysctl net.core.somaxconn
sysctl net.ipv4.tcp_max_syn_backlog
```

**Handling steps**:

1. Check whether server CPU is too high.
2. Check whether accept threads are blocked.
3. Check whether application workers are full.
4. Check backlog and `somaxconn`.
5. Check whether the LB sends burst connections to backends.
6. Temporarily scale service instances.
7. Long-term: optimize accept model, thread-pool isolation, connection reuse, and rate limiting.

### 7.4 Conntrack Table Full SOP

**Symptom**: random packet loss, connection failure, DNS failure, or logs showing conntrack table full on Kubernetes, NAT gateways, or high-concurrency nodes.

Linux kernel documentation states that `nf_conntrack_max` is the connection-tracking table size, with a default of `nf_conntrack_buckets * 4`. ([Linux Kernel][9]) Kubernetes documentation states that kernel parameters can be configured through the sysctl interface in clusters. ([Kubernetes][15])

**Diagnosis flow**:

```bash
# Current conntrack entries
cat /proc/sys/net/netfilter/nf_conntrack_count

# Conntrack limit
cat /proc/sys/net/netfilter/nf_conntrack_max

# Kernel logs
dmesg | grep -i conntrack
```

**Handling steps**:

1. Confirm whether usage is close to `nf_conntrack_max`.
2. Find the short-connection source.
3. Check whether DNS, HTTP, probes, or log reporting cause a short-connection storm.
4. Temporarily increase `nf_conntrack_max`.
5. Long-term: reduce short connections, enable connection reuse, reduce retry storms, and split node traffic.

### 7.5 Idle Connections Closed by Intermediate Layers SOP

**Symptom**: the first low-frequency request fails and the second succeeds; logs show `connection reset by peer` or `broken pipe`.

**Diagnosis flow**:

1. Confirm client connection-pool idle time.
2. Confirm NGINX/LB/NAT/server idle timeout.
3. Confirm whether the client enables keepalive probes.
4. Capture the idle duration of failed connections.
5. Compare failure time with intermediate-layer timeouts.

NGINX documentation states that `keepalive_timeout` controls how long keep-alive client connections remain open on the server. ([Nginx][8]) Linux TCP keepalive starts only after the default 7200 seconds and cannot replace application-side connection-pool lifecycle governance. ([man7.org][13])

**Handling steps**:

1. Client pool `maxIdleTime` should be less than LB / NGINX / NAT idle timeout.
2. Enable keepalive for important long-lived connections.
3. Perform one safe retry for connection-reuse failures.
4. Forbid blind retries for non-idempotent requests.
5. Include idle close, reset, and broken pipe in metrics.

### 7.6 File Descriptor Exhaustion SOP

**Symptom**: logs show `Too many open files`, new connections fail, and the application cannot open files, sockets, or log files.

**Diagnosis flow**:

```bash
# Process fd usage
ls /proc/<PID>/fd | wc -l

# Process fd limit
cat /proc/<PID>/limits | grep "open files"

# Top opened network files
lsof -nP -p <PID> | wc -l
```

**Handling steps**:

1. Determine whether fds are sockets, files, pipes, or eventfd.
2. If sockets dominate, continue diagnosis by TCP state.
3. If files dominate, check file-stream close paths.
4. Temporarily increase process `LimitNOFILE`.
5. Long-term: fix resource release paths and add fd-usage alerts.

---

## 8. Engineering Metrics for Connection Governance

Connection governance must be metricized; otherwise, troubleshooting relies on manual investigation during incidents. At least the following metrics are recommended:

| Metric Type | Metrics |
| --- | --- |
| TCP states | ESTABLISHED, SYN-SENT, SYN-RECV, CLOSE-WAIT, TIME-WAIT, FIN-WAIT |
| Connection pools | active, idle, pending, max, acquire timeout, creation count, eviction count |
| Timeouts | connect timeout, read timeout, response timeout, pool acquire timeout, TLS timeout |
| Downstream dimensions | peer IP, port, service, route, method, status, error type |
| System resources | fd usage, `somaxconn`, conntrack usage, CPU, load, NIC packet drops |
| Proxy layer | NGINX active/reading/writing/waiting, upstream keepalive, upstream error |
| Database | current connections, max connections, active sessions, idle transactions, slow SQL, lock waits |

The core criterion for connection governance is not "whether connection count is high," but "whether connection count matches traffic, latency, error rate, pool usage, and downstream capacity."

---

## 9. Standardized Troubleshooting SOP Summary

| Scenario | First Observation | Primary Judgment | Priority Handling |
| --- | --- | --- | --- |
| Too many connections | `ss -s`, count by state | Normal concurrency, leak, or short-connection storm | Attribute first, then rate-limit, reuse, or fix leak |
| Connection pool exhausted | active/idle/pending | Pool too small or downstream slow | Check downstream RT and connection release |
| connect timeout | `SYN-SENT`, server LISTEN | Network blocked or accept slow | Check network, firewall, backlog |
| read timeout | downstream RT, thread pool, SQL | Connection established but response slow | Check slow API, slow SQL, locks |
| Too much CLOSE_WAIT | `ss state close-wait -p` | Application did not close | Fix finally / try-with-resources |
| Too much TIME_WAIT | peer aggregation | Short connections or frequent active close | Enable connection reuse and backoff retries |
| Too many connections | DB current connections | Application connection budget is wrong | Limit pool, check leak, then tune limits |
| Conntrack full | count/max | NAT table insufficient or too many short connections | Increase limit and reduce short connections |
| fd exhausted | `/proc/<PID>/fd` | Socket leak or file leak | Fix release path, tune NOFILE |

---

## 10. Conclusion

Connection governance is not a single-parameter tuning task. It is lifecycle governance across applications, protocols, proxies, kernels, and downstream dependencies. Excessive `CLOSE_WAIT` usually points to the local application not closing connections. Excessive `TIME_WAIT` usually points to short connections or frequent active closes. Connection timeouts must first be classified into connection-pool acquire timeout, TCP connect timeout, TLS handshake timeout, read/response timeout, and end-to-end deadline timeout. Too many connections must first be attributed before deciding whether to reuse, rate-limit, fix leaks, scale out, or adjust system parameters.

A qualified connection-governance system should satisfy four conditions: first, every connection pool has a limit; second, every external call has layered timeouts and an end-to-end deadline; third, every connection state is observable; fourth, every abnormal connection state has an SOP. Without these four conditions, a high-concurrency system can amplify a local connection problem into a full-path avalanche.

---

## References

1. RFC 9293, Transmission Control Protocol (TCP). ([IETF Datatracker][1])
2. Linux man-pages, `tcp(7)`. ([man7.org][13])
3. Linux man-pages, `ss(8)`. ([man7.org][2])
4. Linux man-pages, `lsof(8)`. ([man7.org][3])
5. Linux man-pages, `listen(2)`. ([man7.org][4])
6. Linux Kernel Documentation, `nf_conntrack_max`. ([Linux Kernel][9])
7. MySQL Reference Manual, Too many connections. ([MySQL Developer Zone][5])
8. PostgreSQL Documentation, Connections and Authentication. ([PostgreSQL][6])
9. HikariCP GitHub Documentation. ([GitHub][7])
10. Oracle Developers, HikariCP Best Practices for Oracle Database and Spring Boot. ([Oracle Blog][12])
11. Oracle Java SE 21 API, `java.net.http.HttpClient`. ([Oracle Docs][10])
12. Apache HttpClient 5 API, `RequestConfig.Builder`. ([hc.apache.org][11])
13. NGINX Documentation, `ngx_http_core_module` and `ngx_http_upstream_module`. ([Nginx][8])

[1]: https://datatracker.ietf.org/doc/html/rfc9293 "RFC 9293 - Transmission Control Protocol (TCP)"
[2]: https://man7.org/linux/man-pages/man8/ss.8.html "ss(8) - Linux manual page"
[3]: https://man7.org/linux/man-pages/man8/lsof.8.html "lsof(8) - Linux manual page"
[4]: https://man7.org/linux/man-pages/man2/listen.2.html "listen(2) - Linux manual page"
[5]: https://dev.mysql.com/doc/en/too-many-connections.html "B.3.2.5 Too many connections"
[6]: https://www.postgresql.org/docs/current/runtime-config-connection.html "Documentation: 18: 19.3. Connections and Authentication"
[7]: https://github.com/brettwooldridge/HikariCP "brettwooldridge/HikariCP"
[8]: https://nginx.org/en/docs/http/ngx_http_core_module.html "Module ngx_http_core_module"
[9]: https://www.kernel.org/doc/Documentation/networking/nf_conntrack-sysctl.txt "nf_conntrack-sysctl.txt"
[10]: https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/java/net/http/HttpClient.html "HttpClient (Java SE 21 & JDK 21)"
[11]: https://hc.apache.org/httpcomponents-client-5.6.x/current/httpclient5/apidocs/org/apache/hc/client5/http/config/RequestConfig.Builder.html "RequestConfig.Builder (Apache HttpClient 5 API)"
[12]: https://blogs.oracle.com/developers/hikaricp-best-practices-for-oracle-database-and-spring-boot "HikariCP Best Practices for Oracle Database and Spring Boot"
[13]: https://man7.org/linux/man-pages/man7/tcp.7.html "tcp(7) - Linux manual page"
[14]: https://nginx.org/en/docs/http/ngx_http_upstream_module.html "Module ngx_http_upstream_module"
[15]: https://kubernetes.io/docs/tasks/administer-cluster/sysctl-cluster/ "Using sysctls in a Kubernetes Cluster"
