---
title: "警惕无意识的“短连接”：深挖中间件客户端频繁创建引发的连接雪崩"
category: "网络可靠性"
summary: "分析在高频路径反复创建 HTTP、gRPC、注册中心、配置中心和中间件 SDK 客户端时，如何绕过连接复用并触发连接雪崩。"
tags:
  - "连接复用"
  - "HTTP"
  - "gRPC"
  - "中间件"
  - "客户端生命周期"
readingDirection: "适合在排查连接风暴、降级路径客户端创建、HTTP client 生命周期、gRPC channel 复用或中间件 SDK 资源抖动问题时阅读。"
outline: deep
---

# 警惕无意识的“短连接”：深挖中间件客户端频繁创建引发的连接雪崩

## 概览

分析在高频路径反复创建 HTTP、gRPC、注册中心、配置中心和中间件 SDK 客户端时，如何绕过连接复用并触发连接雪崩。

在很多线上故障中，真正危险的并不是业务代码显式写了一个“短连接协议”，而是高频请求路径里无意识地反复创建中间件客户端。比如本地配置读取失败后，临时 `new` 一个远程配置中心客户端；注册中心实例异常后，临时重建注册中心客户端；某个降级、兜底、动态路由、热修复逻辑里，按请求创建 RPC、HTTP、缓存、对象存储、搜索、消息队列等 SDK 客户端。表面看，这是“临时兜底”；实际可能把原本可复用的少量稳定连接，放大成每个请求都建连、握手、认证、初始化线程池或连接池的连接雪崩。

这种问题的本质不是“长连接比短连接高级”，而是：**HTTP client、gRPC `ManagedChannel` 这类成熟客户端，本来就已经内置连接复用机制；业务代码如果在高频路径反复创建客户端，就会绕过这些复用机制，把长连接退化成无意识短连接。**

## 一、HTTP 和 gRPC 中的长连接、短连接到底有什么不同

在 HTTP 场景中，所谓长连接通常指 persistent connection、keep-alive 或 connection reuse：同一条 TCP 连接可以承载多个 HTTP request/response，而不是每个 request/response 都重新打开一条连接。Oracle 对 HTTP persistent connections 的说明明确指出，它使用同一个 TCP 连接发送和接收多个 HTTP 请求/响应，优势包括减少 TCP 建立和拆除、降低后续请求延迟，并在 HTTPS 场景减少 TLS/SSL 握手成本；同时，HTTP/1.1 中持久连接是默认行为，除非客户端或服务端通过协议明确表示关闭连接。([Oracle Docs][1])

在 HTTP/1.1 里，短连接最典型的协议表达是 `Connection: close`。RFC 9112 说明，客户端可以在持久连接上继续发送请求，直到发送或收到 `close` 连接选项；如果响应中带有 `close`，表示服务端将在响应完成后关闭该连接，客户端收到后也应停止在该连接上继续发送请求。([IETF Datatracker][2])

HTTP/2 的连接模型比 HTTP/1.1 更进一步。RFC 9113 说明，HTTP/2 通过字段压缩以及允许同一连接上存在多个并发交换来提升网络资源利用率并降低延迟；同一个 HTTP/2 连接可以包含多个并发打开的 stream，并且不同 stream 的 frame 可以在同一连接上交错传输。([IETF Datatracker][3])

gRPC 又建立在 HTTP/2 之上。gRPC Core 文档说明，gRPC over HTTP2 是通过 HTTP/2 framing 承载 gRPC 请求和响应；gRPC 调用使用 HTTP/2 stream id 作为调用标识，服务端在准备终止连接前应发送 GOAWAY，用于告知客户端哪些 stream 已被接受。([grpc.github.io][4])

因此，HTTP 和 gRPC 的差异可以这样理解：HTTP/1.1 长连接主要是“同一 TCP 连接复用多个请求”；HTTP/2/gRPC 则是在同一连接上通过多个 stream 承载并发调用。所谓“短连接”，在工程故障里通常不是指某个新协议，而是指连接、HTTP client、连接池或 gRPC channel 没有被复用，导致请求频繁走新建连接路径。

## 二、主流 HTTP client 和 gRPC ManagedChannel 默认已经走连接复用模型

普通业务开发不需要手写一个“长连接协议”。更准确的工程做法是：**复用 HTTP client，复用连接池，复用 gRPC `ManagedChannel`，把连接生命周期交给成熟客户端管理。**

JDK `HttpClient` 文档说明，一个 `HttpClient` 构建后是不可变对象，并且可以用于发送多个请求；其文档也说明资源可以通过关闭 client 提前回收。([Oracle Docs][5])

