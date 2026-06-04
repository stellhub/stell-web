# 流量治理规则体系的标准化设计研究

## 摘要

流量治理是分布式系统、微服务架构和服务网格中的基础治理能力，其目标是在服务调用过程中对流量入口、服务间调用、路由选择、负载均衡、灰度发布、故障隔离、限流、熔断、超时、重试和可观测性进行统一控制。依据 Kubernetes Gateway API、Istio、Envoy、gRPC 等官方文档，现代流量治理已经从集中式网关转向“集中配置、分布式执行”的模式。南北向流量主要描述集群外部与集群内部之间的访问流量，东西向流量主要描述服务之间、工作负载之间或网格内部的横向调用流量。传统内部网关和外部网关架构将负载均衡、流量调度、鉴权、限流、熔断等能力集中在网关节点上；服务网格和客户端负载均衡模型则将路由规则、负载均衡和实例选择下沉到客户端代理或客户端运行时执行。本文围绕东西向流量、南北向流量、网关集中化架构、客户端路由、路由规则能力以及 Istio 标准实现，对流量治理规则体系进行结构化说明。

**关键词**：流量治理；东西向流量；南北向流量；内部网关；外部网关；客户端路由；服务发现；Istio；Envoy；VirtualService；DestinationRule

## 1. 引言

微服务系统由多个独立服务组成，服务实例数量、部署位置、版本状态和运行健康度会持续变化。服务调用路径不再是单一入口到单一后端，而是由入口流量、服务间调用、跨可用区调用、灰度版本调用、外部依赖访问和故障转移路径共同构成。在这种系统中，流量治理规则用于描述流量应当进入何处、经过何处、被转发到哪个服务版本、是否允许跨可用区、是否执行重试、是否进入熔断或限流逻辑，以及是否需要镜像、重写或故障注入。

Kubernetes Gateway API 将自身定位为面向 Kubernetes 的 L4 和 L7 路由官方项目，并同时覆盖 Ingress 与 Mesh 场景；其官方文档明确将 North-South 与 East-West 作为 Gateway API 的两个路由方向。Istio 官方文档也将服务网格划分为控制平面和数据平面：控制平面负责配置代理，数据平面中的 Envoy 代理负责调解和控制微服务之间的网络通信。因此，现代流量治理的核心不是单一网关转发，而是通过统一规则描述流量行为，并将规则下发给实际执行流量处理的数据平面。

## 2. 东西向流量与南北向流量

南北向流量通常指集群、数据中心或服务网格边界内外之间的流量。在 Kubernetes Gateway API 中，Gateway 资源可定义外部流量进入集群内部的访问点，该类场景被描述为 north/south traffic。典型南北向流量包括用户访问 Web 服务、移动端访问 API、第三方系统访问开放接口、公网流量进入 Ingress Gateway、服务网格访问外部 SaaS 或第三方 HTTP 服务等。

东西向流量通常指系统内部服务之间的横向访问流量。在服务网格语境中，东西向流量主要表现为微服务之间、Pod 之间、工作负载之间、不同命名空间服务之间、不同版本服务之间以及多集群内部服务之间的调用。Gateway API 文档将 Mesh 与 East-West 关联，Istio 架构文档也指出数据平面代理负责控制微服务之间的全部网络通信。因此，东西向流量治理的重点是服务间调用路径、实例选择、版本选择、可用区优先级、故障转移、重试、熔断和内部安全策略。

从治理边界看，南北向流量强调入口暴露、外部访问、TLS 终止、域名和路径匹配、入口鉴权、统一限流和边界审计；东西向流量强调服务发现、客户端路由、服务版本灰度、就近访问、跨区容灾、内部鉴权、连接池、重试、熔断和链路可观测性。二者都属于流量治理，但作用位置和规则粒度不同。

## 3. 内部网关与外部网关时代的集中式流量治理

在内部网关和外部网关架构中，外部网关通常处理南北向流量，内部网关通常处理服务间调用。外部网关承担公网入口、域名路由、TLS 终止、统一鉴权、限流、审计和协议转换等功能。内部网关承担服务间访问入口、内部 API 聚合、内部鉴权、内部限流、服务路由和流量调度等功能。Kubernetes Gateway API 文档也说明，API Gateway 常被用于将认证、授权或限流等能力集中到统一管理位置。

