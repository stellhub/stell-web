# 网络通信中的超时定义与设置

## 摘要

网络通信中的超时并不是单一的 `timeout` 参数，而是一组分布在客户端、服务端、代理网关、连接池、传输协议和 RPC 框架中的时间边界。一次请求可能经过 DNS 解析、连接池排队、TCP 建连、TLS 握手、请求写入、服务端排队与处理、上游代理转发、响应头返回、响应体传输、连接空闲保持等多个阶段。任何一个阶段超过其时间边界，都可能表现为“超时”，但其根因、处理方式和配置位置并不相同。

本文重新定义网络通信中的主要超时类型，并重点讨论如何区分和定位超时原因。核心结论是：**超时治理的重点不是给所有请求设置一个统一秒数，而是建立阶段化超时模型、端到端 deadline、分层日志、阶段耗时观测和跨服务链路关联能力。** AWS Builders Library 建议对任何远程调用设置超时，并指出超时时间过高会降低资源保护价值，过低则会导致误超时和重试放大；其推荐方法是从下游延迟分位数出发，例如选择可接受的误超时率 0.1%，再参考下游 p99.9 延迟设置超时。([Amazon Web Services, Inc.][1])

---

## 1. 研究背景

分布式系统无法假设网络、服务端、代理、中间件和操作系统始终稳定。网络通信中的失败可能来自服务器、网络、负载均衡器、软件、操作系统或人为操作；大量失败首先表现为请求耗时异常增长，甚至长期不返回。客户端在等待请求完成期间会占用线程、连接、内存、临时端口等资源，因此远程调用必须设置明确的时间边界。([Amazon Web Services, Inc.][1])

在工程实践中，超时经常被错误地归因。例如，客户端看到 `SocketTimeoutException`，并不能直接说明是“网络慢”；它可能是下游服务处理慢、网关等待上游超时、响应体传输中断、连接池饱和、服务端线程池排队、数据库慢查询、TLS 握手卡顿，或者 HTTP/2 stream 被 idle timeout 关闭。Java `SocketTimeoutException` 的定义只表明 socket read 或 accept 发生超时，并不直接给出业务根因。([Oracle 文档][2])

因此，超时治理必须从“异常名称驱动”转向“阶段定位驱动”。本文将网络通信超时划分为四个层面：

1. 客户端侧超时：DNS、连接池、TCP 连接、TLS、写请求、读响应、总调用 deadline。
2. 服务端侧超时：请求头读取、请求体读取、业务处理、响应写出、keep-alive。
3. 代理/网关侧超时：连接上游、发送给上游、读取上游响应、路由总超时、单次重试超时、stream idle。
4. 协议与连接生命周期超时：HTTP/2 stream、gRPC deadline、TCP idle、keep-alive、连接最大生命周期。

---

## 2. 超时的完整类型体系

### 2.1 客户端侧超时

客户端侧超时用于约束调用方愿意等待的时间，以及调用方本地资源的等待边界。它并不只包括 `connectTimeout`、`readTimeout`、`writeTimeout`，还包括连接池获取、DNS、TLS、完整调用 deadline 和重试单次尝试时间。

| 超时类型     | 常见配置名                                       | 作用阶段       | 超时后表现               | 主要根因                           |
| -------- | ------------------------------------------- | ---------- | ------------------- | ------------------------------ |
| 连接池获取超时  | `connectionRequestTimeout`、`acquireTimeout` | 从连接池等待可用连接 | 客户端本地失败，请求可能尚未发出    | 连接池太小、连接泄漏、下游变慢导致连接长期占用        |
| DNS 解析超时 | resolver timeout、DNS timeout                | 域名解析       | 请求无法获得目标地址          | DNS 服务异常、域名配置错误、网络策略阻断         |
| TCP 建连超时 | `connectTimeout`                            | TCP 三次握手   | 连接未建立，请求未进入 HTTP 阶段 | 目标端口不可达、防火墙丢包、实例假活、路由问题        |
| TLS 握手超时 | handshake timeout、transport socket timeout  | TLS 协商     | HTTPS/gRPC TLS 连接失败 | 证书链校验慢、SNI 错误、TLS 协议不兼容、CPU 抖动 |
| 请求写超时    | `writeTimeout`、socket write timeout         | 发送请求头/请求体  | 请求写入失败，服务端可能收到部分数据  | 客户端上行慢、服务端接收慢、请求体过大、TCP 窗口阻塞   |
| 响应读超时    | `readTimeout`、socket timeout                | 读取响应头/响应体  | 客户端读失败，服务端可能已处理完成   | 服务端处理慢、响应体过大、网络中断、下游卡顿         |
| 完整调用超时   | `callTimeout`、deadline、request timeout      | 从调用开始到结束   | 调用被取消或失败            | 总预算不足、重试叠加、阶段超时缺失              |
| 单次尝试超时   | `perTryTimeout`、per-attempt timeout         | 重试中的某一次尝试  | 当前尝试失败，可能进入下一次重试    | 单次尝试预算过长或过短                    |

Apache HttpClient 将连接池获取超时、连接建立超时、socket 数据等待超时区分为三个概念：`getConnectionRequestTimeout()` 是从连接管理器请求连接的等待时间，`getConnectTimeout()` 是连接建立时间，`getSocketTimeout()` 是等待数据或两个连续数据包之间最大不活动时间。([Apache HttpComponents][3])

Java Socket 的 `connect(endpoint, timeout)` 明确表示连接建立等待时间，timeout 为 0 表示无限等待；如果连接建立前超时，会抛出 `SocketTimeoutException`。`SO_TIMEOUT` 则作用于读取操作，表示关联输入流的 `read()` 最多阻塞多长时间，超时后 socket 仍然有效。([Oracle 文档][4])

