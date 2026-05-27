# 企业级注册中心的架构模型、核心设计与自研实现路径研究：以 StellMap 为例

## 摘要

注册中心是微服务体系中的基础设施组件，承担服务实例注册、服务发现、健康状态维护、元数据管理、变更通知与多节点容灾等职责。开源生态中常见注册中心或服务发现组件包括 Nacos、Eureka、Consul、ZooKeeper、etcd 以及 Kubernetes Service Discovery。不同系统在架构模型、一致性协议和 CAP 取舍上存在差异：Eureka 更强调分区场景下的可用性，Consul、etcd、ZooKeeper 依赖多数派共识或原子广播协议保证一致状态，Nacos 同时提供 AP 与 CP 语义，Kubernetes 则以 Service、EndpointSlice 与 DNS 机制为集群内服务发现提供抽象。本文基于官方文档与 StellMap 项目文档，对企业级注册中心的基本要素、模块边界、共识模型、存储模型、Watch 机制、跨 Region 同步与运维部署进行系统化归纳，并以 `stellhub/stellmap-service` 为例总结一种轻量级、强一致、自研注册中心的实现路径。

**关键词**：注册中心；服务发现；Raft；CAP；CP；AP；Watch；跨 Region 同步；StellMap

## 1. 引言

微服务系统中，服务实例通常具有动态性：实例会扩缩容、重启、迁移、失效或跨可用区部署。调用方不能依赖静态地址文件完成服务定位，而需要通过注册中心获取当前可用实例集合。Nacos 官方文档将 Nacos 定义为动态服务发现、配置管理与服务管理平台，并说明其支持 DNS 与 RPC 方式的服务发现，同时提供健康检查以避免请求发送到不健康实例。([Nacos 官网][1]) Kubernetes 官方文档也指出，工作负载可以通过 Kubernetes API 查询 EndpointSlice，且当 Service 后端 Pod 集合变化时，Kubernetes 会更新 EndpointSlice；对于 DNS 方式，Kubernetes 会为 Service 和 Pod 创建 DNS 记录，使工作负载可以通过稳定 DNS 名称访问服务。([Kubernetes][2]) ([Kubernetes][3])

企业级注册中心的设计目标不只是“保存地址”。它需要同时处理实例生命周期、强弱一致性、查询延迟、变更推送、故障恢复、跨区域同步、观测、安全与运维部署等问题。StellMap 项目将自身定位为 Stell Hub 体系中的注册中心，职责是为分布式系统中的服务实例提供统一注册、发现与定位能力，使调用方在运行时找到目标服务，并基于一致元数据完成路由与治理协作。([GitHub][4])

## 2. 主流开源注册中心及其架构类型

### 2.1 Nacos

Nacos 是动态服务发现、配置管理与服务管理平台，支持 Spring Cloud、Dubbo、gRPC、Kubernetes 等服务类型，提供服务发现、健康检查、动态配置、动态 DNS 与服务治理能力。([Nacos 官网][1]) Nacos 官方 FAQ 说明，Nacos 使用 Distro 作为 AP 协议，主要用于注册中心中临时服务和实例数据同步，提供高可用和最终一致性；同时使用 Raft 作为 CP 协议，用于非临时服务、服务实例元数据以及 Derby 数据库场景下的一致性保障。([Nacos 官网][5])

因此，Nacos 不能简单归类为单一 AP 或 CP 系统。其注册中心语义同时覆盖 AP 与 CP：临时实例更偏 AP，非临时实例与部分元数据更偏 CP。该架构适合既需要高可用临时实例发现，又需要部分强一致元数据管理的微服务场景。

### 2.2 Eureka

Eureka 是 Netflix OSS 体系中的服务发现组件。Eureka 官方 Wiki 的自我保护模式说明显示，当 Eureka Server 检测到大量客户端非正常断连并等待剔除时，会进入 self-preservation mode，以避免灾难性网络事件导致注册表数据被清空并向下游传播。进入自我保护模式后，Eureka Server 会停止剔除所有实例，直到心跳恢复到阈值以上或该模式被禁用。([GitHub][6]) Eureka 官方 Wiki 的 Peer-to-Peer 说明还指出，在 Peer 网络故障期间，部分注册可能发生在孤立 Server 上，部分客户端可能感知到新注册，部分客户端可能感知不到；网络恢复后，注册信息会自动传递到缺失这些信息的 Server。([GitHub][7])

