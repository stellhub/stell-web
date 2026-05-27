## Abstract

Prometheus and VictoriaMetrics are both time-series data systems for observability scenarios. Prometheus officially positions itself as an open-source monitoring system for applications, systems, and services, with a multidimensional data model, the PromQL query language, alerting capabilities, and local storage. VictoriaMetrics officially positions itself as a fast, cost-effective, and scalable solution for time-series data monitoring and management, and provides both single-node and cluster deployment modes. Based on the official Prometheus documentation, the Prometheus Remote Write specification, official VictoriaMetrics documentation, the official VictoriaMetrics GitHub repository, and official LinkedIn materials, this article objectively compares the two systems across positioning, data ingestion, query compatibility, storage layout, performance-related mechanisms, and migration flow. ([prometheus.io][1])

**Keywords**: Prometheus; VictoriaMetrics; time-series database; PromQL; MetricsQL; Remote Write; vmagent; vmalert; vmctl

---

## 1. Introduction

Prometheus is one of the core components in the cloud-native monitoring ecosystem. Its official documentation describes that Prometheus uses a multidimensional data model, where time series are identified by a metric name and a set of key-value labels. PromQL is used to query, correlate, and transform time-series data. Prometheus Server runs independently and relies on local storage. Alerting rules are based on PromQL, and notification handling is performed by the independent Alertmanager component. ([prometheus.io][1])

VictoriaMetrics is another time-series data system whose core feature is compatibility with the Prometheus ecosystem. The official VictoriaMetrics GitHub repository states that it can be used as long-term storage for Prometheus or as a replacement backend for Prometheus/Graphite in Grafana. It supports PromQL and MetricsQL, and supports multiple ingestion protocols and formats including Prometheus exporters, Prometheus Remote Write, the Prometheus exposition format, InfluxDB, Graphite, OpenTSDB, JSON, CSV, and OpenTelemetry metrics. ([GitHub][2])

---

## 2. Background and Motivation of VictoriaMetrics

### 2.1 Founding Time and Organizational Background

The official VictoriaMetrics LinkedIn page shows that VictoriaMetrics was founded in 2018, with headquarters information listed as San Francisco, California, while also stating that it originated in Kyiv, Ukraine and is currently operated globally from the US headquarters. The official LinkedIn page also describes that VictoriaMetrics team members previously worked at companies such as Google, Lyft, and Cloudflare, and describes its goal as solving problems related to large-scale, constantly changing data types. ([linkedin.com][3])

The official VictoriaMetrics GitHub repository describes the project as a "fast, cost-effective, and scalable solution for monitoring and managing time series data". It lists core use cases such as long-term storage for Prometheus, a replacement backend for Prometheus/Graphite in Grafana, and large-scale time-series scenarios such as APM, Kubernetes, IoT, industrial telemetry, and financial data. ([GitHub][2])

### 2.2 Motivation

Official VictoriaMetrics materials do not describe its creation as a "replacement denial" of Prometheus. Instead, they focus on performance, cost, scalability, and operational complexity in large-scale time-series data processing. The official LinkedIn page describes the team's goal as solving hard problems in large-scale, continuously changing data types, while the official GitHub repository describes its design goals as performance, reliability, scalability, and cost-effectiveness for time-series data. ([linkedin.com][3])

From the official Prometheus documentation, Prometheus local storage and remote storage can be combined as follows: Prometheus can write collected samples to a remote URL in Remote Write format, and can also read raw series data from a remote URL. However, on the remote read path, Prometheus only reads raw series from the remote endpoint; PromQL evaluation still happens inside Prometheus itself, so remote read queries have certain scalability limitations. ([prometheus.io][4])

One direct positioning of VictoriaMetrics is to serve remote storage and global query needs in the Prometheus ecosystem. The VictoriaMetrics FAQ explicitly states that VictoriaMetrics supports Prometheus Remote Write, so it can serve as long-term storage for Prometheus or vmagent. Since it supports PromQL, it can also be used as a drop-in replacement for Prometheus in Grafana. ([docs.victoriametrics.com][5])

