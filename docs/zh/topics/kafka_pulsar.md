---
title: "云原生时代消息中间件架构演进研究：以 Apache Kafka 与 Apache Pulsar 为中心"
category: "消息中间件"
summary: "以 Apache Kafka 与 Apache Pulsar 为中心，分析云原生时代消息中间件的架构演进、状态组织、存储分离、多租户、容器化和有状态系统设计边界。"
tags:
  - "Kafka"
  - "Pulsar"
  - "消息队列"
  - "云原生"
  - "有状态中间件"
readingDirection: "适合在比较 Kafka 与 Pulsar 架构、评估中间件是否应无状态化、容器化部署或采用存储分离方案时阅读。"
outline: deep
---

# 云原生时代消息中间件架构演进研究：以 Apache Kafka 与 Apache Pulsar 为中心

## 概览

以 Apache Kafka 与 Apache Pulsar 为中心，分析云原生时代消息中间件的架构演进、状态组织、存储分离、多租户、容器化和有状态系统设计边界。

## 摘要

Apache Kafka 与 Apache Pulsar 均属于分布式消息与事件流平台。Kafka 官方将其定义为开源分布式事件流平台，并强调其在高性能数据管道、流式分析、数据集成和关键业务应用中的使用规模；Kafka 官网同时披露，超过 80% 的 Fortune 100 企业使用 Kafka，且其用户覆盖数千家组织。由此，在公开官方资料所能反映的生态规模、企业采用度和工具链成熟度上，Kafka 仍是当前消息队列与事件流领域的主流平台之一。([Apache Kafka][1])

Pulsar 官方将其定义为“面向云构建的开源分布式消息与流平台”，并强调其原生支持多租户、多集群、跨地域复制、多种订阅模式、BookKeeper 持久化存储、Tiered Storage、Pulsar Functions、Pulsar IO 和事务能力。Pulsar 的出现并不是对 Kafka 已有能力的简单重复，而是围绕“计算与存储分离”“多租户”“大规模 Topic”“跨地域复制”和“云存储分层”形成另一种架构选择。([Pulsar][2])

本文以 Kafka 与 Pulsar 的架构差异为切入点，分析云原生时代是否应全面采用无状态设计，以及中间件是否都应容器化部署。结论是：云原生并不等价于“所有组件都无状态”，也不等价于“所有状态都外置到数据库”。Kubernetes 官方文档明确提供 StatefulSet 与 PersistentVolume 机制，用于管理需要稳定网络标识、稳定持久化存储、顺序部署和有序滚动更新的有状态应用。([Kubernetes][3])

## 关键词

Apache Kafka；Apache Pulsar；消息队列；事件流；云原生；无状态架构；有状态中间件；容器化；存储分离；注册中心；配置中心

---

## 一、引言

云原生技术的核心目标不是消除状态，而是在动态环境中构建可扩展、弹性、可管理、可观测的系统。CNCF 对云原生的定义强调，容器、服务网格、微服务、不可变基础设施和声明式 API 是这一方法的代表性技术，它们共同服务于松耦合、韧性、可管理和可观测的系统目标。([CNCF][4])

因此，“云原生之后是否都应该选择无状态设计”不能被简化为二元判断。更准确的命题是：系统应当区分业务逻辑状态、元数据状态、持久消息状态、缓存状态和协调状态，并根据状态的强一致性、持久性、访问模式、恢复成本和可迁移性选择不同的部署与存储模型。

Kafka 与 Pulsar 正好代表了两种典型路径。Kafka 将 Broker、分区副本、日志存储、复制协议和元数据管理整合为一个面向事件流的分布式系统；Pulsar 则将 Broker 服务层与 BookKeeper 存储层分离，并使用元数据存储支撑集群管理。两者都不是“纯无状态系统”，但它们对状态的组织方式不同。

---

## 二、Kafka 与 Pulsar 的基本定位

### 2.1 Kafka 的定位：事件流平台与主流生态

