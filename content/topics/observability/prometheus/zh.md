# Prometheus 与 VictoriaMetrics 的技术比较及迁移方法研究

## 摘要

Prometheus 与 VictoriaMetrics 均属于面向可观测性场景的时序数据系统。Prometheus 官方将其定位为用于应用、系统和服务监控的开源监控系统，具备多维数据模型、PromQL 查询语言、告警能力和本地存储能力。VictoriaMetrics 官方将其定位为面向时序数据监控和管理的快速、成本有效、可扩展方案，并提供单节点与集群两种部署形态。本文基于 Prometheus 官方文档、Prometheus Remote Write 规范、VictoriaMetrics 官方文档、VictoriaMetrics 官方 GitHub 与官方 LinkedIn 资料，对二者的系统定位、数据写入、查询兼容性、存储结构、性能相关机制及迁移流程进行客观比较。([prometheus.io][1])

**关键词**：Prometheus；VictoriaMetrics；时序数据库；PromQL；MetricsQL；Remote Write；vmagent；vmalert；vmctl

---

## 1. 引言

Prometheus 是云原生监控体系中的核心组件之一。其官方文档描述，Prometheus 使用多维数据模型，时间序列由指标名称和键值标签集合标识；PromQL 用于查询、关联和转换时序数据；Prometheus Server 独立运行并依赖本地存储；告警规则基于 PromQL，通知处理由独立的 Alertmanager 组件完成。([prometheus.io][1])

VictoriaMetrics 是另一个以 Prometheus 生态兼容为核心特征的时序数据系统。VictoriaMetrics 官方 GitHub 说明其支持作为 Prometheus 的长期存储，或作为 Grafana 中 Prometheus/Graphite 的替代后端；其支持 PromQL 与 MetricsQL，支持 Prometheus exporter、Prometheus Remote Write、Prometheus exposition format、InfluxDB、Graphite、OpenTSDB、JSON、CSV、OpenTelemetry metrics 等多种写入协议。([GitHub][2])

---

## 2. VictoriaMetrics 的背景与产生原因

### 2.1 诞生时间与组织背景

VictoriaMetrics 官方 LinkedIn 页面显示，VictoriaMetrics 公司成立于 2018 年，总部信息显示为 San Francisco, California，并说明其起源于 Kyiv, Ukraine，当前由美国总部进行全球运营。官方 LinkedIn 页面还描述，VictoriaMetrics 团队成员此前曾在 Google、Lyft、Cloudflare 等公司工作，并将其目标表述为解决“大规模、持续变化的数据类型”相关问题。([linkedin.com][3])

VictoriaMetrics 官方 GitHub 将项目描述为“fast, cost-effective, and scalable solution for monitoring and managing time series data”，并列出其核心使用场景，包括作为 Prometheus 的长期存储、在 Grafana 中作为 Prometheus/Graphite 的替代后端、面向大规模 APM、Kubernetes、IoT、工业遥测、金融数据等时序数据场景。([GitHub][2])

### 2.2 产生动因

VictoriaMetrics 官方资料没有将其产生原因表述为对 Prometheus 的“替代性否定”，而是围绕大规模时序数据处理中的性能、成本、扩展性和运维复杂度展开。其官方 LinkedIn 页面将团队目标描述为解决大规模、持续变化数据类型中的困难问题；官方 GitHub 则将其设计目标表述为面向时序数据的高性能、可靠性、可扩展性和成本有效性。([linkedin.com][3])

从 Prometheus 官方文档看，Prometheus 本地存储与远程存储的组合方式为：Prometheus 可以将采集到的样本以 Remote Write 格式写入远程 URL，也可以从远程 URL 读取原始序列数据；但在 remote read 路径上，Prometheus 只从远端读取原始序列，PromQL 计算仍发生在 Prometheus 本身，因此 remote read 查询存在一定扩展性限制。([prometheus.io][4])

VictoriaMetrics 的一个直接定位就是承接 Prometheus 生态中的远程存储和全局查询需求。VictoriaMetrics FAQ 明确说明，VictoriaMetrics 支持 Prometheus Remote Write，因此可作为 Prometheus 或 vmagent 的长期存储；同时由于支持 PromQL，它可以在 Grafana 中作为 Prometheus 的 drop-in replacement。([docs.victoriametrics.com][5])

### 2.3 解决的问题边界

从官方资料归纳，VictoriaMetrics 主要解决以下客观问题：

