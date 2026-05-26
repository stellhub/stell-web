---
title: 分布式链路追踪的发展历程
category: 可观测性
summary: 梳理分布式链路追踪从 Dapper、EagleEye、Zipkin、Jaeger、SkyWalking 到 OpenTelemetry 与 Tempo 的演进路径，说明其如何从调用链可视化发展为云原生可观测性标准。
tags:
  - 分布式追踪
  - OpenTelemetry
  - Jaeger
  - SkyWalking
  - Tempo
readingDirection: 适合在理解链路追踪历史、评估可观测性架构、规划 OpenTelemetry 接入或比较 Zipkin、Jaeger、SkyWalking、Tempo 等系统时阅读。
outline: deep
---

# 分布式链路追踪（Distributed Tracing）的发展历程：从调用链可视化到云原生可观测性标准

## 摘要

分布式链路追踪是分布式系统、微服务架构和云原生系统中用于还原请求调用路径、定位延迟来源、分析服务依赖关系的重要技术。其发展路径大体经历了四个阶段：2010 年以前，以 Google Dapper、淘宝 EagleEye 等大型互联网公司内部系统为代表，链路追踪用于解决大规模分布式系统的“黑盒”问题；2012 年至 2016 年，以 Zipkin、Jaeger 等开源系统为代表，链路追踪形成了采集、存储、查询、展示分层架构；2015 年至 2019 年，以 SkyWalking 为代表，基于 Agent 的自动埋点降低了业务代码侵入成本；2019 年以后，OpenTracing 与 OpenCensus 合并为 OpenTelemetry，链路追踪进入 Metrics、Logs、Traces 统一采集与处理的可观测性时代。本文依据 Google、CNCF、OpenTelemetry、Jaeger、Zipkin、Apache SkyWalking 与 Grafana Tempo 官方资料，对分布式链路追踪的发展历程、代表系统和技术范式进行梳理。

**关键词**：分布式链路追踪；Dapper；Zipkin；Jaeger；SkyWalking；OpenTelemetry；Tempo；可观测性

---

## 一、引言

分布式链路追踪的产生源于分布式系统规模扩大后出现的可诊断性问题。一个用户请求在现代服务系统中通常会经过网关、业务服务、RPC 服务、缓存、数据库、消息队列以及第三方服务。单个服务的日志、指标或错误码只能描述局部现象，无法直接还原一次请求在多个服务之间的完整传播路径。Google 在 Dapper 论文中明确指出，在跨多种编程语言、跨数千台机器和多个物理设施的大规模系统中，帮助理解系统行为和分析性能问题的工具具有重要价值；Dapper 的目标是以低开销、应用级透明和大规模部署的方式提供分布式系统追踪能力。([Google Research][1])

从技术形态看，分布式链路追踪并不是单一工具，而是一套围绕 Trace、Span、Context Propagation、Sampling、Storage、Query、Visualization 建立起来的诊断体系。Zipkin 官方将自身定义为分布式追踪系统，用于收集服务架构中排查延迟问题所需的时序数据，并提供采集与查询能力；Jaeger 官方将其定位为分布式追踪平台，用于监控和排查分布式工作流、识别性能瓶颈、定位根因以及分析服务依赖。([Zipkin][2])

---

## 二、第一阶段：萌芽与探索期（2010 年以前）

### 2.1 背景：大型互联网系统的“黑盒”困境

在 2010 年以前，分布式链路追踪主要存在于大型互联网公司的内部基础设施中。Google 的 Dapper 是这一阶段的代表。Dapper 论文发表时，Google 已经在生产环境中建设并使用该系统超过两年；Google Research 页面说明，Dapper 最初是一个自包含的追踪工具，之后演进为监控平台，并支撑了设计者最初未预期的多种分析工具。([谷歌研究][3])