OkHttp 文档说得更直接：`OkHttpClient` 应该被共享；创建单个 `OkHttpClient` 并复用于所有 HTTP 调用时性能最好，因为每个 client 都持有自己的连接池和线程池；复用连接和线程可以降低延迟、节省内存；相反，为每个请求创建 client 会在空闲池上浪费资源。([Square Open Source][6])

Apache HttpClient 5 文档也明确说明，HttpClient 使用连接池在请求之间复用持久连接，以降低连接建立开销；连接管理器维护 per-route 和 total 连接限制，并在可能时复用空闲持久连接。([Apache HttpComponents][7])

gRPC 官方性能文档同样给出明确建议：尽可能复用 stubs 和 channels；keepalive ping 可用于在空闲期间保持 HTTP/2 连接存活，从而让初始 RPC 不因重新建连而延迟。([gRPC][8])

对 Java gRPC 而言，`ManagedChannelBuilder.idleTimeout` 文档说明，channel 在没有进行中的 RPC 一段时间后会进入 idle；进入 idle 后会关闭所有连接、NameResolver 和 LoadBalancer；新的 RPC 会把 channel 从 idle 状态拉起；默认 idle timeout 是 30 分钟。`ManagedChannel` 文档还说明，channel terminated 后会释放相关资源，包括 TCP connections。([grpc.github.io][9])

结论很明确：HTTP client 和 gRPC `ManagedChannel` 本身已经是“长生命周期对象 + 连接复用”的设计。业务代码真正要避免的是把这些对象放到高频请求路径里反复 `new`。

## 三、默认长连接的好处：少建连、少握手、少初始化、少资源抖动

默认长连接的价值首先来自连接建立成本的减少。Oracle 文档列出的 HTTP persistent connection 优势包括减少 TCP 连接建立和拆除、降低后续请求延迟，并在 HTTPS 场景减少 TLS/SSL 握手成本。([Oracle Docs][1])

对 HTTP/2 和 gRPC 来说，复用连接还意味着可以在同一 HTTP/2 连接上复用多个 stream。RFC 9113 描述了 HTTP/2 通过同一连接上的多个并发交换降低延迟，gRPC 文档也说明 gRPC over HTTP2 通过 HTTP/2 framing 承载请求和响应。([IETF Datatracker][3])

对业务系统来说，长连接默认模式的收益不只是“少一次 TCP 握手”。更重要的是，连接池、线程池、HTTP/2 连接、TLS 会话、gRPC channel、NameResolver、LoadBalancer 等组件可以被稳定复用。Apache HttpClient 文档中，连接管理器负责 per-route/total 连接限制、连接 TTL、idle expiry、idle/expired connection 显式关闭；这些能力只有在 client/connection manager 被复用时才有工程意义。([Apache HttpComponents][10])

这也是为什么正常服务间调用、配置中心、注册中心、RPC、网关、缓存代理、搜索服务、对象存储 SDK 等高频访问场景，都应该默认使用长生命周期客户端，而不是请求级创建客户端。

## 四、短连接不是错误，但必须是“有意识”的选择

短连接在客户端侧有合理场景。一次性脚本、CLI 工具、临时调试、压测对照组、安全隔离、特殊代理链路，或者希望主动释放资源时，可以选择短生命周期连接或短生命周期客户端。Linux `close(2)` 文档说明，`close()` 会关闭文件描述符，使其不再引用任何文件并可被复用；Linux conntrack 文档也提供 `nf_conntrack_count` 表示当前已分配 flow entries，`nf_conntrack_max` 表示允许的连接跟踪项上限。([man7.org][11])

短连接也可能出现在熔断、故障隔离和快速止血场景。Apache HttpClient 连接管理文档提供了关闭 idle 或 expired 连接的 API；gRPC `ManagedChannel.shutdown()` 会发起有序关闭，新调用会被取消，terminated 后释放包括 TCP connections 在内的资源。([Apache HttpComponents][10])

服务端侧也存在主动关闭连接的合理场景，例如限流、鉴权失败、协议异常、异常来源流量、攻击流量等。需要注意，HTTP/1.1 下按协议应返回 `Connection: close`，而不是 `Connection closed`；RFC 9112 说明，服务端发送 `close` 连接选项后，应在响应完成后发起连接关闭，并且不得继续处理该连接上的后续请求。([IETF Datatracker][2])

如果是 HTTP/2 或 gRPC，不能照搬 HTTP/1.1 的 `Connection: close`。RFC 9113 明确规定，HTTP/2 不使用 `Connection` 头，端点不得生成包含连接特定头字段的 HTTP/2 消息；HTTP/2 连接关闭语义应使用 GOAWAY、RST_STREAM 或连接关闭机制。gRPC Core 文档也说明，服务端应在终止连接前发送 GOAWAY，以便客户端识别哪些 stream 已被服务端接受。([IETF Datatracker][3])

