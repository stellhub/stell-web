# Java HTTP Client Selection Research: An Objective Comparison of Built-In and Mainstream Third-Party Clients

## Abstract

HTTP clients in the Java ecosystem can be divided into three categories. The first category is JDK built-in clients, including the earlier `HttpURLConnection` and the `java.net.http.HttpClient` introduced in Java 11. The second category is transport-layer or protocol-layer HTTP clients, including Apache HttpClient, OkHttp, Jetty HttpClient, Reactor Netty HttpClient, AsyncHttpClient, and others. The third category is framework-level or declarative clients, including Spring RestClient, Spring WebClient, OpenFeign, Retrofit, and similar tools. Based on official documentation from each project, this article compares these clients across protocol support, synchronous and asynchronous models, connection reuse, customizability, ease of use, stability, and typical use cases. Official documentation does not provide a unified performance benchmark across clients, versions, and scenarios, so it is not objective to claim that one HTTP client has the best performance in every situation. Selection should be driven primarily by runtime environment, concurrency model, protocol requirements, framework ecosystem, and customization needs.

**Keywords:** Java; HTTP Client; JDK HttpClient; Apache HttpClient; OkHttp; Jetty; Reactor Netty; Spring WebClient; selection research

## 1. Introduction

An HTTP client is a foundational component for Java services that call external HTTP APIs, communicate between microservices, wrap SDKs, implement gateway proxies, upload or download files, and perform asynchronous streaming communication. Different HTTP clients vary in API design, connection pooling, protocol support, asynchronous model, TLS configuration, proxy authentication, caching, observability, and framework integration. Because HTTP call performance is jointly affected by JVM version, TLS implementation, connection reuse strategy, server-side protocol, network RTT, request body size, response body size, concurrency level, connection pool parameters, and blocking behavior in business code, choosing solely by asking "which one is fastest" is not sufficient.

This article uses official documentation as the primary basis and avoids judgment based on personal experience. The goal is not to list every Java HTTP communication library, but to compare the HTTP clients commonly encountered in daily backend development, enterprise service governance, and high-concurrency calls.

## 2. Research Scope and Classification

### 2.1 JDK Built-In Clients

JDK built-in capabilities mainly include two types.

The first is `HttpURLConnection`. It belongs to the `java.net` package, and official documentation defines it as a `URLConnection` with support for HTTP-specific features. Each `HttpURLConnection` instance is used for one request, but the underlying network connection may be transparently shared by other instances. This API has existed since Java 1.1. Its interface is relatively low-level, making it suitable for simple compatibility scenarios but not as a foundation for complex HTTP calls in new projects.

The second is `java.net.http.HttpClient`. This API became the standard HTTP client starting with Java 11. Official documentation explains that it can be created through a builder and supports client-level state such as HTTP/1.1 or HTTP/2 configuration, redirects, proxies, and authenticators. After construction, it is immutable and can be used to send multiple requests. It supports synchronous `send` and asynchronous `sendAsync`; the asynchronous interface returns `CompletableFuture`. In the JDK 21 official API documentation, its default protocol preference is HTTP/2, and it may fall back to other versions when constrained by the implementation. Current OpenJDK documentation also states that JDK 26 introduced HTTP/3 support, while HTTP/2 remains the default preferred protocol and HTTP/3 must be explicitly enabled.

### 2.2 Transport-Layer or Protocol-Layer Third-Party Clients

Apache HttpClient 5.x is part of the Apache HttpComponents project. Official documentation explains that it is a standards-based pure Java implementation of HTTP/1.0, HTTP/1.1, and HTTP/2 clients. It supports HTTPS, pluggable TLS strategies, proxies, Basic/Digest/Bearer/SCRAM-SHA-256 authentication, cookies, flexible connection management and connection pooling, response caching, content decompression, Unix Domain Sockets, observability metrics, and more. It provides classic, fluent, async, and reactive APIs.