当架构要求“内部调用必须经过内部网关”时，服务 A 调用服务 B 的路径不再是 A 直接访问 B 的实例，而是 A 先访问内部网关，再由内部网关根据服务发现、路由规则和负载均衡策略转发到 B。该模型的客观结果是：内部网关同时处于服务调用路径和治理执行路径上。负载均衡、流量调度、鉴权、限流、熔断、降级、重试、灰度、日志、指标和链路追踪都会集中在网关层执行。

集中式网关模型的工程特征是治理逻辑统一、规则入口统一、审计位置集中，但网关也会成为流量汇聚点。随着服务数量、调用量和东西向流量规模增长，网关需要处理所有内部调用的连接、转发、协议解析、策略匹配和指标采集。Istio 性能文档指出，数据路径上的代理需要消耗 CPU 和内存，代理特性和遥测能力也会影响延迟与资源使用。因此，集中式网关在高流量场景下会形成明显的数据面压力集中。

## 4. 从集中式网关到客户端路由

现代流量治理的一个重要变化，是将路由决策从集中式网关转向客户端侧执行。这里的“客户端侧”可以是应用进程内的客户端负载均衡器，也可以是与应用同机部署的 Sidecar 代理。gRPC 官方文档描述了客户端负载均衡模型：名称解析器向客户端负载均衡策略提供服务端 IP 地址列表，负载均衡策略负责维护到服务端的连接并在 RPC 发送时选择连接。Spring Cloud LoadBalancer 官方文档也将其定义为客户端侧负载均衡抽象和实现。

在服务网格中，路由规则仍然由平台侧统一配置，但执行位置通常在客户端请求路径上的 Sidecar 代理。Istio 官方架构文档说明，Istiod 将高级路由规则转换为 Envoy 配置，并在运行时传播到 Sidecar；Envoy Sidecar 作为数据平面代理处理入站和出站流量。这意味着路由规则在控制面集中配置，但在数据面分布式生效。对于一次服务调用，请求方侧的代理可以根据 VirtualService、DestinationRule、服务发现端点、负载均衡策略、熔断状态和健康状态选择目标实例。

因此，“路由规则在服务端配置，但直接作用于客户端”可以被表述为：规则由控制面或配置中心统一保存和发布，但规则最终在请求发起侧的客户端运行时、客户端负载均衡器或客户端 Sidecar 上执行。该模式将原本集中在内部网关的数据面压力分散到调用方侧，同时保留集中配置和统一治理能力。

## 5. 服务发现权重与客户端路由规则的关系

传统服务发现系统通常保存服务实例列表、实例健康状态、实例元数据、权重、可用区、机房、版本和标签。路由系统可以基于这些元数据完成实例选择。在客户端路由模型中，服务发现不再只返回“有哪些实例”，还可以向客户端或代理提供更多参与负载均衡和路由决策的属性。

Envoy 官方文档说明，Endpoint Discovery Service 可以向 Envoy 提供上游集群成员，且端点响应中携带的额外属性可包含负载均衡权重、canary 状态、zone 等信息，这些属性会被用于负载均衡和统计等行为。Kubernetes Topology Aware Routing 也通过 EndpointSlice 的拓扑提示影响流量路由，使流量优先保持在发起流量的可用区内。由此可见，服务发现上的权重、可用区、灰度标记和路由属性可以从单纯注册中心字段转化为客户端路由输入。

在该模式下，服务发现系统提供实例事实，路由规则系统提供调度意图，客户端负载均衡器或 Sidecar 代理完成最终实例选择。服务发现中的权重和路由并不是消失，而是从“注册中心直接决定”转为“注册中心提供元数据，路由规则消费元数据并执行调度”。

## 6. 路由规则的基本模型

路由规则的基本模型可以抽象为匹配条件、目标集合、流量比例和附加动作四部分。

