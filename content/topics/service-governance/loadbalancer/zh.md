# 面向微服务内部调用的负载均衡架构选择

## 摘要

在现代微服务系统中，负载均衡已经不只是“把请求平均分给多个实例”的网络问题，而是服务发现、故障隔离、流量治理、弹性伸缩、可观测性和调用链稳定性的综合问题。本文的核心判断是：**对内部服务间调用，也就是东西向流量，客户端负载均衡或 sidecar 代理负载均衡应当作为默认选择；对外部入口，也就是南北向流量，仍然保留网关、Ingress、ALB、NLB、API Gateway 等集中式负载均衡。** 把所有内部调用都压到网关上，是一种过时且危险的集中式设计，容易制造额外跳数、瓶颈和单点爆炸半径。

Kubernetes 官方文档指出，Service 的目标是在工作负载可能动态变化、Pod 可能随时创建销毁的情况下，将一组后端以网络服务的形式暴露出来；如果应用能够使用 Kubernetes API 做云原生服务发现，可以查询 EndpointSlice，而非云原生应用则可在应用与后端 Pod 之间放置网络端口或负载均衡器。这个事实直接说明：现代负载均衡的本质已经从“固定后端列表”变成了“动态端点发现 + 策略化路由”。([Kubernetes][1])

**关键词：** 客户端负载均衡、网关负载均衡、服务发现、gRPC、Envoy、Istio、Kubernetes、Round Robin、Least Request、Consistent Hash

---

## 1. 负载均衡策略的背景

负载均衡最初解决的是多实例系统中的资源利用率、吞吐量、延迟和容错问题。NGINX 官方文档对 HTTP 负载均衡的概括非常典型：在多个应用实例之间做负载均衡，是优化资源利用、最大化吞吐、降低延迟、实现容错配置的常用技术。([NGINX 文档][2])

但在微服务架构中，负载均衡的复杂度被显著放大，主要原因有四个。

第一，**服务实例是动态的**。在 Kubernetes 中，Deployment 可以动态创建和销毁 Pod，某一时刻可用的后端集合会不断变化；Kubernetes Service 通过 selector 和 EndpointSlice 来维护服务端点集合。([Kubernetes][1])

第二，**调用不再是少量入口流量，而是大量内部服务间调用**。一个用户请求进入系统后，可能触发几十个内部 RPC。如果每一次内部调用都绕到集中式网关，系统会人为增加网络跳数和排队点。

第三，**协议发生了变化**。HTTP/2、gRPC、长连接、连接池、双向流式调用使“按连接负载均衡”经常失效。gRPC 官方设计文档明确强调，gRPC 内部负载均衡发生在 per-call 维度，而不是 per-connection 维度；即使所有请求来自同一个客户端，也希望这些调用能被分散到所有服务端。([GitHub][3])

第四，**故障治理已经成为负载均衡的一部分**。一个好的负载均衡器不只是选择实例，还要配合超时、重试、熔断、连接池、异常实例摘除、预热、灰度、就近路由和指标反馈。Envoy 官方文档将负载均衡策略、异常检测、熔断等都作为 upstream 管理的一部分；Envoy 的 outlier detection 会把异常主机标记为不健康并从负载均衡选择中摘除一段时间。([Envoy Proxy][4])

---

## 2. 网关负载均衡和客户端负载均衡的好坏

本文中的“网关负载均衡”指集中式代理或入口式负载均衡，例如 NGINX、HAProxy、AWS ALB/NLB、Kubernetes Ingress、API Gateway、Service LoadBalancer 等；“客户端负载均衡”指调用方 SDK、gRPC channel、Spring Cloud LoadBalancer，或者与服务进程同节点/同 Pod 运行的 sidecar 代理，例如 Envoy/Istio sidecar，根据服务发现结果直接选择目标实例。

### 2.1 网关负载均衡的优点

网关负载均衡的最大优点是**治理集中**。TLS 终止、认证鉴权、WAF、限流、访问日志、黑白名单、路径路由、域名路由等能力天然适合放在入口网关。AWS Application Load Balancer 官方文档说明，ALB 工作在 OSI 第七层，接收请求后按 listener rules 判断规则，并可基于应用流量内容把请求路由到不同 target group。([AWS Documentation][5])

