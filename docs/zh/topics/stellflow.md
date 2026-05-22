---
title: 基于分布式日志模型的企业级消息队列自研架构研究：以 Stellflow 为例
category: 消息中间件
summary: 以 Stellflow 为例，系统归纳企业级消息队列自研架构中的分布式日志模型、数据面协议、Broker 请求链路、存储层、Controller Quorum、Replica、高吞吐数据面和 OpenTelemetry-first 可观测性。
tags:
  - Stellflow
  - 消息队列
  - 分布式日志
  - Raft
  - OpenTelemetry
readingDirection: 适合在设计企业级消息队列、自研分布式日志系统、规划 Broker/Controller 架构、复制高水位、协议演进或可观测指标体系时阅读。
outline: deep
---

# 基于分布式日志模型的企业级消息队列自研架构研究：以 Stellflow 为例

## 摘要

企业级消息队列的核心问题不是“实现一个消息发送与消费接口”，而是构建一个可持久化、可复制、可扩展、可治理、可观测的分布式日志系统。本文以 `stellhub/stellflow-service` 为案例，对其 `docs` 与 `docs/adr` 中的设计文档进行归纳，并结合 Apache Ratis、Raft、Netty、gRPC、OpenTelemetry 等官方文档或权威资料，整理一个企业级消息队列的自研架构论文式方案。Stellflow 当前文档将项目定位为基于 JDK 25 的分布式消息队列，保留 Kafka 风格的 Topic、Partition、Replica、ISR、Offset、Controller Quorum 等核心语义，同时在控制面、通信框架、可观测性上采用更现代化的工程路线。

**关键词**：消息队列；分布式日志；Broker；Controller Quorum；Raft；Replica；OpenTelemetry；Netty；gRPC

---

## 1. 引言

企业级消息队列通常承担异步解耦、事件分发、流式传输、高吞吐日志聚合、削峰填谷与任务缓冲等职责。Stellflow 的概要设计将其定义为“分布式日志与消息队列平台”，并明确以 Topic、Partition、Replica、Leader、ISR、Consumer Group、Offset、Epoch、Metadata Log 等领域模型为核心。该定位说明，真正的自研重点应落在分布式日志事实模型、分区复制、控制面元数据一致性、Broker 热路径处理、客户端协议演进和可观测治理上，而不是仅封装一个生产者/消费者 SDK。

从工程判断看，Stellflow 的路线是正确的：企业级 MQ 不应该优先追求“功能花样”，而应该先把日志存储、协议、复制、高水位、元数据、故障切换和观测口径固定下来。Stellflow README 也明确说明当前仓库仍处于设计与骨架规划阶段，重点在于固化总体架构、模块边界、通信、存储、控制面和可观测性路线。

---

## 2. 架构决策记录归纳

Stellflow 的 ADR 索引显示，当前已经沉淀 7 条架构决策记录，覆盖通信协议、控制面一致性、存储核心、可观测性、多语言协议版本、元数据发现与 Broker 扩容、OpenTelemetry 指标命名等关键问题。ADR 文档本身定义了“记录背景、备选方案、最终选择、理由、约束和后果”的用途，因此这些 ADR 可以作为当前自研 MQ 的架构基线。

Stellflow 的通信决策是分层通信：Broker/Client 数据面使用自定义二进制协议，Java 客户端底层使用 Netty，Broker 间复制复用同一套二进制协议，Controller/Broker 控制面使用 gRPC。该决策使高吞吐数据面保留二进制协议的控制力，同时让控制面获得 IDL、跨语言代码生成和接口演进能力。 Netty 官方将其定义为异步事件驱动网络应用框架，用于快速构建可维护、高性能协议服务器与客户端，并提供 NIO 客户端/服务端框架能力。([netty.io][1]) gRPC 官方文档说明，gRPC 基于服务定义，默认使用 Protocol Buffers 作为 IDL 描述服务接口和消息结构，并能生成客户端与服务端代码。([gRPC][2])

控制面一致性方面，Stellflow 选择 Apache 的 Raft 实现，而不是自研通用一致性协议。该选择是合理的：一致性协议的工程风险高，消息队列项目的主要价值应在元数据模型、Broker 协作、复制状态机和日志存储，而不是重新实现通用共识协议。 Apache Ratis 官方说明其是 Java 版 Raft 协议实现，可用于需要在多个实例之间复制状态的 Java 应用，并提供可插拔传输、状态机、Raft log 和指标层。([ratis.apache.org][3]) Raft 官方资料说明，Raft 是一种易理解的共识算法，与 Paxos 在容错能力和性能上等价，并将共识问题拆解为相对独立的子问题；共识系统在多数服务器可用时推进，且不会返回错误结果。([raft.github.io][4])

