---
title: "Connection Reset by Peer: TCP RST, Connection Lifecycle, and Engineering Troubleshooting"
category: Network Reliability
summary: A systematic explanation of Connection reset by peer, TCP RST semantics, lifecycle timing, common production causes, and practical troubleshooting methods for long-lived network connections.
tags:
  - TCP
  - ECONNRESET
  - RST
  - Keepalive
  - Network Troubleshooting
readingDirection: Read this when diagnosing connection resets, long-connection disconnects, stale connection-pool reuse, idle timeouts, or registry watch failures.
outline: deep
---

# Connection Reset by Peer: TCP RST, Connection Lifecycle, and Engineering Troubleshooting

## Overview

A systematic explanation of Connection reset by peer, TCP RST semantics, lifecycle timing, common production causes, and practical troubleshooting methods for long-lived network connections.

## Abstract

`Connection reset by peer` is a common network-programming error. It usually maps to `ECONNRESET` on POSIX/Linux, meaning that while the local process was using a TCP connection, the peer or an intermediate network device forcibly reset that connection with a TCP RST packet. Linux `errno(3)` describes `ECONNRESET` as "Connection reset", and `send(2)` also lists `ECONNRESET` as the error returned when a connection is reset by its peer. ([man7.org][1])

From the TCP protocol perspective, a connection can end in two basic ways. One is an orderly FIN handshake. The other is an abort or reset, where one side sends one or more RST packets and immediately discards connection state. RFC 9293 states that a TCP connection can be terminated through the normal FIN path or aborted through RST, and that an application must be able to learn whether the connection was closed normally or aborted. ([IETF Datatracker][2])

This article answers three engineering questions:

- In which TCP lifecycle stage does `Connection reset by peer` appear?
- What causes it in real systems?
- How should engineers locate and fix it in production?

**Keywords:** Connection reset by peer, ECONNRESET, TCP RST, three-way handshake, four-way close, idle timeout, keepalive, registry center, long-lived connection

---

## 1. Why This Error Is Common in Engineering Systems

In microservices, registry centers, gateways, RPC frameworks, HTTP connection pools, gRPC streams, WebSocket links, and service-discovery watches, applications usually reuse long-lived connections instead of opening a new TCP connection for every request. Once a connection lives for a long time, it is affected by more factors:

```text
client timeout
server restart
connection-pool reuse of stale connections
LB / Nginx / Envoy / NAT idle timeout
TLS / HTTP protocol mismatch
application-level active close
slow clients
server overload
TCP keepalive failure
```

Some of these paths close the connection with FIN. Others trigger RST. When an application sees RST, the common symptoms are:

```text
Connection reset by peer
java.net.SocketException: Connection reset
java.io.IOException: Connection reset by peer
read: connection reset by peer
write: connection reset by peer
ECONNRESET
WSAECONNRESET
```

IBM MQ documentation also notes that `ECONNRESET` has different return codes on different platforms, such as `104` on Linux and `WSAECONNRESET 10054` on Windows. ([IBM][3])

---

## 2. Protocol Semantics of TCP RST

The TCP header contains control flags such as SYN, ACK, FIN, and RST. SYN is used to establish a connection, FIN is used for orderly shutdown, and RST is used to reset a connection.

RFC 9293 gives clear rules for reset generation. As a general principle, when a TCP endpoint receives a segment that obviously does not belong to the current connection, it can send a reset. If no connection exists, meaning the endpoint is in CLOSED state, any incoming segment except another RST is answered with a reset. ([IETF Datatracker][2])

The semantics can be summarized as:

```text
FIN:
  I have no more data to send, but the connection can be closed through
  the normal TCP state machine.

RST:
  This connection is invalid immediately. Connection state may be discarded,
  and outstanding data is no longer guaranteed to be delivered.
```

Cloudflare's explanation of TCP reset follows the same idea: one side sends an RST packet to tell the other side to close the connection immediately and discard connection state; reset is commonly used for unrecoverable errors. ([The Cloudflare Blog][4])

Therefore, `Connection reset by peer` does not simply mean "the peer closed the connection." It means the peer, or something on the network path, forcibly reset it.

---