这一阶段的核心问题是：系统已经分布式化，但诊断工具仍然以单机日志、局部指标和人工排查为主。当一次请求跨越多个服务、线程、机器、机房与语言运行时时，仅依靠单点日志难以回答三个基础问题：请求经过了哪些服务、每个服务耗时多少、失败或慢调用发生在哪一段。Dapper 的设计选择包括采样、在少量公共库中做埋点、应用级透明性和低开销部署，这些选择说明早期追踪系统的关键约束不是“是否能记录全部信息”，而是在大规模生产环境中如何以可接受成本持续记录足够有诊断价值的信息。([谷歌研究][3])

### 2.2 Google Dapper 的技术意义

Dapper 的核心贡献在于提出并验证了后来分布式追踪系统长期沿用的基础模型：一次请求对应一个 Trace，请求中的每个关键调用片段对应一个 Span，通过上下文传播把多个 Span 组织为父子关系或因果关系，最终形成可查询、可聚合、可展示的调用树。Dapper 论文强调其目标包括低开销、应用级透明和普遍部署；这些目标后来成为开源追踪系统和商业 APM 系统的重要设计依据。([Google Research][1])

从工程范式看，Dapper 把链路追踪从“日志搜索技巧”推进为“基础设施能力”。它不是要求每个业务研发手工在每段代码中打印日志，而是通过公共通信库、采样和统一数据模型，将分布式调用关系沉淀为平台能力。这一思路影响了后续 Zipkin、Jaeger、SkyWalking、OpenTelemetry 等系统。

### 2.3 淘宝 EagleEye 的位置

国内大型互联网公司也在相近时期遇到类似问题。公开演讲资料显示，淘宝 EagleEye 被描述为基于日志的分布式调用跟踪系统，用于调用链跟踪，并与 Google Dapper 思路存在关联。由于 EagleEye 主要是企业内部系统，公开、可验证的官方工程文档有限，因此在严谨表述上应将其定位为“中国大型互联网公司内部链路追踪实践的早期代表”，而不宜把其等同于开源标准或公开规范。([docs.huihoo.com][4])

这一阶段的历史结论是：分布式链路追踪首先不是由开源社区发明，而是由大规模互联网生产系统的可诊断性需求推动产生。其初始目标是解决分布式调用链不可见、故障定位依赖经验、性能瓶颈难以归因的问题。

---

## 三、第二阶段：百花齐放与组件化期（2012 年—2016 年）

### 3.1 背景：Dapper 模式公开后的开源复制

Dapper 论文公开后，开源社区开始围绕类似模型实现分布式追踪系统。这个阶段与微服务架构的扩张同步发生：服务数量增加、RPC 调用链变长、团队边界变多，单体时代的日志排查方式无法覆盖跨服务调用路径。分布式追踪逐步从企业内部基础设施走向开源工具链。

Zipkin 是这一阶段的关键开源项目。Zipkin 官方说明其功能包括收集和查询追踪数据，应用需要通过 tracer 或 instrumentation library 上报追踪数据，数据可以通过 HTTP、Kafka 等方式上报，UI 数据可以存储在内存中，也可以持久化到 Cassandra 或 Elasticsearch 等后端。([Zipkin][2])

### 3.2 Zipkin：开源链路追踪的基本架构成型

Zipkin 的重要性不只在于“能追踪”，而在于它把链路追踪拆成了较清晰的组件边界：客户端埋点或 tracer 负责生成数据，collector 负责接收数据，storage 负责保存数据，query service 和 UI 负责检索与展示。Zipkin 官方文档对采集、查询、存储、UI、依赖图等能力的描述，体现了开源链路追踪系统的基本架构已经形成。([Zipkin][2])

这一阶段的典型数据流可以概括为：

```text
Application / Library Instrumentation
        ↓
Reporter / Tracer
        ↓
Collector
        ↓
Storage
        ↓
Query API
        ↓
Web UI / Dependency Graph
```

这个分层架构对后续系统影响很大。Jaeger、SkyWalking、OpenTelemetry Collector + Backend 的方案，本质上都延续了“数据生成、数据接收、数据处理、数据存储、数据查询、数据展示”分离的思路。