因此，Eureka 更符合 AP 型注册中心特征：分区期间优先保护已有注册表与服务发现可用性，但允许不同客户端在短时间内看到不同服务视图。

### 2.3 Consul

Consul 官方文档将 Consul 定义为可注册、访问和保护网络中服务的控制平面；其 Catalog API 跟踪已注册服务及其位置，用于服务发现和服务网格场景。([HashiCorp Developer][8]) Consul 使用 Raft 协议保证一致状态，官方文档说明，多数派 Server Agent 与一个 Leader 在提交状态日志前需要对状态变化达成一致。([HashiCorp Developer][8]) 在 Consul 的 Raft 文档中，日志条目被定义为 Raft 系统中的基本工作单元，包含添加节点、注册服务、更新 KV 等集群变化；如果多数派不可用，Consul 集群无法提交新的日志。([HashiCorp Developer][9])

因此，Consul 的服务目录属于 CP 型设计：写入依赖 Leader 与多数派提交，分区时少数派不能继续提交新状态。

### 2.4 ZooKeeper

Apache ZooKeeper 官方定义为集中式服务，用于维护配置信息、命名、分布式同步和组服务。([zookeeper.apache.org][10]) ZooKeeper 官方内部文档说明，原子广播和 Leader 选举使用 quorum 保证系统视图一致，默认使用多数派 quorum；Leader 提案只有在收到 quorum Server 确认后才能提交。([zookeeper.apache.org][11])

因此，ZooKeeper 属于 CP 型协调服务。它不是专门的微服务注册中心，但长期被用于命名、服务注册、分布式协调和元数据管理场景。

### 2.5 etcd

etcd 官方站点定义 etcd 为强一致、分布式 key-value 存储，为分布式系统或机器集群中需要访问的数据提供可靠存储方式，并说明其通过 Raft 协议进行分布式复制。([etcd][12]) etcd 性能文档进一步说明，etcd 使用 Raft 共识算法在成员之间复制请求并达成一致，提交延迟受网络 RTT 与磁盘 `fdatasync` 延迟限制。([etcd][13])

因此，etcd 是典型 CP 型基础设施。它常作为 Kubernetes 等系统的元数据存储，也可以作为服务发现、配置协调或租约元数据的底层存储。

### 2.6 Kubernetes Service Discovery

Kubernetes Service Discovery 并不是传统意义上的独立注册中心，但它在云原生环境中承担服务发现角色。Kubernetes 官方文档说明，应用可以通过 API Server 查询 EndpointSlice，Kubernetes 会在 Service 对应 Pod 集合变化时更新 EndpointSlice；Kubernetes DNS 文档说明，Kubernetes 会为 Service 和 Pod 创建 DNS 记录，工作负载可以使用稳定 DNS 名称而不是 IP 地址访问服务。([Kubernetes][2]) ([Kubernetes][3])

Kubernetes 控制面状态通常由 etcd 存储，因此控制面元数据写入路径依赖 etcd 的 CP 能力；但 Service VIP、kube-proxy、CoreDNS 和 EndpointSlice 共同提供的是集群内服务发现抽象。该体系更适合容器编排环境，而不是直接替代所有业务级注册中心。

## 3. 企业级注册中心的基本要点

一个合格的企业级注册中心应至少包含以下能力。

第一，**实例注册模型**。注册中心必须定义服务实例的逻辑主键、网络端点、协议、权重、标签、元数据、租约 TTL 和最近心跳时间。Nacos 文档中服务被视为一等公民，并支持多种服务类型的发现、健康检查和元数据治理。([Nacos 官网][1]) StellMap 文档将数据模型定义为“实例注册表”而不是通用 KV 产品，其逻辑主键为 `namespace / service / instanceId`，实例内容包含端点、标签、元数据、租约 TTL、最近心跳等注册信息。([GitHub][4])