第二个优点是**客户端简单**。调用方只需要访问一个稳定域名或虚拟 IP，不需要感知后端实例列表。Kubernetes Service 也体现了这种抽象：Service 把一组 Pod 暴露为一个稳定网络服务，使客户端不必自己追踪后端 Pod 集合变化。([Kubernetes][1])

第三个优点是**入口安全边界清晰**。互联网流量、跨网络流量、第三方调用、BFF/API 聚合层都适合先进网关，再进入内部服务网格或服务集群。

### 2.2 网关负载均衡的缺点

网关负载均衡用于入口是正确的，但用于所有内部服务间调用就明显不合格。

第一，**网关容易变成中心瓶颈和故障放大器**。所有内部 RPC 都绕网关，会让网关承担本不该承担的东西向流量，任何网关抖动都会影响大量服务之间的调用。

第二，**多一次网络跳数，多一次排队和故障点**。内部调用本来可以 client → backend，集中式网关会变成 client → gateway → backend。这个额外跳数对高 QPS、低延迟系统很不划算。

第三，**网关难以掌握每个调用方的细粒度上下文**。不同调用方的超时预算、重试预算、调用优先级、流量权重、灰度规则可能不同。集中网关可以做一部分治理，但会把规则压成复杂的大型配置，长期看会变成运维和治理债务。

第四，**长连接和 HTTP/2/gRPC 场景下，传统网关负载均衡可能不均匀**。gRPC 官方说明，默认 `pick_first` 策略实际上不做负载均衡，而是连接 name resolver 返回的第一个可连地址；切换到 `round_robin` 后，客户端会连接所有地址并在后端之间轮转 RPC。([gRPC][6]) 这说明对 gRPC 这类协议，真正有效的均衡应发生在客户端 channel 或代理的请求选择层，而不是只在入口连接层做一次选择。

### 2.3 客户端负载均衡的优点

客户端负载均衡的最大优点是**决策靠近调用方**。gRPC 负载均衡策略接收 resolver 更新的服务器地址列表，为服务器地址创建 subchannel，并在每个 RPC 发送时决定使用哪个 subchannel。([GitHub][3])

第二个优点是**天然水平扩展**。负载均衡决策分散在每个客户端或每个 sidecar 上，不再由一个中心网关承载所有内部流量。

第三个优点是**适合服务发现和动态端点**。Spring Cloud 官方文档明确称 Spring Cloud LoadBalancer 提供自己的 client-side load-balancer 抽象和实现，并通过 `ServiceInstanceListSupplier` 从 Service Discovery 获取可用实例。([Home][7])

第四个优点是**可以承载更细的流量治理**。Istio 官方文档说明，Istio 的流量管理模型依赖随服务部署的 Envoy 代理，mesh 服务发送和接收的流量都会经过 Envoy，从而可以在不修改服务代码的情况下控制流量。([Istio][8])

### 2.4 客户端负载均衡的缺点

客户端负载均衡也不是没有代价。

第一，**客户端复杂度上升**。如果把逻辑写进业务 SDK，不同语言、不同版本、不同服务可能出现策略不一致。

第二，**需要可靠的服务发现和配置分发**。客户端必须拿到及时、正确、可用的端点列表，否则会发生路由到已下线实例、端点列表陈旧、流量打偏等问题。

第三，**可观测性和治理必须标准化**。如果每个业务团队自己实现客户端负载均衡，指标、日志、重试、熔断都会碎片化。

因此，最佳实践不是“每个业务自己手写客户端负载均衡”，而是：**优先使用成熟框架或 sidecar 数据面统一实现，例如 gRPC 内建策略、Spring Cloud LoadBalancer、Envoy/Istio；不要在业务代码里重复造轮子。**

---

## 3. 为什么要选择客户端负载均衡而不是网关负载均衡

我的判断很明确：**在内部服务间调用场景，应优先选择客户端负载均衡，而不是网关负载均衡。** 原因如下。

### 3.1 客户端负载均衡更适合东西向流量

内部服务调用的特点是高频、低延迟、链路长、依赖多。把这些调用全部集中到网关，会让网关承担不必要的流量中转职责。客户端负载均衡让调用方直接选择后端实例，减少中间跳数，也减少中心节点的排队风险。