第一，承接 Prometheus Remote Write 数据，提供长期存储能力。Prometheus 官方定义 Remote Write 协议用于将样本实时可靠地传播到 receiver；VictoriaMetrics 官方文档明确其可以接收 Prometheus Remote Write，并作为 Prometheus/vmagent 的长期存储。([prometheus.io][6])

第二，在 Grafana 查询层保持较高兼容性。VictoriaMetrics 支持 Prometheus HTTP API，使 Grafana 可以像查询 Prometheus 一样查询 VictoriaMetrics；MetricsQL 也被官方描述为向后兼容 PromQL，因此基于 Prometheus 数据源的 Grafana Dashboard 在切换到 VictoriaMetrics 后应能以相同方式工作，但官方也指出二者存在有意设计的差异。([docs.victoriametrics.com][7])

第三，提供单节点和集群形态。VictoriaMetrics 官方 GitHub 说明其开源版本包含 single-node VictoriaMetrics 与 cluster version；集群部署中最小拓扑包含 `vmstorage`、`vminsert`、`vmselect` 三类节点，分别承担存储、写入和查询路径。([GitHub][2])

---

## 3. Prometheus 与 VictoriaMetrics 的系统模型比较

### 3.1 Prometheus 的模型

Prometheus 官方将其描述为用于系统和服务监控的开源解决方案。其数据模型是多维模型，时间序列由指标名称和标签集合标识；PromQL 用于查询和转换时序数据；Prometheus Server 独立运行，并依赖本地存储；告警规则由 Prometheus Server 计算，通知由 Alertmanager 处理。([prometheus.io][1])

Prometheus 的配置由命令行参数和 YAML 配置文件共同组成。命令行参数用于配置存储路径、数据保留等不可变系统参数，配置文件用于定义采集任务、目标实例和规则文件。Prometheus 支持运行时 reload 配置，但如果新配置格式错误，则不会应用变更。([prometheus.io][8])

在远程写入方面，Prometheus remote write 会为每个远程写入目标启动一个队列，从 WAL 读取数据，将样本写入分片拥有的内存队列，然后发送到配置的远程端点。官方文档还指出 remote write 会增加 Prometheus 的内存占用，多数用户报告约增加 25%，具体取决于数据形态；series cache、shard 与 queue 都会增加内存使用。([prometheus.io][9])

### 3.2 VictoriaMetrics 的模型

VictoriaMetrics 官方 GitHub 描述，其支持单节点和集群两种开源部署形态。单节点 VictoriaMetrics 可以直接承担数据写入、存储和查询；集群模式将写入、查询和存储拆分为 `vminsert`、`vmselect`、`vmstorage`。VictoriaMetrics cluster 文档说明，最小集群至少包含一个 `vmstorage`、一个 `vminsert` 和一个 `vmselect`。([GitHub][2])

VictoriaMetrics 在查询层提供 Prometheus HTTP API；在查询语言层提供 MetricsQL，并声明 MetricsQL 向后兼容 PromQL。VictoriaMetrics 文档明确说明，Grafana 可以通过 Prometheus HTTP API 以查询 Prometheus 的方式查询 VictoriaMetrics。([docs.victoriametrics.com][10])

在采集层，VictoriaMetrics 提供 vmagent。vmagent 官方文档称其用于从多种来源采集指标、执行 relabel/filter，并通过 Prometheus Remote Write 或 VictoriaMetrics Remote Write 协议写入 VictoriaMetrics 或其他兼容存储系统。文档还说明，如果 Prometheus 仅用于采集和转发指标到远程存储，则 vmagent 可以替代 Prometheus。([docs.victoriametrics.com][11])

在告警层，VictoriaMetrics 提供 vmalert。vmalert 官方文档说明，它执行 alerting rules 或 recording rules，查询配置的 `-datasource.url`，发送告警通知到 Alertmanager，recording rules 结果通过 remote write 持久化，并且 vmalert 目标是兼容 Prometheus 规则语法。([docs.victoriametrics.com][12])

---

## 4. VictoriaMetrics 相对 Prometheus 的性能相关机制

### 4.1 写入路径差异

Prometheus remote write 的官方数据流是：WAL → per-destination queue → shard queue → remote endpoint。当某个 shard 阻塞并填满队列时，Prometheus 会阻塞从 WAL 向任何 shard 读取；如果远端不可用超过 2 小时，WAL compact 后未发送的数据可能丢失。Prometheus 官方还说明 remote write 会增加内存、CPU 和网络使用。([prometheus.io][9])