OkHttp is an HTTP client maintained by Square. Official documentation states that OkHttp supports HTTP/2, connection pooling, transparent GZIP, response caching, synchronous blocking calls, and asynchronous callbacks by default. Its documentation also explains that OkHttp uses a fluent builder and immutable object design. At the same time, OkHttp explicitly states that one of its design principles is to avoid excessive configurability, especially avoiding too many configuration options for bypassing broken servers or RFC-violating behavior.

Jetty HttpClient is the client module provided by Eclipse Jetty. Official documentation explains that it is a non-blocking asynchronous HTTP client with asynchronous APIs that do not block on I/O, making it suitable for high-performance scenarios such as load testing and parallel computation. It also provides synchronous APIs. Jetty HttpClient supports HTTP/1.1, HTTP/2, HTTP/3, and FastCGI. It uses different `HttpClientTransport` implementations for different protocol formats and also supports underlying transports such as TCP, Unix Domain Socket, QUIC, and memory.

Reactor Netty HttpClient is the reactive HTTP client provided by Reactor Netty. Official documentation explains that it hides most Netty details required to create an HTTP client and adds Reactive Streams backpressure support. Reactor Netty provides network engines for HTTP, TCP, and UDP, making it suitable for reactive microservice systems. Its HTTP client supports connection pooling, event loops, SSL/TLS, proxies, metrics, tracing, Unix Domain Sockets, timeout configuration, and HTTP/2 configuration.

AsyncHttpClient is an asynchronous HTTP and WebSocket client based on Netty. Its official README defines it as a high-performance asynchronous HTTP client for Java. It supports HTTP/1.1, HTTP/2, and WebSocket, and provides non-blocking I/O, `ListenableFuture`, `CompletableFuture`, connection pooling, compression, authentication, proxies, Native Transport, request/response filters, cookies, multipart upload, resumable download, and other capabilities.

### 2.3 Framework-Level or Declarative Clients

Spring RestClient is a synchronous HTTP client provided by Spring Framework. Official documentation explains that it provides a fluent API, abstracts over underlying HTTP libraries, and handles conversion between HTTP request/response content and higher-level Java objects. Spring RestClient can choose among underlying HTTP libraries, including JDK HttpClient, Apache HttpComponents, Jetty HttpClient, Reactor Netty HttpClient, and SimpleClientHttpRequestFactory. If no request factory is explicitly specified, Spring selects the underlying implementation based on the classpath and the state of the `java.net.http` module.

Spring WebClient is the non-blocking reactive HTTP client in Spring WebFlux. Official documentation explains that WebClient is based on Reactor, provides a functional fluent API, supports asynchronous logic composition, non-blocking execution, and streaming processing, and can plug into underlying libraries such as Reactor Netty, JDK HttpClient, Jetty Reactive HttpClient, and Apache HttpComponents.

OpenFeign and Retrofit are declarative or interface-based HTTP clients. OpenFeign official documentation states that its goal is to simplify the process of writing Java HTTP clients and that it is a Java-to-HTTP client binder. Spring Cloud OpenFeign documentation explains that it can create dynamic implementations based on interfaces and annotations. Retrofit official documentation explains that it turns HTTP APIs into Java or Kotlin interfaces. These tools are usually not direct transport implementations; instead, they wrap the calling model and depend on or adapt underlying HTTP clients.

## 3. Comparison of Major Client Capabilities