Kafka 官方描述其为开源分布式事件流平台，应用于高性能数据管道、流式分析、数据集成和关键业务场景。Kafka 官网还列出高吞吐、可扩展、永久存储、高可用、内置流处理和 Kafka Connect 生态等核心能力。([Apache Kafka][1])

从官方公开资料看，Kafka 具备明显的主流生态特征：其官网披露超过 80% 的 Fortune 100 企业使用 Kafka，并称 Kafka 被数千家组织使用，拥有大规模社区和生态工具。该事实不能直接等同于“所有场景 Kafka 都优于 Pulsar”，但足以说明 Kafka 在事件流与消息中间件领域具有事实上的主流地位。([Apache Kafka][1])

Kafka 的核心抽象是 Topic、Partition、Replica 和 Consumer Group。Kafka 设计文档说明，复制单位是 Topic Partition；正常情况下，一个分区有一个 Leader 和零个或多个 Follower；写入进入分区 Leader，读取可以从 Leader 或 Follower 进行；副本总数构成 replication factor。([Apache Kafka][5])

### 2.2 Pulsar 的定位：云原生消息与流平台

Pulsar 官方将其定位为“Cloud-Native, Distributed Messaging and Streaming”，即云原生分布式消息与流平台。Pulsar 官方概述列出的能力包括多集群实例、跨集群 Geo-replication、低发布与端到端延迟、超过百万 Topic 的可扩展性、多语言客户端、多种订阅类型、BookKeeper 提供的持久化消息存储、Pulsar Functions、Pulsar IO、Tiered Storage 和事务能力。([Pulsar][2])

Pulsar 的一个关键架构事实是 Broker 与 BookKeeper Bookie 的分工。Pulsar 文档说明，消息数据和 Consumer Cursor 均可持久化存储在 BookKeeper 中；BookKeeper Ledger 是一个 append-only 数据结构，一个 Ledger 被分配到多个 Bookie，Ledger Entry 会复制到多个 Bookie。([Pulsar][6])

因此，Pulsar 的设计重点不是“去掉存储”，而是将服务入口、协议处理、Topic 服务、消费位置与持久化日志组织为分层架构。Broker 层更接近服务层，BookKeeper 层承担持久日志存储职责，元数据存储承担集群元数据职责。

---

## 三、既然已有 Kafka，为什么还需要 Pulsar

Pulsar 的存在基础不是 Kafka 不可用，而是 Kafka 的架构选择并不覆盖所有部署目标。两者面对的是同一大类问题，但优化方向不同。

第一，Pulsar 将 Broker 服务层和 BookKeeper 存储层分离。Pulsar 文档说明，Ledger 被分配到多个 BookKeeper Bookie，且 Entry 会复制到多个 Bookie；Managed Ledger 则在 BookKeeper Ledger 之上为单个 Topic 提供存储抽象。([Pulsar][6]) 这种结构使 Broker 失效与存储副本失效的处理路径不同于 Kafka Broker 本地日志副本模型。

第二，Pulsar 原生强调多租户。Pulsar 文档说明，Pulsar 从一开始就是多租户系统，Tenant 可以跨集群分布，并且认证、授权、存储配额、消息 TTL 和隔离策略可以在 Tenant 级别管理。([Pulsar][7]) 这使 Pulsar 更接近云服务化、多租户平台场景中的资源隔离模型。

第三，Pulsar 官方明确列出多集群、跨地域复制和百万级 Topic 扩展能力。Pulsar 概述文档写明其支持一个 Pulsar Instance 中的多个集群，并支持跨集群 Geo-replication，同时列出“Seamless scalability to over a million topics”。([Pulsar][8])

第四，Pulsar 的 Tiered Storage 与分段式日志架构相关。Pulsar Tiered Storage 文档说明，Topic 由 Managed Ledger 支撑，日志由有序 Segment 组成，Pulsar 只写入最后一个 Segment，历史 Segment 被封存后不可变，并可被复制到长期存储。([Pulsar][9])