Istio 官方文档对 sidecar 模式的描述很关键：服务网格内的流量通过与服务一起部署的 Envoy 代理处理，Envoy 代理使用服务注册表将流量引导到相关服务；这本质上就是“客户端侧代理负载均衡”。([Istio][8])

### 3.2 客户端负载均衡能做真正的 per-RPC 均衡

对 gRPC、HTTP/2、连接池场景，按连接均衡经常不能代表按请求均衡。gRPC 官方文档明确将负载均衡策略放在 name resolution 和连接 server 之间，并且由策略在每个 RPC 发送时决定 subchannel。([GitHub][3])

所以，若系统大量使用 gRPC，继续依赖网关的连接级负载均衡是不专业的。正确做法是配置客户端或 sidecar 的请求级负载均衡策略，例如 `round_robin`、`least_request`、xDS/Envoy 策略等。

### 3.3 客户端负载均衡更容易结合实时健康状态

Envoy 支持 outlier detection：当主机被判定为异常时，会被标记为不健康并从负载均衡选择中摘除；之后可在满足条件后自动回到服务池。([Envoy Proxy][4]) Envoy 还支持分布式熔断，官方文档强调，在分布式系统中快速失败并向下游施加背压通常比继续排队更好。([Envoy Proxy][9])

这类能力在集中式网关也能做，但在东西向流量中放到客户端侧或 sidecar 侧更自然，因为故障影响可以被限制在具体调用方、具体目标服务、具体优先级和具体连接池范围内。

### 3.4 客户端负载均衡更适合灰度、版本路由和服务级策略

Istio 官方文档说明，DestinationRule 可用于定制目标服务或服务子集的 Envoy traffic policy，包括负载均衡模型、TLS 模式和熔断设置。([Istio][8]) 这意味着内部服务调用可以按服务、版本、端口、subset 维度配置策略，而不必把所有规则堆到一个大网关里。

### 3.5 网关仍然应该保留，但它不该承担所有内部调用

正确架构不是“客户端负载均衡消灭网关”，而是分层：

```text
External Client
    ↓
Gateway / Ingress / ALB / API Gateway
    ↓
Internal Service A
    ↓ client-side LB or sidecar LB
Internal Service B / C / D
```

**结论：入口用网关，内部用客户端负载均衡。**
这不是折中，这是成熟微服务系统的基本分工。

---

## 4. 负载均衡的算法有哪些？

下面列出主流负载均衡算法及适用场景。

| 算法                                         | 原理                                   | 适用场景                          | 不适用场景                           |
| ------------------------------------------ | ------------------------------------ | ----------------------------- | ------------------------------- |
| Round Robin                                | 按顺序轮流选择后端实例                          | 后端容量相近、请求耗时相近、短连接或普通 HTTP API | 请求耗时差异大、实例容量差异大、长连接             |
| Weighted Round Robin                       | 根据权重轮询，权重高的实例获得更多请求                  | 实例规格不同、灰度放量、容量分层              | 权重维护不准确、实例负载实时波动大               |
| Random                                     | 随机选择健康后端                             | 大规模后端池、实现简单、多个 LB 同时存在        | 小规模服务、请求耗时差异大                   |
| Least Connections                          | 选择当前连接数最少的实例                         | 长连接、数据库连接、TCP 长会话             | HTTP 短请求、HTTP/2 多路复用时连接数不等于请求负载 |
| Least Request / Least Outstanding Requests | 选择当前 in-flight 请求最少的实例，或从随机候选中选负载更低者 | 微服务 HTTP/RPC、请求耗时差异大、实例性能有差异  | 指标不可用或请求极短且完全均质时收益有限            |
| Power of Two Choices / P2C                 | 随机选两个或 N 个候选，再选负载更低者                 | 大规模服务池，性能和均衡效果折中很好            | 需要维护实时负载信息                      |
| IP Hash / Source Hash                      | 根据客户端 IP 或源信息 hash 到固定实例             | 需要会话亲和、TCP 场景                 | 客户端 IP 分布不均、NAT 大量用户共用 IP       |
| Consistent Hash / Ring Hash                | 将请求 key 和后端映射到 hash ring，后端变化时减少重映射  | 缓存、会话亲和、状态相关服务                | 无状态服务默认不该用，会牺牲均衡性               |
| Maglev Hash                                | 一种一致性哈希，目标是减少后端变化时的扰动                | 大规模一致性路由、服务网格、边缘代理            | 普通无状态 API 默认没必要                 |
| Locality / Zone-aware LB                   | 优先同机房、同可用区、同地域实例                     | 多 AZ、多地域、跨云部署                 | 容量不足时若没有 failover 会打满局部资源       |
| Adaptive / Client-side Weighted RR         | 根据后端上报的负载、错误率、利用率动态调整权重              | 服务能力差异大、负载波动明显                | 没有可靠指标或反馈延迟过大                   |