### 3.3 Jaeger：面向微服务生产环境的追踪平台

Jaeger 是这一阶段后半段的重要代表。Jaeger 官方文档说明，Jaeger 是 Uber Technologies 于 2016 年开源的分布式追踪平台，后捐赠给 CNCF，并成为 CNCF 毕业项目；其用途包括监控和排查分布式工作流、识别性能瓶颈、定位根因和分析服务依赖。([Jaeger][5])

CNCF 项目页面显示，Jaeger 于 2017 年 9 月 13 日被 CNCF 接收为孵化项目，并于 2019 年 10 月 31 日进入毕业级别。这个时间点说明 Jaeger 并不是一次性工具，而是在云原生生态中获得了项目治理、生产采用和社区成熟度验证的追踪平台。([CNCF][6])

从架构上看，Jaeger 在 Zipkin 基础范式上强化了微服务生产环境需要的能力。Jaeger 官方文档列出的功能包括 OpenTracing 启发的数据模型、OpenTelemetry 兼容、多种内置存储后端、Kafka 中间缓冲、服务依赖图和自适应采样。([Jaeger][5])

这一阶段可以概括为“组件化期”：链路追踪从论文模型和企业内部系统，演进为开源社区可部署、可替换存储、可查询、可展示的组件化平台。Zipkin 确立了开源链路追踪的基本工程形态，Jaeger 则进一步把该形态推进到面向微服务生产环境的追踪平台。

---

## 四、第三阶段：无侵入与生态爆发期（2015 年—2019 年）

### 4.1 背景：手动埋点的推广成本

随着微服务规模扩大，传统手动埋点方式暴露出明显治理成本。手动埋点要求业务研发在入口、出口、RPC、数据库、缓存、消息队列等位置显式接入 SDK 或添加埋点代码；在服务数量、语言栈、框架版本持续增加的情况下，埋点一致性、升级成本和覆盖率都难以保证。

SkyWalking 是这一阶段的典型代表。Apache SkyWalking 官方文档将其定义为用于收集、分析、聚合和可视化服务及云原生基础设施数据的开源可观测性平台，能力包括分布式追踪、服务网格遥测分析、指标聚合、告警和可视化。([Apache SkyWalking][7])

### 4.2 SkyWalking：以 Agent 为中心的自动埋点体系

SkyWalking 的关键技术路线是 Agent 自动埋点。SkyWalking 官方关于 Service Auto Instrument Agent 的文档指出，自动埋点 Agent 是语言原生 Agent 的一个子集，通常基于虚拟机语言特性；对最终用户而言，多数情况下不需要修改业务代码，但代码实际上会被 Agent 在运行时修改，即 runtime code manipulation，例如 Java 通过 `javaagent premain` 动态加入埋点代码。([Apache SkyWalking][8])

这说明“无侵入”并不等于“没有代码变化”，而是指业务源代码通常无需改动。实际机制是 Agent 在运行时对已知框架或类库进行增强，包括 HTTP Server、RPC Client、数据库驱动、消息队列客户端等边界位置，从而自动生成 Span、传播 Trace Context、采集耗时与状态信息。SkyWalking 官方同时说明，自动埋点存在限制，例如通常只适用于特定框架或类库，跨线程操作并不总是天然支持。([Apache SkyWalking][8])

### 4.3 SkyWalking 的架构意义

SkyWalking 的意义不只是“减少业务改代码”，而是把链路追踪从 tracing backend 推进为 APM 与可观测性平台。Apache SkyWalking 官方首页说明，SkyWalking 面向云原生，收集、分析、聚合和可视化来自服务与云原生基础设施的遥测数据，覆盖分布式追踪、指标、日志、性能剖析和告警，并支持多语言 Agent 与 Kubernetes 上的 eBPF。([Apache SkyWalking][9])

与 Zipkin、Jaeger 相比，SkyWalking 更强调端到端应用性能监控、服务拓扑、Agent 插件生态和开箱即用的分析能力。其典型链路可以概括为：