OkHttp 的默认配置也体现了阶段化模型：默认完整调用没有总超时，但 connect、read、write 默认各为 10 秒；`callTimeoutMillis` 用于完整调用，`connectTimeoutMillis`、`readTimeoutMillis`、`writeTimeoutMillis` 只分别覆盖连接、读、写阶段。([square.github.io][5])

---

### 2.2 服务端侧超时

服务端侧超时的目的不是替客户端决定等待时间，而是保护服务端资源，防止慢客户端、异常连接、过大的请求头、慢上传、慢下载和长时间空闲连接占用资源。

| 超时类型          | 常见配置名                                                 | 作用阶段          | 超时后表现          | 主要根因               |
| ------------- | ----------------------------------------------------- | ------------- | -------------- | ------------------ |
| 请求头读取超时       | `client_header_timeout`、`request_headers_timeout`     | 服务端读取请求行和请求头  | 通常返回 408 或关闭连接 | 慢客户端、网络抖动、恶意慢请求    |
| 请求体读取超时       | `client_body_timeout`、upload timeout                  | 服务端读取请求体      | 通常返回 408 或关闭连接 | 慢上传、大文件、客户端中断      |
| 业务处理超时        | servlet async timeout、controller timeout、RPC deadline | 应用处理请求        | 返回 5xx、超时错误或取消 | 线程池排队、DB 慢查询、下游依赖慢 |
| 响应发送超时        | `send_timeout`                                        | 服务端向客户端写响应    | 连接关闭           | 客户端接收慢、网络拥塞、响应体过大  |
| keep-alive 超时 | `keepAliveTimeout`、`keepalive_timeout`                | 等待复用连接上的下一个请求 | 空闲连接关闭         | 连接复用窗口过长或过短        |

Nginx 的 `client_header_timeout` 默认 60 秒，用于读取客户端请求头；如果客户端未在该时间内发送完整 header，请求会以 408 终止。`client_body_timeout` 默认 60 秒，用于读取请求体，但它限制的是两次连续读取操作之间的时间，而不是整个请求体传输总时间。([Nginx][6])

Tomcat 的 `connectionTimeout` 表示连接被接受后，等待请求 URI 行出现的时间；默认值为 60 秒，但标准 `server.xml` 通常设置为 20 秒。Tomcat 的 `connectionUploadTimeout` 用于上传过程，默认 300 秒；`keepAliveTimeout` 表示连接器等待下一个 HTTP 请求的时间，默认使用 `connectionTimeout` 的值。([tomcat.apache.org][7])

---

### 2.3 代理与网关侧超时

代理/网关侧超时用于约束“客户端到网关”和“网关到上游服务”之间的等待边界。它与客户端超时不同：客户端超时表示调用方愿意等待多久，代理超时表示代理愿意为一次转发占用资源多久。

| 超时类型                | 常见配置名                                             | 作用阶段            | 超时后表现          | 主要根因                    |
| ------------------- | ------------------------------------------------- | --------------- | -------------- | ----------------------- |
| 上游连接超时              | `proxy_connect_timeout`、cluster `connect_timeout` | 网关连接后端服务        | 常见 502/503/504 | 后端不可达、端口未监听、网络 ACL、实例异常 |
| 上游发送超时              | `proxy_send_timeout`                              | 网关向后端发送请求       | 连接关闭或上游错误      | 后端接收慢、请求体大、上游连接阻塞       |
| 上游读取超时              | `proxy_read_timeout`、route timeout                | 网关读取后端响应        | 常见 504         | 后端处理慢、下游依赖慢、响应体无进展      |
| 路由总超时               | Envoy route `timeout`                             | 等待上游完整响应        | Envoy 返回超时响应   | 上游响应整体超出预算              |
| 单次重试超时              | Envoy `per_try_timeout`                           | 每次重试尝试          | 当前尝试失败，可能重试    | 重试预算分配不合理               |
| stream idle timeout | `stream_idle_timeout`、route `idle_timeout`        | HTTP stream 无活动 | stream 被重置或关闭  | 流式接口无心跳、对端停止读写          |
| TCP idle timeout    | TCP proxy `idle_timeout`                          | TCP 连接无活动       | 连接关闭           | 长连接缺少心跳或业务空闲过长          |

Nginx 的 `proxy_connect_timeout` 默认 60 秒，用于建立到被代理服务器的连接；`proxy_read_timeout` 默认 60 秒，用于读取上游响应，且只作用于两次连续读操作之间；`proxy_send_timeout` 默认 60 秒，用于向上游发送请求，且只作用于两次连续写操作之间。([Nginx][8])

Envoy 官方文档将超时分为 HTTP/gRPC 连接超时、stream 超时、route 超时、TCP 超时和 transport socket 超时。Envoy route `timeout` 默认 15 秒，表示等待上游完整响应的时间；该配置不适合永不自然结束的 streaming response，流式 API 应使用 stream idle timeout。Envoy cluster `connect_timeout` 表示等待上游 TCP 连接建立的时间，未设置时默认 5 秒；上游 TLS 连接时，该时间包含 TLS 握手。([envoyproxy.io][9])

---

### 2.4 gRPC 与 deadline 超时

gRPC 的核心超时概念是 deadline。deadline 表示客户端愿意等待响应的最晚时间点；timeout 是最大持续时间，deadline 可以由当前时间加 timeout 得出。gRPC 默认不设置 deadline，因此如果调用方不显式配置，客户端可能长期等待响应。([gRPC][10])

当 deadline 超过时，客户端会以 `DEADLINE_EXCEEDED` 失败；服务端会在客户端 deadline 超过后取消调用，但服务端应用本身仍需要检查取消信号并停止其启动的后台工作。gRPC 还支持 deadline propagation：上游服务继续调用下游服务时，应继承原始 deadline，gRPC 会将 deadline 转换为扣除已消耗时间后的 timeout，以避免时钟偏差问题。([gRPC][10])