匹配条件用于判断哪些请求命中规则。常见条件包括服务名、域名、HTTP Method、URL Path、Header、Query、Cookie、gRPC 方法、来源服务、来源命名空间、来源可用区、用户标识、租户标识、请求协议、目标端口等。

目标集合用于描述请求应被转发到哪些后端。目标可以是服务、服务版本、实例分组、可用区、机房、命名空间、实例标签集合、外部服务、备份服务或降级服务。

流量比例用于描述多目标之间的分配关系。典型场景包括 90% 流量进入稳定版本、10% 流量进入灰度版本；同可用区优先，跨可用区作为故障转移；按权重将流量分配给不同实例空间；按用户或租户将请求固定到某个版本。

附加动作用于描述转发前后的处理逻辑。常见动作包括路径重写、Header 增删改、请求镜像、重定向、直接返回、超时、重试、故障注入、限流、熔断、连接池控制、跨区故障转移和审计标记。

## 7. 路由规则可实现的治理内容

路由规则不仅用于服务版本选择，还可以实现多类流量治理能力。

第一，基于版本的灰度发布。规则可以将部分流量按比例分配到新版本，例如 1%、5%、10%、50% 逐步扩大，直到新版本完全接管。

第二，基于用户、租户或请求头的定向灰度。规则可以将内部用户、测试用户、特定租户、特定 Header 或特定 Cookie 的请求路由到灰度版本。

第三，基于 URL 或方法的接口级路由。HTTP 场景可以基于 Path、Method、Header、Query 进行匹配；gRPC 场景可以在 HTTP/2/gRPC 路由层针对具体服务方法进行匹配。

第四，基于可用区或地域的就近访问。规则可以优先将流量调度到同地域、同可用区或同机房实例，以降低跨区延迟和跨区成本。

第五，基于故障状态的故障转移。规则可以在本地可用区不可用、实例异常、连续错误或健康检查失败时，将流量切换到备用可用区、备用版本或备用服务。

第六，基于权重的容量调度。规则可以按照实例权重、分组权重、版本权重或可用区权重分配流量，用于容量不均衡、异构机器、弹性扩缩容和成本控制场景。

第七，请求镜像。规则可以将线上真实请求复制到影子服务或新版本服务，用于功能验证、压测回放和兼容性观察；镜像请求不影响原始请求响应。

第八，路径重写和重定向。规则可以将旧路径转发到新路径，将单体应用路径逐步迁移到微服务路径，或将不再使用的接口重定向到新服务。

第九，超时和重试控制。规则可以针对接口、服务或版本配置超时时间、重试次数、重试条件和单次尝试超时，避免故障请求无限占用调用链资源。

第十，熔断和异常实例摘除。规则可以限制连接池、并发请求、待处理请求数量，并基于异常检测将持续失败的实例从负载均衡池中临时移除。

第十一，故障注入。规则可以人为注入延迟或错误响应，用于验证调用方超时、重试、降级和容错逻辑。

第十二，出口流量治理。规则可以约束服务访问外部网络的路径，使外部访问通过专用出口网关，并在出口处施加监控、路由和安全策略。

第十三，多集群和跨集群路由。规则可以将流量调度到本集群、本地域、远端集群或灾备集群，用于多活、容灾和迁移场景。

第十四，协议级路由。规则可以针对 HTTP、HTTP/2、gRPC、TCP、TLS 和 SNI 进行不同层级的匹配和转发。

第十五，配置可见性和作用域控制。规则可以限定在某个命名空间、某个网关、某组 Sidecar 或某组服务中生效，避免全局规则对无关服务产生影响。

## 8. 自定义路由的粒度边界

自定义路由可以支持 URL 级别、方法级别和部分参数级别，但不同粒度适合的执行位置不同。

URL 级路由适合网关、Sidecar 和客户端代理执行。HTTP Path 是协议层可见信息，代理无需理解业务请求体即可匹配。Istio VirtualService 的 HTTPMatchRequest 支持 URI、Header、Method、Authority 和 Query 参数匹配，因此 URL 和 Method 属于基础设施层可表达的路由条件。