VictoriaMetrics 的写入路径在单节点文档中描述为：写入数据会先在内存中最多缓冲约 1 秒，然后写入可查询的 in-memory parts；这些 in-memory parts 会周期性持久化到磁盘，持久化后的数据按月分区目录组织。该文档还说明 VictoriaMetrics 会优先处理数据写入，当资源不足以支撑写入时，查询可能显著变慢。([docs.victoriametrics.com][13])

因此，在“快在什么地方”的问题上，官方资料支持的客观表述是：VictoriaMetrics 的性能优化覆盖写入、存储、查询和采集转发多个路径；Prometheus remote write 的额外成本体现在 WAL 读取、series cache、shard queue、网络发送等环节，而 VictoriaMetrics/vmagent 提供了面向远程写入和采集转发场景的专用组件。([prometheus.io][9])

### 4.2 存储结构差异

VictoriaMetrics 官方 key concepts 文档说明，VictoriaMetrics 使用类似 MergeTree 的数据结构存储时序数据；这种方式对 write-heavy database 是高效的，但也带来限制：已写入数据的直接修改需要重写所在的数据块，因此 VictoriaMetrics 不支持直接修改已写入数据。([docs.victoriametrics.com][7])

VictoriaMetrics 单节点文档还说明其存储中存在 `part` 概念，数据持久化后写入 `<storageDataPath>/data/small/YYYY_MM/` 这样的月分区目录；索引层包含 global index 与 per-day index，查询时 VictoriaMetrics 会根据查询时间范围在二者之间选择。若搜索时间范围小于 partition 时间范围，则使用 per-day index；若查询时间范围等于或大于 partition 时间范围，则使用 global index。([docs.victoriametrics.com][13])

这意味着 VictoriaMetrics 的查询性能机制并非单一“算法更快”，而是由数据分区、part 合并、索引选择、缓存和查询执行共同构成。

### 4.3 索引与高基数/高 churn 场景

VictoriaMetrics 文档说明，默认使用 global 和 per-day 两类索引用于数据检索，并在查询时选择索引以获得更优性能；文档还指出，如果使用场景涉及 high cardinality 与 high churn rate，则默认设置是理想设置。([docs.victoriametrics.com][13])

Prometheus 官方文档没有在本文引用范围内将其本地 TSDB 与 VictoriaMetrics 的 high churn 处理机制逐项对比，因此不能从官方资料中得出“所有场景 VictoriaMetrics 都更快”的结论。可以客观说明的是：VictoriaMetrics 官方明确将 high cardinality、high churn、长期存储、大量时序数据作为其优化目标与适用场景；Prometheus 官方则将其定位为独立运行、本地存储、PromQL 查询和告警系统，并通过 remote write/read 与远程存储集成。([GitHub][2])

### 4.4 查询缓存与查询执行

VictoriaMetrics 单节点文档说明，VictoriaMetrics 默认缓存查询响应，并在可能时用于后续查询，从而提升重复查询性能。对于 range query，缓存可用于相同表达式和相同步长的查询；对于 instant query，缓存可用于具有相同表达式且使用超过指定 lookbehind window 的部分函数查询。VictoriaMetrics 也提供 `nocache=1` 参数和 `-search.disableCache` 参数用于按查询或全局禁用缓存。([docs.victoriametrics.com][13])

VictoriaMetrics 还提供 query tracing，官方文档将其类比为 PostgreSQL 的 `EXPLAIN ANALYZE`，用于定位查询处理瓶颈。([docs.victoriametrics.com][13])

### 4.5 采集转发层：vmagent

vmagent 的官方动机是为 VictoriaMetrics 用户提供快速、RAM-friendly 的 Prometheus-compatible exporter 采集能力，并增加对多种 push 协议、目标发现和灵活拓扑的支持。官方文档列出的 vmagent 特性包括：可作为 Prometheus 的 drop-in replacement 发现和采集目标；支持 relabel/filter；支持多种 VictoriaMetrics ingestion protocols；支持 stream aggregation；支持复制到多个 Prometheus-compatible remote storage；在 VictoriaMetrics remote write protocol 下节省 egress 带宽；在远端不可用时将数据缓存在本地磁盘并恢复后发送。([docs.victoriametrics.com][11])