第二，**服务发现查询模型**。注册中心应支持按服务名查询候选实例，并支持命名空间、分组、标签、服务前缀、区域、版本等过滤条件。StellMap 的 `internal/registry` 模块负责领域模型和规则，包含实例模型、注册输入规范化、查询候选集、过期判断和变化事件发布；其查询支持精确服务名、`servicePrefix` 前缀订阅，以及组织、业务域、能力域、应用、角色等结构化层级过滤。([GitHub][14])

第三，**租约与健康状态维护**。注册中心需要通过心跳、TTL、主动探测或被动上报维护实例健康状态。Nacos 官方文档说明其支持传输层 PING/TCP 健康检查，以及 HTTP、Redis、MySQL、自定义协议等应用层健康检查。([Nacos 官网][1]) Eureka 文档中也描述了客户端心跳续约、连续心跳失败后的后台剔除，以及自我保护模式下停止剔除实例的行为。([GitHub][6])

第四，**变更通知机制**。注册中心需要把实例变化以 Watch、长轮询、SSE、gRPC Stream 或 DNS 更新等形式通知调用方。Kubernetes 通过 EndpointSlice 和 DNS 记录更新暴露变化；StellMap 已具备基于 SSE 的实例变化 Watch，接口为 `GET /api/v1/registry/watch`，并使用已提交日志索引作为 `revision` 的增量事件流。([Kubernetes][2]) ([GitHub][15])

第五，**一致性模型**。注册中心必须明确 AP、CP 或混合模式。Eureka 的自我保护与 Peer 网络故障处理体现 AP 取舍；Consul、etcd、ZooKeeper 依赖多数派提交体现 CP 取舍；Nacos 对临时实例和非临时实例分别使用不同一致性协议。([GitHub][6]) ([HashiCorp Developer][9]) ([etcd][12]) ([Nacos 官网][5]) 对企业级自研注册中心而言，该选择不能隐藏在实现细节中，而应成为产品语义的一部分。

第六，**持久化与恢复模型**。CP 型注册中心必须处理共识日志、状态机数据、快照、崩溃恢复和日志压缩。StellMap 将持久化职责拆为 WAL、Pebble 和 Snapshot 三部分：WAL 存储 Raft Log，Pebble 存储实例注册表数据与本地元数据，Snapshot 存储独立快照文件。([GitHub][4]) 这种拆分与 etcd 文档中“Raft 复制请求并达成一致，提交受网络和磁盘约束”的事实相匹配，因为共识日志和状态机存储的生命周期不同。([etcd][13])

第七，**多节点通信与成员变更**。CP 注册中心需要 Leader 选举、日志复制、节点加入、节点退出、Learner、Joint Consensus、快照传输等机制。Consul 文档说明 Raft 节点从 Follower 开始，如果一段时间未收到条目会成为 Candidate，获得 quorum 投票后成为 Leader，Leader 负责记录权威日志并复制给其他成员。([HashiCorp Developer][9]) StellMap 文档也规划通过 Learner 与 Joint Consensus 处理成员变更，避免扩容或缩容过程中多数派抖动。([GitHub][4])

第八，**跨 Region 设计**。跨 Region 服务发现不能直接等同于跨 Region 强一致共识。StellMap 的跨 Region 目录同步方案明确不把多个 Region 拼成一个更大的 Raft 共识域，而是保持每个 Region 独立共识域，远端目录以异步复制视图进入本地，并在查询阶段执行本地优先、远端回退、网关入口替换等策略。([GitHub][15])

第九，**运维与观测能力**。注册中心属于基础设施，必须具备部署脚本、配置文件、健康检查、Prometheus 指标、Grafana 面板、日志、审计与版本发布流程。StellMap 的部署文档说明当前采用 GitHub Actions 直推 CVM 加本地 `/data/start.sh` 启动方式，目标机器包含 `stellmapd.toml`、`stellmapd`、`stellmapctl` 和 `start.sh`，并通过 systemd 服务启动和健康检查。([GitHub][16])

## 4. 企业级注册中心的模块设计

从工程实现角度，企业级注册中心可以拆分为九类模块。

### 4.1 API 接入层

API 接入层承载注册、注销、续约、查询、Watch、管理操作和健康检查。面向业务 SDK 的接口与面向集群内部复制的接口应分离。StellMap 的跨 Region 设计文档明确区分客户端 Watch 与同步 Watch：客户端 Watch 面向业务调用方、SDK、sidecar；同步 Watch 面向受信任的内部复制器；二者在暴露面、返回字段、权限要求、回放语义、流控与限流策略上不同。([GitHub][15])

