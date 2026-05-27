In many production incidents, the real danger is not that business code explicitly implements a "short-connection protocol." The more common problem is that a high-frequency request path unconsciously creates middleware clients again and again. A local configuration read fails, so the code temporarily `new`s a remote configuration-center client. A registry instance looks abnormal, so the code rebuilds a registry client. A fallback, degradation, dynamic routing, hotfix, cache recovery, or emergency branch creates an RPC, HTTP, cache, object-storage, search, or message-queue SDK client per request. On the surface, this looks like a temporary fallback. In practice, it can amplify a small number of reusable stable connections into a connection avalanche where every request creates a connection, performs a handshake, authenticates, and initializes thread pools or connection pools.

The essence of the problem is not that "long connections are more advanced than short connections." It is this: **mature clients such as HTTP clients and gRPC `ManagedChannel`s already include connection reuse mechanisms. If business code repeatedly creates clients on high-frequency paths, it bypasses those reuse mechanisms and degrades long connections into unconscious short connections.**

## 1. What Is the Difference between Long and Short Connections in HTTP and gRPC?

In HTTP, a long connection usually means a persistent connection, keep-alive, or connection reuse: the same TCP connection can carry multiple HTTP request/response exchanges instead of opening a new connection for every request/response pair. Oracle's documentation on HTTP persistent connections states that they use the same TCP connection to send and receive multiple HTTP requests and responses. The benefits include reducing TCP setup and teardown, lowering latency for later requests, and reducing TLS/SSL handshake cost in HTTPS scenarios. It also notes that persistent connections are the default behavior in HTTP/1.1 unless the client or server explicitly asks to close the connection at the protocol level. ([Oracle Docs][1])

In HTTP/1.1, the most typical protocol expression of a short connection is `Connection: close`. RFC 9112 explains that a client can continue sending requests on a persistent connection until it sends or receives the `close` connection option. If a response contains `close`, the server will close the connection after completing the response, and the client should stop sending further requests on that connection. ([IETF Datatracker][2])

HTTP/2 takes the connection model further than HTTP/1.1. RFC 9113 explains that HTTP/2 improves network resource usage and reduces latency through field compression and by allowing multiple concurrent exchanges on the same connection. One HTTP/2 connection can contain multiple concurrently open streams, and frames from different streams can be interleaved on that connection. ([IETF Datatracker][3])

gRPC is built on top of HTTP/2. The gRPC Core documentation explains that gRPC over HTTP2 carries gRPC requests and responses through HTTP/2 framing. A gRPC call uses the HTTP/2 stream id as the call identifier, and the server should send GOAWAY before terminating a connection so that the client can tell which streams were accepted. ([grpc.github.io][4])

Therefore, the difference can be summarized this way: an HTTP/1.1 long connection mainly means reusing the same TCP connection for multiple requests; HTTP/2 and gRPC use multiple streams over the same connection to carry concurrent calls. In engineering incidents, a "short connection" usually does not mean a new protocol. It usually means that the connection, HTTP client, connection pool, or gRPC channel is not reused, so requests repeatedly go through the new-connection path.

## 2. Mainstream HTTP Clients and gRPC ManagedChannel Already Use Connection Reuse by Default

Normal business applications do not need to hand-write a "long-connection protocol." The more accurate engineering practice is: **reuse HTTP clients, reuse connection pools, reuse gRPC `ManagedChannel`s, and let mature clients manage the connection lifecycle.**

The JDK `HttpClient` documentation states that once an `HttpClient` is built, it is immutable and can be used to send multiple requests. It also explains that resources can be reclaimed earlier by closing the client. ([Oracle Docs][5])

OkHttp says this even more directly: an `OkHttpClient` should be shared. Creating a single `OkHttpClient` and reusing it for all HTTP calls gives the best performance because every client holds its own connection pool and thread pools. Reusing connections and threads reduces latency and saves memory. By contrast, creating a client for each request wastes resources on idle pools. ([Square Open Source][6])

Apache HttpClient 5 also states that HttpClient uses a connection pool to reuse persistent connections across requests and reduce connection-establishment overhead. The connection manager maintains per-route and total connection limits and reuses idle persistent connections whenever possible. ([Apache HttpComponents][7])

The official gRPC performance guide gives the same recommendation: reuse stubs and channels whenever possible. Keepalive pings can be used to keep an HTTP/2 connection alive during idle periods so the initial RPC does not pay the cost of reconnecting. ([gRPC][8])