存储核心方面，Stellflow 明确采用自研 `UnifiedLog + LogSegment + OffsetIndex + TimeIndex`，不使用第三方 KV 作为主消息存储，也不把 gRPC 引入主消息读写路径。这个判断非常关键：企业级 MQ 的主事实模型应是顺序追加日志，而不是 KV。KV 适合状态索引或辅助状态，不适合替代消息主日志。

可观测性方面，Stellflow 选择 OpenTelemetry-first，不再以 JMX 作为主暴露方式。该决策符合多语言客户端、云原生平台和统一观测链路的要求。OpenTelemetry 官方指标数据模型说明，OTel Metrics 由协议规范和语义约定组成，可用于导入既有系统、导出到既有系统，并支持从 Span 或 Log 流生成指标。([OpenTelemetry][5]) OTel 还定义了 Metrics 的 Event Model、Timeseries Model 和 Metric Stream Model，并将时间序列实体定义为 metric name、attributes、value type、unit 等元数据组合。([OpenTelemetry][5])

---

## 3. 总体架构模型

一个企业级 MQ 至少应拆分为四层：客户端层、Broker 数据面、Controller 控制面、运维与观测工具链。Stellflow 概要设计中的整体视图也采用 Producer/Admin Client、Consumer、Broker Data Plane、Local Log Storage、Replication Plane、Controller Quorum、Tools/Metrics/Ops 等角色划分。该分层是必要的，因为消息追加、拉取、复制、刷盘属于数据面，Broker 注册、分区分配、Leader 选举、元数据变更属于控制面。

Broker 应负责 Produce、Fetch、ListOffsets、OffsetCommit 等请求处理，本地分区日志、索引、清理与保留策略，以及 Leader/Follower 副本角色。Controller Quorum 应负责元数据日志、Broker 注册、Topic/Partition/Replica 分配、分区 Leader 选举与故障转移。Producer 应负责元数据拉取、记录批聚合、分区路由、重试、超时、幂等与压缩；Consumer 应负责分区拉取、消费位点、Consumer Group、再均衡、背压与提交策略。

---

## 4. 数据面协议设计

Stellflow 的协议规范将数据面定义为“TCP + 自定义二进制请求响应协议 + Produce/Fetch/Metadata/ApiVersions 等语义 API”，并明确该协议适用于 Broker/Client 数据面通信与 Broker 间复制通信，不适用于 Controller/Broker 控制面 gRPC。协议采用长度前缀、统一请求头、统一响应头、显式 `apiKey`、`apiVersion`、`headerVersion`、`correlationId`、错误码与能力协商机制。

该设计的关键不在于“是否像 Kafka”，而在于是否满足企业协议的四个硬要求：第一，跨语言可实现；第二，协议版本可演进；第三，请求响应可关联；第四，灰度升级可协商。Stellflow 的 ADR-0005 明确要求每个协议请求包含 `apiKey` 与 `apiVersion`，Broker 暴露协议版本查询能力，客户端基于 Broker 返回的能力范围选择可用版本，而不是假定服务端支持最新版本。

请求头中 `traceId`、`spanId`、`tenantId`、`quotaKey`、`authContextId`、`trafficClass`、`trafficTag` 的存在是企业级治理能力的体现。它们分别服务于链路追踪、多租户、配额、鉴权上下文、流量分级和实验染色。这里的判断很明确：这些字段不能后补，因为一旦协议发布后再引入治理上下文，兼容成本会明显增大。

---

## 5. Broker 请求处理链路

Stellflow 的 Broker 请求处理链路分为连接建立、网络读事件、请求帧读取与头部解析、协议对象反序列化、入队到 `RequestChannel`、业务线程处理、响应编码、网络线程异步回写八个阶段。该模型避免 I/O 线程承载重业务逻辑，并通过 `SocketServer -> RequestChannel -> BrokerApis -> Domain Service -> Async Response` 形成清晰主链路。

Produce 请求的正确处理流程应包括版本校验、认证、鉴权、Topic/Partition/Leader 校验、消息大小与配额校验、按分区追加到 `ReplicaManager` 与 `UnifiedLog`，再依据 `acks` 与 `min.insync.replicas` 决定立即响应或延迟完成。Fetch 请求则需要区分普通 Consumer 与 Follower Replica，并按高水位或最后稳定偏移量控制可见性。该设计是企业级 MQ 的底线：普通消费者不能读到未达到一致性可见边界的数据，副本复制则需要读取高水位之后但已经落盘的数据。

---

## 6. 存储层设计