在 .NET gRPC 文档中，deadline 超过后客户端会中止底层 HTTP 请求并抛出 `DeadlineExceeded`；服务端 HTTP 请求被中止并触发 `ServerCallContext.CancellationToken`，但 gRPC 方法会继续运行直到方法完成，因此服务端需要把 cancellation token 传递给数据库查询、HTTP 请求等异步操作。([Microsoft Learn][11])

---

## 3. 超时根因模型

超时定位应围绕“超时发生在哪个阶段”展开。下面给出一个从客户端视角观察到的阶段链路：

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

OkHttp 的 `EventListener` 正是按照类似阶段暴露观测事件，包括 dispatcher queue、proxy selection、DNS、connect、secure connect、connection acquired、request headers/body、response headers/body 等事件；这些事件可以用于记录 HTTP 调用各阶段的数量、大小和耗时。([square.github.io][12])

### 3.1 DNS 解析超时

DNS 解析超时通常发生在请求尚未连接目标服务之前。常见根因包括 DNS 服务不可用、域名不存在、DNS 服务器网络不可达、本地 resolver 配置错误、容器内 DNS 配置异常、Kubernetes CoreDNS 压力过高、跨网络访问 DNS 被防火墙限制。

定位依据：

| 现象                                             | 判断                    |
| ---------------------------------------------- | --------------------- |
| `UnknownHostException`、name resolution timeout | 优先检查 DNS              |
| curl `time_namelookup` 高                       | DNS 阶段耗时异常            |
| 同 IP 访问正常，域名访问异常                               | DNS 或 SNI/Host 配置问题   |
| 部分 Pod 异常，宿主机正常                                | 容器 DNS、CoreDNS、网络策略问题 |

curl 的 `--write-out` 支持 `time_namelookup`，它表示从开始到名称解析完成所用时间；`time_connect` 表示到 TCP 连接完成的时间；`time_appconnect` 表示 SSL/SSH 等握手完成时间；`time_starttransfer` 表示收到第一个字节的时间。([Curl][13])

---

### 3.2 TCP 建连超时

TCP 建连超时发生在 DNS 已经得到地址之后，但 TCP 连接未能在规定时间内建立。根因通常不是服务端业务处理慢，而是网络路径、目标端口、实例健康或防火墙问题。

常见根因：

| 根因             | 说明                                   |
| -------------- | ------------------------------------ |
| 目标服务未监听端口      | 可能表现为 connection refused，而不是 timeout |
| 防火墙或安全组丢弃 SYN  | 常表现为 connect timeout                 |
| 路由不可达          | 跨网段、跨 VPC、跨地域路由问题                    |
| 目标实例假活         | 健康检查误判，端口不可用                         |
| SYN backlog 溢出 | 服务端连接建立队列压力过高                        |
| NAT/SNAT 资源耗尽  | 大量短连接导致端口或连接跟踪耗尽                     |

定位依据：

| 观测信号                                    | 判断                 |
| --------------------------------------- | ------------------ |
| curl `time_connect - time_namelookup` 高 | TCP 建连阶段慢          |
| telnet/nc 连接目标端口超时                      | 网络或端口可达性问题         |
| 服务端没有收到请求日志                             | 请求未到应用层            |
| 抓包看到 SYN 重传无 SYN-ACK                    | 网络丢包、ACL、防火墙、目标不可达 |
| 只在新连接时发生，复用连接正常                         | 建连或 TLS 阶段问题       |

Java Socket 的连接超时发生在连接建立前，超时后抛出 `SocketTimeoutException`；这类超时通常不应被解释为服务端业务逻辑执行慢。([Oracle 文档][4])

---

### 3.3 TLS 握手超时

TLS 握手超时发生在 TCP 已连接之后、应用层请求发送之前。它与 HTTPS、gRPC TLS、mTLS、证书链校验、SNI、加密套件协商有关。

常见根因：

| 根因           | 说明                       |
| ------------ | ------------------------ |
| 证书链过长或校验慢    | 客户端验证耗时升高                |
| SNI 不匹配      | 服务端返回错误证书或握手失败           |
| 协议版本不兼容      | TLS 版本或 cipher suite 不匹配 |
| 服务端 CPU 抖动   | TLS 握手需要计算资源             |
| mTLS 客户端证书异常 | 证书过期、信任链缺失               |
| 新实例冷启动       | 连接池尚未预热，TLS 握手集中发生       |

AWS Builders Library 提到一个实际问题：某系统在部署后出现少量超时，原因是超时时间包含新建安全连接，连接建立超过了约 20ms；连接复用后问题不明显，后来通过进程启动时预建连接缓解。([Amazon Web Services, Inc.][1])

定位依据：

| 观测信号                                                 | 判断            |
| ---------------------------------------------------- | ------------- |
| curl `time_appconnect - time_connect` 高              | TLS/SSL 握手阶段慢 |
| HTTP 明文正常，HTTPS 慢                                    | TLS 或证书问题     |
| 新实例上线后短时间超时                                          | 连接预热不足        |
| OkHttp `secureConnectStart` 到 `secureConnectEnd` 耗时高 | TLS 阶段异常      |

---

### 3.4 连接池获取超时

连接池获取超时是客户端本地超时，请求可能尚未发出。它容易被误判为“下游慢”，但根因通常在调用方自身：连接池太小、连接未释放、并发超过连接池容量、响应体未关闭、下游变慢导致连接长期占用。

Apache HttpClient 的 `connectionRequestTimeout` 专门表示从连接管理器请求连接的等待时间；这与 TCP 建连超时和 socket 数据等待超时是不同概念。([Apache HttpComponents][3])

定位依据：

| 观测信号                       | 判断          |
| -------------------------- | ----------- |
| 连接池 pending 数高             | 调用方本地连接资源不足 |
| 服务端无对应请求日志                 | 请求尚未到达服务端   |
| 客户端线程大量等待 connection lease | 连接池获取阻塞     |
| 响应体未关闭后问题加剧                | 连接泄漏        |
| 提高连接池后缓解                   | 本地池容量或释放问题  |

