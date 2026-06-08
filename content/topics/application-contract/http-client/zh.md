# Java HTTP Client 选型调研：内置客户端与主流第三方客户端的客观比较

## 摘要

Java 生态中用于发起 HTTP 请求的客户端可以分为三类：第一类是 JDK 内置客户端，包括早期的 `HttpURLConnection` 与 Java 11 引入的 `java.net.http.HttpClient`；第二类是传输层或协议层 HTTP 客户端，包括 Apache HttpClient、OkHttp、Jetty HttpClient、Reactor Netty HttpClient、AsyncHttpClient 等；第三类是框架型或声明式客户端，包括 Spring RestClient、Spring WebClient、OpenFeign、Retrofit 等。本文基于各项目官方文档，从协议支持、同步/异步模型、连接复用、可定制性、易用性、稳定性与典型适用场景等维度进行比较。官方文档并未提供跨客户端、跨版本、跨场景的统一性能基准，因此不能客观断言某一个 HTTP Client 在所有场景下性能最佳。选型应以运行时环境、并发模型、协议需求、框架体系和定制化需求为主要依据。

**关键词：** Java；HTTP Client；JDK HttpClient；Apache HttpClient；OkHttp；Jetty；Reactor Netty；Spring WebClient；选型调研

## 1. 引言

HTTP Client 是 Java 服务调用外部 HTTP API、微服务间通信、SDK 封装、网关代理、文件上传下载和异步流式通信的基础组件。不同 HTTP Client 在 API 设计、连接池、协议支持、异步模型、TLS 配置、代理认证、缓存、可观测性和框架集成方面存在差异。由于 HTTP 调用性能受 JVM 版本、TLS 实现、连接复用策略、服务端协议、网络 RTT、请求体大小、响应体大小、并发度、连接池参数和业务代码阻塞行为共同影响，单纯以“哪个最快”作为选型标准并不充分。

本文采用官方文档作为主要依据，避免基于个人经验进行判断。调研目标不是列出所有 Java HTTP 通信库，而是围绕日常后端开发、企业级服务治理和高并发调用中常见的 HTTP Client 进行比较。

## 2. 研究范围与分类

### 2.1 JDK 内置客户端

JDK 内置能力主要包括两类。

第一类是 `HttpURLConnection`。它属于 `java.net` 包，官方文档将其定义为支持 HTTP 特性的 `URLConnection`。每个 `HttpURLConnection` 实例用于一次请求，但底层网络连接可能被其他实例透明共享。该 API 自 Java 1.1 起存在，接口较底层，适合简单兼容场景，不适合作为新项目的复杂 HTTP 调用基础。

第二类是 `java.net.http.HttpClient`。该 API 自 Java 11 起成为标准 HTTP Client。官方文档说明，它可以通过 builder 创建，支持配置 HTTP/1.1 或 HTTP/2、重定向、代理、认证器等客户端级状态；构建后不可变，并可用于发送多个请求。它支持同步 `send` 和异步 `sendAsync`，异步接口返回 `CompletableFuture`。JDK 21 官方 API 文档中，其默认协议偏好为 HTTP/2，并可在必要时受实现约束回退到其他版本。OpenJDK 当前说明中还指出，JDK 26 引入了 HTTP/3 支持，但 HTTP/2 仍是默认首选协议，HTTP/3 需要显式启用。

### 2.2 传输层或协议层第三方客户端

Apache HttpClient 5.x 是 Apache HttpComponents 项目的一部分。官方文档说明，它是基于标准的纯 Java HTTP/1.0、HTTP/1.1 和 HTTP/2 客户端实现，支持 HTTPS、可插拔 TLS 策略、代理、Basic/Digest/Bearer/SCRAM-SHA-256 认证、Cookie、灵活连接管理与连接池、响应缓存、内容解压、Unix Domain Socket、观测指标等。它同时提供 classic、fluent、async 和 reactive 相关 API。

OkHttp 是 Square 维护的 HTTP Client。官方文档说明，OkHttp 默认支持 HTTP/2、连接池、透明 GZIP、响应缓存，并支持同步阻塞调用和异步回调。其文档还说明，OkHttp 使用 fluent builder 和不可变对象设计；同时，OkHttp 明确表示其设计原则是避免过度可配置，尤其避免为了绕过错误服务端或违反 RFC 场景而开放过多配置。