因此，“已有 Kafka 为什么还要 Pulsar”的事实性回答是：Kafka 与 Pulsar 的核心差异不在于是否都能收发消息，而在于两者对消息持久化、服务层、存储层、多租户、跨地域复制和冷数据分层的架构组织不同。Kafka 是生态规模更大的主流事件流平台；Pulsar 是围绕云原生、多租户、存储分离和大规模 Topic 管理形成的另一种架构路线。

---

## 四、云原生是否意味着中间件都应无状态化

云原生并不要求所有应用都无状态。Kubernetes 官方文档明确区分 Deployment/ReplicaSet 更适合无状态副本，而 StatefulSet 适合需要稳定网络标识、稳定持久化存储、有序部署和有序滚动更新的应用。([Kubernetes][3])

Kubernetes 还通过 PersistentVolume 抽象将“存储如何提供”和“应用如何消费存储”解耦。官方文档说明，管理存储是不同于管理计算实例的问题；PersistentVolume 是集群中的一块存储资源，生命周期独立于使用它的单个 Pod。([Kubernetes][10])

这说明云原生平台并没有否定有状态系统，而是给有状态系统提供了声明式编排、稳定身份、稳定存储和生命周期管理机制。由此可以得出一个工程结论：中间件是否无状态化，不应由“是否云原生”直接决定，而应由该中间件所管理的状态性质决定。

对于 Kafka 这类事件流平台，消息日志本身是产品语义的一部分。Kafka 官网将永久存储列为核心能力，说明 Kafka 可以在分布式、持久、容错集群中安全存储数据流。([Apache Kafka][1]) 因此，将 Kafka 简化成“只保留业务逻辑，存储全部交给外部数据库”，会改变其核心架构边界。

对于 Pulsar，虽然 Broker 层更服务化，但 Pulsar 并没有消除存储，而是将持久化消息存储交给 BookKeeper，并通过 Tiered Storage 将老数据转移到更便宜的长期存储。([Pulsar][6]) 这也说明“服务层无状态化”与“系统整体无状态化”不是同一个概念。

---

## 五、自建本地存储与自研 Raft 在云原生之后是否仍有必要

Kafka 在新版本中引入 KRaft 模式，用 KRaft Controller Quorum 作为元数据系统，替代传统 ZooKeeper 模式。Kafka 官方文档将 ZK mode 定义为使用 ZooKeeper 作为元数据系统的 Kafka Broker，将 KRaft mode 定义为使用 KRaft Controller Quorum 作为元数据系统的 Kafka Broker。([Apache Kafka][11])

这表明，在 Kafka 这类系统中，元数据一致性不是外围功能，而是集群控制面的核心组成部分。对于消息队列、注册中心、配置中心、分布式锁、服务发现、分布式日志等系统，是否自建一致性协议或本地存储，取决于状态是否构成产品语义本身。

可以分为三类：

| 类型            | 状态性质                               | 是否需要自建强状态层       |
| ------------- | ---------------------------------- | ---------------- |
| Kafka 这类事件流平台 | 消息日志、分区副本、Offset、元数据直接构成产品语义       | 通常需要             |
| 注册中心 / 配置中心   | 注册数据、配置数据、变更通知是核心语义，但数据规模通常远小于消息日志 | 可自建，也可外置 DB / KV |
| 普通业务中台服务      | 状态主要是业务数据，服务本身负责计算与访问控制            | 通常不需要自建一致性存储     |

因此，“全面云原生之后是否还有必要自建本地存储、自己写 Raft”的客观答案是：如果系统的核心能力依赖日志复制、一致性元数据、快速故障切换和本地顺序写入，那么仍然存在必要性；如果系统的状态只是普通业务数据或低频元数据，则可优先复用成熟数据库、云存储或托管 KV 系统。

---

## 六、存储外置是否会把可用性全部压在存储组件上