Stellflow 存储层详细设计将存储职责限定为“本地日志事实”的维护，不负责网络协议、Topic 元数据分配、ISR 选举或 Consumer Group 协调。核心对象包括 `LogManager`、`UnifiedLog`、`LogSegments`、`LogSegment`、`OffsetIndex`、`TimeIndex`、`TransactionIndex`、`LogCleaner`、`LogRetentionManager` 和 `LogRecoveryService`。

从企业级 MQ 的工程角度看，`UnifiedLog + LogSegment + OffsetIndex + TimeIndex` 是必须优先完成的主干。日志段负责顺序追加，偏移量索引负责 offset 到物理位置的稀疏索引，时间索引用于时间戳到 offset 的定位，恢复逻辑负责启动后重建索引、截断尾部半写入批次并计算 LEO 与恢复位点。Stellflow 文档中提出的“顺序追加、可恢复、可截断、可索引、可复制”五项能力，是比上层 API 更根本的交付标准。

存储层不应把每条消息当成独立文件或独立 KV 项处理。正确模型是按 TopicPartition 维护逻辑日志，由多个段文件组成，每个段包含数据文件、偏移量索引、时间索引、事务索引与恢复辅助文件。写路径必须单分区串行、多分区并行；读路径通过索引定位后顺序读取；恢复流程必须幂等。

---

## 7. Controller 与 Replica 设计

Stellflow 的 Controller 与 Replica 设计将控制面和复制子系统拆开：Controller 负责元数据命令、状态机和变更广播；Replica 负责分区副本运行时、同步和高水位；Storage 负责日志事实落盘。Controller 以追加式元数据日志作为事实来源，元数据变更流程是接收命令、生成记录、追加日志、提交后回放状态机、更新内存视图并广播增量。

Replica 侧的核心是 Leader/Follower 模型、ISR 集合、高水位推进和 Leader Epoch。Follower 通过 `ReplicaFetcherThread` 向 Leader 发送复制 Fetch 请求，Leader 校验 Epoch、分区状态和可读范围后返回数据、高水位和 Leader Epoch；Follower 必要时执行截断，再以 `appendAsFollower` 写入本地日志。

这里最不能妥协的是高水位规则。Stellflow 文档明确要求 Leader 高水位依赖 ISR 内副本最小同步位点，高水位单调不减，高水位推进后触发读可见性更新和延迟请求完成。ISR 变更必须由 Controller 持久化为元数据记录，再反向作用到 Broker 运行时。只靠 Broker 本地内存改 ISR 是不合格的，会造成控制面事实来源分裂。

---

## 8. 元数据发现与扩容

Stellflow 的 ADR-0006 将元数据发现定义为 `bootstrap servers + metadata + 稳定逻辑地址`。客户端通过一组 bootstrap servers 引导，连接任一可达节点后通过 Metadata 请求获取完整集群视图，后续按分区 Leader 地址直连 Broker。Broker 地址应使用稳定域名等逻辑地址，而不是裸 IP；扩容依赖控制面元数据更新与分区迁移，不依赖客户端手工重配所有连接目标。

这个设计是正确的。企业级 MQ 如果把所有数据面流量都压到固定网关或单一入口，会削弱分区级路由能力，并引入吞吐瓶颈。合理做法是客户端只把 bootstrap 当作引导入口，真实读写按元数据中的分区 Leader 直连。这样扩容、迁移、Leader 切换都可以通过元数据刷新完成，而不是要求所有业务应用重启或修改配置。

---

## 9. 高吞吐数据面设计

Stellflow 的数据面性能目标文档将单 Broker 数据面吞吐目标设为 `500 MB/s+`，并指出决定上限的关键不是协议头多几十字节，而是 batch、内存拷贝、顺序 I/O、pipeline、flush 策略和复制窗口。该判断非常准确。企业级 MQ 的吞吐不是靠“换一个 RPC 框架”达成，而是靠端到端字节路径收敛。

高吞吐主路径应是 `Producer Batch -> Client Buffer -> TCP Socket -> Broker Netty Direct Buffer -> Request Decode -> Partition Append -> Log Segment/Page Cache -> Replica Fetch -> Consumer Fetch/Response Write`。Stellflow 文档建议 Producer batch 可从 `256KB - 1MB` 起步，高吞吐场景可到 `1MB - 4MB`，Replica 同步可使用 `4MB - 16MB`。同时，Netty 主路径建议使用 `PooledByteBufAllocator`、`DirectByteBuf`、`CompositeByteBuf` 或 gather write，并避免对大块磁盘数据重新组装为堆内字节数组。

Fetch 与 Replica Fetch 应优先考虑 zero-copy 路径，例如 Java `FileChannel.transferTo` 与 Netty `DefaultFileRegion`。Netty 官方也强调其性能目标包括更高吞吐、更低延迟、更少资源消耗和减少不必要内存拷贝。([netty.io][1])