对于仅使用 Prometheus 进行 scrape + remote write 的场景，VictoriaMetrics 官方文档明确说明 vmagent 可以替代 Prometheus，并通常需要更少的 RAM、CPU 和网络带宽。([docs.victoriametrics.com][11])

### 4.6 查询语言兼容与差异

VictoriaMetrics 实现 MetricsQL，官方文档称其受 PromQL 启发并向后兼容 PromQL，因此基于 Prometheus datasource 的 Grafana Dashboard 在切换到 VictoriaMetrics 后应以相同方式工作；但官方同时明确指出 MetricsQL 与 PromQL 存在有意设计的差异。例如 `rate`、`increase`、NaN 处理、metric name 保留等行为存在差异。([docs.victoriametrics.com][10])

因此，迁移时不能只验证接口是否能访问，还应验证关键 PromQL 表达式在业务 Dashboard 和告警规则中的结果是否符合预期。

---

## 5. Prometheus 到 VictoriaMetrics 的标准迁移指南

### 5.1 迁移目标分类

从现有 Prometheus 迁移到 VictoriaMetrics，应先明确迁移目标。基于官方组件能力，迁移可分为三类：

第一类是“只增加 VictoriaMetrics 作为长期存储”。Prometheus 继续 scrape 和 alert，只通过 remote write 将数据写入 VictoriaMetrics。Prometheus 官方支持将采集样本以 Remote Write 格式写入远程 URL；VictoriaMetrics 支持作为 Prometheus/vmagent 的长期存储。([prometheus.io][4])

第二类是“采集层也迁移到 vmagent”。如果 Prometheus 只承担 scrape 和 remote write，VictoriaMetrics 官方文档说明 vmagent 可以替代 Prometheus。([docs.victoriametrics.com][11])

第三类是“完整替换 Prometheus 监控栈”。该方式需要同时迁移数据写入、查询数据源、告警规则、recording rules、Grafana datasource，以及 Kubernetes 中的 ServiceMonitor、PodMonitor、PrometheusRule 等对象。VictoriaMetrics operator 官方文档支持 Prometheus Operator 对象转换，可将 ServiceMonitor、PodMonitor、PrometheusRule、Probe、ScrapeConfig 转换为对应的 VictoriaMetrics Operator 对象。([docs.victoriametrics.com][14])

### 5.2 阶段一：部署 VictoriaMetrics

单节点场景可部署 single-node VictoriaMetrics。该模式适用于较小规模或需要较低运维复杂度的场景。VictoriaMetrics 官方 GitHub 说明其 single-node 与 cluster version 均为开源部署形态。([GitHub][2])

集群场景应部署 `vminsert`、`vmselect`、`vmstorage`。VictoriaMetrics cluster 官方文档说明，最小集群至少包含一个 `vmstorage`、一个 `vminsert` 和一个 `vmselect`；其中 `vminsert` 负责写入路径，`vmselect` 负责查询路径，`vmstorage` 负责存储。([docs.victoriametrics.com][15])

### 5.3 阶段二：配置 Prometheus Remote Write 到 VictoriaMetrics

保留现有 Prometheus scrape 配置，在 `prometheus.yml` 中添加 remote write 目标，使 Prometheus 将采集到的数据写入 VictoriaMetrics。Prometheus remote write 协议以 HTTP POST、protobuf、Snappy 压缩格式发送数据；VictoriaMetrics single-node 的 remote write 写入路径通常为：

```yaml
remote_write:
  - url: http://victoriametrics:8428/api/v1/write
```

Prometheus 官方文档说明，Remote Write 协议用于可靠地实时传播样本；VictoriaMetrics vmagent 文档也给出写入 single-node VictoriaMetrics 的示例地址 `/api/v1/write`。([prometheus.io][6])

对于 VictoriaMetrics cluster，写入路径应指向 `vminsert`，通常形态为：

```yaml
remote_write:
  - url: http://vminsert:8480/insert/0/prometheus/api/v1/write
```

vmalert 的 cluster 示例也体现了 cluster 模式下 `vmselect` 用于查询、`vminsert` 用于写入的路径划分。([docs.victoriametrics.com][12])

### 5.4 阶段三：并行运行与数据校验

在迁移初期，应让 Prometheus 与 VictoriaMetrics 并行运行一段时间。Prometheus 继续作为现有监控系统提供查询和告警，VictoriaMetrics 作为 remote write 接收端接收同一批样本。