Jetty HttpClient 是 Eclipse Jetty 提供的客户端模块。官方文档说明，它是非阻塞、异步的 HTTP Client，提供不会因 I/O 阻塞的异步 API，适合负载测试、并行计算等高性能场景；同时也提供同步 API。Jetty HttpClient 支持 HTTP/1.1、HTTP/2、HTTP/3 和 FastCGI，并通过不同 `HttpClientTransport` 实现不同协议格式，还支持 TCP、Unix Domain Socket、QUIC、memory 等底层传输形式。

Reactor Netty HttpClient 是 Reactor Netty 提供的响应式 HTTP Client。官方文档说明，它隐藏了创建 HTTP Client 所需的大部分 Netty 细节，并加入 Reactive Streams 背压能力。Reactor Netty 面向 HTTP、TCP、UDP 提供网络引擎，适用于响应式微服务体系；其 HTTP Client 支持连接池、事件循环、SSL/TLS、代理、指标、跟踪、Unix Domain Socket、超时配置和 HTTP/2 配置。

AsyncHttpClient 是基于 Netty 的异步 HTTP 与 WebSocket 客户端。官方 README 将其定义为面向 Java 的高性能异步 HTTP Client，支持 HTTP/1.1、HTTP/2 和 WebSocket，提供非阻塞 I/O、`ListenableFuture`、`CompletableFuture`、连接池、压缩、认证、代理、Native Transport、请求/响应过滤器、Cookie、Multipart 上传和断点续传等能力。

### 2.3 框架型或声明式客户端

Spring RestClient 是 Spring Framework 提供的同步 HTTP 客户端。官方文档说明，它提供 fluent API，是对底层 HTTP 库的抽象，并负责 HTTP 请求/响应内容与高级 Java 对象之间的转换。Spring RestClient 可选择底层 HTTP 库，包括 JDK HttpClient、Apache HttpComponents、Jetty HttpClient、Reactor Netty HttpClient 和 SimpleClientHttpRequestFactory。若未显式指定 request factory，Spring 会根据 classpath 和 `java.net.http` 模块状态选择底层实现。

Spring WebClient 是 Spring WebFlux 中的非阻塞响应式 HTTP Client。官方文档说明，WebClient 基于 Reactor 提供函数式 fluent API，支持异步逻辑组合、非阻塞、流式处理，并可插入 Reactor Netty、JDK HttpClient、Jetty Reactive HttpClient、Apache HttpComponents 等底层库。

OpenFeign 和 Retrofit 属于声明式或接口型 HTTP Client。OpenFeign 官方说明其目标是简化 Java HTTP Client 编写过程，是 Java 到 HTTP 的 client binder；Spring Cloud OpenFeign 文档说明，它可以基于接口和注解创建动态实现。Retrofit 官方说明它可以将 HTTP API 转换为 Java 或 Kotlin 接口。这两类工具通常不直接作为底层传输实现，而是封装调用模型，并依赖或适配底层 HTTP Client。

## 3. 主要客户端能力比较