### 2.3 Problem Boundaries

Based on official materials, VictoriaMetrics mainly addresses the following objective problems.

First, it receives Prometheus Remote Write data and provides long-term storage. The official Prometheus specification defines Remote Write as a protocol for reliably propagating samples to a receiver in real time. VictoriaMetrics documentation explicitly states that it can receive Prometheus Remote Write and act as long-term storage for Prometheus/vmagent. ([prometheus.io][6])

Second, it maintains high compatibility at the Grafana query layer. VictoriaMetrics supports the Prometheus HTTP API, allowing Grafana to query VictoriaMetrics the same way it queries Prometheus. MetricsQL is also officially described as backward-compatible with PromQL, so Grafana dashboards based on the Prometheus data source should work in the same way after switching to VictoriaMetrics, although the official documentation also notes intentional differences between the two. ([docs.victoriametrics.com][7])

Third, it provides both single-node and cluster modes. The official VictoriaMetrics GitHub repository states that the open-source version includes single-node VictoriaMetrics and a cluster version. In cluster deployment, the minimum topology contains three types of nodes: `vmstorage`, `vminsert`, and `vmselect`, which handle storage, write path, and query path respectively. ([GitHub][2])

---

## 3. System Model Comparison between Prometheus and VictoriaMetrics

### 3.1 Prometheus Model

Prometheus officially describes itself as an open-source solution for system and service monitoring. Its data model is multidimensional; time series are identified by a metric name and a set of labels; PromQL is used to query and transform time-series data; Prometheus Server runs independently and depends on local storage; alerting rules are evaluated by Prometheus Server, while notifications are handled by Alertmanager. ([prometheus.io][1])

Prometheus configuration consists of command-line arguments and YAML configuration files. Command-line arguments configure immutable system parameters such as storage path and data retention, while configuration files define scrape jobs, target instances, and rule files. Prometheus supports runtime configuration reload, but if the new configuration is malformed, the change will not be applied. ([prometheus.io][8])

For remote write, Prometheus starts one queue for each remote write target. It reads data from the WAL, writes samples into the in-memory queue owned by a shard, and then sends them to the configured remote endpoint. The official documentation also notes that remote write increases Prometheus memory usage. Most users report an increase of about 25%, depending on the data shape. The series cache, shards, and queues all increase memory usage. ([prometheus.io][9])

### 3.2 VictoriaMetrics Model

The official VictoriaMetrics GitHub repository states that it supports two open-source deployment modes: single-node and cluster. Single-node VictoriaMetrics can directly handle data ingestion, storage, and query. Cluster mode splits ingestion, query, and storage into `vminsert`, `vmselect`, and `vmstorage`. The VictoriaMetrics cluster documentation states that the minimum cluster contains at least one `vmstorage`, one `vminsert`, and one `vmselect`. ([GitHub][2])

At the query layer, VictoriaMetrics provides the Prometheus HTTP API. At the query-language layer, it provides MetricsQL and states that MetricsQL is backward-compatible with PromQL. The VictoriaMetrics documentation explicitly states that Grafana can query VictoriaMetrics through the Prometheus HTTP API the same way it queries Prometheus. ([docs.victoriametrics.com][10])

At the collection layer, VictoriaMetrics provides vmagent. The official vmagent documentation states that it collects metrics from multiple sources, performs relabeling/filtering, and writes to VictoriaMetrics or other compatible storage systems through Prometheus Remote Write or VictoriaMetrics Remote Write. The documentation also states that if Prometheus is used only to collect and forward metrics to remote storage, vmagent can replace Prometheus. ([docs.victoriametrics.com][11])

At the alerting layer, VictoriaMetrics provides vmalert. The official vmalert documentation states that it executes alerting rules or recording rules, queries the configured `-datasource.url`, sends alert notifications to Alertmanager, persists recording rule results through remote write, and aims to be compatible with Prometheus rule syntax. ([docs.victoriametrics.com][12])