| Client | Type | Sync/Async Model | Protocol Support | Main Verifiable Strengths | Main Limitations |
| --- | --- | --- | --- | --- | --- |
| `HttpURLConnection` | Earlier JDK built-in client | Mainly synchronous | HTTP/1.x | Built into the JDK, no extra dependency, compatible with legacy code | Low-level API; not suitable as the foundation for complex HTTP calls in new projects; does not support modern needs such as PATCH well |
| `java.net.http.HttpClient` | JDK 11+ built-in client | Synchronous + `CompletableFuture` asynchronous | JDK 21: HTTP/1.1 and HTTP/2; HTTP/3 supported starting with JDK 26 | No third-party dependency; standard API; connection pool managed by client instances; supports WebSocket | Advanced capabilities such as JSON conversion, interceptors, complex connection-pool strategies, and observability require custom wrappers or frameworks |
| Apache HttpClient 5.x | Third-party protocol-layer client | classic, fluent, async, reactive | HTTP/1.0, HTTP/1.1, HTTP/2 | Broad enterprise HTTP feature coverage; authentication, proxies, cookies, caching, connection pooling, TLS, and observability are complete | Many APIs and configuration options; more complex than JDK HttpClient and OkHttp |
| OkHttp | Third-party client | Synchronous + asynchronous callbacks | HTTP/1.1, HTTP/2, WebSocket, SSE | Simple API; HTTP/2, connection pooling, GZIP, and caching are available by default; suitable for SDKs and mobile clients | Officially avoids excessive configurability; not ideal for unconventional protocol behavior or deep transport-layer customization |
| Jetty HttpClient | Third-party protocol/transport-layer client | Non-blocking asynchronous + synchronous APIs | HTTP/1.1, HTTP/2, HTTP/3, FastCGI | Strong protocol and underlying transport extension capabilities; supports TCP, Unix Domain Socket, QUIC, memory, and other transports | More complex to use; usually suitable when protocol-stack and transport-layer requirements are explicit |
| Reactor Netty HttpClient | Reactive Netty client | Non-blocking reactive | HTTP/1.1; configurable HTTP/2 | Consistent with Reactor/Spring WebFlux; supports backpressure, connection pooling, event loops, metrics, and tracing | Not naturally suited to blocking business code; requires understanding the reactive programming model |
| AsyncHttpClient | Netty asynchronous client | Non-blocking asynchronous | HTTP/1.1, HTTP/2, WebSocket | Designed for asynchronous high concurrency; supports Native Transport, connection pooling, compression, authentication, proxies, and filters | Less integrated with mainstream Spring abstractions than RestClient/WebClient; requires managing asynchronous callbacks and resource lifecycle |
| Spring RestClient | Framework abstraction | Synchronous | Depends on the underlying request factory | Easy to use inside the Spring ecosystem; object conversion, interceptors, baseUrl, default headers, cookies, and related features are complete | Higher adoption cost outside Spring projects; performance and protocol capabilities depend on the underlying implementation |
| Spring WebClient | Framework abstraction | Non-blocking reactive | Depends on the underlying connector | Standard choice for Spring WebFlux; supports asynchronous, streaming, and backpressure-aware usage | Introducing the reactive model into blocking systems increases complexity |
| OpenFeign / Retrofit | Declarative interface clients | Depends on the underlying implementation | Depends on the underlying implementation | Suitable for API interface declarations, SDK wrapping, and declarative microservice calls | Should not be directly equated with underlying HTTP clients; transport performance and protocol capabilities depend on adapters |

## 4. Scenario-Based Selection Analysis

### 4.1 Ordinary Java 11+ Projects

If a project runs on Java 11 or later and its calling requirements are mainly ordinary REST APIs, including GET, POST, PUT, DELETE, request headers, timeouts, proxies, redirects, synchronous calls, or simple asynchronous calls, then `java.net.http.HttpClient` can be used as the baseline choice. The objective basis is that it is a JDK standard API with no external dependency, official support for both synchronous and asynchronous models, and client instances that manage reusable connection pools.

### 4.2 Spring MVC Blocking Services

If a project is based on Spring MVC and mainly uses synchronous blocking calls, Spring RestClient is a better fit for the Spring ecosystem. The objective basis is that Spring officially defines RestClient as a synchronous fluent API and provides HTTP message conversion, baseUrl, default request headers, cookies, interceptors, request initializers, and underlying HTTP library selection. Starting with Spring Framework 7.0, RestTemplate has been marked as replaced by RestClient and will be removed in a future version. Therefore, new Spring MVC projects should no longer use RestTemplate as the default new selection.