| 客户端                        | 类型            | 同步/异步模型                       | 协议支持                                     | 主要可验证优势                                                | 主要限制                                                    |
| -------------------------- | ------------- | ----------------------------- | ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| `HttpURLConnection`        | JDK 早期内置      | 同步为主                          | HTTP/1.x                                 | JDK 内置、无额外依赖、兼容历史代码                                    | API 底层；新项目中不适合作为复杂 HTTP 调用基础；不支持 PATCH 等现代需求            |
| `java.net.http.HttpClient` | JDK 11+ 内置    | 同步 + `CompletableFuture` 异步   | JDK 21：HTTP/1.1、HTTP/2；JDK 26 起支持 HTTP/3 | 无三方依赖；标准 API；连接池由客户端实例管理；支持 WebSocket                  | JSON 转换、拦截器、复杂连接池策略、可观测性等高级能力需要自行封装或借助框架                |
| Apache HttpClient 5.x      | 三方协议层客户端      | classic、fluent、async、reactive | HTTP/1.0、HTTP/1.1、HTTP/2                 | 企业级 HTTP 功能覆盖广；认证、代理、Cookie、缓存、连接池、TLS、观测能力完整          | API 与配置项较多，使用复杂度高于 JDK HttpClient 和 OkHttp              |
| OkHttp                     | 三方客户端         | 同步 + 异步回调                     | HTTP/1.1、HTTP/2、WebSocket、SSE            | API 简洁；HTTP/2、连接池、GZIP、缓存默认可用；适合 SDK 和移动端              | 官方明确避免过度可配置；对需要非常规协议行为或深度传输层定制的场景不占优                    |
| Jetty HttpClient           | 三方协议/传输层客户端   | 非阻塞异步 + 同步 API                | HTTP/1.1、HTTP/2、HTTP/3、FastCGI           | 协议与底层传输扩展能力强；支持 TCP、Unix Domain Socket、QUIC、memory 等传输 | 使用复杂度高；通常适合对协议栈和传输层有明确要求的场景                             |
| Reactor Netty HttpClient   | 响应式 Netty 客户端 | 非阻塞响应式                        | HTTP/1.1；可配置 HTTP/2                      | 与 Reactor/Spring WebFlux 生态一致；支持背压、连接池、事件循环、指标、跟踪      | 对阻塞式业务代码不天然适配；需要理解响应式编程模型                               |
| AsyncHttpClient            | Netty 异步客户端   | 非阻塞异步                         | HTTP/1.1、HTTP/2、WebSocket                | 面向异步高并发；支持 Native Transport、连接池、压缩、认证、代理、过滤器           | 与 Spring 主流抽象集成度低于 RestClient/WebClient；需要管理异步回调与资源生命周期 |
| Spring RestClient          | 框架抽象          | 同步                            | 取决于底层 request factory                    | Spring 生态内易用；对象转换、拦截器、baseUrl、默认头、cookie 等能力完善         | 非 Spring 项目引入成本较高；性能与协议能力取决于底层实现                        |
| Spring WebClient           | 框架抽象          | 非阻塞响应式                        | 取决于底层 connector                          | Spring WebFlux 场景标准选择；支持异步、流式和背压                       | 阻塞式系统中引入响应式模型会增加复杂度                                     |
| OpenFeign / Retrofit       | 声明式接口客户端      | 取决于底层实现                       | 取决于底层实现                                  | 适合 API 接口声明、SDK 封装和微服务声明式调用                            | 不应与底层 HTTP Client 直接等价比较；底层性能和协议能力取决于适配器                |

## 4. 场景化选型分析

### 4.1 普通 Java 11+ 项目

如果项目运行在 Java 11 及以上，调用需求主要是普通 REST API，包括 GET、POST、PUT、DELETE、请求头、超时、代理、重定向、同步或简单异步调用，则 `java.net.http.HttpClient` 可以作为基础选择。其客观依据是：它是 JDK 标准 API，无外部依赖；官方支持同步与异步模型；客户端实例管理连接池并可复用。

### 4.2 Spring MVC 阻塞式服务

如果项目基于 Spring MVC，调用方式以同步阻塞为主，则 Spring RestClient 是更贴合 Spring 体系的选择。其客观依据是：Spring 官方将 RestClient 定义为同步 fluent API，并提供 HTTP 消息转换、baseUrl、默认请求头、cookie、拦截器、request initializer 和底层 HTTP 库选择能力。Spring Framework 7.0 起，RestTemplate 已被标记为由 RestClient 替代，并将在未来版本移除。因此，新 Spring MVC 项目不应再以 RestTemplate 作为默认新选型。

在 Spring RestClient 的底层实现选择上，普通场景可使用 JDK HttpClient；需要更完整代理、认证、连接池、缓存、TLS、观测能力时可使用 Apache HttpClient；已有 Jetty 或 Reactor Netty 体系时可使用对应 request factory。

### 4.3 Spring WebFlux 或响应式服务

如果服务本身使用 Spring WebFlux、Reactor、响应式链路、流式响应、SSE 或高并发非阻塞模型，则 WebClient 是更一致的选择。其客观依据是：Spring 官方文档将 WebClient 定义为非阻塞、响应式、支持流式处理的 fluent API；其底层可使用 Reactor Netty、JDK HttpClient、Jetty Reactive HttpClient 或 Apache HttpComponents。默认 Spring WebFlux 生态中，Reactor Netty 与 Reactor 编程模型更一致。

### 4.4 SDK、客户端工具和移动端兼容场景

如果目标是封装 SDK、命令行客户端、桌面客户端或 Android/Java 通用客户端，OkHttp 是常见选择。其客观依据是：OkHttp 官方文档说明其支持 Java 8+ 与 Android 5.0+，并默认提供 HTTP/2、连接池、GZIP、响应缓存、同步与异步调用。OkHttp 的 API 以 builder 和不可变对象为核心，代码体量通常低于 Apache HttpClient 的完整配置模型。

### 4.5 企业级复杂 HTTP 能力场景

