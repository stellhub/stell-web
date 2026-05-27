# 告别 ELK 依赖？在 OpenTelemetry 时代重新定义日志治理

## 摘要

日志治理的技术边界正在从“日志采集、索引、查询的一体化平台”转向“以遥测数据标准为中心的统一采集、处理与传输体系”。在传统 ELK 体系中，Elasticsearch、Logstash、Kibana 以及 Beats/Elastic Agent 分别承担存储搜索、数据处理、可视化和采集职责；Elastic 官方将 Elastic Stack 定义为用于大规模摄取、存储、搜索和可视化数据的一组产品，Filebeat 则用于监控日志文件并转发到 Elasticsearch 或 Logstash。([Elastic][1]) OpenTelemetry 时代的变化不在于 Elasticsearch 或 Kibana 失去作用，而在于日志、指标、链路追踪不再需要分别维护独立 agent；OpenTelemetry Collector 官方定义为可接收、处理并导出 telemetry 数据的统一组件，并明确支持 traces、metrics、logs 三类信号。([OpenTelemetry][2])

**关键词**：OpenTelemetry；日志治理；ELK；Collector；Kafka；Logback；Log4j2；Zap

---

## 1. 引言

早期应用日志主要以本机文件或标准输出形式存在，开发和运维人员通过登录机器、检索文件、查看时间片段完成问题定位。随着服务数量增加，日志文件分布在多台机器、多种运行环境和多个应用实例中，日志治理从“单机查看”进入“集中采集”阶段。Elastic 官方对 Filebeat 的定位即为轻量级日志 shipper，它监控日志文件或位置、收集日志事件，并将其转发到 Elasticsearch 或 Logstash。([Elastic][3])

ELK 体系形成后，Logstash 负责输入、过滤和输出的管道处理，Elasticsearch 负责分布式搜索与分析，Kibana 负责查询、过滤、仪表盘和可视化，构成了集中式日志观测的事实架构。([Elastic][4]) 这一架构解决了日志集中查询和可视化问题，但其治理边界通常围绕“日志”单一信号展开；指标、链路追踪、日志往往由不同 SDK、不同 agent、不同协议和不同后端分别治理。OpenTelemetry 日志规范指出，现有日志生态存在不同日志库、不同采集 agent、不同传输协议和不同后端之间的碎片化问题，并将统一数据模型、trace/span 关联、resource 上下文和统一采集作为其日志设计目标。([OpenTelemetry][5])

因此，“告别 ELK 依赖”并不等同于否定 Elasticsearch、Logstash 或 Kibana 的工程价值。更准确的表述是：OpenTelemetry 将日志治理的核心从某一套日志平台迁移到标准化遥测链路，存储和查询系统可以继续选择 Elasticsearch，也可以选择其他离线存储、湖仓或时序/分析型数据库。OpenTelemetry Collector 的架构由 receiver、processor、exporter 和 pipeline 组成，pipeline 可以分别处理 logs、metrics、traces。([OpenTelemetry][6])

---

## 2. 日志治理的发展历程

### 2.1 单机日志文件阶段

在单体应用或少量服务阶段，日志通常由语言运行时或日志库写入本地文件、控制台或标准错误输出。Java 平台自带 `java.util.logging`，Oracle 官方将其定义为 Java 平台核心日志设施，提供 Logger、Handler、Level 等基础抽象。([Oracle Docs][7]) Go 早期标准库也提供 `log` 包，官方文档将其定义为简单日志包，默认 Logger 写入标准错误并带有日期时间前缀。([Go Packages][8])

这一阶段的主要特征是日志生产和日志查看发生在同一台机器上，日志治理的核心问题是文件路径、日志滚动、级别控制和人工检索。该模式在服务规模扩大后会遇到实例分散、权限隔离、检索效率低和上下文缺失等问题。

### 2.2 日志采集阶段

服务实例增多后，日志采集器成为基础组件。Filebeat 的官方定位是 lightweight shipper，负责转发和集中化日志数据；Logstash 则通过 input、filter、output 组成事件处理管道，支持从不同来源接收数据、在中间阶段转换数据，并最终输出到目标系统。([Elastic][3])