NGINX Open Source 官方支持 Round Robin、Least Connections、IP Hash、Generic Hash，NGINX Plus 还支持 Least Time 和 Random；其文档明确指出 Round Robin 是默认方法。([NGINX 文档][2])

Envoy 官方支持 Weighted Round Robin、Client-side Weighted Round Robin、Weighted Least Request、Ring Hash、Maglev 和 Random。Envoy 的 Weighted Least Request 在等权重情况下使用 P2C 思路，即随机选择若干可用主机，再挑 active requests 更少的主机。([Envoy Proxy][10]) Envoy 对 Ring Hash 和 Maglev 的说明也表明，一致性哈希主要适合需要稳定 hash key 的场景。([Envoy Proxy][10])

AWS ALB 官方支持 Round Robin、Least Outstanding Requests、Weighted Random，并说明 Round Robin 是 target group 级别的默认路由算法；Least Outstanding Requests 会把请求路由给 in-progress 请求数最低的目标。([AWS Documentation][11])

HAProxy 官方配置手册中也列出 roundrobin、leastconn、source、uri、url_param、hdr、random 等算法，并称 roundrobin 会按权重轮流使用服务器，在服务器处理时间分布相近时是平滑且公平的算法。([HAProxy Technologies][12])

---

## 5. 业界使用最标准、最广泛的负载均衡算法是哪个？

**最标准、最广泛的基线算法是 Round Robin，生产增强版通常是 Weighted Round Robin。**

这个结论不是因为 Round Robin 最聪明，而是因为它最简单、最可解释、最容易实现、跨产品支持最广。NGINX 默认使用 Round Robin；AWS ALB 的 target group 默认算法也是 Round Robin；Envoy 支持 Weighted Round Robin；HAProxy 也把 roundrobin 作为核心调度算法之一。([NGINX 文档][2])

但必须强调：**“最广泛”不等于“生产最优”。** 对现代微服务 HTTP/RPC 来说，我更推荐把 **Least Request / P2C** 作为默认生产策略，尤其是请求耗时不均、实例负载不均、存在扩缩容和冷启动的场景。Istio 官方文档已经非常直接地说，`ROUND_ROBIN` 在许多场景下通常不安全，可能使端点过载；一般应优先使用 `LEAST_REQUEST` 作为 `ROUND_ROBIN` 的替代，并称 `LEAST_REQUEST` 通常更安全且几乎总是优于 `ROUND_ROBIN`。([Istio][13])

因此本文给出明确判断：

```text
行业最标准、最广泛：Round Robin / Weighted Round Robin
现代微服务更推荐：Least Request / P2C
需要会话亲和或缓存命中：Consistent Hash / Ring Hash / Maglev
异构容量或灰度放量：Weighted Round Robin / Adaptive Weighted
```

---

## 6. 当前客户端负载均衡最佳实践

### 6.1 架构原则：入口集中，内部下沉

最合理的职责划分如下：

```text
North-South Traffic:
User / Partner / Mobile / Web
    → Gateway / Ingress / ALB / API Gateway
    → Internal Service

East-West Traffic:
Service A
    → Client-side LB / Sidecar LB
    → Service B instances
```

网关负责入口治理，客户端负载均衡负责内部调用。把网关当成所有内部服务调用的中转中心，是不应该采用的设计。

### 6.2 优先使用 sidecar 或成熟客户端框架