## 3. Where RST Appears in the TCP Lifecycle

The TCP lifecycle can be simplified into three phases:

```text
connection establishment:
  three-way handshake

data transfer:
  ESTABLISHED

connection shutdown:
  FIN close / half close / TIME_WAIT
```

RST can appear in several of these phases, but the application-level symptom differs.

---

## 4. RST During the Three-Way Handshake

The normal TCP handshake is:

```text
Client                                      Server

SYN ------------------------------->       SYN-RECEIVED

SYN + ACK <-------------------------

ACK ------------------------------->       ESTABLISHED
```

RFC 9293 describes the handshake as the process in which one endpoint sends SYN, the peer returns SYN+ACK, and the initiator then sends ACK so both sides enter ESTABLISHED. ([IETF Datatracker][2])

RST may appear during this phase in several cases.

### 4.1 No Server Is Listening on the Target Port

If the client sends SYN to a host that exists, but no process is listening on the target port, the kernel commonly replies with RST. The client usually sees:

```text
Connection refused
ECONNREFUSED
```

This is a connection-establishment failure and does not always surface as `Connection reset by peer`.

### 4.2 Abnormal Half-Open or Handshake State

If a connection is in `SYN-SENT` or `SYN-RECEIVED` and receives an unacceptable ACK or a mismatched segment, the protocol allows a reset. RFC 9293 distinguishes unsynchronized states such as `LISTEN`, `SYN-SENT`, and `SYN-RECEIVED`, and describes reset behavior for invalid ACKs in those states. ([IETF Datatracker][2])

### 4.3 Abort Before or After accept

The kernel may have finished part of the handshake, but the application, proxy, security policy, backlog pressure, or protocol detector may reject the connection and cause RST.

Engineering symptoms include:

```text
connect succeeds, then the first read or write fails
TLS handshake resets
HTTP request resets immediately after being sent
```

### 4.4 Phase Conclusion

RST can happen during the handshake, but typical `Connection reset by peer` more often occurs after the connection has already been established and the application performs read or write. If RST answers the initial SYN, the application more commonly sees `Connection refused`.

---

## 5. RST During ESTABLISHED Data Transfer

`ESTABLISHED` is the normal TCP data-transfer state. RFC 9293 describes it as the open-connection state in which incoming data can be delivered to the user. ([IETF Datatracker][2])

This is the most common phase for `Connection reset by peer`.

```text
Client                                      Server

connection is ESTABLISHED

DATA ------------------------------>       Server

                    Server sends RST

RST <-------------------------------

Client read/write:
  ECONNRESET / Connection reset by peer
```

In this phase, if either side forcibly closes the connection, the other side may see reset on a later read or write.

---

## 6. RST Around the Four-Way Close

A normal TCP close roughly looks like this:

```text
active closer                                 passive closer

FIN ------------------------------->         CLOSE-WAIT

ACK <-------------------------------

                         application closes and sends FIN

FIN <-------------------------------         LAST-ACK

ACK ------------------------------->         CLOSED
```

RFC 9293 describes this normal close sequence: the active closer sends FIN and enters `FIN-WAIT-1`, then `FIN-WAIT-2`, then waits for the peer's FIN, and eventually enters `TIME-WAIT`; the peer enters `CLOSE-WAIT`, sends FIN when the application closes, and then enters `LAST-ACK`. ([IETF Datatracker][2])

RST is not the normal result of a four-way close. It means that before, during, or after the orderly FIN path, one side aborted the connection.

Common examples:

```text
The client times out after sending a request and directly closes the connection.
The server later writes the response and discovers that the peer has reset.

The server is shutting down while unsent data remains in the send buffer.
The application uses abortive close.
The peer sees reset when it reads or writes.

A connection is already half-closed.
The other side writes data that does not fit the current state.
This can trigger reset.
```

RFC 9293 explicitly states that a TCP connection can be closed normally with FIN or aborted with RST, in which case connection state is discarded immediately. ([IETF Datatracker][2])

---

## 7. Lifecycle Location Table