```text
Business Service
  + SkyWalking Agent
        ↓
OAP Server
        ↓
Storage Backend
        ↓
SkyWalking UI / Topology / Metrics / Trace / Alarm
```

这一阶段的历史结论是：链路追踪的主要矛盾从“有没有追踪系统”转向“如何让足够多的服务低成本、稳定、一致地接入追踪系统”。Agent 自动埋点技术成为解决规模化接入问题的重要路径，SkyWalking 则是该路径在开源生态中的代表系统。

---

## 五、第四阶段：大一统与可观测性时代（2019 年至今）

### 5.1 背景：Trace 单点能力不足与标准割裂

2019 年以后，链路追踪进入可观测性时代。这个阶段有两个基础事实。第一，单独观察 Trace 不足以完整描述系统状态。Trace 可以回答一次请求经过了哪里、每一段耗时多少，但容量、吞吐、错误率、资源使用率、日志上下文等仍然需要 Metrics 和 Logs 补充。第二，OpenTracing 与 OpenCensus 等标准并存，造成用户和厂商在 API、SDK、数据模型和后端适配上的割裂。

Google Open Source Blog 在 2019 年 5 月 21 日发布的文章说明，OpenCensus 和 OpenTracing 合并为一个新项目 OpenTelemetry，目标是结合两个项目的优势，并提供平滑迁移体验；该文章同时说明 OpenTelemetry 成为 CNCF 项目。([Google Open Source Blog][10])

OpenTelemetry 官方首页将其定义为面向云原生软件的开源可观测性框架，提供统一的 API、库、Agent 和 Collector 服务，用于捕获分布式追踪和指标；同时说明 OpenTelemetry 建立在 OpenTracing 与 OpenCensus 多年经验之上，并融合社区实践。([OpenTelemetry][11])

### 5.2 OpenTelemetry：从 Tracing 工具到遥测标准

OpenTelemetry 的关键变化在于角色定位。它不是单纯的 Trace UI，也不是单一存储系统，而是遥测数据的生成、采集、处理和导出标准。CNCF 在 2024 年的 OpenTelemetry 认证文章中说明，OTel 是用于收集、处理和导出 traces、metrics、logs 等遥测数据的开源可观测性框架，并指出其于 2019 年 5 月 7 日被 CNCF 接收、2021 年 8 月 26 日进入孵化阶段，且是 Kubernetes 之后第二活跃的 CNCF 项目。([CNCF][12])

截至 2026 年 5 月 21 日，CNCF 宣布 OpenTelemetry 毕业，并称其为用于标准化 metrics、logs、traces 采集、处理和导出的厂商中立开源可观测性框架；CNCF 同时说明该里程碑反映了广泛生产采用和稳定的厂商中立可观测性标准。([CNCF][13])

OpenTelemetry Collector 是该体系中的关键组件。官方文档说明，Collector 提供厂商无关的方式来接收、处理和导出遥测数据，减少运行和维护多个 Agent 或 Collector 的需要，并支持 Jaeger、Prometheus、Fluent Bit 等开源可观测性数据格式发送到一个或多个开源或商业后端。Collector 的目标还包括可用性、性能、可观测性、可扩展性和统一性，其中统一性明确指单一代码库可作为 Agent 或 Collector 部署，并支持 traces、metrics 和 logs。([OpenTelemetry][14])

典型 OpenTelemetry 数据链路如下：

```text
Application
  + OTel SDK / Auto Instrumentation
        ↓ OTLP
OpenTelemetry Collector
  + receivers
  + processors
  + exporters
        ↓
Tracing Backend / Metrics Backend / Logging Backend
        ↓
Grafana / Alerting / Analysis
```

这一架构把“埋点标准”和“后端系统”解耦。应用侧只需要遵循 OpenTelemetry API、SDK、语义约定和 OTLP 协议，后端可以选择 Jaeger、Tempo、Prometheus、Loki、商业 APM 或企业自研系统。

### 5.3 Tempo：OpenTelemetry 时代的追踪后端实现