校验内容应包括：

| 校验项          | 校验方法                                                           |
| ------------ | -------------------------------------------------------------- |
| 写入是否成功       | 检查 VictoriaMetrics `/metrics` 与写入相关指标                          |
| 时间序列数量       | 对比 Prometheus 与 VictoriaMetrics 中核心 metric 的 label cardinality |
| Dashboard 查询 | 将部分 Grafana 面板数据源切换到 VictoriaMetrics 验证结果                      |
| PromQL 兼容性   | 重点验证 `rate`、`increase`、histogram、recording rule 查询             |
| 告警表达式        | 在 vmalert 或 Prometheus 中同时执行核心规则做结果对比                          |
| 资源使用         | 对比 CPU、内存、磁盘、网络与查询延迟                                           |

Prometheus remote write 官方文档指出，当远程写入落后时，可以通过 `prometheus_remote_storage_samples_pending` 等指标判断；VictoriaMetrics 文档则提供 query tracing、cache metrics、slow ingestion/query 相关指标用于定位瓶颈。([prometheus.io][9])

### 5.5 阶段四：迁移 Grafana 数据源

VictoriaMetrics 支持 Prometheus HTTP API，因此 Grafana 可以像查询 Prometheus 一样查询 VictoriaMetrics。官方文档明确说明，VictoriaMetrics 支持 Prometheus HTTP API，使 Grafana 能以查询 Prometheus 的方式查询 VictoriaMetrics。([docs.victoriametrics.com][7])

Grafana 迁移步骤如下：

1. 新增一个 Prometheus 类型数据源，URL 指向 VictoriaMetrics 或 `vmselect`。
2. 复制现有 Dashboard，将数据源从 Prometheus 切换为 VictoriaMetrics。
3. 验证核心 PromQL 查询结果。
4. 对 MetricsQL 与 PromQL 存在差异的表达式进行专项验证。
5. 将只读 Dashboard 先切换到 VictoriaMetrics。
6. 在确认一致后，再逐步切换核心业务 Dashboard。

MetricsQL 官方文档明确说明其向后兼容 PromQL，但也列出若干有意差异，因此生产迁移时必须验证关键表达式，而不是假设所有 PromQL 行为完全一致。([docs.victoriametrics.com][10])

### 5.6 阶段五：迁移告警与 recording rules

如果继续由 Prometheus 执行告警规则，则该阶段可以暂缓。若要迁移告警计算，应部署 vmalert。

vmalert 官方文档说明，vmalert 执行 alerting rules 或 recording rules，查询配置的 `-datasource.url`；告警通知依赖 Alertmanager；recording rules 结果通过 remote write 持久化；vmalert 目标是兼容 Prometheus 规则语法。([docs.victoriametrics.com][12])

单节点 VictoriaMetrics 的 vmalert 示例拓扑为：

```bash
vmalert \
  -rule=rules.yml \
  -datasource.url=http://victoriametrics:8428 \
  -remoteWrite.url=http://victoriametrics:8428 \
  -remoteRead.url=http://victoriametrics:8428 \
  -notifier.url=http://alertmanager:9093
```

集群模式下，查询地址应指向 `vmselect`，写入地址应指向 `vminsert`：

```bash
vmalert \
  -rule=rules.yml \
  -datasource.url=http://vmselect:8481/select/0/prometheus \
  -remoteWrite.url=http://vminsert:8480/insert/0/prometheus \
  -remoteRead.url=http://vmselect:8481/select/0/prometheus \
  -notifier.url=http://alertmanager:9093
```

该路径划分来自 VictoriaMetrics vmalert 官方文档中的 cluster 示例。([docs.victoriametrics.com][12])

### 5.7 阶段六：迁移历史数据

VictoriaMetrics 官方提供 `vmctl` 用于从 Prometheus 迁移历史数据。官方文档说明，`vmctl` 可以通过读取 Prometheus snapshot 将历史数据迁移到 VictoriaMetrics。基本命令形态如下：

```bash
vmctl prometheus \
  --vm-addr=http://victoriametrics:8428 \
  --prom-snapshot=/path/to/prometheus-snapshot
```

VictoriaMetrics 官方文档还支持按时间范围过滤：

```bash
vmctl prometheus \
  --prom-snapshot=/path/to/prometheus-snapshot \
  --vm-addr=http://victoriametrics:8428 \
  --prom-filter-time-start=2024-01-01T00:00:00Z \
  --prom-filter-time-end=2024-02-01T00:00:00Z
```