| TCP phase | TCP state | Can RST appear? | Common application symptom | Notes |
| --- | --- | ---: | --- | --- |
| Before handshake | CLOSED / LISTEN | Possible | `ECONNREFUSED` is more common | A SYN to a closed port often receives RST |
| During handshake | SYN-SENT / SYN-RECEIVED | Possible | connect failure, TLS/HTTP startup failure | Invalid ACKs, old SYNs, or policy rejection can reset |
| Just after handshake | Early ESTABLISHED | Common | `Connection reset by peer` | Proxy, server, or protocol detector resets after accept |
| Data transfer | ESTABLISHED | Most common | read/write returns `ECONNRESET` | Peer close, proxy reset, or stale connection reuse |
| Normal close | FIN-WAIT-1/2, CLOSE-WAIT, LAST-ACK | Possible | EOF, Broken pipe, or reset | FIN should produce EOF; abort produces reset |
| TIME_WAIT related | TIME-WAIT | Possible | Usually connection errors or kernel drop | Old segments, port reuse, and invalid segments can complicate behavior |

---

## 8. Cause Categories and Fixes

The error text alone is not the root cause. It only tells us that this endpoint received RST from a peer or intermediate device.

### 8.1 Application Abort or Forced Close

Typical causes:

```text
peer process crashes
service is killed with kill -9
container is forcibly stopped
rolling release kills active connections
application code directly closes the socket
SO_LINGER=0 causes abortive close
```

Symptoms:

```text
reset spikes during releases, restarts, or scaling
client is in-flight while server restarts
server has no complete response log
client read reports Connection reset by peer
```

Fixes:

```text
use graceful shutdown
remove traffic before stopping the process
wait for in-flight requests to finish
send graceful close / GOAWAY for long-lived protocols
avoid unnecessary SO_LINGER=0
configure terminationGracePeriodSeconds reasonably
clean up subscriptions and connection state before exit
```

### 8.2 Client Timeout or Request Cancellation

Typical causes:

```text
read timeout is too short
caller cancels after deadline
browser refreshes or closes
upstream gateway cancels
RPC deadline expires
circuit breaker gives up
```

When the server later writes the response, it may see:

```text
Connection reset by peer
Broken pipe
client prematurely closed connection
```

Fixes:

```text
make client timeout cover reasonable server processing time
use server-side limits and degradation for slow requests
after write failure, clean up resources instead of retrying on the same connection
downgrade expected client-cancellation logs instead of marking all as ERROR
propagate RPC deadlines and cancellation to the server
```

### 8.3 Idle Timeout and Keepalive Mismatch

Long-lived idle connections can be cleaned up by intermediate devices or servers:

```text
LB idle timeout
Nginx keepalive_timeout / proxy_read_timeout
Envoy stream_idle_timeout / idle_timeout
NAT idle timeout
firewall connection-tracking timeout
server idle timeout
client connection-pool idle timeout
```

Cloudflare notes that a timeout defines how long a connection can remain active without data or acknowledgements, and that Keep-Alive can help keep idle connections open. ([The Cloudflare Blog][4])

Typical symptoms:

```text
resets appear at fixed times such as 60s, 90s, or 300s
service-discovery watch disconnects when there are no instance changes
the first request after an idle period fails
client reuses an old connection and immediately gets reset
```

Core configuration rule:

```text
heartbeatInterval < idleTimeout
clientReadTimeout > heartbeatInterval
clientConnectionPoolMaxIdleTime < serverKeepAliveTimeout
```

Example:

```yaml
watch:
  heartbeatInterval: 20s
  heartbeatTimeout: 10s
  idleTimeout: 60s
  clientReadTimeout: 90s
```

Linux `tcp(7)` explains that `TCP_USER_TIMEOUT` applies in synchronized states such as `ESTABLISHED`, `FIN-WAIT-1`, `FIN-WAIT-2`, `CLOSE-WAIT`, `CLOSING`, and `LAST-ACK`; when used with `SO_KEEPALIVE`, it overrides keepalive behavior for deciding when to close after keepalive failure. ([man7.org][5])

### 8.4 Connection Pool Reuses a Stale Connection

Typical path:

```text
server closes an idle connection
LB has already removed the connection
client pool still marks it as usable
next request reuses the connection
write or read receives RST
```

Fixes:

```text
set client maxIdleTime lower than server keepAliveTimeout
enable connection validation when appropriate
allow one safe retry for idempotent requests
align server and proxy keepalive timeout
avoid holding idle connections too long
```

Example:

```text
server keepAliveTimeout = 60s
client connection-pool maxIdleTime = 50s
```

### 8.5 Protocol Mismatch

Typical causes:

```text
HTTP request to HTTPS port
HTTPS request to HTTP port
gRPC through a proxy that only supports HTTP/1.1
wrong HTTP/2 preface
TLS SNI mismatch
TLS version or cipher mismatch
certificate validation failure
cleartext protocol sent to TLS listener
```

Typical symptoms:

```text
connection resets immediately after establishment
TLS handshake fails
curl reports connection reset
no application-layer request log exists on the server
proxy logs protocol error
```

Fixes:

```text
verify URL scheme: http or https
verify port and protocol
verify proxy HTTP/2 support
verify TLS certificate, SNI, and ALPN
capture packets to locate ClientHello, ServerHello, and RST
check Nginx, Envoy, and Ingress logs
```

### 8.6 Server Overload or Resource Exhaustion

Typical causes:

```text
fd exhaustion
full accept queue
thread-pool exhaustion
event-loop blockage
memory pressure
container OOM
CPU saturation
send-buffer backlog
slow clients
connection limit exceeded
```

Troubleshooting commands:

```bash
# Check socket summary
ss -s

# Check TCP connections
ss -antp | grep <port>

# Check process fd usage
ls /proc/<pid>/fd | wc -l

# Check system fd limit
cat /proc/sys/fs/file-max

# Check process limit
ulimit -n

# Check kernel logs
dmesg -T | tail -100
```

Fixes include scaling the service, increasing file-descriptor limits, tuning thread pools and event loops, configuring backlog and `somaxconn`, adding rate limiting and circuit breaking, isolating slow clients, limiting per-connection send queues, reducing subscriptions per connection, and sharding by app, tenant, or zone.

### 8.7 Proxy, Load Balancer, Firewall, or NAT Reset

Typical causes:

```text
LB idle timeout
Nginx upstream timeout
Envoy stream idle timeout
firewall policy rejection
security device injects RST
NAT table entry expires
service-mesh sidecar restarts
Ingress reload
L4 load balancer connection migration
```

The key observation is often that both application endpoints believe they did not actively close the connection, while the RST source IP is the proxy, LB, or another middlebox.

Fixes:

```text
align client, server, LB, and proxy idle timeouts
enable heartbeat / ping for long-lived connections
check Nginx proxy_read_timeout and keepalive_timeout
check Envoy idle_timeout and stream_idle_timeout
check cloud LB idle timeout
check NAT and firewall connection-tracking timeout
drain service-mesh sidecars during rolling release
```

### 8.8 TCP Keepalive Failure or Half-Open Network

Typical causes:

```text
one side powers off
one-way network interruption
NAT mapping disappears
peer host becomes unreachable
connection is half-open after long silence
TCP keepalive probe fails
TCP_USER_TIMEOUT expires
```

Fixes:

```text
use application-level heartbeat
configure TCP keepalive reasonably
set TCP_USER_TIMEOUT where supported
ensure heartbeat is shorter than NAT / LB idle timeout
use exponential backoff plus jitter for reconnect
server cleans up subscriptions for half-open connections
```

---

## 9. Registry Watch Scenario

In registry-center watch communication, a common reset path is:

```text
client watches a set of application instances
subscribed applications have no instance changes for a long time
no business event is sent on the connection
server or LB idle timeout fires
connection is closed or reset
client continues read/write
Connection reset by peer appears
```

The correct design is to separate business events from connection liveness:

```text
no instance change:
  do not send instance-change event

connection is still alive:
  send heartbeat / ping

connection is abnormal:
  close after keepalive timeout and reconnect
```

Recommended model:

```text
long-lived watch
+ application-level heartbeat
+ protocol-level keepalive
+ revision-based incremental recovery
+ slow-client governance
+ graceful reconnect
```

If real-time change propagation is not required, long polling or periodic pulling may be more suitable than pretending to use a long-lived connection while relying on idle timeout to break it.