如果业务需要复杂代理、认证、Cookie、连接池策略、缓存后端、TLS 策略、Unix Domain Socket、指标观测、请求重试、响应压缩解压等能力，Apache HttpClient 5.x 更匹配。其客观依据是：Apache 官方文档列出了这些能力，并且 HttpClient 5.x 同时提供 classic、fluent、async 和 reactive API。对于大型企业后端系统，Apache HttpClient 的价值主要体现在 HTTP 协议周边能力完整，而不是单次请求代码最短。

### 4.6 协议栈和传输层定制场景

如果调用场景涉及 HTTP/2、HTTP/3、QUIC、Unix Domain Socket、memory transport、FastCGI 或协议协商定制，则 Jetty HttpClient 更适合。其客观依据是：Jetty 官方文档明确说明其 HTTP Client 支持不同 HTTP 格式和不同底层传输，并通过 `HttpClientTransport` 进行扩展。该类场景通常出现在网关、代理、压测工具、协议实验、内部基础设施或需要精细控制连接与协议行为的系统中。

### 4.7 高并发异步调用场景

如果调用链路以高并发、非阻塞、事件循环、异步回调或响应式背压为核心，则 Reactor Netty HttpClient、Jetty HttpClient 或 AsyncHttpClient 是候选对象。Reactor Netty 与 Spring WebFlux/Reactor 生态一致；Jetty 在协议和传输层扩展方面更完整；AsyncHttpClient 基于 Netty，面向异步 HTTP 与 WebSocket，并提供 Native Transport 等能力。具体选择应取决于业务是否已采用 Reactor、是否需要 Spring 集成、是否需要 HTTP/3 或底层传输定制。

### 4.8 声明式服务调用场景

如果核心目标不是控制 HTTP 传输细节，而是将远程 API 映射成 Java 接口，则 OpenFeign 或 Retrofit 属于更高层选择。OpenFeign 适合 Spring Cloud 微服务中的声明式 REST 调用；Retrofit 适合 SDK、Android 或接口型 API 封装。此类框架的性能与协议能力取决于其底层 HTTP Client，因此不能将其与 Apache HttpClient、OkHttp、Jetty 或 JDK HttpClient 作为同一层级进行性能比较。

## 5. 关键问题的客观结论

### 5.1 哪个 HTTP Client 性能最佳

官方文档没有提供覆盖 JDK HttpClient、Apache HttpClient、OkHttp、Jetty、Reactor Netty、AsyncHttpClient 的统一性能基准。因此，不能客观断言某一个 HTTP Client 在所有场景中性能最佳。

如果仅根据官方文档描述进行场景归纳，可以得到以下事实性结论：

第一，Jetty HttpClient 官方文档明确说明其非阻塞异步 API 不会因 I/O 阻塞，线程利用率高，适合负载测试和并行计算等高性能场景。

第二，Reactor Netty HttpClient 官方文档说明其隐藏 Netty 细节并加入 Reactive Streams 背压能力，适用于响应式微服务体系。

第三，AsyncHttpClient 官方 README 将其定义为基于 Netty 的高性能异步 HTTP Client，并支持 HTTP/2、多路复用、Native Transport 和非阻塞 I/O。

第四，OkHttp 官方文档说明其通过 HTTP/2、连接池、透明 GZIP 和响应缓存提升默认效率。

因此，性能选型不能脱离场景：阻塞式普通 REST 调用可使用 JDK HttpClient 或 Spring RestClient；响应式高并发调用可使用 WebClient/Reactor Netty；协议栈高性能与 HTTP/3 场景可使用 Jetty；Netty 异步模型场景可使用 AsyncHttpClient。严谨的性能结论必须通过同一硬件、同一 JVM、同一 TLS、同一服务端、同一请求模型和同一连接池参数下的基准测试获得。

### 5.2 哪个 HTTP Client 最稳定

“稳定”至少包含三类含义：API 稳定、运行时依赖稳定、复杂 HTTP 行为稳定。

从 API 与依赖角度看，`java.net.http.HttpClient` 是 Java 11 起的 JDK 标准 API，无第三方依赖，因而依赖冲突风险最低。

从复杂 HTTP 行为覆盖角度看，Apache HttpClient 5.x 提供更完整的企业级 HTTP 能力，包括连接池、认证、代理、Cookie、缓存、TLS 策略、观测和多种 API 形态，因此更适合复杂企业 HTTP 调用。

从协议与传输稳定性角度看，如果系统依赖 HTTP/2、HTTP/3、QUIC 或底层传输扩展，Jetty HttpClient 的协议栈能力更完整。