For Java gRPC, the `ManagedChannelBuilder.idleTimeout` documentation explains that a channel enters idle mode after a period without in-flight RPCs. When it enters idle mode, it shuts down all connections, NameResolvers, and LoadBalancers; a new RPC brings the channel out of idle. The default idle timeout is 30 minutes. The `ManagedChannel` documentation also explains that after a channel is terminated, related resources, including TCP connections, are released. ([grpc.github.io][9])

The conclusion is clear: HTTP clients and gRPC `ManagedChannel`s are already designed as long-lived objects with connection reuse. Business code should avoid repeatedly `new`ing these objects on high-frequency request paths.

## 3. Why Long Connections Help: Fewer Connections, Fewer Handshakes, Fewer Initializations, Less Resource Churn

The first value of long connections is lower connection-establishment cost. Oracle's HTTP persistent connection documentation lists benefits such as reducing TCP setup and teardown, lowering latency for later requests, and reducing TLS/SSL handshake cost in HTTPS scenarios. ([Oracle Docs][1])

For HTTP/2 and gRPC, connection reuse also means multiple streams can share the same HTTP/2 connection. RFC 9113 describes how multiple concurrent exchanges over one connection reduce latency, and the gRPC documentation explains that gRPC over HTTP2 carries requests and responses through HTTP/2 framing. ([IETF Datatracker][3])

For business systems, the benefit of long connections is not just "saving one TCP handshake." More importantly, connection pools, thread pools, HTTP/2 connections, TLS sessions, gRPC channels, NameResolvers, LoadBalancers, and related components can be reused steadily. In Apache HttpClient, the connection manager handles per-route and total connection limits, connection TTL, idle expiry, and explicit closure of idle or expired connections. Those capabilities only have engineering value when the client or connection manager itself is reused. ([Apache HttpComponents][10])

This is why service-to-service calls, configuration centers, registry centers, RPC frameworks, gateways, cache proxies, search services, object-storage SDKs, and other high-frequency access scenarios should default to long-lived clients instead of request-scoped clients.

## 4. Short Connections Are Not Wrong, but They Must Be a Conscious Choice

Short connections can be reasonable on the client side. One-off scripts, CLI tools, temporary debugging, benchmark control groups, security isolation, special proxy chains, or active resource release can all justify short-lived connections or short-lived clients. The Linux `close(2)` documentation explains that `close()` closes a file descriptor so it no longer refers to any file and can be reused. The Linux conntrack documentation also exposes `nf_conntrack_count`, the current number of allocated flow entries, and `nf_conntrack_max`, the allowed upper limit of connection-tracking entries. ([man7.org][11])

Short connections can also appear in circuit-breaking, failure isolation, and emergency mitigation scenarios. Apache HttpClient connection-management documentation provides APIs for closing idle or expired connections. gRPC `ManagedChannel.shutdown()` starts an orderly shutdown, cancels new calls, and releases resources, including TCP connections, after termination. ([Apache HttpComponents][10])

The server side can also have valid reasons to actively close connections, such as rate limiting, authentication failure, protocol errors, abnormal traffic sources, or attack traffic. One detail matters: under HTTP/1.1, the protocol header should be `Connection: close`, not `Connection closed`. RFC 9112 explains that after a server sends the `close` connection option, it should initiate connection closure after the response is complete and must not continue processing later requests on that connection. ([IETF Datatracker][2])

For HTTP/2 or gRPC, do not copy the HTTP/1.1 `Connection: close` model. RFC 9113 explicitly states that HTTP/2 does not use the `Connection` header field and endpoints must not generate HTTP/2 messages containing connection-specific header fields. HTTP/2 connection closure should use GOAWAY, RST_STREAM, or the connection-close mechanism. The gRPC Core documentation also states that a server should send GOAWAY before terminating a connection so the client can know which streams were accepted. ([IETF Datatracker][3])

So short connections can be used, but they should be explicit, controlled, and observable. They should not be accidental side effects hidden inside degradation code.

## 5. The Most Common Failure Entry Point: Creating Middleware Clients on High-Frequency Fallback Paths

The code most likely to trigger a connection avalanche often looks like this:

```java
// Bad: a client is created on the hot path.
ConfigClient configClient = new ConfigClient(remoteConfigEndpoint);
String value = configClient.get(key);
```

Or this:

```java
// Bad: registry client is recreated during fallback.
RegistryClient registryClient = new RegistryClient(registryAddress);
List<Instance> instances = registryClient.refresh(serviceName);
```

The problem is not necessarily the `new ConfigClient()` line itself. The real issue is that the middleware client may internally wrap an `OkHttpClient`, Apache HttpClient, JDK `HttpClient`, gRPC `ManagedChannel`, connection pool, thread pool, background refresh task, authentication context, or load-balancing component. OkHttp explicitly says that each client holds its own connection pool and thread pools and that creating a client for every request wastes resources. Apache HttpClient explains that connection pools reuse persistent connections and reduce connection-establishment overhead. The official gRPC guide says to reuse stubs and channels whenever possible. ([Square Open Source][6])

Typical scenario one: a local configuration value cannot be found, so a request thread temporarily creates a remote configuration-center client to fetch it. At low frequency, the problem is invisible. Once local configuration is missing or a cache is broken through, many requests enter this branch at the same time, configuration-center clients are created in bulk, and their internal HTTP/gRPC connections are created in bulk as well.

Typical scenario two: registry instances are polluted, the registry center is unreachable, or the instance list is stale, so the request path degrades by recreating a registry client. This turns "service discovery is abnormal" into "the registry center is hit by many new connections." If the registry client internally uses HTTP or gRPC, repeatedly creating the client bypasses the reuse capability of the existing connection pool or `ManagedChannel`.

Typical scenario three: degradation, fallback, hotfix, dynamic configuration refresh, request-level routing correction, or cache-recovery logic temporarily creates some middleware client. This can include configuration-center, registry-center, RPC, message-queue, cache, object-storage, or search clients. As long as those clients contain HTTP/gRPC clients, connection pools, thread pools, or background tasks, high-frequency triggering can turn request traffic into a connection storm.

The most dangerous part is that this usually erupts only during failures. On the normal path, connection reuse is stable and metrics look healthy. Once a dependency becomes abnormal, all requests enter the degradation branch, business code starts creating clients per request, and the middleware server is hit by connection establishment, TLS negotiation, HTTP/2 prefaces, authentication, initialization, rate limiting, and error handling at the same time. Microsoft's gRPC performance documentation also explains that if every gRPC call creates a new channel, call completion time increases significantly because each call must open a socket, establish TCP, negotiate TLS, start an HTTP/2 connection, and then perform the gRPC call. ([Microsoft Learn][12])

## 6. Engineering Principles for Avoiding Connection Avalanches

First, HTTP clients, gRPC `ManagedChannel`s, and middleware SDK clients should be managed as long-lived objects. They can be Spring Beans, singleton components, controlled connection pools, SDK-internal shared objects, or clients produced by a framework-managed factory. This is not just a coding-style preference. It follows directly from the connection-reuse expectations documented by OkHttp, Apache HttpClient, gRPC, and similar mature clients. ([Square Open Source][6])

Second, degradation paths must not create clients without limits. A fallback can read a local snapshot, read cache, trigger asynchronous refresh, merge requests through singleflight, enforce concurrency limits, set timeouts, apply rate limiting, or use circuit breaking. It should not create a new middleware client per request on a high-frequency request path. Apache HttpClient's per-route and total connection limits, TTL, idle expiry, and idle/expired eviction only work as intended when connection management is reused steadily. ([Apache HttpComponents][10])

Third, if a short-lived client is genuinely required, define the boundaries explicitly: low trigger frequency, concurrency protection, timeouts, rate limits, lifecycle shutdown, failure metrics, connection-establishment metrics, and alerts. The JDK `HttpClient` documentation explains that resources can be reclaimed earlier by closing the client, and the gRPC `ManagedChannel` documentation connects shutdown/termination with TCP connection resource release. ([Oracle Docs][5])

Fourth, servers should distinguish HTTP/1.1 and HTTP/2/gRPC close semantics. HTTP/1.1 uses `Connection: close`; HTTP/2 must not generate connection-specific headers such as `Connection`; gRPC over HTTP/2 should use GOAWAY, RST_STREAM, status codes, and channel or transport close semantics. ([IETF Datatracker][2])

Fifth, monitoring should not look only at QPS, latency, and error rate. It should also show whether connection reuse has failed. Watch new connection count, active connection count, idle connection count, connection-pool hit ratio, file-descriptor count, thread count, port usage, TLS handshakes, HTTP/2 connection count, gRPC channel count, server accept/handshake pressure, and conntrack entry count. In Linux, `nf_conntrack_count` and `nf_conntrack_max` represent the current connection-tracking entry count and the allowed upper limit. These metrics help locate incidents where request volume is stable but connection creation suddenly surges. ([Linux Kernel Documentation][13])