治理方法：

```text
1. 记录 connection acquired / released 时间。
2. 检查响应体是否在 finally 中关闭。
3. 区分 maxTotal、maxPerRoute、HTTP/2 stream 并发上限。
4. 连接池获取超时应短于完整调用 deadline。
5. 连接池耗尽不应简单扩大池大小，应同时分析下游延迟和连接释放。
```

---

### 3.5 请求写超时

请求写超时发生在客户端向服务端或代理发送请求时。它可能发生在请求头阶段，也可能发生在请求体阶段。普通 JSON 请求很少出现持续写超时；大文件上传、大请求体、客户端上行慢、服务端接收窗口阻塞更容易触发。

常见根因：

| 根因        | 说明                   |
| --------- | -------------------- |
| 请求体过大     | 上传时间超过写超时            |
| 客户端上行带宽不足 | 移动网络、公网弱网            |
| 服务端读取请求体慢 | 应用层不消费 body，TCP 窗口缩小 |
| 代理缓冲策略影响  | 网关先缓存请求体再转发          |
| 后端背压      | 上游处理慢导致接收窗口不足        |

Nginx 的 `proxy_send_timeout` 与 `send_timeout` 都强调其限制的是两次连续写操作之间的时间，而不是整个请求或响应传输的总时间；这说明写超时更接近“传输进展超时”，不是单纯的总耗时限制。([Nginx][8])

定位依据：

| 观测信号                              | 判断          |
| --------------------------------- | ----------- |
| request body 发送阶段耗时高              | 客户端上传或网关转发慢 |
| 服务端 access log 中 request body 未完整 | 客户端或代理中途失败  |
| 大文件接口显著高发                         | 请求体大小相关     |
| 客户端写超时但服务端无业务日志                   | 请求可能未进入业务处理 |

---

### 3.6 首字节超时与服务端处理慢

如果 DNS、TCP、TLS、请求写入都正常，但长时间没有收到响应头或响应首字节，根因通常集中在服务端处理、服务端排队、网关等待上游、数据库慢查询或下游依赖慢。

curl 的 `time_starttransfer` 表示从开始到收到第一个字节的时间，并包含 `time_pretransfer` 以及服务端计算结果所需时间。因此，`time_starttransfer - time_pretransfer` 通常用于近似判断“请求已发出后到响应首字节返回前”的等待时间。([Curl][13])

常见根因：

| 根因       | 说明                     |
| -------- | ---------------------- |
| 服务端线程池排队 | 请求进入应用前等待              |
| 业务逻辑慢    | CPU、锁、序列化、模板渲染         |
| 数据库慢查询   | SQL、索引、锁等待             |
| 下游 RPC 慢 | 服务链路中更深层超时             |
| 网关等待上游   | proxy/route timeout 触发 |
| 连接池耗尽    | DB、Redis、HTTP 客户端连接池饱和 |

定位依据：

| 观测信号                           | 判断              |
| ------------------------------ | --------------- |
| 客户端 `time_starttransfer` 高     | 服务端处理或上游等待慢     |
| 网关 `$upstream_response_time` 高 | 上游服务慢           |
| 应用 access log 总耗时高             | 应用处理慢或下游慢       |
| 应用日志无请求进入                      | 请求卡在网关、连接池或网络前段 |
| APM trace 中 DB span 占比高        | 数据库或存储慢         |
| gRPC `DEADLINE_EXCEEDED`       | 总 deadline 被耗尽  |

---

### 3.7 响应体读取超时

响应体读取超时发生在响应头已经返回之后，读取响应体过程中没有持续进展。其根因通常不同于首字节超时。

常见根因：

| 根因          | 说明           |
| ----------- | ------------ |
| 响应体过大       | 下载耗时长        |
| 服务端流式输出中断   | 没有持续写数据或心跳   |
| 客户端下行慢      | 移动网络、公网链路    |
| 中间代理缓冲      | 缓冲策略导致长时间无数据 |
| HTTP/2 流控窗口 | 对端不读取导致窗口耗尽  |
| 对端半开连接      | TCP 层未及时发现断链 |

Nginx `proxy_read_timeout` 限制的是两次连续读取上游响应之间的时间，而不是整个响应传输总时间；因此大响应是否超时，取决于传输过程中是否持续有数据，而不只是总下载时间。([Nginx][8])

定位依据：

| 观测信号                                | 判断                                 |
| ----------------------------------- | ---------------------------------- |
| 已收到响应头后失败                           | 不是服务端首字节慢                          |
| `time_total - time_starttransfer` 高 | 响应体传输慢                             |
| 小响应正常，大响应失败                         | 响应大小或传输带宽相关                        |
| streaming 接口固定时间断开                  | idle timeout 或 route timeout 配置不匹配 |
| HTTP/2 连接上多个 stream 同时受影响           | 流控、连接级问题或代理配置                      |

---

### 3.8 408 与 504 的区分

HTTP 408 和 504 是两个经常被混淆的超时状态码。RFC 9110 定义 408 表示服务端未在准备等待的时间内收到完整请求消息；504 表示服务器作为网关或代理时，没有及时收到完成请求所需的上游响应。([RFC 编辑器][14])

| 状态码                 | 发生位置       | 含义           | 常见根因                                     |
| ------------------- | ---------- | ------------ | ---------------------------------------- |
| 408 Request Timeout | 服务端等待客户端请求 | 客户端未及时发送完整请求 | 慢客户端、慢上传、连接中断、请求头/体读取超时                  |
| 504 Gateway Timeout | 网关等待上游服务   | 上游未及时响应      | 后端处理慢、上游不可用、网关 upstream timeout 过短、依赖链路慢 |

定位原则：