因此，不能以单一维度定义“最稳定”。如果稳定性指最少外部依赖，则 JDK HttpClient 更符合；如果稳定性指复杂 HTTP 能力覆盖，则 Apache HttpClient 更符合；如果稳定性指协议和传输扩展，则 Jetty HttpClient 更符合。

### 5.3 哪个 HTTP Client 最易用

易用性与项目上下文相关。

在非 Spring、Java 11+ 项目中，JDK HttpClient 易用性较高，因为无需引入依赖，API 直接来自 JDK。

在 Java/Android SDK 场景中，OkHttp 易用性较高，因为官方提供简洁的 request/response API、同步调用和异步回调，并默认具备连接池、HTTP/2、GZIP 与缓存能力。

在 Spring MVC 项目中，Spring RestClient 易用性较高，因为它直接集成 Spring 的消息转换、拦截器、baseUrl、默认头、cookie 和底层 request factory 选择。

在 Spring WebFlux 项目中，WebClient 易用性较高，因为它与 Reactor 异步组合、非阻塞 I/O 和流式处理模型一致。

### 5.4 哪个 HTTP Client 可定制化和扩展性最高

如果扩展性指 HTTP 企业功能扩展，Apache HttpClient 5.x 较强。其官方文档列出可插拔 TLS 策略、连接池策略、认证、缓存后端、内容解压、Unix Domain Socket、观测模块等能力。

如果扩展性指协议格式和底层传输扩展，Jetty HttpClient 较强。其官方文档说明不同 HTTP 格式由不同 `HttpClientTransport` 实现承载，并可使用 TCP、Unix Domain Socket、QUIC、memory 等底层传输。

如果扩展性指响应式链路集成，Reactor Netty 与 WebClient 更强，因为它们天然处于 Reactor/Spring WebFlux 生态中。

OkHttp 官方文档明确说明其原则是避免过度可配置，因此在极端定制化场景下不应作为首选。

## 6. 日常开发选型规则

日常开发可以采用以下规则：

第一，纯 Java 11+ 普通服务调用默认使用 `java.net.http.HttpClient`。该选择减少外部依赖，并满足同步、异步、HTTP/2、代理、认证、超时和连接复用等基础需求。

第二，Spring MVC 阻塞式项目默认使用 Spring RestClient。底层优先使用 JDK HttpClient；当需要复杂连接池、代理、认证、TLS 或观测能力时，切换为 Apache HttpClient request factory。

第三，Spring WebFlux 或响应式项目默认使用 WebClient。底层可采用 Reactor Netty，以保持响应式编程模型、背压和事件循环模型一致。

第四，SDK、Android 或轻量客户端默认使用 OkHttp。该场景通常更关注 API 简洁、默认连接池、HTTP/2、缓存、GZIP 和跨平台兼容。

第五，企业级复杂 HTTP 能力默认使用 Apache HttpClient 5.x。该场景通常包含代理、认证、Cookie、连接池细粒度控制、TLS 策略、缓存、观测和兼容历史系统等需求。

第六，协议栈、网关、代理、压测、HTTP/3、QUIC 或底层传输定制场景使用 Jetty HttpClient。

第七，已有 Netty 异步体系且不依赖 Spring WebFlux 时，可以考虑 AsyncHttpClient。该场景适合高并发异步、WebSocket、多路复用和 Native Transport。

第八，远程 API 需要声明式接口封装时，使用 OpenFeign 或 Retrofit；但底层传输实现仍需按上述规则单独选型。

## 7. 结论

Java HTTP Client 选型不能以单一“最好”作为结论。JDK HttpClient 的核心价值是标准化、低依赖和足够覆盖普通 HTTP 调用；Apache HttpClient 的核心价值是企业级 HTTP 能力完整；OkHttp 的核心价值是默认高效和 API 简洁；Jetty HttpClient 的核心价值是协议栈和传输层扩展；Reactor Netty 与 WebClient 的核心价值是响应式非阻塞模型；AsyncHttpClient 的核心价值是基于 Netty 的异步高并发能力；OpenFeign 和 Retrofit 的核心价值是声明式接口封装。

日常后端开发的基准路径是：普通 Java 项目使用 JDK HttpClient；Spring MVC 项目使用 RestClient；Spring WebFlux 项目使用 WebClient；复杂企业 HTTP 场景使用 Apache HttpClient；SDK 和 Android 场景使用 OkHttp；协议或传输层定制场景使用 Jetty；Netty 异步体系使用 AsyncHttpClient。性能结论应通过项目内基准测试确认，而不应从官方能力描述直接推导出全局排名。