## 7. A Recommended HTTP/gRPC Long-Connection vs Short-Connection Test Project

If you want to see the difference between connection reuse and per-request connection creation more directly, see `https://github.com/stellhub/java-connection-reuse-benchmark`. This repository is a Java benchmark suite for comparing persistent connection reuse with per-request connection creation across HTTP and gRPC workloads. ([GitHub][14])

The project contains both server and client modules. The server provides an HTTP server and a gRPC server. The client runs four benchmark groups: HTTP long connection, HTTP short connection, gRPC long connection, and gRPC short connection. The HTTP long-connection benchmark reuses one `StellfluxHttpClient`; the HTTP short-connection benchmark creates and closes a `StellfluxHttpClient` for each request. The gRPC long-connection benchmark reuses one `ManagedChannel`; the gRPC short-connection benchmark creates and closes a `ManagedChannel` for each request. ([GitHub][14])

The value of this project is not only in the performance numbers. It is also useful for reproducing the failure pattern discussed in this article: when business code repeatedly creates middleware clients on a high-frequency path, the default connection reuse of HTTP and gRPC is bypassed and the system degrades into per-request connection creation. The repository README also lists risk scenarios such as temporarily creating a configuration-center client when local configuration cannot be read, temporarily creating a registry-center client when the instance list is not refreshed in time, and temporarily creating any middleware client inside high-frequency request or fallback logic. ([GitHub][14])

## Conclusion

Short connections are not a sin. One-off scripts, CLIs, debugging, security isolation, proxy chains, benchmark control groups, circuit-breaker closure, and server-side rejection of abnormal connections can all use short connections or active connection closure. The real risk is unconscious short connections: high-frequency request paths or degradation paths repeatedly create middleware clients and invalidate the connection reuse already provided by HTTP clients and gRPC `ManagedChannel`s.

Mature clients already point to a clear engineering direction: reuse clients, reuse channels, and reuse connection pools. When connections really need to be closed, close them according to HTTP/1.1, HTTP/2, or gRPC protocol semantics. In degradation paths, never create new clients without limits. Otherwise, fallback logic that was meant to protect the business can become the source of a connection avalanche that overwhelms configuration centers, registry centers, or RPC servers.

[1]: https://docs.oracle.com/javase/8/docs/technotes/guides/net/http-keepalive.html "HTTP Persistent Connections"
[2]: https://datatracker.ietf.org/doc/html/rfc9112 "RFC 9112 - HTTP/1.1"
[3]: https://datatracker.ietf.org/doc/html/rfc9113 "RFC 9113 - HTTP/2"
[4]: https://grpc.github.io/grpc/core/md_doc__p_r_o_t_o_c_o_l-_h_t_t_p2.html "GRPC Core: gRPC over HTTP2"
[5]: https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/java/net/http/HttpClient.html "HttpClient (Java SE 21 & JDK 21)"
[6]: https://square.github.io/okhttp/5.x/okhttp/okhttp3/-ok-http-client/ "OkHttpClient"
[7]: https://hc.apache.org/httpcomponents-client-5.6.x/connection-pooling.html "Apache HttpComponents - Connection pooling"
[8]: https://grpc.io/docs/guides/performance/ "Performance Best Practices | gRPC"
[9]: https://grpc.github.io/grpc-java/javadoc/io/grpc/ManagedChannelBuilder.html "ManagedChannelBuilder (grpc-all 1.81.0 API)"
[10]: https://hc.apache.org/httpcomponents-client-5.6.x/connection-management.html "Apache HttpComponents - Connection management"
[11]: https://man7.org/linux/man-pages/man2/close.2.html "close(2) - Linux manual page"
[12]: https://learn.microsoft.com/en-us/aspnet/core/grpc/performance?view=aspnetcore-10.0 "Performance best practices with gRPC | Microsoft Learn"
[13]: https://docs.kernel.org/networking/nf_conntrack-sysctl.html "Netfilter Conntrack Sysfs variables - The Linux Kernel documentation"
[14]: https://github.com/stellhub/java-connection-reuse-benchmark "GitHub - stellhub/java-connection-reuse-benchmark: Java benchmark suite for comparing persistent connection reuse with per-request connection creation across client/server workloads."