这一阶段将日志治理从“登录机器查看文件”推进到“集中采集与集中查询”。采集器的出现降低了人工查看分布式日志的成本，但日志仍通常作为独立信号治理，与 metrics 和 traces 的接入链路分离。

### 2.3 ELK 阶段

ELK/Elastic Stack 阶段将采集、处理、索引、搜索和可视化组合成完整日志平台。Elastic 官方文档说明，Elastic Stack 是用于大规模摄取、存储、搜索和可视化数据的产品套件；Elasticsearch 是分布式数据存储和搜索引擎，Kibana 提供搜索、过滤、仪表盘和可视化能力。([Elastic][1])

在日志观测场景中，ELK 的价值体现在三点：第一，日志从机器本地转移到集中索引；第二，日志查询从 `grep` 转向结构化检索；第三，日志分析从单条文本查看转向仪表盘、聚合和告警。Elasticsearch 官方也将其定位为可用于 logs、metrics、traces 等可观测数据的搜索和分析引擎。([Elastic][9])

### 2.4 OpenTelemetry 阶段

OpenTelemetry 阶段的核心变化是统一 telemetry 数据的采集、处理和传输。OpenTelemetry Collector 官方将其定义为 vendor-agnostic 的接收、处理、导出组件，并说明它可以消除运行多个 agent 或 collector 的需求。([OpenTelemetry][2]) Collector 架构中，receiver 负责接收数据，processor 负责处理数据，exporter 负责向后端发送数据，pipeline 则按信号类型组织 traces、metrics、logs。([OpenTelemetry][6])

OpenTelemetry 日志规范明确提出日志需要统一数据模型，并支持通过时间戳、trace context 和 resource context 与其它遥测数据关联。([OpenTelemetry][5]) 这意味着日志治理不再只是“把文本写入 Elasticsearch”，而是把日志作为 telemetry 的一类信号，与 metrics、traces 在统一上下文中采集、处理、路由和存储。

---

## 3. 业务侧日志 SDK 的选择

### 3.1 Java 日志体系

Java 日志体系长期存在多种选择，包括 JDK 自带 JUL、Log4j、Logback、Log4j2 以及 SLF4J 门面体系。JUL 是 Java 平台内置日志设施，适合作为基础运行时日志能力存在。([Oracle Docs][7]) 在 Spring Boot 应用中，官方文档说明默认 starter 使用 Logback，并为 Java Util Logging、Log4j2 和 Logback 提供默认配置。([Home][10])

从工程选型看，Spring Boot 默认栈中采用 SLF4J + Logback 是稳定路径，因为它与 Spring Boot 默认 starter、依赖路由和配置模型天然兼容。对于需要极高吞吐、异步日志和低延迟场景的应用，Log4j2 仍是重要选择。Apache Log4j2 官方文档说明，异步日志可通过单独 I/O 线程提升吞吐，并基于 LMAX Disruptor 实现无锁队列，从而在部分场景获得更高吞吐和更低延迟。([Apache Logging Services][11])

安全层面，Log4j 1.x 已在 2015 年停止维护，Apache 官方建议用户升级到 Log4j2，并说明 Log4j 1.x 的问题不会被修复。([Apache Logging Services][12]) Log4j2 也曾出现 CVE-2021-44228，NVD 描述该漏洞与 JNDI 功能处理攻击者控制的 LDAP 等端点有关，可能导致远程代码执行；该问题影响的是特定版本的 `log4j-core`。([国家漏洞数据库][13])

因此，在 Java 业务侧，客观可落地的选择顺序是：Spring Boot 普通业务服务默认采用 SLF4J + Logback；高吞吐异步日志场景在完成安全版本约束和性能验证后采用 Log4j2；历史 Log4j 1.x 不应作为新系统选项；JUL 更适合作为 JDK 内置基础设施日志而非复杂业务日志治理主入口。

### 3.2 OpenTelemetry 对 Java 日志侧的影响

OpenTelemetry 并不要求业务系统抛弃既有日志库。OpenTelemetry 日志规范明确指出，应用可以使用已有日志库并通过 OpenTelemetry appender 采集，也可以直接使用 OpenTelemetry Logs API；Collector 还可以通过 filelog receiver 读取现有日志文件并解析转换。([OpenTelemetry][5])