---

## 10. Troubleshooting Method

### 10.1 Identify Whose Log Reports the Reset

```text
client reports reset:
  server, LB, Nginx, Envoy, firewall, or peer-side proxy may have reset

server reports reset:
  client, client-side proxy, LB, or NAT may have reset
```

`peer` means the direct TCP peer, not necessarily the final business client or final business server.

### 10.2 Determine Whether It Happens During connect, read, or write

```text
connect phase:
  focus on handshake, listener, LB, TLS, and protocol mismatch

read phase:
  peer may have already reset before the local process reads

write phase:
  peer may have disconnected and the local side continues writing
```

Linux `send(2)` explicitly lists `ECONNRESET` as a possible send error, meaning the connection was reset by the peer. ([man7.org][6])

### 10.3 Check Whether the Timing Matches a Timeout

If reset appears around fixed values such as:

```text
30s
60s
75s
90s
300s
350s
600s
```

prioritize timeout checks:

```text
LB idle timeout
Nginx / Envoy idle timeout
client read timeout
server keepalive timeout
connection-pool maxIdleTime
NAT / firewall timeout
```

### 10.4 Capture Packets and Locate the RST Source

```bash
# Capture all TCP reset packets
sudo tcpdump -i eth0 -nn 'tcp[tcpflags] & tcp-rst != 0'

# Capture packets for a specific peer
sudo tcpdump -i eth0 -nn host <peer_ip> and tcp

# Capture a specific port
sudo tcpdump -i eth0 -nn port <port> and tcp
```

Interpretation:

```text
RST source IP is the client:
  client or client-side proxy reset

RST source IP is the server:
  server or server-side proxy reset

RST source IP is LB / proxy:
  intermediate device reset
```

With TLS enabled, packet capture still shows TCP SYN, ACK, FIN, and RST, but not encrypted application content.

### 10.5 Inspect TCP State

```bash
# Show TCP connection states
ss -antp

# Count states
ss -ant | awk 'NR>1 {print $1}' | sort | uniq -c

# Socket summary
ss -s
```

Focus points:

```text
many CLOSE-WAIT:
  peer has closed; local application did not close in time

many TIME-WAIT:
  many short connections or active closes; not necessarily a fault

many SYN-RECV:
  handshake pressure or half-open queue issue

many ESTABLISHED with send-queue backlog:
  slow client or network congestion

many FIN-WAIT-2:
  peer did not complete the close
```

### 10.6 Inspect Proxy and Gateway Logs

Nginx clues:

```text
recv() failed (104: Connection reset by peer)
upstream prematurely closed connection
client prematurely closed connection
```

Envoy clues:

```text
upstream reset before response started
downstream reset
stream idle timeout
connection termination
local reset
remote reset
```

gRPC clues:

```text
UNAVAILABLE
RST_STREAM
GOAWAY
keepalive timeout
transport is closing
```

These logs are often closer to the true RST source than application exceptions.

### 10.7 Correlate Releases, Restarts, and Resource Metrics

```bash
# Process restart / OOM
dmesg -T | grep -i -E 'killed|oom|segfault'

# Container restart
kubectl get pod -o wide
kubectl describe pod <pod>
kubectl logs <pod> --previous

# CPU / memory
top
free -m

# fd usage
ls /proc/<pid>/fd | wc -l
```

If reset correlates strongly with release windows, OOM, CPU saturation, or fd exhaustion, start from service stability and graceful shutdown.

---

## 11. Summary Table