## 参考资料

[1] Oracle Java SE 21 `java.net.http.HttpClient`：说明 JDK HttpClient 的 builder、HTTP/1.1/HTTP/2、同步/异步、连接池复用、默认 HTTP/2 偏好等。([Oracle 文档][1])
[2] OpenJDK HTTP Client Introduction：说明 Java HTTP Client 自 Java 11 引入，并说明 JDK 26 增加 HTTP/3、HTTP/2 仍为默认偏好。([OpenJDK][2])
[3] Oracle Java SE 21 `HttpURLConnection`：说明每个实例用于一次请求、底层连接可透明共享，并列出其 HTTP 方法限制。([Oracle 文档][3])
[4] Apache HttpComponents Client 5.6 Overview：说明 Apache HttpClient 的协议、TLS、代理、认证、Cookie、连接池、缓存、压缩、Unix Domain Socket、观测等能力。([hc.apache.org][4])
[5] Apache HttpClient Quick Start：说明 classic、fluent、async API 及 Java 版本要求。([hc.apache.org][5])
[6] OkHttp Overview：说明 OkHttp 的 HTTP/2、连接池、GZIP、缓存、同步/异步调用、TLS、易用性与避免过度可配置原则。([square.github.io][6])
[7] OkHttp Recipes：说明缓存、单实例复用、取消调用等实践细节。([square.github.io][7])
[8] Jetty HTTP Client 官方文档：说明非阻塞异步 API、同步 API、HTTP/1.1、HTTP/2、HTTP/3、FastCGI、QUIC、Unix Domain Socket、memory transport 和 `HttpClientTransport` 扩展。([jetty.org][8])
[9] Reactor Netty HTTP Client Reference：说明 Reactor Netty HttpClient、Reactive Streams 背压、连接池、事件循环、HTTP/2、指标和超时配置。([Project Reactor][9])
[10] Spring REST Clients：说明 RestClient、WebClient、RestTemplate、HTTP Service Clients、request factory 选择逻辑，以及 Spring Framework 7.0 起 RestTemplate 被 RestClient 替代。([Home][10])
[11] Spring WebClient：说明 WebClient 的非阻塞、响应式、流式处理能力，以及可插入 Reactor Netty、JDK HttpClient、Jetty Reactive HttpClient、Apache HttpComponents。([Home][11])
[12] AsyncHttpClient 官方 README：说明其基于 Netty，支持 HTTP/1.1、HTTP/2、WebSocket、非阻塞 API、Native Transport、连接池、认证、代理、过滤器等能力。([GitHub][12])
[13] Retrofit 与 OpenFeign 官方说明：Retrofit 将 HTTP API 转为 Java/Kotlin 接口；OpenFeign 是 Java 到 HTTP 的 client binder，Spring Cloud OpenFeign 可基于注解接口创建动态实现。([square.github.io][13])

[1]: https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/java/net/http/HttpClient.html "HttpClient (Java SE 21 & JDK 21)"
[2]: https://openjdk.org/groups/net/httpclient/intro.html "Introduction to the Java HTTP Client"
[3]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/HttpURLConnection.html "HttpURLConnection (Java SE 21 & JDK 21)"
[4]: https://hc.apache.org/httpcomponents-client-5.5.x/ "Apache HttpComponents – HttpClient Overview"
[5]: https://hc.apache.org/httpcomponents-client-5.5.x/quickstart.html "Apache HttpComponents – HttpClient Quick Start"
[6]: https://square.github.io/okhttp/ "Overview - OkHttp"
[7]: https://square.github.io/okhttp/recipes/ "Recipes - OkHttp"
[8]: https://jetty.org/docs/jetty/12.1/programming-guide/client/http.html "HTTP Client :: Eclipse Jetty"
[9]: https://projectreactor.io/docs/netty/release/reference/http-client.html "HTTP Client :: Reactor Netty Reference Guide"
[10]: https://docs.spring.io/spring-framework/reference/integration/rest-clients.html "REST Clients :: Spring Framework"
[11]: https://docs.spring.io/spring-framework/reference/web/webflux-webclient.html?utm_source=chatgpt.com "WebClient :: Spring Framework"
[12]: https://github.com/AsyncHttpClient/async-http-client "GitHub - AsyncHttpClient/async-http-client: Asynchronous Http and WebSocket Client library for Java · GitHub"
[13]: https://square.github.io/retrofit/?utm_source=chatgpt.com "Introduction | Retrofit"