### 4.2 领域模型层

领域模型层定义服务、实例、端点、标签、元数据、租约、查询条件和 Watch 事件。StellMap 的 `internal/registry` 模块不处理 HTTP、gRPC、Raft 启动或存储装配，而专注注册中心业务语义；它负责清理 `namespace/service/instanceId` 字段空白、规范化多层级服务标识、校验端点协议、地址、端口、权重，兜底默认 TTL 和默认端点权重，并构造落到状态机中的最终 `Value`。([GitHub][14])

### 4.3 一致性与共识层

CP 型注册中心需要以复制状态机方式承载写入。StellMap 采用单 Raft Group，基于 `etcd-io/raft` 实现复制状态机，并明确采用 CP 架构：网络分区发生时，少数派节点停止提供线性一致写服务，只有多数派存活并完成选主后系统才继续接受写入。([GitHub][4]) 该取舍与 Consul、etcd 的多数派共识模型一致：如果 quorum 不可用，新日志不能提交。([HashiCorp Developer][9])

### 4.4 线性一致读层

注册中心查询如果返回过期实例，会影响调用链路正确性。StellMap 明确要求所有读请求为线性一致读，不默认提供 stale read；其路径为外部读请求进入 `raftnode.LinearizableRead`，通过 `ReadIndex` 申请读屏障，状态机 `appliedIndex >= readIndex` 后再从本地状态机读取。([GitHub][4])

### 4.5 状态机与存储层

状态机负责把已提交日志转换为本地注册表状态。StellMap 的 `internal/storage` 提供状态机抽象和 Pebble 存储实现，用于承接“Raft 已提交的注册变更最终如何落到本地注册表状态”；其状态机接口包括 `Apply`、`Get`、`Scan`、`Snapshot`、`Restore`、`AppliedIndex`，生产实现 `PebbleStore` 保存实例注册表数据、`applied index`、`applied term` 和成员地址元数据。([GitHub][17])

### 4.6 WAL 日志层

WAL 层负责共识日志安全落盘和崩溃恢复。StellMap 的 `internal/wal` 提供 Raft 日志的预写日志能力，负责持久化 `HardState` 和 `Entry`，并在节点重启后恢复；其接口包括 `Open`、`Append`、`Load`、`TruncatePrefix`、`Sync`、`Close`，生产实现 `FileWAL` 使用 `hardstate.bin` 保存最近一次 `HardState`，使用 `*.wal` 保存日志条目 segment。([GitHub][18])

### 4.7 Snapshot 层

Snapshot 层负责状态截面导出、安装、恢复和历史清理。StellMap 的 `internal/snapshot` 提供快照抽象和快照存储实现，负责把注册中心当前实例注册表视图导出为独立快照文件，并支持恢复和安装；`FileStore` 使用 `*.snap` 保存快照内容，`*.meta` 保存快照元信息，创建时写入临时 `.snap.tmp`，计算 SHA-256 checksum，随后原子重命名为正式快照文件。([GitHub][19])

### 4.8 Runtime 集群通信层

Runtime 层负责节点间地址簿、Raft 消息转发和快照传输。StellMap 的 `internal/runtime` 维护节点 ID 到 HTTP、gRPC、admin 地址的映射；`PeerTransport` 消费本地 Raft 节点产生的 `Ready`，把普通 Raft 消息按目标节点分组后通过 gRPC 批量转发；`InternalTransportService` 接收远端 Raft 消息，接收快照分片并安装，也可从本地快照存储读取最新快照并切成 chunk 供远端下载。([GitHub][20])

### 4.9 运维发布层

运维发布层需要支持本地构建、自动化发布、配置管理、systemd 或容器部署、健康检查与回滚。StellMap 部署文档说明，发布后目标 CVM 的 `/data` 目录包含配置文件、服务端二进制、控制面 CLI 和启动脚本；`start.sh` 会安装到 `/opt/stellmap/bin`，安装配置到 `/etc/stellmapd/stellmapd.toml`，生成 systemd 服务并启动健康检查。([GitHub][16])