For the underlying implementation of Spring RestClient, ordinary scenarios can use JDK HttpClient. When more complete proxy, authentication, connection pooling, caching, TLS, or observability capabilities are needed, Apache HttpClient can be used as the request factory. If the system already uses Jetty or Reactor Netty, the corresponding request factory can be used.

### 4.3 Spring WebFlux or Reactive Services

If the service itself uses Spring WebFlux, Reactor, reactive call chains, streaming responses, SSE, or a high-concurrency non-blocking model, WebClient is the more consistent choice. The objective basis is that Spring official documentation defines WebClient as a non-blocking, reactive, streaming-capable fluent API. Its underlying implementation can use Reactor Netty, JDK HttpClient, Jetty Reactive HttpClient, or Apache HttpComponents. In the default Spring WebFlux ecosystem, Reactor Netty is more consistent with the Reactor programming model.

### 4.4 SDKs, Client Tools, and Mobile Compatibility

If the goal is to wrap an SDK, command-line client, desktop client, or Android/Java general-purpose client, OkHttp is a common choice. The objective basis is that OkHttp official documentation states that it supports Java 8+ and Android 5.0+, and provides HTTP/2, connection pooling, GZIP, response caching, synchronous calls, and asynchronous calls by default. OkHttp's API is centered on builders and immutable objects, and the amount of code is usually smaller than the full configuration model of Apache HttpClient.

### 4.5 Enterprise Scenarios Requiring Complex HTTP Capabilities

If the business requires complex proxies, authentication, cookies, connection pool strategies, cache backends, TLS strategies, Unix Domain Sockets, observability metrics, request retries, response compression and decompression, and similar capabilities, Apache HttpClient 5.x is a better match. The objective basis is that Apache official documentation lists these capabilities and that HttpClient 5.x provides classic, fluent, async, and reactive APIs. For large enterprise backend systems, the value of Apache HttpClient mainly lies in its complete set of HTTP protocol-adjacent capabilities, not in writing the shortest single-request code.

### 4.6 Protocol Stack and Transport-Layer Customization

If the calling scenario involves HTTP/2, HTTP/3, QUIC, Unix Domain Socket, memory transport, FastCGI, or protocol negotiation customization, Jetty HttpClient is more suitable. The objective basis is that Jetty official documentation clearly states that its HTTP client supports different HTTP formats and different underlying transports, and is extensible through `HttpClientTransport`. Such scenarios usually appear in gateways, proxies, load-testing tools, protocol experiments, internal infrastructure, or systems that require fine-grained control over connection and protocol behavior.

### 4.7 High-Concurrency Asynchronous Calls

If the call chain centers on high concurrency, non-blocking execution, event loops, asynchronous callbacks, or reactive backpressure, Reactor Netty HttpClient, Jetty HttpClient, and AsyncHttpClient are candidates. Reactor Netty is consistent with the Spring WebFlux/Reactor ecosystem. Jetty has more complete protocol and transport-layer extension capabilities. AsyncHttpClient is based on Netty, targets asynchronous HTTP and WebSocket, and provides capabilities such as Native Transport. The concrete choice should depend on whether the business has already adopted Reactor, whether Spring integration is needed, and whether HTTP/3 or underlying transport customization is required.

### 4.8 Declarative Service Calls

If the core goal is not to control HTTP transport details but to map remote APIs into Java interfaces, OpenFeign or Retrofit is a higher-level choice. OpenFeign is suitable for declarative REST calls in Spring Cloud microservices. Retrofit is suitable for SDKs, Android, or interface-based API wrapping. The performance and protocol capabilities of these frameworks depend on their underlying HTTP clients, so they should not be compared with Apache HttpClient, OkHttp, Jetty, or JDK HttpClient as if they were at the same layer.