因此，短连接可以用，但它应该是明确、受控、可观测的选择，而不是降级代码里无意触发的副作用。

## 五、最常见的故障入口：高频降级路径里 new 中间件客户端

最容易引发连接雪崩的代码，往往长这样：

```java
// Bad: a client is created on the hot path.
ConfigClient configClient = new ConfigClient(remoteConfigEndpoint);
String value = configClient.get(key);
```

或者：

```java
// Bad: registry client is recreated during fallback.
RegistryClient registryClient = new RegistryClient(registryAddress);
List<Instance> instances = registryClient.refresh(serviceName);
```

这类代码的问题不一定在 `new ConfigClient()` 这一行本身，而在于中间件客户端内部可能封装了 `OkHttpClient`、Apache HttpClient、JDK `HttpClient`、gRPC `ManagedChannel`、连接池、线程池、后台刷新任务、认证上下文或负载均衡组件。OkHttp 文档明确说明每个 client 持有自己的连接池和线程池，为每个请求创建 client 会浪费资源；Apache HttpClient 文档说明连接池用于复用持久连接并降低连接建立开销；gRPC 官方文档要求尽可能复用 stubs 和 channels。([Square Open Source][6])

典型场景一：本地配置找不到，于是请求线程临时创建远程配置中心客户端去拉配置。低频触发时看不出问题；一旦本地配置缺失或缓存击穿，大量请求同时进入该分支，配置中心客户端被大量创建，内部 HTTP/gRPC 连接也随之被大量创建。

典型场景二：注册实例污染、注册中心不可达、实例列表过期，于是请求路径上降级重新创建注册中心客户端。这个动作会把“实例发现异常”放大成“注册中心被大量新连接冲击”。如果注册中心客户端内部使用 HTTP 或 gRPC，反复创建客户端就会绕过已有连接池或 `ManagedChannel` 的复用能力。

典型场景三：降级、兜底、热修复、动态配置刷新、请求级路由纠偏等逻辑里，临时创建任意中间件客户端。包括配置中心、注册中心、RPC、消息队列、缓存、对象存储、搜索服务客户端等。只要这些客户端内部包含 HTTP/gRPC client、连接池、线程池或后台任务，高频触发时就可能从“请求流量”演变为“建连风暴”。

这类问题最危险的地方是：它通常只在故障时爆发。正常路径下连接复用稳定，指标看起来健康；一旦某个依赖异常，所有请求进入降级路径，业务侧开始按请求创建客户端，中间件服务端同时承受建连、TLS、HTTP/2 preface、认证、初始化、限流和错误处理压力。Microsoft gRPC 性能文档也说明，如果每个 gRPC 调用都创建新 channel，调用完成时间会显著增加，因为每次调用都要经历打开 socket、建立 TCP、协商 TLS、启动 HTTP/2 连接，再发起 gRPC 调用。([Microsoft Learn][12])

## 六、避免连接雪崩的工程原则

第一，HTTP client、gRPC `ManagedChannel` 和中间件 SDK client 应作为长生命周期对象管理。可以是 Spring Bean、单例组件、受控连接池、SDK 内部共享对象，或者由框架统一管理的 client factory。这个原则不是编码风格问题，而是由 OkHttp、Apache HttpClient、gRPC 等官方文档共同支持的连接复用要求。([Square Open Source][6])

第二，降级路径不能无限制创建客户端。降级可以读本地快照、读缓存、触发异步刷新、使用 singleflight 合并请求、设置并发上限、加超时、加限流、加熔断；但不应在高频请求路径里按请求创建新中间件客户端。Apache HttpClient 文档中的 per-route/total connection limits、TTL、idle expiry、idle/expired eviction 说明连接管理本身需要被稳定复用，才能发挥限制和清理作用。([Apache HttpComponents][10])

第三，确实需要短生命周期客户端时，必须显式设置边界：低频触发、并发保护、超时、限流、生命周期关闭、失败指标、建连指标和告警。JDK `HttpClient` 文档说明资源可以通过关闭 client 提前回收；gRPC `ManagedChannel` 文档说明 shutdown/terminated 与 TCP connection 资源释放相关。([Oracle Docs][5])

第四，服务端应区分 HTTP/1.1 和 HTTP/2/gRPC 的关闭语义。HTTP/1.1 使用 `Connection: close`；HTTP/2 不允许生成 `Connection` 这类连接特定头字段；gRPC over HTTP/2 场景应使用 GOAWAY、RST_STREAM、状态码和 channel/transport 关闭语义。([IETF Datatracker][2])