也支持按 label 过滤，例如按 `__name__` 过滤部分指标。官方文档说明，Prometheus 模式下 vmctl 读取 Prometheus snapshot，性能受 Prometheus library、磁盘 IO 和 `--prom-concurrency` 并发读取数影响，建议将 `--prom-concurrency` 设置为 vmctl 可用 CPU 核数。([docs.victoriametrics.com][16])

### 5.8 阶段七：迁移采集层到 vmagent

在确认 VictoriaMetrics 写入、查询和历史数据迁移稳定后，可以将采集层从 Prometheus 迁移到 vmagent。vmagent 支持加载 Prometheus scrape config，并通过 `-remoteWrite.url` 写入 VictoriaMetrics。官方示例为：

```bash
vmagent \
  -promscrape.config=/path/to/prometheus.yml \
  -remoteWrite.url=http://victoriametrics:8428/api/v1/write
```

官方文档说明，如果 Prometheus 仅用于 scrape 和转发数据到远程存储，则 vmagent 可以替代 Prometheus，并通常需要更少 RAM、CPU 和网络带宽。([docs.victoriametrics.com][11])

### 5.9 阶段八：Kubernetes 场景中的 Prometheus Operator 对象迁移

如果现有系统使用 Prometheus Operator，应评估 VictoriaMetrics Operator 的迁移能力。VictoriaMetrics Operator 官方文档说明，其设计和实现受 Prometheus Operator 启发，并支持熟悉的 CRD 对象，包括 `ServiceMonitor`、`PodMonitor`、`PrometheusRule`、`Probe` 和 `AlertmanagerConfig`。同时也提供对应的 VictoriaMetrics CRD，例如 `VMServiceScrape`、`VMPodScrape`、`VMRule`、`VMProbe`、`VMAlertmanagerConfig` 和 `VMScrapeConfig`。([docs.victoriametrics.com][14])

默认行为是将已有 Prometheus `ServiceMonitor`、`PodMonitor`、`PrometheusRule`、`Probe` 和 `ScrapeConfig` 转换为对应的 VictoriaMetrics Operator 对象，并同步 Prometheus 对象的更新；默认不会在原对象删除后删除转换对象，因此可以安全迁移或同时运行两个 operator。([docs.victoriametrics.com][14])

### 5.10 阶段九：切换生产入口与退役 Prometheus

当以下条件满足后，可以逐步退役 Prometheus：

1. Grafana 主要 Dashboard 已切换到 VictoriaMetrics。
2. 核心 PromQL/MetricsQL 查询结果已验证。
3. vmalert 告警规则已验证。
4. recording rules 结果已通过 remote write 持久化。
5. 历史数据已通过 vmctl 迁移并完成抽样校验。
6. vmagent 采集目标、relabel、service discovery、scrape interval 与原 Prometheus 行为完成对齐。
7. VictoriaMetrics 自身监控、备份、容量规划和告警已配置。

对于 Kubernetes 场景，退役前还应确认 Prometheus Operator CRD 转换策略、删除同步策略、更新同步策略，以及 label/annotation 同步策略。VictoriaMetrics Operator 文档提供了相关控制参数，例如禁用特定对象转换、启用 owner references、控制更新同步、控制 metadata merge strategy 等。([docs.victoriametrics.com][14])

---

## 6. 迁移风险与验证重点

### 6.1 PromQL 与 MetricsQL 的行为差异

MetricsQL 官方文档声明其向后兼容 PromQL，但也明确列出有意差异，包括 `rate`、`increase`、NaN 处理、metric name 保留等。因此迁移中的最大验证重点不是“语法是否能执行”，而是“结果是否符合现有告警和 Dashboard 的语义预期”。([docs.victoriametrics.com][10])

### 6.2 Remote Write 队列与回压

Prometheus remote write 官方文档说明，remote write 会增加内存、CPU 和网络使用；当 shard queue 填满时会阻塞 WAL 读取；远端不可用超过 2 小时可能导致未发送数据丢失。因此，在并行迁移阶段必须监控 Prometheus remote write pending、failed、retry、queue length 等指标。([prometheus.io][9])

### 6.3 历史数据迁移一致性