| Category | Typical cause | Common symptom | Troubleshooting | Fix |
| --- | --- | --- | --- | --- |
| Server restart | Release, crash, OOM, kill -9 | reset spikes during release | dmesg, container events, service logs | graceful shutdown, drain |
| Client cancellation | timeout, user abort, RPC deadline | server sees reset while writing | server logs, trace deadline | adjust timeout, honor cancellation |
| idle timeout | LB/NAT/proxy cleans idle connection | fixed-time reset | compare timeout, packet capture | heartbeat < idleTimeout |
| stale pool connection | server closed, client reuses | first request after idle fails | pool logs, tcpdump | client maxIdleTime < server keepalive |
| protocol mismatch | HTTP/HTTPS, HTTP1/HTTP2, gRPC | reset right after connect | curl, openssl, proxy logs | fix scheme, port, ALPN, TLS |
| server overload | fd, backlog, thread pool, CPU | peak-time reset | ss, top, dmesg, monitoring | scale, rate limit, queue protection |
| proxy reset | Nginx, Envoy, LB policy | direct path works, proxy path fails | proxy logs, RST source IP | align proxy timeout and policy |
| firewall/NAT | tracking timeout, policy rejection | cross-network failures | tcpdump, network-device logs | keepalive, network-policy tuning |
| keepalive failure | half-open connection, network break | fails after long silence | keepalive config, packet capture | app heartbeat, TCP_USER_TIMEOUT |
| slow client | send queue backlog | memory rises, write fails | send queue, per-connection metrics | queue limits, kick slow clients |
| SO_LINGER=0 | abortive close | peer sees reset after close | code review, packet capture | avoid unnecessary RST close |
| security policy | WAF, ACL, invalid packet | specific requests reset | security-device logs | fix rules or packet format |

---

## 12. Engineering Principles

### 12.1 Do Not Stop at the Error Text

`Connection reset by peer` only says RST was received. It does not say why. Combine:

```text
RST source IP
TCP state
failure phase
timeout timing
proxy logs
release records
resource metrics
```

### 12.2 Do Not Treat Every Reset as a Severe Fault

Client cancellation, browser refresh, caller timeout, and a small number of resets during rolling release are common. Classify them correctly so alerts are not polluted.

### 12.3 Long-Lived Connections Need Heartbeat

Registry watch, gRPC stream, WebSocket, and service-governance channels cannot rely on business events for liveness. When business state does not change, send heartbeat or ping.

### 12.4 Retry Idempotent Requests Carefully

Stale pooled connections can often be retried once for idempotent requests. Non-idempotent requests must be handled carefully to avoid duplicate submission.

### 12.5 Clean Up Context After Server Write Failure

For registry watch, if heartbeat write, instance-change write, or read/write fails with reset, the server should clean up the subscription state for that connection to avoid leaks and invalid fanout.

---

## 13. Conclusion

`Connection reset by peer` means that a TCP connection was forcibly reset by the peer or an intermediate network device using RST. It can happen during the handshake, data transfer, or states related to close, but the most common location is read/write after the connection has already been established.

During the handshake, a SYN answered by RST usually appears as connection refusal. During ESTABLISHED, applications, proxies, load balancers, NAT devices, server restarts, stale connection-pool reuse, and protocol mismatches can all cause reset. Around connection close, FIN is the normal path, while RST usually means abortive close or abnormal termination.

The core of troubleshooting is not guessing but locating the RST source. The most effective approach combines tcpdump, `ss`, application logs, proxy logs, timeout configuration, release records, and resource metrics. For long-lived systems such as registry centers, RPC streams, WebSocket, and gRPC streaming, careful heartbeat, keepalive, idle-timeout, connection-pool maxIdleTime, revision recovery, and slow-client governance are the main ways to reduce this class of failure.

In one sentence:

```text
FIN is an orderly goodbye. RST is a forced abort.
Connection reset by peer is not the root cause; it is TCP telling the
application that the peer has abandoned this connection with RST.
```

[1]: https://man7.org/linux/man-pages/man3/errno.3.html "errno(3) - Linux manual page"
[2]: https://datatracker.ietf.org/doc/html/rfc9293 "RFC 9293 - Transmission Control Protocol (TCP)"
[3]: https://www.ibm.com/docs/ja/ibm-mq/9.3.x?topic=problems-channel-failure-return-code-econnreset-tcpip "Channel failure with TCP/IP return code ECONNRESET"
[4]: https://blog.cloudflare.com/ja-jp/tcp-resets-timeouts/ "TCP Resets and Timeouts"
[5]: https://man7.org/linux/man-pages/man7/tcp.7.html "tcp(7) - Linux manual page"
[6]: https://man7.org/linux/man-pages/man2/send.2.html "send(2) - Linux manual page"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/connect_reset_by_peer)