方法级路由在 HTTP 场景中通常表现为 Method + Path，在 gRPC 场景中通常表现为 gRPC 服务方法。Istio VirtualService 的 HTTPRoute 可应用于 HTTP、HTTP/2 和 gRPC 协议，并按有序规则匹配请求。因此，面向 API 或 RPC 方法的灰度、重试、超时、镜像和版本调度可以作为标准路由规则的一部分。

参数级路由需要区分协议参数和业务参数。Header、Query、Cookie、Path Variable 等参数对网关和代理可见，可以作为基础设施层匹配条件。请求体中的业务字段、数据库资源归属、订单状态、用户权限、商品状态等信息需要业务服务解析和判断，不适合完全交给通用路由代理执行。否则路由系统需要理解业务协议、请求体结构和数据语义，会导致平台规则与业务模型强耦合。

因此，流量治理规则应支持到方法级别；参数级别应限制在协议可见参数范围内。业务语义参数可以通过应用层路由、业务网关插件、外部策略服务或领域服务内部逻辑处理。

## 9. Istio 的路由规则标准实现

Istio 的流量治理主要由 Gateway、VirtualService、DestinationRule、ServiceEntry、Sidecar 等资源组成。其中，Gateway 描述服务网格边缘的负载均衡器，用于接收进入或离开网格的 HTTP/TCP 连接；VirtualService 定义主机被访问时适用的路由规则；DestinationRule 定义路由发生后作用于目标服务的策略，包括负载均衡、连接池和异常实例检测。

Istio 官方文档将 VirtualService 描述为解耦客户端请求地址与实际目标工作负载的核心资源。客户端向虚拟主机发送请求，Envoy 根据 VirtualService 规则将流量路由到不同服务版本、不同服务或不同子集。VirtualService 支持按百分比分流、按 Header 或 URI 匹配、按顺序匹配规则、设置默认路由、配置重写、重定向、超时、重试、故障注入和请求镜像。

DestinationRule 在 VirtualService 路由决策之后生效。它定义目标服务的子集，例如按照版本标签将服务实例划分为 v1、v2、v3；同时定义负载均衡策略、连接池大小、TLS 设置和 outlierDetection。Istio DestinationRule 官方文档将 outlierDetection 描述为熔断实现的一部分，可跟踪上游服务中单个主机状态，并将连续失败的主机从负载均衡池中移除。

Gateway 主要用于边界流量。Istio 官方文档指出，Gateway 只配置 L4-L6 层的端口、协议、TLS 等负载均衡属性，L7 路由仍然通过绑定 VirtualService 完成。因此，Istio 的网关流量与网格内部流量可以使用同一种 VirtualService 路由模型表达。

Egress Gateway 用于出口流量治理。Istio 文档说明，Ingress Gateway 定义进入网格的入口点，Egress Gateway 对称地定义离开网格的出口点，并可将监控和路由规则应用于离开网格的流量。这说明 Istio 将南北向入口、东西向内部调用和出口流量统一纳入流量治理体系。

## 10. 流量治理规则的配置方式

流量治理规则的配置方式可以分为声明式配置、集中式配置和运行时动态下发三层。

声明式配置以 Kubernetes CRD、YAML 或平台配置对象表达规则。Istio 的 Gateway、VirtualService 和 DestinationRule 属于声明式配置。Gateway API 的 HTTPRoute 和 GRPCRoute 也属于声明式路由资源。

集中式配置指规则由平台、控制面或配置中心统一维护。使用者不直接修改每个客户端实例，而是提交规则对象，控制面根据服务发现状态、部署状态和规则状态生成数据面配置。

运行时动态下发指控制面将规则转换成代理可执行配置，并推送到数据面。Istio 中 Istiod 将高级路由规则转换为 Envoy 配置并传播给 Sidecar。Envoy 的 xDS API 支持 LDS、RDS、CDS、EDS 等动态配置能力，其中 RDS 可在运行时发现整个 HTTP 路由配置，EDS 可发现上游集群成员，CDS 可发现上游集群。

该配置方式形成了“规则集中管理、执行分布式完成”的治理结构。它不同于传统内部网关模型中“规则集中、执行也集中”的方式，也不同于完全 SDK 化治理中“规则和执行都分散到应用代码”的方式。