```text
408：优先检查客户端到服务端/网关的请求发送阶段。
504：优先检查网关到上游服务的连接、发送、读取和上游业务处理阶段。
```

---

## 4. 超时定位方法论

### 4.1 第一步：确认超时由哪一层触发

超时的第一定位动作不是调整配置，而是确认“谁认为超时”。

| 触发方    | 常见表现                                                                  | 首要检查对象                           |
| ------ | --------------------------------------------------------------------- | -------------------------------- |
| 客户端    | `ConnectTimeoutException`、`SocketTimeoutException`、`DeadlineExceeded` | 客户端阶段耗时、连接池、DNS、TCP、TLS、deadline |
| 服务端    | 408、服务端 request timeout、业务 cancel                                     | 请求头/体读取、慢客户端、业务处理超限              |
| 网关/代理  | 502、503、504、upstream timeout                                          | 网关到上游连接、上游响应、网关 route timeout    |
| RPC 框架 | gRPC `DEADLINE_EXCEEDED`、`CANCELLED`                                  | deadline 设置、传播、服务端取消处理           |
| 连接池    | acquire timeout、pending connection                                    | 本地连接池容量、连接释放、下游耗时                |

gRPC 中，客户端 deadline 超过会得到 `DEADLINE_EXCEEDED`；服务端在 deadline 超过后会取消调用，但应用代码需要主动停止后台工作。这个行为决定了定位 gRPC 超时时必须同时检查客户端 deadline、服务端 cancellation 处理、下游调用是否继承 deadline。([gRPC][10])

---

### 4.2 第二步：拆分阶段耗时

建议用 curl、客户端事件监听器、网关访问日志、APM trace 四类数据拆分阶段耗时。

curl 示例：

```bash
curl -o /dev/null -s -w \
"namelookup=%{time_namelookup}\nconnect=%{time_connect}\nappconnect=%{time_appconnect}\npretransfer=%{time_pretransfer}\nstarttransfer=%{time_starttransfer}\ntotal=%{time_total}\n" \
"https://example.com/api"
```

阶段解释：

| 指标                   | 含义             | 诊断意义                                  |
| -------------------- | -------------- | ------------------------------------- |
| `time_namelookup`    | DNS 完成时间       | 高则优先检查 DNS                            |
| `time_connect`       | TCP 连接完成时间     | 与 `time_namelookup` 差值高，检查网络/TCP      |
| `time_appconnect`    | TLS/SSL 握手完成时间 | 与 `time_connect` 差值高，检查 TLS           |
| `time_pretransfer`   | 传输开始前准备完成时间    | 包括协议相关准备                              |
| `time_starttransfer` | 收到首字节时间        | 与 `time_pretransfer` 差值高，检查服务端处理或网关上游 |
| `time_total`         | 完整操作总时间        | 与 `time_starttransfer` 差值高，检查响应体传输    |

curl 官方文档对这些变量有明确解释：`time_namelookup` 是名称解析完成时间，`time_connect` 是 TCP 连接完成时间，`time_appconnect` 是 SSL/SSH 等握手完成时间，`time_starttransfer` 是收到第一个字节的时间，`time_total` 是完整操作总耗时。([Curl][13])

---

### 4.3 第三步：建立客户端阶段日志

客户端日志不应只记录“请求超时”，而应记录以下字段：

```text
traceId
target service
target host
resolved ip
connection reused
connection pool wait time
dns duration
tcp connect duration
tls handshake duration
request header write duration
request body write duration
time to first byte
response body read duration
total duration
timeout type
exception class
retry attempt
deadline remaining
```

OkHttp `EventListener` 可以直接提供 DNS、connect、secure connect、connection acquired、request headers/body、response headers/body 等阶段事件，适合在客户端侧建立 HTTP 调用阶段耗时日志。([square.github.io][12])

---

### 4.4 第四步：建立网关访问日志

网关日志需要至少区分三类时间：

| 时间     | 说明             |
| ------ | -------------- |
| 请求总时间  | 客户端到网关完整请求生命周期 |
| 上游连接时间 | 网关连接后端耗时       |
| 上游响应时间 | 网关等待后端响应耗时     |

如果请求总时间高但上游响应时间低，问题可能在客户端上传、客户端下载或网关自身排队。如果上游响应时间高，问题更可能在后端服务或后端依赖。如果上游连接时间高，问题更接近后端连接建立、服务实例健康、网络 ACL 或端口可达性。

Nginx 的 `proxy_connect_timeout`、`proxy_send_timeout`、`proxy_read_timeout` 分别覆盖连接上游、向上游发送请求、读取上游响应三个阶段；这三个配置的含义不同，不能只通过一个“网关超时”概念处理。([Nginx][8])

---

### 4.5 第五步：用链路追踪确认下游耗时

仅靠客户端和网关日志通常不足以定位复杂超时。需要通过 trace 将请求拆为服务端处理、数据库访问、缓存访问、RPC 调用、消息发送等 span。OpenTelemetry HTTP 语义约定定义了 HTTP spans、metrics、logs，并提供 HTTP client/server request duration、active requests、request/response body size、open connections、connection duration 等指标，用于对 HTTP 操作进行标准化观测。([OpenTelemetry][15])

建议至少建立以下指标：

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

## 5. 典型超时场景的根因判别

### 5.1 客户端连接超时

现象：

```text
connect timed out
ConnectTimeoutException
java.net.SocketTimeoutException: connect timed out
```

优先判断：

| 检查项           | 解释                   |
| ------------- | -------------------- |
| 服务端是否有请求日志    | 没有日志说明未到应用层          |
| 目标 IP/端口是否可达  | 使用 nc、telnet、curl 验证 |
| 是否只有部分节点失败    | 检查服务发现、负载均衡、坏实例      |
| 抓包是否只有 SYN 重传 | 检查网络丢包、防火墙、安全组       |
| 是否跨地域或公网      | 检查网络路径和连接超时是否过短      |