## 5. StellMap 的自研设计过程总结

StellMap 的设计过程可以归纳为从“注册中心语义”到“强一致复制状态机”再到“跨 Region 投影同步”的三阶段演进。

第一阶段是确定产品边界。StellMap 不是通用配置中心，也不是通用 KV 产品，而是以实例注册表为核心的注册中心。项目 README 明确其职责是为服务实例提供统一注册、发现与定位能力，并规划服务注册、服务发现、实例心跳、健康状态维护、服务元数据、命名空间、分组隔离以及与治理、配置、控制面模块的协作接口。([GitHub][4])

第二阶段是确定一致性取舍。StellMap 明确采用 CP 架构，优先保证线性一致和正确性；在网络分区发生时，少数派节点停止提供线性一致写服务，多数派完成选主后继续接受写入。([GitHub][4]) 这一选择与 Eureka 的 AP 取舍不同：Eureka 在网络故障期间允许客户端出现不同服务视图，并通过自我保护保护已有注册表。([GitHub][7]) StellMap 的设计更接近 Consul 和 etcd 的多数派提交模型。([HashiCorp Developer][9]) ([etcd][12])

第三阶段是确定存储职责拆分。StellMap 将 WAL、Pebble 和 Snapshot 拆开：WAL 只负责 Raft 复制日志和必要共识元数据，Pebble 负责 apply 后的实例注册数据和少量本地元数据，Snapshot 负责独立截面恢复。([GitHub][4]) 该拆分在模块文档中进一步落地：`internal/wal` 负责 `HardState` 和 `Entry` 持久化，`internal/storage` 负责状态机 apply、查询、扫描、快照导出恢复，`internal/snapshot` 负责快照文件生命周期。([GitHub][18]) ([GitHub][17]) ([GitHub][19])

第四阶段是确定注册中心领域语义。`internal/registry` 被限定为注册中心业务语义层，负责实例是什么、如何注册、如何查询候选集、如何判断是否过期、如何发布变化事件。其多层级服务标识采用 `organization.businessDomain.capabilityDomain.application.role`，同时保留规范化服务名和结构化字段，以支持前缀订阅、权限治理和监控聚合。([GitHub][14])

第五阶段是确定集群运行时边界。`internal/runtime` 不处理注册中心查询、过滤、注册表存储、WAL 或外部 HTTP API，而专注集群内部运行时通信与快照传输。该边界使注册中心领域逻辑、Raft 共识、节点通信、存储恢复和 API 接入可以独立演进。([GitHub][20])

第六阶段是确定跨 Region 同步原则。StellMap 的跨 Region 设计不是跨 Region 单一 Raft 集群，而是每个 Region 保持独立共识域；本地数据由本地集群强一致维护，远端数据以异步复制视图进入本地，查询阶段再合并本地原生目录和远端复制目录。([GitHub][15]) 该设计同时明确本地原生目录和远端复制目录必须使用不同前缀：本地目录使用 `/registry/{namespace}/{service}/{instanceId}`，远端复制目录使用 `/replication/regions/{sourceRegion}/clusters/{sourceClusterId}/registry/{namespace}/{service}/{instanceId}`，以避免本地过期清理误删远端目录、Watch 回环和来源混淆。([GitHub][15])

## 6. 结论

开源注册中心的架构路线可以概括为三类：第一类是 Eureka 代表的 AP 型服务发现，分区期间保护可用性与已有注册表，但允许短期不一致；第二类是 Consul、etcd、ZooKeeper 代表的 CP 型协调与服务目录，依赖多数派、Leader、日志复制或原子广播保证一致状态；第三类是 Nacos 代表的混合模型，根据临时实例、非临时实例和元数据场景分别使用 AP 与 CP 协议。Kubernetes Service Discovery 则以 Service、EndpointSlice 和 DNS 机制在容器编排环境中提供服务发现抽象。([GitHub][6]) ([HashiCorp Developer][9]) ([etcd][12]) ([zookeeper.apache.org][10]) ([Nacos 官网][5]) ([Kubernetes][2])