将中间件设计为“服务层无状态 + 存储层外置”会带来明确收益：服务层扩缩容更简单，节点替换成本更低，发布回滚更容易，计算资源和存储资源可以分别扩展。CNCF 云原生定义中提到的容器、微服务、不可变基础设施和声明式 API，正是服务于可扩展、可管理和自动化运维。([CNCF][4])

但该设计不会消除可用性问题，只会改变可用性边界。原来由中间件自身承担的复制、一致性、持久化、恢复和故障切换能力，会转移到外部存储系统。Pulsar 是一个典型例子：Broker 层与 BookKeeper 层分离后，持久化语义依赖 BookKeeper；Pulsar 文档明确说明持久化消息存储由 BookKeeper 提供。([Pulsar][8])

因此，存储外置是否合理，取决于以下条件是否成立：

1. 外部存储的可用性、持久性和一致性等级不低于中间件语义要求。
2. 中间件在存储异常时有明确降级模式，例如只读、缓存读、拒绝写入、延迟写入或快速失败。
3. 存储故障不会导致服务层无限重试、雪崩或错误传播。
4. 服务层恢复后可以从存储或日志中恢复完整状态。
5. 运维体系可以分别观测服务层、存储层和二者之间的调用链路。

所以，“非存储组件以外的中间件是否都应该容器化，并将业务逻辑和实际存储分开”的结论应是条件成立时可行，而非无条件成立。Kubernetes 官方文档同时提供无状态工作负载与 StatefulSet，这意味着容器化并不排斥有状态部署；容器化解决的是交付、编排和生命周期管理问题，而不是自动消除状态管理复杂度。([Kubernetes][3])

---

## 七、配置中心、注册中心采用“全量内存 + DB 持久化”的折中方案是否可行

配置中心和注册中心与 Kafka/Pulsar 的差异在于：它们通常不以大规模消息日志作为核心存储对象，而是管理配置项、服务实例、路由规则、权重、标签、健康状态和版本变更。此类数据一般具备以下特征：数据量相对有限，读多写少，读路径对低延迟敏感，写路径可以通过版本号、事件通知和缓存刷新控制一致性。

在这种场景下，“全量内存容器化部署 + DB 持久化”是一种可行架构，但它必须满足若干前提：

第一，服务启动时必须能够从 DB 或快照加载完整数据。否则容器重启后无法恢复服务发现或配置查询能力。

第二，运行时读路径应主要访问内存，DB 主要承担持久化、审计、版本记录和灾难恢复职责。这样 DB 对读路径是弱依赖，而不是每次服务发现都访问 DB。

第三，写路径应具备版本控制和事件传播机制，例如基于版本号、递增变更日志、数据库事务、消息通知或 Watch 机制刷新各节点内存。

第四，DB 故障时系统应有定义明确的行为。常见方式是继续提供已有内存快照的只读服务，同时拒绝或延迟新增注册、注销、配置修改等写操作。

第五，多实例部署时必须处理缓存一致性问题。仅有 DB 持久化不足以保证所有节点内存视图实时一致，还需要变更广播、拉取补偿、定期校验或基于版本的最终一致性机制。

因此，该方案在配置中心、注册中心这类“元数据规模可控、读多写少、可接受短时间最终一致”的系统上成立；但不适合直接替代 Kafka/Pulsar 这类以高吞吐持久日志、分区副本、消费位点和顺序写入为核心语义的消息系统。

---

## 八、面向中间件设计的架构归纳

云原生时代的中间件设计可以归纳为四种模式：