在 OpenTelemetry 解决采集和标准化问题之后，Trace 数据仍然需要后端系统存储、查询和展示。Grafana Tempo 是 OpenTelemetry 时代常见的追踪后端之一。Grafana Tempo 官方文档将其定义为开源、易用、高规模的分布式追踪后端，支持搜索 traces、从 spans 生成 metrics，并将 tracing data 与 logs、metrics 关联。([Grafana Labs][15])

Tempo 的核心工程取向是降低大规模 Trace 存储和查询的复杂度。官方文档说明，Tempo 只需要对象存储即可运行，并与 Grafana、Mimir、Prometheus、Loki 深度集成；同时支持 Jaeger、Zipkin 和 OpenTelemetry 等开源 tracing 协议。([Grafana Labs][15])

Tempo 架构文档进一步说明，Tempo 使用对象存储保存所有 tracing 数据，支持 S3、GCS、Azure Storage 等对象存储 API；查询路径上，Querier 会在 ingesters 和后端存储中查找指定 Trace ID，并使用 bloom filters 和 indexes 在对象存储块中定位 trace 数据。([Grafana Labs][16])

因此，OpenTelemetry + Tempo 的实现模式可以概括为：

```text
业务应用
  ↓ OTel SDK / Java Agent / Go SDK / Node SDK
OTLP gRPC / HTTP
  ↓
OpenTelemetry Collector
  ↓
Tempo Distributor / Ingester
  ↓
Object Storage
  ↓
Tempo Query Frontend / Querier
  ↓
Grafana Trace UI
  ↔ Loki Logs
  ↔ Prometheus / Mimir Metrics
```

这个组合的职责边界较清晰：OpenTelemetry 负责统一埋点、协议、采集与转发；Tempo 负责 Trace 存储和查询；Grafana 负责可视化和跨 Logs、Metrics、Traces 的关联分析。它反映了第四阶段的关键范式：链路追踪不再是孤立系统，而是可观测性平台中的一个信号源。

---

## 六、四个阶段的技术演进对比

| 阶段         |        时间 | 代表系统                      | 核心问题              | 技术范式                                         |
| ---------- | --------: | ------------------------- | ----------------- | -------------------------------------------- |
| 萌芽与探索期     |  2010 年以前 | Google Dapper、淘宝 EagleEye | 分布式系统黑盒化，调用路径不可见  | Trace/Span 模型、上下文传播、采样、公共库埋点                 |
| 百花齐放与组件化期  | 2012—2016 | Zipkin、Jaeger             | 微服务爆发，需要开源可部署追踪系统 | Collector、Storage、Query、UI 分层                |
| 无侵入与生态爆发期  | 2015—2019 | SkyWalking                | 手动埋点推广成本高、覆盖率难保证  | Agent 自动埋点、APM、拓扑、指标与告警                      |
| 大一统与可观测性时代 |   2019 至今 | OpenTelemetry、Tempo       | 标准割裂，Trace 单点不足   | Metrics、Logs、Traces 统一采集、OTLP、Collector、后端解耦 |

---

## 七、讨论：分布式链路追踪演进的主线

分布式链路追踪的发展不是简单的工具替换，而是围绕三个方向持续演进。

第一，**从局部日志到请求级因果链路**。Dapper 将一次请求跨服务传播的路径建模为可追踪对象，解决了单点日志无法描述全局调用关系的问题。([Google Research][1])

第二，**从内部系统到开源平台**。Zipkin 把采集、查询、存储和 UI 组合为可部署系统，Jaeger 将这一模式进一步工程化并进入 CNCF 治理体系，成为云原生微服务环境中的成熟追踪平台。([Zipkin][2])

第三，**从追踪工具到可观测性标准**。SkyWalking 通过 Agent 自动埋点降低接入成本，OpenTelemetry 通过统一 API、SDK、协议和 Collector 解决生态割裂，Tempo 则作为后端系统承接高规模 Trace 存储和查询。([Apache SkyWalking][8])