---

## 4. Performance-Related Mechanisms of VictoriaMetrics Compared with Prometheus

### 4.1 Write Path Differences

The official data flow of Prometheus remote write is: WAL -> per-destination queue -> shard queue -> remote endpoint. When a shard is blocked and its queue is full, Prometheus blocks reading from the WAL into any shard. If the remote endpoint is unavailable for more than 2 hours, unsent data may be lost after WAL compaction. The official Prometheus documentation also states that remote write increases memory, CPU, and network usage. ([prometheus.io][9])

VictoriaMetrics single-node documentation describes its write path as follows: written data is first buffered in memory for up to about 1 second, and then written into queryable in-memory parts. These in-memory parts are periodically persisted to disk. Persisted data is organized into monthly partition directories. The documentation also states that VictoriaMetrics prioritizes data ingestion; when resources are insufficient to support ingestion, queries may become significantly slower. ([docs.victoriametrics.com][13])

Therefore, for the question "where is it fast?", the objective statement supported by official materials is: VictoriaMetrics optimizations cover ingestion, storage, query, and collection-forwarding paths. The additional cost of Prometheus remote write appears in WAL reading, series cache, shard queues, and network sending, while VictoriaMetrics/vmagent provides dedicated components for remote-write and collection-forwarding scenarios. ([prometheus.io][9])

### 4.2 Storage Structure Differences

The VictoriaMetrics key concepts documentation explains that VictoriaMetrics stores time-series data using a MergeTree-like data structure. This approach is efficient for write-heavy databases, but it also brings a limitation: directly modifying already-written data would require rewriting the data block containing it, so VictoriaMetrics does not support direct modification of already-written data. ([docs.victoriametrics.com][7])

The VictoriaMetrics single-node documentation also explains that its storage has the concept of `part`. After data is persisted, it is written into monthly partition directories such as `<storageDataPath>/data/small/YYYY_MM/`. The index layer contains a global index and a per-day index. During queries, VictoriaMetrics chooses between them according to the query time range. If the search time range is smaller than the partition time range, it uses the per-day index; if the query time range is equal to or larger than the partition time range, it uses the global index. ([docs.victoriametrics.com][13])

This means VictoriaMetrics query performance does not come from a single "faster algorithm". It is formed by data partitioning, part merging, index selection, cache, and query execution together.

### 4.3 Indexing, High Cardinality, and High Churn

VictoriaMetrics documentation explains that by default it uses both global and per-day indexes for data retrieval, and selects the index during query execution for better performance. The documentation also notes that if a use case involves high cardinality and high churn rate, the default settings are ideal. ([docs.victoriametrics.com][13])

The Prometheus official documentation cited in this article does not provide a point-by-point comparison between Prometheus local TSDB and VictoriaMetrics high-churn handling. Therefore, official materials cannot support the conclusion that "VictoriaMetrics is faster in all scenarios". The objective statement is that VictoriaMetrics official materials explicitly list high cardinality, high churn, long-term storage, and large volumes of time-series data as optimization goals and suitable scenarios, while Prometheus officially positions itself as an independently running local-storage PromQL query and alerting system that integrates with remote storage through remote write/read. ([GitHub][2])

### 4.4 Query Cache and Query Execution

The VictoriaMetrics single-node documentation explains that VictoriaMetrics caches query responses by default and reuses them for later queries when possible, improving repeated query performance. For range queries, the cache can be used for queries with the same expression and step. For instant queries, the cache can be used for some function queries with the same expression and a lookbehind window exceeding a specified value. VictoriaMetrics also provides the `nocache=1` parameter and the `-search.disableCache` parameter to disable caching per query or globally. ([docs.victoriametrics.com][13])

VictoriaMetrics also provides query tracing. The official documentation compares it to PostgreSQL `EXPLAIN ANALYZE` and uses it to locate query processing bottlenecks. ([docs.victoriametrics.com][13])

### 4.5 Collection and Forwarding Layer: vmagent