## 11. 标准化流量治理模型

一个完整的流量治理规则体系应包含以下标准对象。

第一，流量入口对象。用于描述外部入口、内部入口、出口网关和服务暴露边界。

第二，服务目标对象。用于描述服务名、命名空间、端口、协议、版本、实例子集、可用区、集群和外部服务。

第三，匹配条件对象。用于描述域名、路径、方法、Header、Query、Cookie、来源服务、来源身份、来源可用区、端口、协议和 SNI。

第四，路由动作对象。用于描述转发、分流、重写、重定向、镜像、直接响应、故障注入和外部转发。

第五，负载均衡对象。用于描述轮询、随机、最少请求、一致性哈希、权重、地域优先、可用区优先和故障转移。

第六，韧性治理对象。用于描述超时、重试、熔断、异常实例摘除、连接池、并发限制、请求排队和降级。

第七，安全治理对象。用于描述认证、授权、mTLS、访问控制、出口控制和策略审计。

第八，可观测对象。用于描述指标、日志、链路追踪、访问日志、命中规则、路由结果和异常原因。

第九，作用域对象。用于描述规则在哪个命名空间、服务、网关、Sidecar、租户、环境或可用区生效。

第十，发布对象。用于描述规则版本、灰度发布、回滚、校验、冲突检测、优先级和变更审计。

该模型可以覆盖内部网关、外部网关、客户端负载均衡、服务发现、服务网格和应用层路由等多种实现方式。

## 12. 结论

流量治理是分布式系统中对请求路径、目标选择、故障处理和策略执行的系统化控制。南北向流量主要描述外部与内部边界之间的访问，东西向流量主要描述服务间横向调用。内部网关和外部网关架构通过集中式网关统一承载负载均衡、流量调度、鉴权、限流、熔断和审计，但在大规模东西向调用下会使网关成为数据面汇聚点。

客户端路由和服务网格将治理模式转变为集中配置、分布式执行。路由规则可以由控制面统一管理，但实际作用于客户端运行时、客户端负载均衡器或客户端 Sidecar。服务发现中的实例权重、可用区、版本、canary 标记和健康状态可以作为客户端路由规则的输入，从而将服务发现和路由调度统一到请求侧执行。

Istio 的标准实现表明，Gateway 负责边界流量入口和出口，VirtualService 负责路由规则，DestinationRule 负责目标服务策略，Envoy 负责数据面执行，Istiod 负责配置转换和下发。该模型将南北向流量、东西向流量、灰度发布、请求路由、超时、重试、镜像、熔断、异常实例摘除和本地性负载均衡纳入统一治理体系。流量治理规则应至少支持服务级、接口级和方法级；参数级规则应限于协议可见参数，业务语义参数应保留在应用层或外部策略系统中处理。