---

## 八、结论

分布式链路追踪的发展历程可以归纳为一条清晰主线：大型互联网公司首先在内部系统中解决分布式调用不可见问题；开源社区随后将 Dapper 模式工程化为 Zipkin、Jaeger 等可部署系统；随着微服务规模扩大，SkyWalking 等 Agent 型平台降低了业务接入成本；2019 年以后，OpenTelemetry 将 tracing 从单一工具推进为 Metrics、Logs、Traces 统一遥测标准，Tempo 等后端系统则在云原生场景下承担高规模 Trace 存储、查询和 Grafana 生态集成。

从当前事实看，分布式链路追踪已经不再只是“查看调用链”的工具，而是云原生可观测性体系中的基础信号之一。更准确的技术边界是：OpenTelemetry 负责标准化采集、处理和导出，Tempo、Jaeger、SkyWalking 等系统负责不同形态的存储、分析和展示，Grafana 等平台负责跨 Trace、Metric、Log 的关联视图。这个分工是当前分布式链路追踪进入可观测性时代的主要工程形态。

---

## 参考资料

[1] Google Research, *Dapper, a Large-Scale Distributed Systems Tracing Infrastructure*.
[2] OpenZipkin 官方文档。
[3] Jaeger 官方文档与 CNCF Jaeger 项目页面。
[4] Apache SkyWalking 官方文档。
[5] Google Open Source Blog, *OpenTelemetry: The Merger of OpenCensus and OpenTracing*.
[6] OpenTelemetry 官方文档与 CNCF OpenTelemetry 公告。
[7] Grafana Tempo 官方文档。

[1]: https://research.google.com/archive/papers/dapper-2010-1.pdf?utm_source=chatgpt.com "Dapper, a Large-Scale Distributed Systems Tracing ..."
[2]: https://zipkin.io/ "OpenZipkin · A distributed tracing system"
[3]: https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/ "Dapper, a Large-Scale Distributed Systems Tracing Infrastructure"
[4]: https://docs.huihoo.com/javaone/2013/CON1361-Taobao.pptx?utm_source=chatgpt.com "鹰眼下的淘宝 - Huihoo"
[5]: https://www.jaegertracing.io/docs/latest/ "Introduction | Jaeger"
[6]: https://www.cncf.io/projects/jaeger/ "Jaeger | CNCF"
[7]: https://skywalking.apache.org/docs/main/next/readme/ "Welcome | Apache SkyWalking"
[8]: https://skywalking.apache.org/docs/main/next/en/concepts-and-designs/service-agent/ "Service Auto Instrument Agent | Apache SkyWalking"
[9]: https://skywalking.apache.org/?utm_source=chatgpt.com "Apache SkyWalking"
[10]: https://opensource.googleblog.com/2019/05/opentelemetry-merger-of-opencensus-and.html "OpenTelemetry: The Merger of OpenCensus and OpenTracing | Google Open Source Blog"
[11]: https://opentelemetry.io/?utm_source=chatgpt.com "OpenTelemetry"
[12]: https://www.cncf.io/blog/2024/11/15/gain-insights-into-cloud-native-applications-with-the-opentelemetry-certified-associate-otca/ "Gain insights into cloud native applications with the OpenTelemetry Certified Associate (OTCA) | CNCF"
[13]: https://www.cncf.io/announcements/2026/05/21/cloud-native-computing-foundation-announces-opentelemetrys-graduation-solidifying-status-as-the-de-facto-observability-standard/ "Cloud Native Computing Foundation Announces OpenTelemetry’s Graduation, Solidifying Status as the De Facto Observability Standard | CNCF"
[14]: https://opentelemetry.io/docs/collector/ "Collector | OpenTelemetry"
[15]: https://grafana.com/docs/tempo/latest/ "Grafana Tempo | Grafana Tempo documentation"
[16]: https://grafana.com/docs/tempo/latest/introduction/architecture/ "Tempo architecture | Grafana Tempo documentation"