The official motivation for vmagent is to provide VictoriaMetrics users with fast, RAM-friendly, Prometheus-compatible exporter scraping capabilities, while adding support for multiple push protocols, target discovery, and flexible topologies. Features listed in the official documentation include: acting as a drop-in replacement for Prometheus to discover and scrape targets; supporting relabel/filter; supporting multiple VictoriaMetrics ingestion protocols; supporting stream aggregation; replicating to multiple Prometheus-compatible remote storages; saving egress bandwidth under the VictoriaMetrics remote write protocol; and caching data on local disk when the remote endpoint is unavailable, then sending it after recovery. ([docs.victoriametrics.com][11])

For scenarios where Prometheus is only used for scrape + remote write, the official VictoriaMetrics documentation explicitly states that vmagent can replace Prometheus and usually requires less RAM, CPU, and network bandwidth. ([docs.victoriametrics.com][11])

### 4.6 Query Language Compatibility and Differences

VictoriaMetrics implements MetricsQL. The official documentation states that it is inspired by PromQL and is backward-compatible with PromQL, so Grafana dashboards based on a Prometheus datasource should work in the same way after switching to VictoriaMetrics. However, the official documentation also explicitly states that MetricsQL and PromQL have intentional differences. For example, behaviors differ around `rate`, `increase`, NaN handling, metric name retention, and more. ([docs.victoriametrics.com][10])

Therefore, migration should not only verify whether APIs are reachable. It should also verify whether key PromQL expressions in business dashboards and alerting rules produce the expected results.

---

## 5. Standard Migration Guide from Prometheus to VictoriaMetrics

### 5.1 Classify the Migration Goal

Before migrating from an existing Prometheus setup to VictoriaMetrics, first clarify the migration goal. Based on official component capabilities, migration can be divided into three categories.

The first category is "only add VictoriaMetrics as long-term storage". Prometheus continues scraping and alerting, and only writes data to VictoriaMetrics through remote write. Prometheus officially supports writing collected samples to a remote URL in Remote Write format, and VictoriaMetrics supports acting as long-term storage for Prometheus/vmagent. ([prometheus.io][4])

The second category is "migrate the collection layer to vmagent". If Prometheus only handles scrape and remote write, the official VictoriaMetrics documentation states that vmagent can replace Prometheus. ([docs.victoriametrics.com][11])

The third category is "fully replace the Prometheus monitoring stack". This requires migrating data ingestion, query datasource, alerting rules, recording rules, Grafana datasource, and Kubernetes objects such as ServiceMonitor, PodMonitor, and PrometheusRule. The official VictoriaMetrics Operator documentation supports converting Prometheus Operator objects into corresponding VictoriaMetrics Operator objects, including ServiceMonitor, PodMonitor, PrometheusRule, Probe, and ScrapeConfig. ([docs.victoriametrics.com][14])

### 5.2 Phase One: Deploy VictoriaMetrics

For single-node scenarios, deploy single-node VictoriaMetrics. This mode is suitable for smaller scale or scenarios that require lower operational complexity. The official VictoriaMetrics GitHub repository states that both the single-node version and cluster version are open-source deployment modes. ([GitHub][2])

For cluster scenarios, deploy `vminsert`, `vmselect`, and `vmstorage`. The official VictoriaMetrics cluster documentation states that the minimum cluster contains at least one `vmstorage`, one `vminsert`, and one `vmselect`. `vminsert` handles the write path, `vmselect` handles the query path, and `vmstorage` handles storage. ([docs.victoriametrics.com][15])

### 5.3 Phase Two: Configure Prometheus Remote Write to VictoriaMetrics

Keep the existing Prometheus scrape configuration and add a remote write target in `prometheus.yml` so Prometheus writes collected data to VictoriaMetrics. The Prometheus remote write protocol sends data through HTTP POST using protobuf and Snappy compression. The remote write path for single-node VictoriaMetrics is usually:

```yaml
remote_write:
  - url: http://victoriametrics:8428/api/v1/write
```

The official Prometheus documentation explains that Remote Write is used to reliably propagate samples in real time. The VictoriaMetrics vmagent documentation also gives `/api/v1/write` as the example path for writing to single-node VictoriaMetrics. ([prometheus.io][6])

For VictoriaMetrics cluster, the write path should point to `vminsert`, usually in this form:

```yaml
remote_write:
  - url: http://vminsert:8480/insert/0/prometheus/api/v1/write
```

The vmalert cluster example also reflects that in cluster mode, `vmselect` is used for queries and `vminsert` is used for writes. ([docs.victoriametrics.com][12])

### 5.4 Phase Three: Parallel Run and Data Validation

In the early migration phase, run Prometheus and VictoriaMetrics in parallel for a period of time. Prometheus continues to serve as the existing monitoring system for queries and alerts, while VictoriaMetrics receives the same samples as a remote write receiver.

Validation should include:

| Validation item | Validation method |
| --- | --- |
| Whether writes succeed | Check VictoriaMetrics `/metrics` and ingestion-related metrics |
| Number of time series | Compare label cardinality of core metrics between Prometheus and VictoriaMetrics |
| Dashboard queries | Switch part of Grafana panels to VictoriaMetrics and verify results |
| PromQL compatibility | Focus on `rate`, `increase`, histogram, and recording rule queries |
| Alert expressions | Execute core rules in vmalert or Prometheus at the same time and compare results |
| Resource usage | Compare CPU, memory, disk, network, and query latency |

The official Prometheus remote write documentation notes that when remote writes fall behind, indicators such as `prometheus_remote_storage_samples_pending` can be used for diagnosis. VictoriaMetrics documentation provides query tracing, cache metrics, and slow ingestion/query-related metrics for locating bottlenecks. ([prometheus.io][9])

### 5.5 Phase Four: Migrate Grafana Datasource

VictoriaMetrics supports the Prometheus HTTP API, so Grafana can query VictoriaMetrics in the same way it queries Prometheus. The official documentation explicitly states that VictoriaMetrics supports the Prometheus HTTP API, allowing Grafana to query it as if querying Prometheus. ([docs.victoriametrics.com][7])

Grafana migration steps:

1. Add a Prometheus-type datasource whose URL points to VictoriaMetrics or `vmselect`.
2. Copy existing dashboards and switch the datasource from Prometheus to VictoriaMetrics.
3. Verify core PromQL query results.
4. Perform focused validation for expressions affected by MetricsQL and PromQL differences.
5. Switch read-only dashboards to VictoriaMetrics first.
6. After confirming consistency, gradually switch core business dashboards.

The official MetricsQL documentation explicitly states that it is backward-compatible with PromQL, but also lists several intentional differences. Therefore, production migration must validate key expressions instead of assuming every PromQL behavior is exactly identical. ([docs.victoriametrics.com][10])

### 5.6 Phase Five: Migrate Alerts and Recording Rules

If alert rules continue to be executed by Prometheus, this phase can be postponed. To migrate alert evaluation, deploy vmalert.

The official vmalert documentation states that vmalert executes alerting rules or recording rules and queries the configured `-datasource.url`; alert notifications depend on Alertmanager; recording rule results are persisted through remote write; and vmalert aims to be compatible with Prometheus rule syntax. ([docs.victoriametrics.com][12])

Example vmalert topology for single-node VictoriaMetrics:

```bash
vmalert \
  -rule=rules.yml \
  -datasource.url=http://victoriametrics:8428 \
  -remoteWrite.url=http://victoriametrics:8428 \
  -remoteRead.url=http://victoriametrics:8428 \
  -notifier.url=http://alertmanager:9093
```

In cluster mode, the query address should point to `vmselect`, and the write address should point to `vminsert`:

```bash
vmalert \
  -rule=rules.yml \
  -datasource.url=http://vmselect:8481/select/0/prometheus \
  -remoteWrite.url=http://vminsert:8480/insert/0/prometheus \
  -remoteRead.url=http://vmselect:8481/select/0/prometheus \
  -notifier.url=http://alertmanager:9093
```

This path division comes from the cluster example in the official VictoriaMetrics vmalert documentation. ([docs.victoriametrics.com][12])

### 5.7 Phase Six: Migrate Historical Data

VictoriaMetrics officially provides `vmctl` for migrating historical data from Prometheus. The official documentation explains that `vmctl` can migrate historical data to VictoriaMetrics by reading Prometheus snapshots. The basic command form is:

```bash
vmctl prometheus \
  --vm-addr=http://victoriametrics:8428 \
  --prom-snapshot=/path/to/prometheus-snapshot
```

VictoriaMetrics official documentation also supports filtering by time range:

```bash
vmctl prometheus \
  --prom-snapshot=/path/to/prometheus-snapshot \
  --vm-addr=http://victoriametrics:8428 \
  --prom-filter-time-start=2024-01-01T00:00:00Z \
  --prom-filter-time-end=2024-02-01T00:00:00Z
```

It also supports filtering by labels, such as filtering part of the metrics by `__name__`. The official documentation states that in Prometheus mode, vmctl reads Prometheus snapshots. Performance is affected by the Prometheus library, disk I/O, and the concurrent read count controlled by `--prom-concurrency`; it is recommended to set `--prom-concurrency` to the number of CPU cores available to vmctl. ([docs.victoriametrics.com][16])

### 5.8 Phase Seven: Migrate the Collection Layer to vmagent

After confirming that VictoriaMetrics ingestion, queries, and historical data migration are stable, the collection layer can be migrated from Prometheus to vmagent. vmagent supports loading Prometheus scrape configuration and writing to VictoriaMetrics through `-remoteWrite.url`. Official example:

```bash
vmagent \
  -promscrape.config=/path/to/prometheus.yml \
  -remoteWrite.url=http://victoriametrics:8428/api/v1/write
```

The official documentation states that if Prometheus is only used to scrape and forward data to remote storage, vmagent can replace Prometheus and usually requires less RAM, CPU, and network bandwidth. ([docs.victoriametrics.com][11])

### 5.9 Phase Eight: Prometheus Operator Object Migration in Kubernetes

If the existing system uses Prometheus Operator, evaluate VictoriaMetrics Operator migration capabilities. The official VictoriaMetrics Operator documentation states that its design and implementation are inspired by Prometheus Operator, and it supports familiar CRD objects such as `ServiceMonitor`, `PodMonitor`, `PrometheusRule`, `Probe`, and `AlertmanagerConfig`. It also provides corresponding VictoriaMetrics CRDs such as `VMServiceScrape`, `VMPodScrape`, `VMRule`, `VMProbe`, `VMAlertmanagerConfig`, and `VMScrapeConfig`. ([docs.victoriametrics.com][14])

The default behavior is to convert existing Prometheus `ServiceMonitor`, `PodMonitor`, `PrometheusRule`, `Probe`, and `ScrapeConfig` objects into corresponding VictoriaMetrics Operator objects, and synchronize updates from Prometheus objects. By default, converted objects are not deleted after the original objects are deleted, so the migration or simultaneous operation of two operators can be done safely. ([docs.victoriametrics.com][14])

### 5.10 Phase Nine: Switch Production Entry Points and Retire Prometheus

Prometheus can be gradually retired after the following conditions are satisfied:

1. Major Grafana dashboards have been switched to VictoriaMetrics.
2. Core PromQL/MetricsQL query results have been validated.
3. vmalert alert rules have been validated.
4. Recording rule results have been persisted through remote write.
5. Historical data has been migrated by vmctl and sampling validation has completed.
6. vmagent scrape targets, relabeling, service discovery, and scrape interval behavior are aligned with the original Prometheus behavior.
7. Monitoring, backup, capacity planning, and alerting for VictoriaMetrics itself have been configured.