如果系统是多语言、多团队、多服务，最佳选择是 **Envoy/Istio 这类 sidecar 数据面**，因为它能避免各语言 SDK 分裂。Envoy 官方介绍中说明，Envoy 可作为 edge proxy 和 service proxy，运行在每个应用旁边，并以平台无关方式提供通用网络能力。([Envoy Proxy][14])

如果系统主要是 Java/Spring，可以使用 Spring Cloud LoadBalancer。Spring 官方文档说明它提供 client-side load-balancer 抽象，默认实现是 `RoundRobinLoadBalancer`，也可切换到 `RandomLoadBalancer`。([Home][7])

如果系统大量使用 gRPC，应显式配置 gRPC 客户端负载均衡策略。不要默认依赖 `pick_first`，因为 gRPC 官方文档已经说明 `pick_first` 实际上不做负载均衡。([gRPC][6])

### 6.3 算法选择建议

**默认建议：**

```text
普通微服务 HTTP/RPC：Least Request / P2C
完全均质短请求：Round Robin / Weighted Round Robin
gRPC 多实例调用：round_robin 或 xDS/Envoy 策略
缓存或会话亲和：Consistent Hash / Ring Hash / Maglev
异构实例规格：Weighted Round Robin 或 Adaptive Weighted
多地域/多 AZ：Locality-aware + failover
```

对于 Istio，建议优先配置：

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: order-service-lb
spec:
  host: order-service.default.svc.cluster.local
  trafficPolicy:
    loadBalancer:
      simple: LEAST_REQUEST
```

Istio 官方文档明确说明 DestinationRule 可配置目标服务的负载均衡策略，并列出 Random、Weighted、Round robin、Consistent hash、Ring hash、Maglev 等选项。([Istio][8])

### 6.4 健康检查必须分主动和被动

负载均衡不能只看“实例是否存在”，必须看“实例是否还能正确服务”。

主动健康检查适合周期性确认实例是否存活；被动异常检测适合根据真实流量中的 5xx、超时、reset 等错误摘除异常实例。Envoy 官方文档说明，outlier detection 可以基于连续 5xx、网关错误、本地连接失败、成功率、失败百分比等检测异常主机。([Envoy Proxy][4])

最佳实践：

```text
必须做：
1. Readiness / active health check
2. Passive outlier detection
3. Connection draining
4. Slow start / warmup
5. Endpoint ejection metrics
```

### 6.5 熔断、超时、重试必须和负载均衡一起设计

只做负载均衡，不做熔断和重试预算，是半成品。Envoy 官方文档明确说，熔断是分布式系统关键组件，快速失败并向下游施加背压通常更好；Envoy 支持 cluster 最大连接数、最大 pending requests、最大 active requests、最大 retries 等限制。([Envoy Proxy][9])

推荐规则：

```text
1. 每个服务必须有默认超时。
2. 重试只允许幂等接口或明确可重试错误。
3. 重试必须设置 retry budget，不能无限重试。
4. 熔断按目标服务、优先级、调用方分层配置。
5. 过载时宁可快速失败，也不要无限排队。
```

### 6.6 gRPC 场景不要使用默认 pick_first

gRPC 的默认 `pick_first` 不是负载均衡。一个最小的 gRPC service config 示例：

```json
{
  "loadBalancingConfig": [
    {
      "round_robin": {}
    }
  ],
  "methodConfig": [
    {
      "name": [
        {
          "service": "com.example.OrderService"
        }
      ],
      "timeout": "2s"
    }
  ]
}
```

gRPC 官方文档说明，`round_robin` 会连接它拿到的每个地址，并在已连接的后端之间为每个 RPC 轮转。([gRPC][6])

### 6.7 Spring Cloud 场景要避免隐式懒加载抖动

Spring Cloud LoadBalancer 默认会为每个 service id 创建子上下文，并在第一次请求时懒加载。生产系统中，对核心依赖服务建议 eager load，避免首次调用抖动。Spring 官方文档说明可以通过 `spring.cloud.loadbalancer.eager-load.clients` 配置需要提前加载的 service id。([Home][7])

```yaml
spring:
  cloud:
    loadbalancer:
      eager-load:
        clients:
          - order-service
          - payment-service