结论：连接超时通常不应优先调整服务端业务代码，而应先检查端口可达性、网络路径、服务发现、负载均衡健康检查和实例监听状态。

---

### 5.2 客户端读超时

现象：

```text
read timed out
SocketTimeoutException: Read timed out
```

优先判断：

| 检查项                  | 解释                |
| -------------------- | ----------------- |
| 是否已经收到响应头            | 区分首字节超时和响应体中断     |
| 服务端 access log 是否耗时高 | 判断业务处理慢           |
| 网关 upstream time 是否高 | 判断后端或网关上游慢        |
| 响应体是否很大              | 判断下载阶段慢           |
| 是否只有 POST/写操作超时      | 判断服务端处理、锁、DB、下游依赖 |

结论：读超时可能发生在服务端处理前、服务端处理后、响应体传输中。只凭异常名称无法判定根因，必须结合阶段耗时。

---

### 5.3 网关 504

现象：

```text
HTTP 504 Gateway Timeout
upstream timed out
```

优先判断：

| 检查项               | 解释                               |
| ----------------- | -------------------------------- |
| 网关到上游 connect 时间  | 高则检查上游实例和网络                      |
| 网关到上游 response 时间 | 高则检查后端处理和下游依赖                    |
| 后端服务是否完成请求        | 若完成但网关超时，检查 timeout 不一致          |
| 是否流式接口            | 检查 route timeout 是否不适合 streaming |
| 入口客户端是否早于网关放弃     | 检查分层 deadline 是否不一致              |

RFC 9110 对 504 的定义限定在网关或代理未及时收到上游响应，因此 504 的定位重点应放在网关到上游之间，而不是客户端到网关之间。([RFC 编辑器][14])

---

### 5.4 服务端 408

现象：

```text
HTTP 408 Request Timeout
client timed out while sending request
```

优先判断：

| 检查项          | 解释                               |
| ------------ | -------------------------------- |
| 请求头是否过大或发送慢  | 检查 header timeout                |
| 请求体是否大文件上传   | 检查 body timeout / upload timeout |
| 客户端网络是否弱     | 慢客户端可能触发 408                     |
| 网关是否先缓存请求体   | 检查 buffering 配置                  |
| 是否大量连接只发部分请求 | 可能是慢请求攻击或客户端中断                   |

RFC 9110 定义 408 为服务端未在准备等待的时间内收到完整请求消息；Nginx 的 `client_header_timeout` 和 `client_body_timeout` 都可能导致 408。([RFC 编辑器][14])

---

### 5.5 gRPC `DEADLINE_EXCEEDED`

现象：

```text
StatusCode.DEADLINE_EXCEEDED
DeadlineExceeded
context deadline exceeded
```

优先判断：

| 检查项                  | 解释                       |
| -------------------- | ------------------------ |
| 客户端 deadline 是否过短    | gRPC 默认无 deadline，需要显式设置 |
| deadline 是否跨服务传播     | 缺失传播会导致下游继续执行            |
| 重试是否消耗完整 deadline    | deadline 包含所有重试时间        |
| 服务端是否处理 cancellation | 未处理会导致资源继续消耗             |
| 下游 span 是否超过剩余预算     | 检查预算分配是否合理               |

gRPC 官方说明，客户端不设置 deadline 时可能长期等待；deadline 超过后客户端得到 `DEADLINE_EXCEEDED`，服务端调用会被取消，但应用仍需负责停止已经派生的工作。([gRPC][10])

---

### 5.6 流式接口超时

流式接口包括 SSE、WebSocket、gRPC server streaming、双向 streaming、大文件下载、长轮询等。这类接口不能简单套用普通 HTTP API 的 route timeout 或总响应超时。

常见根因：

| 根因                       | 说明                                                      |
| ------------------------ | ------------------------------------------------------- |
| 网关 route timeout 不适合流式响应 | Envoy route timeout 默认 15 秒，不兼容永不结束的 streaming response |
| stream idle timeout 过短   | 数据或心跳间隔超过 idle timeout                                  |
| 没有应用层心跳                  | 中间层认为连接无活动                                              |
| HTTP/2 flow control 阻塞   | 对端不读取数据                                                 |
| 客户端提前取消                  | 服务端未及时感知 cancellation                                   |

Envoy 文档明确说明 route `timeout` 默认 15 秒，但不兼容永不结束的 streaming response，流式 API 应使用 stream idle timeout。([envoyproxy.io][9])

---

## 6. 超时设置原则

### 6.1 使用分位数而不是固定经验值

工程上不存在适用于所有系统的统一超时秒数。AWS 推荐从下游服务延迟指标出发，先选择可接受的误超时率，例如 0.1%，再使用对应的延迟分位数，例如 p99.9；如果是公网调用，还需要加入合理的最坏网络延迟；如果 p99.9 接近 p50，则需要增加 padding，避免小幅延迟变化导致大量误超时。([Amazon Web Services, Inc.][1])

形式化表达为：

```text
timeout = downstream_latency_percentile + network_padding + safety_margin
```

其中：

| 参数                              | 含义                       |
| ------------------------------- | ------------------------ |
| `downstream_latency_percentile` | 下游服务目标分位数，例如 p99、p99.9   |
| `network_padding`               | 跨机房、公网、移动网络等网络额外成本       |
| `safety_margin`                 | 抖动、GC、调度、TLS 冷启动、连接重建等余量 |

---

### 6.2 同时设置阶段超时和总 deadline

阶段超时用于定位和约束具体阶段，总 deadline 用于约束完整调用。两者职责不同。

| 配置                      | 目的                 |
| ----------------------- | ------------------ |
| DNS timeout             | 防止解析长期阻塞           |
| connect timeout         | 快速识别不可达实例          |
| TLS handshake timeout   | 约束安全连接协商           |
| write timeout           | 约束请求发送进展           |
| read timeout            | 约束响应读取进展           |
| call timeout / deadline | 约束完整调用生命周期         |
| per-try timeout         | 约束重试中的单次尝试         |
| idle timeout            | 约束连接或 stream 无活动时间 |