[R1] Kubernetes Gateway API 官方文档说明 Gateway API 是 Kubernetes 中面向 L4/L7 路由的官方项目，并支持 Ingress 与 Mesh 场景；文档同时明确 North-South 与 East-West 交通方向。([Gateway API][1])
[R2] Kubernetes Gateway API 官方文档说明 API Gateway 常用于将认证、授权或限流等能力集中到统一管理位置。([Gateway API][1])
[R3] Istio 架构文档说明 Istio 分为控制平面和数据平面，Envoy Sidecar 调解和控制微服务间通信，Istiod 将高级路由规则转换为 Envoy 配置并传播到 Sidecar。([Istio][2])
[R4] Istio Traffic Management 文档说明 VirtualService 用于解耦客户端请求地址与实际目标工作负载，并通过路由规则指示 Envoy 如何转发流量。([Istio][3])
[R5] Istio VirtualService 参考文档说明 VirtualService 定义主机被访问时适用的流量路由规则，规则包含匹配条件并转发到目标服务或子集。([Istio][4])
[R6] Istio DestinationRule 参考文档说明 DestinationRule 在路由发生后作用于目标服务，并配置负载均衡、连接池和异常实例检测。([Istio][5])
[R7] Istio Gateway 参考文档说明 Gateway 是服务网格边缘的负载均衡器，用于接收进入或离开的 HTTP/TCP 连接。([Istio][6])
[R8] Istio Ingress Gateway 文档说明 Gateway 配置端口和协议，入口流量的 L7 路由通过普通路由规则完成，内部服务请求也使用同类路由规则。([Istio][7])
[R9] Istio Egress Gateway 文档说明 Egress Gateway 定义离开服务网格的出口点，并可对出口流量应用监控和路由规则。([Istio][8])
[R10] Kubernetes Topology Aware Routing 文档说明该能力可使流量优先保持在发起流量的可用区内，以改善可靠性、性能或成本。([Kubernetes][9])
[R11] gRPC 官方文档说明客户端负载均衡策略从名称解析器获得地址列表，并负责维护连接和为 RPC 选择连接。([gRPC][10])
[R12] Envoy xDS 官方文档说明 RDS、CDS、EDS、LDS 等 API 支持路由、集群、端点和监听器的动态配置。([envoyproxy.io][11])
[R13] Envoy 服务发现文档说明 EDS 可向 Envoy 提供端点，端点属性可包括权重、canary 状态和 zone，并参与负载均衡与路由。([envoyproxy.io][12])
[R14] Gateway API HTTP traffic splitting 文档说明 HTTPRoute 可以通过 backendRefs 权重在多个后端之间分配流量。([Gateway API][13])
[R15] Envoy 官方文档说明 Envoy 支持高级负载均衡、自动重试、熔断、全局限流、请求镜像和异常检测等能力。([envoyproxy.io][14])
[R16] Istio Circuit Breaking 文档说明 Istio 可配置连接、请求和异常检测相关的熔断规则。([Istio][15])
[R17] Istio Locality Load Balancing 文档说明 locality 由 region、zone、sub-zone 组成，Istio 可使用这些信息控制负载均衡行为。([Istio][16])
[R18] Spring Cloud LoadBalancer 官方文档说明 Spring Cloud 提供客户端侧负载均衡抽象，并可从服务发现中获取实例。([docs.spring.io][17])

[1]: https://gateway-api.sigs.k8s.io/docs/ "Introduction | Gateway API"
[2]: https://istio.io/latest/docs/ops/deployment/architecture/ "Istio / Architecture"
[3]: https://istio.io/latest/docs/concepts/traffic-management/ "Istio / Traffic Management"
[4]: https://istio.io/latest/docs/reference/config/networking/virtual-service/ "Istio / Virtual Service"
[5]: https://istio.io/latest/docs/reference/config/networking/destination-rule/ "Istio / Destination Rule"
[6]: https://istio.io/latest/docs/reference/config/networking/gateway/ "Istio / Gateway"
[7]: https://istio.io/latest/docs/tasks/traffic-management/ingress/ingress-control/ "Istio / Ingress Gateways"
[8]: https://istio.io/latest/docs/tasks/traffic-management/egress/egress-gateway/ "Istio / Egress Gateways"
[9]: https://kubernetes.io/docs/concepts/services-networking/topology-aware-routing/ "Topology Aware Routing | Kubernetes"
[10]: https://grpc.io/docs/guides/custom-load-balancing/ "Custom Load Balancing Policies | gRPC"
[11]: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/dynamic_configuration "xDS configuration API overview — envoy 1.39.0-dev-287f07 documentation"
[12]: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/service_discovery "Service discovery — envoy 1.39.0-dev-287f07 documentation"
[13]: https://gateway-api.sigs.k8s.io/guides/user-guides/traffic-splitting/ "HTTP traffic splitting | Gateway API"
[14]: https://www.envoyproxy.io/docs/envoy/latest/intro/what_is_envoy "What is Envoy — envoy 1.39.0-dev-287f07 documentation"
[15]: https://istio.io/latest/docs/tasks/traffic-management/circuit-breaking/ "Istio / Circuit Breaking"
[16]: https://istio.io/latest/docs/tasks/traffic-management/locality-load-balancing/ "Istio / Locality Load Balancing"
[17]: https://docs.spring.io/spring-cloud-commons/reference/spring-cloud-commons/loadbalancer.html "Spring Cloud LoadBalancer :: Spring Cloud Commons"