---

## 10. 可观测性与指标体系

Stellflow 采用 OpenTelemetry-first，并在 ADR-0007 中定义了统一指标命名和标签规范：指标名使用 `stellflow.` 前缀，采用点分风格；标签只保留高价值、低基数维度；Broker、Controller、客户端共享基础语义词汇；禁止在核心指标中引入高基数 `client.id`、`connection.id`、`request.id` 或原始 IP。

指标字典进一步将指标划分为 Broker 网络与请求、Produce/Fetch、存储、复制与高水位、协调器与配额、Controller、Client Producer、Client Consumer 等类别。优先告警指标包括请求延迟、解码错误、刷盘延迟、副本滞后、ISR 缩容、控制器选举、Broker 心跳超时、消费滞后。

这里需要明确：可观测性不是最后接 Prometheus 的“插件”。对于 MQ 这种强状态系统，指标字典必须在实现之前定义，否则后续压测结果不可解释，故障复盘不可复现，跨语言 SDK 的观测语义也会分裂。OpenTelemetry 的 Timeseries Model 将时间序列实体定义为 metric name、attributes、value type、unit，因此 Stellflow 提前控制标签基数是正确的。([OpenTelemetry][5])

---

## 11. 分阶段实现路径

按照当前文档成熟度，Stellflow 的实现顺序应分为五个阶段。

第一阶段是协议与网络骨架：实现 `SocketServer`、`Acceptor`、`Processor`、`RequestChannel`、统一 Request/Response、ApiVersions、Metadata、Produce、Fetch 的最小闭环。Broker 请求链路文档也建议先完成 `SocketServer`、`RequestChannel`、`RequestContext`、协议分发器、`BrokerApis`、Produce/Fetch 主链路和延迟操作。

第二阶段是本地日志存储：实现 `TopicPartition`、`LogConfig`、`AppendInfo`、`FetchDataInfo`、`LogSegment`、`FileRecords`、`OffsetIndex`、`TimeIndex`、`UnifiedLog`、`LogManager`、恢复、检查点和清理后台任务。没有这条链路，Broker 只是网络转发器，不是消息队列。

第三阶段是复制与高水位：实现 `ReplicaManager`、`Partition`、`ReplicaFetcherManager`、`ReplicaFetcherThread`、ISR 管理、高水位推进、Leader Epoch 校验与截断。该阶段之后才能讨论 `acks=all`、副本一致性和故障切换。

第四阶段是 Controller Quorum 与元数据日志：接入 Apache Ratis，完成 Broker 注册、心跳、围栏、Topic/Partition 元数据、Leader 选举、元数据增量广播、快照与恢复。Apache Ratis 提供可插拔状态机和 Raft log，因此可以作为控制面元数据一致性的基础设施。([ratis.apache.org][3])

第五阶段是企业治理：补齐 ACL、配额、Consumer Group、OffsetCommit、事务、幂等、多语言 SDK、OTel 指标、Trace、日志审计、压测矩阵和运维工具。这个阶段不应提前覆盖主链路，因为在日志、复制、控制面未稳定前引入复杂治理，只会增加重构成本。

---

## 12. 结论

自研企业级消息队列的本质是自研一个可复制、可恢复、可观测、可治理的分布式日志系统。以 Stellflow 当前文档为基础，合理的架构结论是：数据面采用自定义二进制协议与 Netty，控制面采用 gRPC，Controller Quorum 采用 Apache Ratis/Raft，消息主存储采用自研日志段与索引，复制围绕 Leader/Follower、ISR、高水位和 Leader Epoch 设计，可观测性采用 OpenTelemetry-first，并在协议早期植入 trace、tenant、quota、auth、traffic class/tag 等治理字段。

最终判断很明确：Stellflow 当前文档方向是对的，且比“从零写一个简单 MQ”更接近企业级中间件的真实问题域。后续成败不取决于概念是否完整，而取决于能否按“协议闭环 → 日志存储 → 复制高水位 → Controller Quorum → 治理与观测 → 压测矩阵”的顺序落地。跳过存储和复制去做上层功能，是错误路线；先把 `UnifiedLog + Protocol + Replica + MetadataLog + OTel` 五条主链路钉牢，才是自研企业级消息队列的正确实现路径。

[1]: https://netty.io/ "Netty: Home"
[2]: https://grpc.io/docs/what-is-grpc/core-concepts/ "Core concepts, architecture and lifecycle | gRPC"
[3]: https://ratis.apache.org/ "Apache Ratis"
[4]: https://raft.github.io/ "Raft Consensus Algorithm"
[5]: https://opentelemetry.io/docs/specs/otel/metrics/data-model/ "Metrics Data Model | OpenTelemetry"