```

### 6.8 可观测性必须覆盖“选择过程”

客户端负载均衡上线后，不能只看服务总体 QPS。至少要看：

```text
1. 每个 endpoint 的 request count
2. 每个 endpoint 的 active requests
3. 每个 endpoint 的 p95 / p99 latency
4. 每个 endpoint 的 error rate
5. endpoint ejection count
6. retry count and retry success rate
7. circuit breaker overflow count
8. load balancing policy distribution
9. locality / zone hit ratio
10. endpoint list freshness
```

没有这些指标，客户端负载均衡一旦打偏，很难排查。

---

## 7. 推荐落地步骤

### 第一步：区分流量类型

```text
外部用户 → 系统：网关负载均衡
服务 A → 服务 B：客户端负载均衡或 sidecar 负载均衡
跨集群 / 跨地域：全局流量调度 + 本地客户端负载均衡
```

### 第二步：选择实现方式

```text
多语言微服务：Istio / Envoy sidecar
gRPC 为主：gRPC round_robin / xDS / Envoy
Java Spring 为主：Spring Cloud LoadBalancer
Kubernetes 原生简单系统：Service + EndpointSlice + 客户端服务发现
```

### 第三步：选择默认算法

```text
生产默认：LEAST_REQUEST / P2C
保守基线：Weighted Round Robin
会话亲和：Consistent Hash
缓存服务：Ring Hash / Maglev
异构容量：Weighted / Adaptive Weighted
```

### 第四步：配置故障治理

```text
1. timeout
2. retry budget
3. circuit breaker
4. passive outlier detection
5. active health check
6. slow start / warmup
7. connection draining
```

### 第五步：灰度迁移

```text
1. 先对低风险服务启用客户端负载均衡。
2. 对比网关路径和客户端直连路径的延迟、错误率、重试率。
3. 小比例切流。
4. 观察 endpoint 分布是否均匀。
5. 逐步替换内部网关中转调用。
6. 保留入口网关，不要移除南北向治理。
```

---

## 8. 结论

当前客户端负载均衡的最佳实践可以概括为一句话：

**入口流量用网关，内部调用用客户端负载均衡；算法上以 Round Robin / Weighted Round Robin 作为行业基线，以 Least Request / P2C 作为现代微服务默认优选，以 Consistent Hash 服务状态亲和场景。**

对现代微服务系统来说，继续把所有内部调用都压到网关做集中负载均衡，是一种架构退化。正确的做法是将负载均衡决策下沉到客户端或 sidecar，让每个调用方基于服务发现、健康状态、连接池、熔断、重试和调用上下文做更近、更快、更细粒度的决策。网关仍然重要，但它应该守住入口，而不是统治所有内部流量。

[1]: https://kubernetes.io/docs/concepts/services-networking/service/ "Service | Kubernetes"
[2]: https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/ "HTTP Load Balancing | NGINX Documentation"
[3]: https://github.com/grpc/grpc/blob/master/doc/load-balancing.md "grpc/doc/load-balancing.md at master · grpc/grpc · GitHub"
[4]: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier "Outlier detection — envoy 1.39.0-dev-eb7a60 documentation"
[5]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html "What is an Application Load Balancer? - Elastic Load Balancing"
[6]: https://grpc.io/docs/guides/custom-load-balancing/ "Custom Load Balancing Policies | gRPC"
[7]: https://docs.spring.io/spring-cloud-commons/reference/spring-cloud-commons/loadbalancer.html "Spring Cloud LoadBalancer :: Spring Cloud Commons"
[8]: https://istio.io/latest/docs/concepts/traffic-management/ "Istio / Traffic Management"
[9]: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking "Circuit breaking — envoy 1.39.0-dev-eb7a60 documentation"
[10]: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/load_balancers "Supported load balancers — envoy 1.39.0-dev-eb7a60 documentation"
[11]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html "Edit target group attributes for your Application Load Balancer - Elastic Load Balancing"
[12]: https://www.haproxy.com/documentation/haproxy-configuration-manual/latest/ "HAProxy Enterprise Documentation  version 3.3r1 (1.0.0-368.498) - Configuration Manual"
[13]: https://istio.io/latest/docs/reference/config/networking/destination-rule/ "Istio / Destination Rule"
[14]: https://www.envoyproxy.io/ "Envoy proxy - home"