| 模式              | 代表系统                   | 部署方式                       | 存储方式                                         | 适用场景                   |
| --------------- | ---------------------- | -------------------------- | -------------------------------------------- | ---------------------- |
| Broker 与本地日志一体化 | Kafka                  | 可裸机、VM、容器、StatefulSet      | Broker 本地日志副本 + 元数据系统                        | 高吞吐事件流、日志持久化、强顺序语义     |
| 服务层与存储层分离       | Pulsar                 | Broker 可服务化，BookKeeper 有状态 | BookKeeper + Metadata Store + Tiered Storage | 多租户、大规模 Topic、跨地域、冷热分层 |
| 全量内存 + DB 持久化   | 配置中心、注册中心              | Deployment 容器化             | DB 持久化，内存读                                   | 读多写少、数据规模可控、可只读降级      |
| 完全无状态业务中间层      | API Gateway、控制台、治理 API | Deployment / HPA           | 外部 DB / KV / MQ                              | 业务逻辑、控制面、管理面           |

该分类说明，中间件设计不应统一套用“无状态化”原则，而应按照状态是否属于核心语义进行拆分。消息日志、消费位点、分区副本和一致性元数据通常属于核心语义；配置、规则、实例列表等元数据可以在满足一致性与恢复约束时外置到 DB，并由内存缓存承担读路径。

---

## 九、结论

从公开官方资料看，Kafka 仍是消息队列与事件流领域的主流平台之一，其依据包括官方披露的大规模企业使用、成熟生态、高吞吐、永久存储、高可用和流处理能力。([Apache Kafka][1]) Pulsar 的价值不在于替代 Kafka 的所有场景，而在于提供另一种云原生消息与流架构：Broker 与 BookKeeper 分离，多租户、多集群、Geo-replication、百万级 Topic、Tiered Storage 和事务能力构成其差异化基础。([Pulsar][6])

云原生不等于所有组件无状态。Kubernetes 官方文档明确支持 StatefulSet 和 PersistentVolume，用于处理需要稳定身份、稳定存储和有序生命周期的有状态应用。([Kubernetes][3]) 因此，云原生时代更合理的设计原则不是“消灭状态”，而是“识别状态、隔离状态、声明式管理状态，并按状态性质选择部署模型”。

对于 Kafka、Pulsar 这类消息系统，持久日志和消费状态是核心产品语义，不能简单外包给普通数据库。对于配置中心、注册中心这类读多写少、元数据规模可控的系统，“全量内存 + DB 持久化 + 变更通知 + 只读降级”是可行折中方案。该方案可以弱化 DB 对读路径的依赖，但不能取消对持久化、版本控制、变更传播和故障恢复的设计要求。

最终，容器化应被视为交付与编排方式，存储分离应被视为架构分层手段，无状态化应被视为服务层设计目标，而不是所有中间件系统的绝对原则。对于中间件架构，判断标准应始终回到状态语义：状态是否是产品核心能力、是否需要强一致、是否需要顺序写入、是否需要持久日志、是否可以从外部系统恢复，以及故障时是否允许降级。

[1]: https://kafka.apache.org/ "Apache Kafka"
[2]: https://pulsar.apache.org/?utm_source=chatgpt.com "Apache Pulsar"
[3]: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/ "StatefulSets | Kubernetes"
[4]: https://www.cncf.io/about/who-we-are/ "Who We Are | CNCF"
[5]: https://kafka.apache.org/42/design/design/?utm_source=chatgpt.com "Design | Apache Kafka"
[6]: https://pulsar.apache.org/docs/2.10.x/concepts-architecture-overview/ "Architecture Overview | Apache Pulsar"
[7]: https://pulsar.apache.org/docs/2.6.0/concepts-multi-tenancy/?utm_source=chatgpt.com "Multi Tenancy - Apache Pulsar"
[8]: https://pulsar.apache.org/docs/next/concepts-overview/ "Pulsar Overview | Apache Pulsar"
[9]: https://pulsar.apache.org/docs/4.2.x/tiered-storage-overview/?utm_source=chatgpt.com "Overview of tiered storage | Apache Pulsar"
[10]: https://kubernetes.io/docs/concepts/storage/persistent-volumes/ "Persistent Volumes | Kubernetes"
[11]: https://kafka.apache.org/35/operations/kraft/ "KRaft | Apache Kafka"