vmctl 从 Prometheus snapshot 读取历史数据。迁移历史数据前应冻结或复制 Prometheus snapshot，避免在写入中的 head block 与历史 block 之间出现不一致。Prometheus 官方 backfilling 文档也说明，不应从最近 3 小时的当前 head block 回填数据，因为该时间范围可能与 Prometheus 正在修改的 head block 重叠。([docs.victoriametrics.com][16])

### 6.4 告警链路可靠性

Prometheus 的告警由 Prometheus Server 计算规则并发送到 Alertmanager；vmalert 则通过远程 datasource 执行查询，因此 VictoriaMetrics 官方文档提示，vmalert 通过远程 datasource 执行查询存在网络可靠性风险，告警阈值和规则表达式应考虑网络请求失败的情况。([prometheus.io][17])

---

## 7. 结论

Prometheus 与 VictoriaMetrics 的差异主要体现在系统定位和架构边界上。Prometheus 是集 scrape、本地 TSDB、PromQL、告警规则计算于一体的监控系统，并通过 Remote Write/Remote Read 与远程存储集成。VictoriaMetrics 则围绕 Prometheus 生态兼容、长期存储、多协议写入、MetricsQL、vmagent、vmalert、单节点与集群部署形态构建完整时序数据处理体系。([prometheus.io][1])

VictoriaMetrics “更快”的官方依据主要来自其写入缓冲与 part 存储、MergeTree-like 数据结构、global/per-day index、查询缓存、query tracing、vmagent 采集转发优化，以及集群模式下写入、查询、存储路径拆分。Prometheus 官方文档则明确 remote write 会带来内存、CPU 和网络开销，并说明 remote read 的 PromQL 计算仍在 Prometheus 本地完成，存在扩展性限制。([docs.victoriametrics.com][13])

从现有 Prometheus 迁移到 VictoriaMetrics 的标准路径应采用渐进式流程：先部署 VictoriaMetrics，配置 Prometheus remote write；并行运行并校验数据；切换 Grafana 数据源；使用 vmalert 迁移规则；使用 vmctl 迁移 Prometheus snapshot 历史数据；再将采集层从 Prometheus 迁移到 vmagent；最后在 Kubernetes 场景中通过 VictoriaMetrics Operator 迁移 Prometheus Operator 对象。该路径保留了回滚空间，并符合 Prometheus Remote Write、VictoriaMetrics vmagent、vmalert、vmctl 和 Operator 官方文档给出的能力边界。([prometheus.io][6])

[1]: https://prometheus.io/ "Prometheus - Monitoring system & time series database"
[2]: https://github.com/victoriametrics/VictoriaMetrics "GitHub - VictoriaMetrics/VictoriaMetrics: VictoriaMetrics: fast, cost-effective monitoring solution and time series database · GitHub"
[3]: https://www.linkedin.com/company/victoriametrics "VictoriaMetrics | LinkedIn"
[4]: https://prometheus.io/docs/prometheus/latest/storage/ "Storage | Prometheus"
[5]: https://docs.victoriametrics.com/victoriametrics/faq/ "VictoriaMetrics: FAQ"
[6]: https://prometheus.io/docs/specs/prw/remote_write_spec/ "Prometheus Remote-Write 1.0 specification | Prometheus"
[7]: https://docs.victoriametrics.com/victoriametrics/keyconcepts/ "VictoriaMetrics: Key concepts"
[8]: https://prometheus.io/docs/prometheus/latest/configuration/configuration/ "Configuration | Prometheus"
[9]: https://prometheus.io/docs/practices/remote_write/ "Remote write tuning | Prometheus"
[10]: https://docs.victoriametrics.com/victoriametrics/metricsql/ "VictoriaMetrics: MetricsQL"
[11]: https://docs.victoriametrics.com/victoriametrics/vmagent/ "VictoriaMetrics: vmagent"
[12]: https://docs.victoriametrics.com/victoriametrics/vmalert/ "VictoriaMetrics: vmalert"
[13]: https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/ "VictoriaMetrics: Single-node version"
[14]: https://docs.victoriametrics.com/operator/integrations/prometheus/ "Kubernetes Operator: Integrations: Prometheus"
[15]: https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/ "VictoriaMetrics: Cluster version"
[16]: https://docs.victoriametrics.com/victoriametrics/vmctl/prometheus/ "VictoriaMetrics: vmctl: Prometheus"
[17]: https://prometheus.io/docs/alerting/latest/overview/ "Alerting overview | Prometheus"