## 5. Objective Conclusions on Key Questions

### 5.1 Which HTTP Client Has the Best Performance

Official documentation does not provide a unified performance benchmark covering JDK HttpClient, Apache HttpClient, OkHttp, Jetty, Reactor Netty, and AsyncHttpClient. Therefore, it is not objective to claim that one HTTP client has the best performance in all scenarios.

If we summarize scenarios only from official documentation descriptions, the following factual conclusions can be drawn:

First, Jetty HttpClient official documentation clearly states that its non-blocking asynchronous API does not block on I/O, has high thread utilization, and is suitable for high-performance scenarios such as load testing and parallel computation.

Second, Reactor Netty HttpClient official documentation explains that it hides Netty details and adds Reactive Streams backpressure support, making it suitable for reactive microservice systems.

Third, the AsyncHttpClient official README defines it as a high-performance asynchronous HTTP client based on Netty and states that it supports HTTP/2, multiplexing, Native Transport, and non-blocking I/O.

Fourth, OkHttp official documentation explains that it improves default efficiency through HTTP/2, connection pooling, transparent GZIP, and response caching.

Therefore, performance selection cannot be separated from the scenario. Blocking ordinary REST calls can use JDK HttpClient or Spring RestClient. Reactive high-concurrency calls can use WebClient/Reactor Netty. Protocol-stack performance and HTTP/3 scenarios can use Jetty. Netty asynchronous model scenarios can use AsyncHttpClient. Rigorous performance conclusions must be obtained through benchmarks on the same hardware, same JVM, same TLS, same server, same request model, and same connection pool parameters.

### 5.2 Which HTTP Client Is the Most Stable

"Stable" includes at least three meanings: API stability, runtime dependency stability, and stability under complex HTTP behavior.

From the perspective of API and dependency stability, `java.net.http.HttpClient` is a JDK standard API since Java 11 and has no third-party dependency, so it has the lowest risk of dependency conflicts.

From the perspective of complex HTTP behavior coverage, Apache HttpClient 5.x provides a more complete set of enterprise HTTP capabilities, including connection pooling, authentication, proxies, cookies, caching, TLS strategies, observability, and multiple API forms. It is therefore more suitable for complex enterprise HTTP calls.

From the perspective of protocol and transport stability, if the system depends on HTTP/2, HTTP/3, QUIC, or underlying transport extensions, Jetty HttpClient has more complete protocol-stack capabilities.

Therefore, "most stable" cannot be defined by a single dimension. If stability means the fewest external dependencies, JDK HttpClient is the better fit. If stability means coverage of complex HTTP capabilities, Apache HttpClient is the better fit. If stability means protocol and transport extension capability, Jetty HttpClient is the better fit.

### 5.3 Which HTTP Client Is the Easiest to Use

Ease of use depends on project context.

In non-Spring Java 11+ projects, JDK HttpClient is relatively easy to use because no dependency needs to be introduced and the API comes directly from the JDK.

In Java/Android SDK scenarios, OkHttp is relatively easy to use because its official documentation provides concise request/response APIs, synchronous calls, asynchronous callbacks, and default capabilities such as connection pooling, HTTP/2, GZIP, and caching.

In Spring MVC projects, Spring RestClient is relatively easy to use because it directly integrates Spring message conversion, interceptors, baseUrl, default headers, cookies, and underlying request factory selection.

In Spring WebFlux projects, WebClient is relatively easy to use because it is consistent with Reactor asynchronous composition, non-blocking I/O, and streaming processing models.

### 5.4 Which HTTP Client Has the Highest Customizability and Extensibility

If extensibility means enterprise HTTP feature extension, Apache HttpClient 5.x is strong. Its official documentation lists capabilities such as pluggable TLS strategies, connection pool strategies, authentication, cache backends, content decompression, Unix Domain Sockets, and observability modules.