第五，监控不能只看 QPS、RT 和错误率，还应覆盖连接复用是否失效。应重点观察新建连接数、活跃连接数、空闲连接数、连接池命中情况、fd 数、线程数、端口占用、TLS 握手、HTTP/2 连接数、gRPC channel 数、服务端 accept/handshake 压力，以及 conntrack entry 数量。Linux 文档中 `nf_conntrack_count` 和 `nf_conntrack_max` 分别对应当前连接跟踪项数量和允许上限，这类指标可以帮助定位“请求量没变，但建连量暴涨”的故障。([Linux Kernel 文档][13])

## 七、推荐一个 HTTP/gRPC 长短连接测试项目

如果希望直观看到“复用连接”和“每次请求创建连接”的差异，可以参考 `https://github.com/stellhub/java-connection-reuse-benchmark` 。这个仓库是一个 Java benchmark suite，用于比较 HTTP 和 gRPC workload 下的 persistent connection reuse 与 per-request connection creation。([GitHub][14])

该项目包含 server 和 client 两个模块：server 同时提供 HTTP Server 与 gRPC Server；client 同时执行四组压测：HTTP 长连接、HTTP 短连接、gRPC 长连接、gRPC 短连接。其中，HTTP 长连接复用同一个 `StellfluxHttpClient`，HTTP 短连接每次请求创建并关闭一个 `StellfluxHttpClient`；gRPC 长连接复用同一个 `ManagedChannel`，gRPC 短连接每次请求创建并关闭一个 `ManagedChannel`。([GitHub][14])

这个项目的价值不只是跑性能数字，更适合用来复现本文讨论的故障模式：当业务在高频路径上反复创建中间件客户端时，HTTP/gRPC 的默认连接复用会被绕过，系统会退化为 per-request connection creation。仓库 README 也把“本地配置读不到时临时 new 配置中心客户端”“注册中心实例列表没有及时更新时临时 new 注册中心客户端”“高频请求或兜底逻辑里临时 new 任意中间件客户端”等列为短连接风险场景。([GitHub][14])

## 结语

短连接不是原罪。一次性脚本、CLI、调试、安全隔离、代理链路、压测对照组、熔断关闭、服务端拒绝异常连接，都可以使用短连接或主动关闭连接。真正需要警惕的是无意识短连接：在高频请求链路或降级链路里反复创建中间件客户端，让 HTTP client 和 gRPC `ManagedChannel` 原本具备的连接复用能力失效。

成熟客户端已经给出了清晰的工程方向：复用 client，复用 channel，复用连接池；在确实需要关闭时，按 HTTP/1.1、HTTP/2 或 gRPC 的协议语义关闭；在降级路径里，禁止无限制创建新客户端。否则，原本用于保护业务的兜底逻辑，可能会变成压垮配置中心、注册中心或 RPC 服务端的连接雪崩源头。

[1]: https://docs.oracle.com/javase/8/docs/technotes/guides/net/http-keepalive.html "HTTP Persistent Connections"
[2]: https://datatracker.ietf.org/doc/html/rfc9112 "RFC 9112 - HTTP/1.1"
[3]: https://datatracker.ietf.org/doc/html/rfc9113 "RFC 9113 - HTTP/2"
[4]: https://grpc.github.io/grpc/core/md_doc__p_r_o_t_o_c_o_l-_h_t_t_p2.html "GRPC Core: gRPC over HTTP2"
[5]: https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/java/net/http/HttpClient.html "HttpClient (Java SE 21 & JDK 21)"
[6]: https://square.github.io/okhttp/5.x/okhttp/okhttp3/-ok-http-client/ "OkHttpClient"
[7]: https://hc.apache.org/httpcomponents-client-5.6.x/connection-pooling.html "Apache HttpComponents – Connection pooling"
[8]: https://grpc.io/docs/guides/performance/ "Performance Best Practices | gRPC"
[9]: https://grpc.github.io/grpc-java/javadoc/io/grpc/ManagedChannelBuilder.html "ManagedChannelBuilder (grpc-all 1.81.0 API)"
[10]: https://hc.apache.org/httpcomponents-client-5.6.x/connection-management.html "Apache HttpComponents – Connection management"
[11]: https://man7.org/linux/man-pages/man2/close.2.html "close(2) - Linux manual page"
[12]: https://learn.microsoft.com/en-us/aspnet/core/grpc/performance?view=aspnetcore-10.0 "Performance best practices with gRPC | Microsoft Learn"
[13]: https://docs.kernel.org/networking/nf_conntrack-sysctl.html "Netfilter Conntrack Sysfs variables — The Linux Kernel  documentation"
[14]: https://github.com/stellhub/java-connection-reuse-benchmark "GitHub - stellhub/java-connection-reuse-benchmark: Java benchmark suite for comparing persistent connection reuse with per-request connection creation across client/server workloads. · GitHub"