OkHttp 默认没有完整调用超时，但有 connect/read/write 超时；这说明如果只依赖默认配置，完整调用总耗时可能没有统一上界。([square.github.io][5])

---

### 6.3 分层 deadline 必须保持一致

一次请求通常经过客户端、网关、服务 A、服务 B、数据库。合理配置应保证外层预算覆盖内层预算，并且每一层在调用下游时扣除已经消耗的时间。

示例：

```text
Client total deadline: 3000ms
Gateway upstream timeout: 2800ms
Service A local budget: 2500ms
Service A -> Service B deadline: 1500ms
Service B -> DB timeout: 500ms
```

这种设计使超时能够在内层被及时发现，并在外层 deadline 到期前返回可控错误。gRPC deadline propagation 支持将原始 deadline 传递给下游，并扣除已消耗时间，避免手工传递 deadline 时遗漏或计算错误。([gRPC][10])

---

### 6.4 重试必须纳入总超时

重试不能绕过总 deadline。若一次调用总预算为 2 秒，而每次读超时为 2 秒，再配置 3 次重试，则实际最坏耗时会超过调用方等待预算。

合理关系：

```text
per_try_timeout * attempts + backoff <= total_deadline
```

Envoy 的 `per_try_timeout` 就是针对重试场景的单次尝试超时，它应短于整体 request timeout，并用于在总预算内控制每次尝试。([envoyproxy.io][9])

---

### 6.5 普通请求、上传下载、流式接口分开配置

不同类型接口的超时模型不同：

| 接口类型            | 超时模型                                        |
| --------------- | ------------------------------------------- |
| 普通 JSON API     | 较短 connect、read、write、总 deadline            |
| 大文件上传           | 更长 request body / write timeout，必要时异步化      |
| 大文件下载           | 更长 response body / send timeout，支持断点续传      |
| SSE / streaming | 不适合短 route timeout，应配置 idle timeout 和心跳     |
| WebSocket       | 重点是 ping/pong、idle timeout、连接生命周期           |
| gRPC unary      | 明确 deadline，并传播到下游                          |
| gRPC streaming  | 使用 deadline、idle timeout、keepalive、业务取消共同控制 |

Nginx 和 Envoy 文档都体现了“总时间”和“进展时间”的差异：Nginx 多个 timeout 限制的是两次连续读写之间的时间；Envoy route timeout 不适合永不结束的 streaming response，应改用 stream idle timeout。([Nginx][8])

---

## 7. 推荐配置基线

以下配置不是通用标准，而是工程起点。最终取值应以业务 SLO、下游 p99/p99.9、错误预算、网络环境和负载测试结果为准。

| 场景        |         DNS |     Connect |      TLS |    Write |          Read / TTFB | Total deadline | 说明            |
| --------- | ----------: | ----------: | -------: | -------: | -------------------: | -------------: | ------------- |
| 同机房内部 RPC | 100ms~500ms | 100ms~500ms | 100ms~1s | 500ms~2s |      p99.9 + padding |       500ms~3s | 适合高频微服务       |
| 跨可用区调用    |    500ms~1s |    300ms~1s | 500ms~2s |    1s~3s | p99.9 + 跨 AZ padding |          1s~5s | 需要考虑网络抖动      |
| 公网第三方 API |       1s~5s |       1s~3s |    1s~5s |   2s~10s |               3s~15s |         5s~30s | 以供应商 SLA 为准   |
| 用户同步请求    |    500ms~2s |    300ms~1s | 500ms~2s |    1s~5s |                1s~5s |          2s~8s | 超时后应降级或返回明确失败 |
| 后台任务      |       1s~5s |       1s~5s |    1s~5s |   5s~30s |              10s~60s |       30s~180s | 可异步重试         |
| 大文件上传     |       1s~5s |       1s~5s |    1s~5s | 30s~300s |             30s~300s |          建议异步化 | 重点看传输进展       |
| 流式接口      |       1s~5s |       1s~5s |    1s~5s |    视协议而定 |     idle + heartbeat |         不宜短总超时 | 使用心跳和取消机制     |

需要注意，官方默认值通常不是业务最佳值。OkHttp connect/read/write 默认 10 秒，call timeout 默认无完整调用上限；Nginx 多个代理与客户端读写超时默认 60 秒；Envoy route timeout 默认 15 秒；Tomcat connectionTimeout 默认 60 秒但标准配置常设为 20 秒。这些默认值只能作为理解框架行为的参考，不能替代业务级超时设计。([square.github.io][5])

---

## 8. 调试手段清单

### 8.1 客户端侧

| 手段                     | 用途                                 |
| ---------------------- | ---------------------------------- |
| curl `--write-out`     | 拆分 DNS、TCP、TLS、TTFB、总耗时            |
| OkHttp `EventListener` | 获取 Java HTTP 客户端阶段事件               |
| 客户端连接池指标               | 判断 acquire timeout、连接泄漏、池容量不足      |
| 异常分类统计                 | 区分 connect/read/write/deadline/DNS |
| traceId 透传             | 与网关、服务端、下游日志关联                     |
| 抓包                     | 判断 SYN 重传、TLS 握手、TCP reset、窗口阻塞    |

### 8.2 网关侧

| 手段                     | 用途                |
| ---------------------- | ----------------- |
| access log 总耗时         | 判断客户端到网关完整耗时      |
| upstream connect time  | 判断网关连接上游是否慢       |
| upstream response time | 判断上游服务是否慢         |
| upstream status        | 判断 502/503/504 来源 |
| route timeout 指标       | 判断路由级超时           |
| stream idle reset 指标   | 判断流式接口 idle 问题    |