If extensibility means protocol format and underlying transport extension, Jetty HttpClient is strong. Its official documentation explains that different HTTP formats are carried by different `HttpClientTransport` implementations and that underlying transports such as TCP, Unix Domain Socket, QUIC, and memory can be used.

If extensibility means reactive call-chain integration, Reactor Netty and WebClient are stronger because they are naturally part of the Reactor/Spring WebFlux ecosystem.

OkHttp official documentation clearly states that its principle is to avoid excessive configurability, so it should not be the first choice in extreme customization scenarios.

## 6. Daily Development Selection Rules

Daily development can use the following rules:

First, ordinary pure Java 11+ service calls should use `java.net.http.HttpClient` by default. This choice reduces external dependencies and satisfies basic needs such as synchronous calls, asynchronous calls, HTTP/2, proxies, authentication, timeouts, and connection reuse.

Second, Spring MVC blocking projects should use Spring RestClient by default. Prefer JDK HttpClient as the underlying implementation. When complex connection pooling, proxies, authentication, TLS, or observability capabilities are needed, switch to an Apache HttpClient request factory.

Third, Spring WebFlux or reactive projects should use WebClient by default. Reactor Netty can be used underneath to keep the reactive programming model, backpressure, and event-loop model consistent.

Fourth, SDKs, Android, or lightweight clients should use OkHttp by default. These scenarios usually care more about API simplicity, default connection pooling, HTTP/2, caching, GZIP, and cross-platform compatibility.

Fifth, enterprise scenarios with complex HTTP capabilities should use Apache HttpClient 5.x by default. These scenarios usually include proxies, authentication, cookies, fine-grained connection pool control, TLS strategies, caching, observability, and compatibility with legacy systems.

Sixth, protocol-stack, gateway, proxy, load-testing, HTTP/3, QUIC, or underlying transport customization scenarios should use Jetty HttpClient.

Seventh, when an existing Netty asynchronous system does not depend on Spring WebFlux, AsyncHttpClient can be considered. This scenario is suitable for high-concurrency asynchronous calls, WebSocket, multiplexing, and Native Transport.

Eighth, when remote APIs need declarative interface wrapping, use OpenFeign or Retrofit. However, the underlying transport implementation still needs to be selected separately according to the rules above.

## 7. Conclusion

Java HTTP client selection cannot be reduced to a single "best" conclusion. The core value of JDK HttpClient is standardization, low dependency count, and sufficient coverage for ordinary HTTP calls. The core value of Apache HttpClient is complete enterprise HTTP capability coverage. The core value of OkHttp is efficient defaults and a simple API. The core value of Jetty HttpClient is protocol-stack and transport-layer extension. The core value of Reactor Netty and WebClient is the reactive non-blocking model. The core value of AsyncHttpClient is Netty-based asynchronous high-concurrency capability. The core value of OpenFeign and Retrofit is declarative interface wrapping.

The baseline path for daily backend development is: use JDK HttpClient for ordinary Java projects; use RestClient for Spring MVC projects; use WebClient for Spring WebFlux projects; use Apache HttpClient for complex enterprise HTTP scenarios; use OkHttp for SDK and Android scenarios; use Jetty for protocol or transport-layer customization scenarios; use AsyncHttpClient for Netty asynchronous systems. Performance conclusions should be confirmed through project-specific benchmarks and should not be inferred as a global ranking directly from official capability descriptions.

## References