这意味着 Java 应用的合理迁移路径不是立即替换 Logback 或 Log4j2，而是优先统一日志结构、trace/span 关联字段、resource 属性和导出链路。业务侧日志库解决“如何产生日志”，OpenTelemetry 解决“如何标准化、关联、处理和传输日志”。

---

## 4. Go 日志 SDK 的发展与 Zap 的位置

Go 早期标准库提供 `log` 包，满足简单日志输出需求。Go 1.21 引入 `log/slog`，官方博客说明 `slog` 面向结构化日志，支持 key-value 形式，便于日志解析、过滤和搜索。([Go Packages][8])

在高性能结构化日志场景中，Uber 的 Zap 是 Go 生态中的常见选择。Zap 官方包文档说明，`Logger` 提供 fast、leveled、structured logging，并且是并发安全的；其 API 偏向性能和类型安全，`SugaredLogger` 则提供更符合人体工学但略慢的接口。([Go Packages][14])

在 OpenTelemetry 时代，Go 业务侧日志 SDK 的核心标准不只是“写得快”，还包括结构化字段、上下文传播、trace/span 关联、resource 属性注入和统一导出能力。对于新应用，`slog` 具备标准库优势；对于高吞吐场景，Zap 仍具备性能和结构化优势；对于企业级日志治理，两者都应通过适配层、hook、core 或 bridge 将日志转换为 OpenTelemetry LogRecord 或可被 Collector 解析的结构化日志。

---

## 5. ELK 时代的日志观测方式与挑战

ELK 时代的典型日志链路是：业务应用写入文件或标准输出，Filebeat 或 Elastic Agent 采集，Logstash 或 ingest pipeline 处理，Elasticsearch 建立索引，Kibana 查询和可视化。Elastic 官方文档中，Filebeat 负责监控日志文件并转发，Logstash 负责输入、过滤和输出管道，Elasticsearch 提供搜索与分析，Kibana 提供查询、过滤、仪表盘和可视化。([Elastic][3])

这一模式的挑战主要来自治理边界分裂。日志链路通常由 Filebeat/Logstash/Elasticsearch 维护，指标链路可能由 Prometheus/node-exporter 维护，链路追踪链路可能由 Jaeger、Zipkin 或专用 SDK 维护。OpenTelemetry 日志规范明确指出，日志生态过去存在不同日志库、不同代理、不同协议和不同后端之间的分裂，并将统一日志模型与 telemetry 关联作为目标。([OpenTelemetry][5])

因此，ELK 时代的问题不只是存储成本或索引成本，而是日志治理与可观测治理之间缺少统一协议、统一上下文和统一传输层。日志可以在 Kibana 中被搜索，但它与 trace、metric 的关联往往依赖额外字段规范、人工约定或平台侧二次加工。

---

## 6. OpenTelemetry 时代的日志最佳实践

OpenTelemetry 时代的日志最佳实践可以归纳为四层。

第一，业务侧继续使用成熟日志库，但日志内容应结构化。OpenTelemetry 日志规范要求所有日志记录最终可表达为统一数据模型，并支持通过 trace context、resource context 和时间进行关联。([OpenTelemetry][5])

第二，本机或本 Pod 内部署 OpenTelemetry Collector 作为 agent。OpenTelemetry 官方 agent 部署模式说明，应用通过 SDK 或其他 Collector 将数据发送到与应用同机或相邻的 Collector 实例，Collector 再发送到后端。([OpenTelemetry][15])

第三，在 Collector 中使用 receiver、processor、exporter 组成 pipeline。Collector 官方架构说明，receiver 接收数据，processor 执行处理，exporter 将数据发送到外部系统，pipeline 可分别处理 traces、metrics、logs。([OpenTelemetry][6])

第四，将存储系统从采集标准中解耦。OpenTelemetry Collector 可以将 logs、metrics、traces 输出到不同后端；它不是日志存储系统，而是统一采集、处理和导出的遥测组件。([OpenTelemetry][2]) Elasticsearch 仍可作为日志搜索和分析后端，但不再必须承担日志治理入口的角色。([Elastic][9])

---