### 8.3 服务端侧

| 手段                | 用途                      |
| ----------------- | ----------------------- |
| access log        | 判断请求是否进入应用              |
| 请求排队时间            | 判断线程池、事件循环、Servlet 容器压力 |
| handler 执行时间      | 判断业务逻辑耗时                |
| DB/RPC/cache span | 判断下游依赖耗时                |
| cancellation 处理日志 | 判断客户端取消后服务端是否继续执行       |
| 慢查询/锁等待           | 判断存储层根因                 |

### 8.4 基础设施侧

| 手段                 | 用途                     |
| ------------------ | ---------------------- |
| DNS 查询日志           | 定位解析慢、解析失败             |
| tcpdump            | 定位 SYN 重传、RST、FIN、窗口问题 |
| conntrack / NAT 指标 | 定位 SNAT 端口耗尽、连接跟踪满     |
| CPU/GC 指标          | 定位服务端抖动、TLS 握手慢        |
| 网络丢包/重传指标          | 定位底层链路质量               |
| 负载均衡健康检查           | 定位坏实例、假活实例             |

---

## 9. 常见误判与修正

| 误判                     | 修正                                   |
| ---------------------- | ------------------------------------ |
| 看到 read timeout 就认为网络慢 | read timeout 可能是服务端处理慢、网关上游慢、响应体传输慢  |
| 看到 504 就调整客户端超时        | 504 是网关等待上游超时，应优先检查网关到上游链路           |
| 看到 408 就检查后端慢查询        | 408 是服务端未及时收到完整请求，应优先检查请求发送阶段        |
| 只调大超时时间                | 超时变大可能掩盖资源耗尽，应先定位阶段根因                |
| 所有接口使用同一超时             | 普通 API、上传、下载、streaming、第三方 API 的模型不同 |
| 没有总 deadline           | 阶段超时不能替代完整调用上限                       |
| deadline 不传播           | 上游超时后，下游仍可能继续消耗资源                    |
| 重试不计入 deadline         | 实际耗时会超过调用方预算                         |
| 服务端不处理取消               | 客户端已超时，服务端仍继续执行                      |

---

## 10. 结论

网络通信中的超时定义与设置，应从单一参数配置升级为阶段化、分层化、可观测的系统设计。完整结论如下：

1. **超时类型必须分层理解。** 客户端、服务端、代理/网关、RPC 框架和连接池都有自己的超时，作用阶段不同，故障表现不同，配置位置也不同。

2. **根因定位必须基于阶段耗时。** DNS、TCP、TLS、连接池、请求写入、服务端处理、上游代理、响应体传输、stream idle 等阶段需要分别观测；仅凭异常名称不能确定根因。

3. **HTTP 408 与 504 必须区分。** 408 指服务端未及时收到完整请求，重点检查客户端发送请求阶段；504 指网关未及时收到上游响应，重点检查网关到后端和后端依赖链路。

4. **gRPC 应以 deadline 为核心。** deadline 应显式设置并向下游传播；服务端必须处理 cancellation，否则客户端超时后服务端仍可能继续占用资源。

5. **设置超时不能依赖统一秒数。** 更可靠的方法是基于下游延迟分位数、可接受误超时率、网络 padding 和业务 SLO 设置。

6. **总 deadline 与阶段超时必须同时存在。** 阶段超时用于定位和保护局部阶段，总 deadline 用于限制完整调用生命周期。

7. **调试手段应标准化。** 客户端阶段日志、curl timing、网关 upstream timing、OpenTelemetry trace、连接池指标、抓包和基础设施指标应形成闭环。

最终结论可以概括为：

> **超时治理的核心不是“设置多长时间”，而是“在哪一层、哪一阶段、因为什么等待、由谁终止、如何观测、如何传播剩余预算”。只有建立阶段化定位能力，超时配置才具有工程意义。**

[1]: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/ "Timeouts, retries and backoff with jitter"
[2]: https://docs.oracle.com/javase/8/docs/api/java/net/SocketTimeoutException.html "SocketTimeoutException (Java Platform SE 8 )"
[3]: https://hc.apache.org/httpcomponents-client-4.5.x/current/httpclient/apidocs/org/apache/http/client/config/RequestConfig.html "RequestConfig (Apache HttpClient 4.5.14 API)"
[4]: https://docs.oracle.com/javase/8/docs/api/java/net/Socket.html "Socket (Java Platform SE 8 )"
[5]: https://square.github.io/okhttp/5.x/okhttp/okhttp3/-ok-http-client/index.html "OkHttpClient"
[6]: https://nginx.org/en/docs/http/ngx_http_core_module.html "Module ngx_http_core_module"
[7]: https://tomcat.apache.org/tomcat-9.0-doc/config/http.html "Apache Tomcat 9 Configuration Reference (9.0.117) - The HTTP Connector"
[8]: https://nginx.org/en/docs/http/ngx_http_proxy_module.html "Module ngx_http_proxy_module"
[9]: https://www.envoyproxy.io/docs/envoy/latest/faq/configuration/timeouts "How do I configure timeouts? — envoy 1.39.0-dev-2013db documentation"
[10]: https://grpc.io/docs/guides/deadlines/ "Deadlines | gRPC"
[11]: https://learn.microsoft.com/en-us/aspnet/core/grpc/deadlines-cancellation?view=aspnetcore-10.0 "Reliable gRPC services with deadlines and cancellation | Microsoft Learn"
[12]: https://square.github.io/okhttp/5.x/okhttp/okhttp3/-event-listener/index.html "EventListener"
[13]: https://curl.se/docs/manpage.html "curl - How To Use"
[14]: https://www.rfc-editor.org/rfc/rfc9110.html "RFC 9110: HTTP Semantics"
[15]: https://opentelemetry.io/docs/specs/semconv/http/ "Semantic conventions for HTTP | OpenTelemetry"