自研企业级注册中心时，关键不是复刻某个开源产品的接口，而是明确注册中心自身的一致性语义、实例模型、租约模型、Watch 模型、存储恢复模型、成员变更模型和跨 Region 模型。StellMap 当前采用 CP 架构、单 Raft Group、线性一致读、WAL/Pebble/Snapshot 分层持久化、SSE Watch、模块化 Runtime 和异步跨 Region 复制视图，形成了一条面向企业级服务治理场景的清晰实现路径。([GitHub][4]) ([GitHub][14]) ([GitHub][20]) ([GitHub][15])

## 7. 项目推广

StellMap 是 Stell Hub 体系中的自研注册中心，面向分布式系统提供服务注册、服务发现、实例心跳、健康状态维护、元数据管理、命名空间隔离和治理协作能力。项目采用 Go 实现，设计上选择 CP 架构、Raft 复制状态机、线性一致读、独立 WAL、Pebble 状态机存储与 Snapshot 恢复机制，并已沉淀模块文档、部署文档和跨 Region 目录同步设计。对于关注微服务治理、注册中心内核、Raft 工程化、服务发现和跨 Region 目录同步的开发者，`stellhub/stellmap-service` 提供了一个从工程代码到设计文档都可阅读、可演进、可参与的开源样本。([GitHub][4])

[1]: https://nacos.io/en/docs/latest/what-is-nacos/ "Nacos Configuration Center profile | Nacos 官网"
[2]: https://kubernetes.io/docs/concepts/services-networking/service/ "Service | Kubernetes"
[3]: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/ "DNS for Services and Pods | Kubernetes"
[4]: https://github.com/stellhub/stellmap-service "GitHub - stellhub/stellmap-service: StellMap Service is a cloud-native message queue server for distributed messaging, routing, and StellHub Cloud integration. · GitHub"
[5]: https://nacos.io/blog/faq/nacos-user-question-history10487/?utm_source=chatgpt.com "Nacos的高可用性如何保证？"
[6]: https://github.com/netflix/eureka/wiki/server-self-preservation-mode "Server Self Preservation Mode · Netflix/eureka Wiki · GitHub"
[7]: https://github.com/Netflix/eureka/wiki/Understanding-Eureka-Peer-to-Peer-Communication "Understanding Eureka Peer to Peer Communication · Netflix/eureka Wiki · GitHub"
[8]: https://developer.hashicorp.com/consul "Consul | HashiCorp Developer"
[9]: https://developer.hashicorp.com/consul/docs/concept/consensus "Consensus | Consul | HashiCorp Developer"
[10]: https://zookeeper.apache.org/ "Apache ZooKeeper"
[11]: https://zookeeper.apache.org/doc/current/zookeeperInternals.html?utm_source=chatgpt.com "ZooKeeper Internals"
[12]: https://etcd.io/?utm_source=chatgpt.com "etcd"
[13]: https://etcd.io/docs/v3.2/op-guide/performance/ "Performance | etcd"
[14]: https://github.com/stellhub/stellmap-service/blob/main/docs/modules/registry.md "stellmap-service/docs/modules/registry.md at main · stellhub/stellmap-service · GitHub"
[15]: https://github.com/stellhub/stellmap-service/blob/main/docs/design/cross-region-directory-sync.md "stellmap-service/docs/design/cross-region-directory-sync.md at main · stellhub/stellmap-service · GitHub"
[16]: https://github.com/stellhub/stellmap-service/blob/main/docs/operations/deploy.md "stellmap-service/docs/operations/deploy.md at main · stellhub/stellmap-service · GitHub"
[17]: https://github.com/stellhub/stellmap-service/blob/main/docs/modules/storage.md "stellmap-service/docs/modules/storage.md at main · stellhub/stellmap-service · GitHub"
[18]: https://github.com/stellhub/stellmap-service/blob/main/docs/modules/wal.md "stellmap-service/docs/modules/wal.md at main · stellhub/stellmap-service · GitHub"
[19]: https://github.com/stellhub/stellmap-service/blob/main/docs/modules/snapshot.md "stellmap-service/docs/modules/snapshot.md at main · stellhub/stellmap-service · GitHub"
[20]: https://github.com/stellhub/stellmap-service/blob/main/docs/modules/runtime.md "stellmap-service/docs/modules/runtime.md at main · stellhub/stellmap-service · GitHub"