For Kubernetes scenarios, before retiring Prometheus, also confirm the Prometheus Operator CRD conversion strategy, delete synchronization strategy, update synchronization strategy, and label/annotation synchronization strategy. The VictoriaMetrics Operator documentation provides related control parameters, such as disabling conversion for specific objects, enabling owner references, controlling update synchronization, and controlling metadata merge strategy. ([docs.victoriametrics.com][14])

---

## 6. Migration Risks and Validation Focus

### 6.1 Behavioral Differences between PromQL and MetricsQL

The official MetricsQL documentation states that it is backward-compatible with PromQL, but also explicitly lists intentional differences, including `rate`, `increase`, NaN handling, metric name retention, and more. Therefore, the biggest validation focus during migration is not "whether the syntax can execute", but "whether the result matches the semantic expectations of existing alerts and dashboards". ([docs.victoriametrics.com][10])

### 6.2 Remote Write Queues and Backpressure

The official Prometheus remote write documentation states that remote write increases memory, CPU, and network usage; when a shard queue is full, WAL reading is blocked; if the remote endpoint is unavailable for more than 2 hours, unsent data may be lost. Therefore, during the parallel migration phase, Prometheus remote write pending, failed, retry, queue length, and related metrics must be monitored. ([prometheus.io][9])

### 6.3 Historical Data Migration Consistency

vmctl reads historical data from Prometheus snapshots. Before migrating historical data, freeze or copy the Prometheus snapshot to avoid inconsistency between the current head block and historical blocks. The official Prometheus backfilling documentation also explains that data should not be backfilled from the current head block within the most recent 3 hours, because that time range may overlap with the head block Prometheus is currently modifying. ([docs.victoriametrics.com][16])

### 6.4 Alerting Path Reliability

Prometheus alerting is calculated by Prometheus Server and sent to Alertmanager. vmalert executes queries through a remote datasource, so the official VictoriaMetrics documentation notes that vmalert querying a remote datasource has network reliability risks. Alert thresholds and rule expressions should consider possible network request failures. ([prometheus.io][17])

---

## 7. Conclusion

The difference between Prometheus and VictoriaMetrics mainly lies in system positioning and architectural boundaries. Prometheus is a monitoring system that integrates scrape, local TSDB, PromQL, and alert rule evaluation, and integrates with remote storage through Remote Write/Remote Read. VictoriaMetrics builds a complete time-series data processing system around Prometheus ecosystem compatibility, long-term storage, multi-protocol ingestion, MetricsQL, vmagent, vmalert, and both single-node and cluster deployment modes. ([prometheus.io][1])

The official basis for VictoriaMetrics being "faster" mainly comes from its ingestion buffering and part storage, MergeTree-like data structure, global/per-day index, query cache, query tracing, vmagent collection-forwarding optimization, and path separation for writes, queries, and storage in cluster mode. The official Prometheus documentation clearly states that remote write brings memory, CPU, and network overhead, and that remote read still performs PromQL evaluation locally in Prometheus, which has scalability limitations. ([docs.victoriametrics.com][13])

The standard path for migrating from an existing Prometheus deployment to VictoriaMetrics should be gradual: first deploy VictoriaMetrics and configure Prometheus remote write; run in parallel and validate data; switch the Grafana datasource; use vmalert to migrate rules; use vmctl to migrate historical data from Prometheus snapshots; then migrate the collection layer from Prometheus to vmagent; finally, in Kubernetes scenarios, migrate Prometheus Operator objects through VictoriaMetrics Operator. This path preserves rollback space and matches the capability boundaries described by the official Prometheus Remote Write, VictoriaMetrics vmagent, vmalert, vmctl, and Operator documentation. ([prometheus.io][6])

[1]: https://prometheus.io/ "Prometheus - Monitoring system & time series database"
[2]: https://github.com/victoriametrics/VictoriaMetrics "GitHub - VictoriaMetrics/VictoriaMetrics: VictoriaMetrics: fast, cost-effective monitoring solution and time series database"
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