## 7. 大型企业日志传输链路设计

大型企业中，日志链路通常需要考虑多语言接入、多租户隔离、削峰填谷、统一清洗、统一路由、权限控制、成本控制和离线归档。基于 OpenTelemetry 的标准链路可以表达为：

```text
Business App
  -> OpenTelemetry Exporter
  -> Local OpenTelemetry Collector Receiver
  -> Processor
  -> Exporter [Kafka Producer]
  -> Kafka
  -> Kafka Consumer
  -> Elasticsearch / Offline Storage / Data Lake / Alerting System
```

在这个链路中，OpenTelemetry Collector 的 receiver、processor、exporter 分别对应接收、处理和导出阶段。([OpenTelemetry][6]) Kafka 在该链路中承担事件流平台角色；Apache Kafka 官方将其定义为分布式事件流平台，用于高性能数据管道、流分析、数据集成和关键任务应用，并强调其高吞吐、可扩展和持久化能力。([Apache Kafka][16])

采用 Kafka 的关键目的不是替代 Collector，而是在 Collector 与存储/查询后端之间提供缓冲、解耦和削峰能力。Collector 负责协议标准化、上下文处理和数据导出；Kafka 负责流式缓冲和消费解耦；Kafka Consumer 负责写入 Elasticsearch、离线存储、数据湖或告警系统。该模式下，Elasticsearch 退回到“日志查询和分析后端”的位置，而不是全链路日志治理的唯一中心。

---

## 8. 本机 Agent 直连 Kafka 与增加 OpenTelemetry Gateway 的取舍

OpenTelemetry 官方区分 agent 和 gateway 两类部署模式。agent 模式中，Collector 与应用部署在同一主机、同一 Pod 或相邻位置，应用将 OTLP 数据发送到本地 Collector，再由 Collector 发送到后端。([OpenTelemetry][15]) gateway 模式中，应用或其他 Collector 将 telemetry 发送到一个集中 OTLP endpoint，再由 gateway Collector 发送到后端。([OpenTelemetry][17])

如果本机 agent 直接发送 Kafka，链路更短，故障点更少，Kafka 已经承担缓冲、持久化和削峰填谷职责。该方案适用于企业内部网络边界清晰、Kafka 鉴权和 topic 规范可下发到 agent、接入方主要是内部业务服务的场景。其代价是 Kafka 地址、鉴权、topic 路由、协议版本和限流策略需要下沉到大量 agent 节点。

如果本机 agent 先转发到 OpenTelemetry Gateway，再由 gateway 写入 Kafka，则 gateway 可以提供统一 OTLP 接入点、集中凭证管理、统一策略和统一路由。OpenTelemetry 官方 gateway 文档也将集中凭证、集中策略列为优势，同时明确指出 gateway 会增加额外维护对象、潜在故障点、延迟和资源消耗。([OpenTelemetry][17])

因此，在核心日志链路中，是否增加 OpenTelemetry Gateway 不应以“Kafka 是否需要削峰”为判断标准，因为 Kafka 本身已用于事件流缓冲。更合理的判断标准是是否需要统一接入入口、跨网络边界接入、集中鉴权、统一 OpenAPI、统一多租户治理或对外部系统屏蔽 Kafka。如果只是内部服务日志进入 Kafka，再增加 gateway 会增加一跳风险；如果需要扩大接入范围并统一准入规范，gateway 具备工程必要性。

---

## 9. 对自定义 OpenTelemetry Collector 的工程意义

OpenTelemetry 官方提供 Collector Builder，可用于生成包含自定义或上游组件的 Collector 二进制文件；构建清单可以声明 receiver、processor、exporter、extension 等组件。([OpenTelemetry][18]) 这为企业自定义日志 agent、协议适配、字段清洗、路由策略、鉴权扩展和 Kafka exporter 封装提供了基础。

`stellhub/stello11y-opentelemetry-collector` 正是面向该方向的自定义 Collector 仓库。该仓库文档将项目定位为本地日志 agent，负责接收 SDK 发送的 OTLP LogRecord，对日志进行标准化、增强、清洗、缓冲、重试和路由，并写入 Kafka；其 README 中给出的主链路为业务应用通过 SDK 发送 OTLP/gRPC 到本地 agent，再由 agent 写入 Kafka，最终进入后端消费与查询系统。([GitHub][19])