[1] Oracle Java SE 21 `java.net.http.HttpClient`: explains the JDK HttpClient builder, HTTP/1.1/HTTP/2 support, synchronous/asynchronous models, connection pool reuse, default HTTP/2 preference, and related behavior. ([Oracle Documentation][1])
[2] OpenJDK HTTP Client Introduction: explains that the Java HTTP Client was introduced in Java 11 and that JDK 26 adds HTTP/3 while HTTP/2 remains the default preference. ([OpenJDK][2])
[3] Oracle Java SE 21 `HttpURLConnection`: explains that each instance is used for one request, that underlying connections may be transparently shared, and lists its HTTP method limitations. ([Oracle Documentation][3])
[4] Apache HttpComponents Client 5.6 Overview: explains Apache HttpClient capabilities around protocols, TLS, proxies, authentication, cookies, connection pooling, caching, compression, Unix Domain Sockets, observability, and more. ([hc.apache.org][4])
[5] Apache HttpClient Quick Start: explains classic, fluent, and async APIs and Java version requirements. ([hc.apache.org][5])
[6] OkHttp Overview: explains OkHttp capabilities around HTTP/2, connection pooling, GZIP, caching, synchronous/asynchronous calls, TLS, ease of use, and avoidance of excessive configurability. ([square.github.io][6])
[7] OkHttp Recipes: explains practical details such as caching, single-instance reuse, and call cancellation. ([square.github.io][7])
[8] Jetty HTTP Client official documentation: explains non-blocking asynchronous APIs, synchronous APIs, HTTP/1.1, HTTP/2, HTTP/3, FastCGI, QUIC, Unix Domain Sockets, memory transport, and `HttpClientTransport` extension. ([jetty.org][8])
[9] Reactor Netty HTTP Client Reference: explains Reactor Netty HttpClient, Reactive Streams backpressure, connection pooling, event loops, HTTP/2, metrics, and timeout configuration. ([Project Reactor][9])
[10] Spring REST Clients: explains RestClient, WebClient, RestTemplate, HTTP Service Clients, request factory selection logic, and RestTemplate being replaced by RestClient starting with Spring Framework 7.0. ([Home][10])
[11] Spring WebClient: explains WebClient's non-blocking, reactive, and streaming capabilities, and that it can plug into Reactor Netty, JDK HttpClient, Jetty Reactive HttpClient, and Apache HttpComponents. ([Home][11])
[12] AsyncHttpClient official README: explains that it is based on Netty and supports HTTP/1.1, HTTP/2, WebSocket, non-blocking APIs, Native Transport, connection pooling, authentication, proxies, filters, and more. ([GitHub][12])
[13] Retrofit and OpenFeign official documentation: Retrofit turns HTTP APIs into Java/Kotlin interfaces; OpenFeign is a Java-to-HTTP client binder, and Spring Cloud OpenFeign can create dynamic implementations from annotated interfaces. ([square.github.io][13])

[1]: https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/java/net/http/HttpClient.html "HttpClient (Java SE 21 & JDK 21)"
[2]: https://openjdk.org/groups/net/httpclient/intro.html "Introduction to the Java HTTP Client"
[3]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/HttpURLConnection.html "HttpURLConnection (Java SE 21 & JDK 21)"
[4]: https://hc.apache.org/httpcomponents-client-5.5.x/ "Apache HttpComponents - HttpClient Overview"
[5]: https://hc.apache.org/httpcomponents-client-5.5.x/quickstart.html "Apache HttpComponents - HttpClient Quick Start"
[6]: https://square.github.io/okhttp/ "Overview - OkHttp"
[7]: https://square.github.io/okhttp/recipes/ "Recipes - OkHttp"
[8]: https://jetty.org/docs/jetty/12.1/programming-guide/client/http.html "HTTP Client :: Eclipse Jetty"
[9]: https://projectreactor.io/docs/netty/release/reference/http-client.html "HTTP Client :: Reactor Netty Reference Guide"
[10]: https://docs.spring.io/spring-framework/reference/integration/rest-clients.html "REST Clients :: Spring Framework"
[11]: https://docs.spring.io/spring-framework/reference/web/webflux-webclient.html?utm_source=chatgpt.com "WebClient :: Spring Framework"
[12]: https://github.com/AsyncHttpClient/async-http-client "GitHub - AsyncHttpClient/async-http-client: Asynchronous Http and WebSocket Client library for Java"
[13]: https://square.github.io/retrofit/?utm_source=chatgpt.com "Introduction | Retrofit"