从学习和扩展角度看，该仓库可以作为理解 OpenTelemetry Collector 二次开发、OTLP 日志接入、Kafka 日志链路、日志清洗、背压重试和自观测能力的工程样例。对于希望从 ELK 采集模式迁移到 OpenTelemetry 统一遥测模式的团队，该项目可以作为自定义 Collector 的实验入口和扩展基础。([GitHub][19])

---

## 10. 结论

日志治理经历了单机文件、集中采集、ELK 平台化和 OpenTelemetry 标准化四个阶段。ELK 解决了集中索引、搜索和可视化问题；OpenTelemetry 进一步解决 logs、metrics、traces 在采集、上下文、处理和传输层面的统一问题。Elastic Stack 仍可作为日志搜索与分析后端，OpenTelemetry Collector 则更适合作为企业 telemetry 的统一入口和传输治理层。([Elastic][1])

在业务侧，Java 应用应优先基于 SLF4J 与 Spring Boot 默认 Logback 体系建设结构化日志，高吞吐场景可在安全版本和性能验证前提下采用 Log4j2；Go 应用可基于标准库 `slog` 或 Zap 构建结构化日志，并通过 OpenTelemetry 适配进入统一链路。([Home][10])

在平台侧，企业级日志链路更适合采用 OpenTelemetry Collector 作为本机 agent，使用 processor 完成清洗、增强、限流和路由，再通过 Kafka 进行削峰填谷，最后由消费者写入 Elasticsearch 或离线存储。是否引入 OpenTelemetry Gateway，应基于统一接入、统一鉴权、多租户治理和网络边界需求判断，而不是把 gateway 当作 Kafka 缓冲能力的替代品。([OpenTelemetry][6])

[1]: https://www.elastic.co/docs/get-started/the-stack "The Elastic Stack | Elastic Docs"
[2]: https://opentelemetry.io/docs/collector/ "Collector | OpenTelemetry"
[3]: https://www.elastic.co/docs/reference/beats/filebeat "Filebeat | Beats"
[4]: https://www.elastic.co/docs/reference/logstash/how-logstash-works "How Logstash Works | Logstash"
[5]: https://opentelemetry.io/docs/specs/otel/logs/ "OpenTelemetry Logging | OpenTelemetry"
[6]: https://opentelemetry.io/docs/collector/architecture/ "Architecture | OpenTelemetry"
[7]: https://docs.oracle.com/en/java/javase/25/docs/api/java.logging/java/util/logging/package-summary.html "java.util.logging (Java SE 25 & JDK 25)"
[8]: https://pkg.go.dev/log "log package - log - Go Packages"
[9]: https://www.elastic.co/docs/reference/elasticsearch "Elasticsearch | Elasticsearch Reference"
[10]: https://docs.spring.io/spring-boot/reference/features/logging.html "Logging :: Spring Boot"
[11]: https://logging.apache.org/log4j/2.x/manual/async.html "Asynchronous loggers :: Apache Log4j"
[12]: https://logging.apache.org/log4j/1.x/ "Apache log4j 1.2 - "
[13]: https://nvd.nist.gov/vuln/detail/cve-2021-44228 "NVD - cve-2021-44228"
[14]: https://pkg.go.dev/go.uber.org/zap "zap package - go.uber.org/zap - Go Packages"
[15]: https://opentelemetry.io/docs/collector/deploy/agent/ "Agent deployment pattern | OpenTelemetry"
[16]: https://kafka.apache.org/ "Apache Kafka"
[17]: https://opentelemetry.io/docs/collector/deploy/gateway/ "Gateway deployment pattern | OpenTelemetry"
[18]: https://opentelemetry.io/docs/collector/extend/ocb/ "Build a custom Collector with OpenTelemetry Collector Builder | OpenTelemetry"
[19]: https://github.com/stellhub/stello11y-opentelemetry-collector "GitHub - stellhub/stello11y-opentelemetry-collector: Custom OpenTelemetry Collector distribution for StellHub observability, telemetry pipelines, metrics, logs, and traces. · GitHub"
