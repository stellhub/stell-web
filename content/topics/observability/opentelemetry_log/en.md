## Abstract

The technical boundary of log governance is moving from "an integrated platform for log collection, indexing, and querying" toward "a unified collection, processing, and transmission system centered on telemetry data standards". In the traditional ELK system, Elasticsearch, Logstash, Kibana, and Beats/Elastic Agent respectively handle storage and search, data processing, visualization, and collection. Elastic officially defines the Elastic Stack as a set of products for ingesting, storing, searching, and visualizing data at scale, while Filebeat monitors log files and forwards them to Elasticsearch or Logstash. ([Elastic][1]) The change in the OpenTelemetry era is not that Elasticsearch or Kibana lose their value, but that logs, metrics, and traces no longer need separately maintained agents. The OpenTelemetry Collector is officially defined as a unified component that can receive, process, and export telemetry data, and it explicitly supports the three signal types: traces, metrics, and logs. ([OpenTelemetry][2])

**Keywords**: OpenTelemetry; log governance; ELK; Collector; Kafka; Logback; Log4j2; Zap

---

## 1. Introduction

Early application logs mainly existed as local files or standard output. Developers and operators located issues by logging into machines, searching files, and checking time windows. As the number of services increased, log files became distributed across many machines, runtime environments, and application instances. Log governance moved from "viewing on a single machine" to "centralized collection". Elastic officially positions Filebeat as a lightweight log shipper that monitors log files or locations, collects log events, and forwards them to Elasticsearch or Logstash. ([Elastic][3])

After the ELK system took shape, Logstash handled input, filtering, and output pipeline processing; Elasticsearch handled distributed search and analytics; Kibana handled querying, filtering, dashboards, and visualization. Together, they formed the de facto architecture for centralized log observability. ([Elastic][4]) This architecture solved centralized log querying and visualization, but its governance boundary usually revolved around the single signal of "logs". Metrics, traces, and logs were often governed by different SDKs, different agents, different protocols, and different backends. The OpenTelemetry logging specification points out fragmentation across different logging libraries, collection agents, transport protocols, and backends in the existing logging ecosystem, and defines unified data model, trace/span correlation, resource context, and unified collection as design goals for logs. ([OpenTelemetry][5])

Therefore, "moving beyond ELK dependency" does not mean denying the engineering value of Elasticsearch, Logstash, or Kibana. A more accurate statement is that OpenTelemetry moves the core of log governance from a specific logging platform to a standardized telemetry pipeline. Storage and query systems can still choose Elasticsearch, or they can choose offline storage, lakehouses, or time-series/analytical databases. The OpenTelemetry Collector architecture consists of receivers, processors, exporters, and pipelines, and pipelines can separately process logs, metrics, and traces. ([OpenTelemetry][6])

---

## 2. Evolution of Log Governance

### 2.1 Local Log File Stage

In monolithic applications or small service environments, logs are usually written by language runtimes or logging libraries to local files, consoles, or standard error. The Java platform includes `java.util.logging`, which Oracle officially defines as the core logging facility of the Java platform and provides basic abstractions such as Logger, Handler, and Level. ([Oracle Docs][7]) Go's early standard library also provides the `log` package, which the official documentation defines as a simple logging package. Its default Logger writes to standard error with a date and time prefix. ([Go Packages][8])

The main characteristic of this stage is that log production and log viewing happen on the same machine. The core log-governance issues are file paths, log rotation, level control, and manual search. As service scale grows, this model encounters problems such as scattered instances, permission isolation, low retrieval efficiency, and missing context.

### 2.2 Log Collection Stage

After service instances increase, log collectors become infrastructure components. Filebeat is officially positioned as a lightweight shipper that forwards and centralizes log data. Logstash uses input, filter, and output stages to form an event-processing pipeline, receiving data from different sources, transforming data in intermediate stages, and finally outputting it to target systems. ([Elastic][3])

This stage moves log governance from "logging into machines to view files" to "centralized collection and centralized query". Collectors reduce the cost of manually checking distributed logs, but logs are still usually governed as an independent signal, separate from metrics and traces ingestion paths.

### 2.3 ELK Stage

The ELK/Elastic Stack stage combines collection, processing, indexing, search, and visualization into a complete logging platform. Elastic documentation explains that the Elastic Stack is a product suite for ingesting, storing, searching, and visualizing data at scale. Elasticsearch is a distributed data store and search engine, while Kibana provides search, filtering, dashboards, and visualization. ([Elastic][1])

In log observability, ELK's value appears in three ways. First, logs move from local machines into centralized indexes. Second, log querying moves from `grep` to structured retrieval. Third, log analysis moves from reading individual text lines to dashboards, aggregation, and alerting. Elasticsearch is also officially positioned as a search and analytics engine usable for observability data such as logs, metrics, and traces. ([Elastic][9])

### 2.4 OpenTelemetry Stage

The core change in the OpenTelemetry stage is unified collection, processing, and transmission of telemetry data. OpenTelemetry Collector is officially defined as a vendor-agnostic component for receiving, processing, and exporting telemetry, and it can remove the need to run multiple agents or collectors. ([OpenTelemetry][2]) In the Collector architecture, receivers receive data, processors process data, exporters send data to backends, and pipelines organize traces, metrics, and logs by signal type. ([OpenTelemetry][6])

The OpenTelemetry logging specification explicitly states that logs need a unified data model and support correlation with other telemetry data through timestamps, trace context, and resource context. ([OpenTelemetry][5]) This means log governance is no longer just "writing text into Elasticsearch"; instead, logs become one telemetry signal that is collected, processed, routed, and stored together with metrics and traces in a unified context.

---

## 3. Choosing Business-Side Logging SDKs

### 3.1 Java Logging Ecosystem

The Java logging ecosystem has long had many choices, including the JDK's built-in JUL, Log4j, Logback, Log4j2, and the SLF4J facade. JUL is the Java platform's built-in logging facility and is suitable as a basic runtime logging capability. ([Oracle Docs][7]) In Spring Boot applications, the official documentation states that the default starter uses Logback and provides default configurations for Java Util Logging, Log4j2, and Logback. ([Home][10])

From an engineering selection perspective, SLF4J + Logback in the default Spring Boot stack is the stable path because it naturally matches Spring Boot's default starter, dependency routing, and configuration model. For applications that require very high throughput, asynchronous logging, and low latency, Log4j2 remains an important choice. The official Apache Log4j2 documentation explains that asynchronous loggers can improve throughput through a dedicated I/O thread and use the LMAX Disruptor lock-free queue, which can provide higher throughput and lower latency in some scenarios. ([Apache Logging Services][11])

From a security perspective, Log4j 1.x reached end of life in 2015. Apache officially recommends that users upgrade to Log4j2 and states that Log4j 1.x issues will not be fixed. ([Apache Logging Services][12]) Log4j2 also had CVE-2021-44228. The NVD describes this vulnerability as related to JNDI features handling attacker-controlled LDAP and other endpoints, potentially causing remote code execution. The issue affected specific versions of `log4j-core`. ([National Vulnerability Database][13])

Therefore, on the Java business side, the practical selection order is: ordinary Spring Boot business services default to SLF4J + Logback; high-throughput asynchronous logging scenarios can use Log4j2 after security version constraints and performance validation; historical Log4j 1.x should not be selected for new systems; JUL is more suitable as JDK built-in infrastructure logging than as the main entry point for complex business log governance.

### 3.2 OpenTelemetry's Impact on Java Logging

OpenTelemetry does not require business systems to abandon existing logging libraries. The OpenTelemetry logging specification explicitly states that applications can use existing logging libraries and collect through OpenTelemetry appenders, or they can directly use the OpenTelemetry Logs API. The Collector can also read existing log files through the filelog receiver and parse or transform them. ([OpenTelemetry][5])

This means the reasonable migration path for Java applications is not to immediately replace Logback or Log4j2. Instead, prioritize unifying log structure, trace/span correlation fields, resource attributes, and the export path. Business-side logging libraries solve "how logs are produced"; OpenTelemetry solves "how logs are standardized, correlated, processed, and transmitted".

---

## 4. Evolution of Go Logging SDKs and the Position of Zap

Go's early standard library provides the `log` package, which satisfies simple logging output needs. Go 1.21 introduced `log/slog`. The official Go blog explains that `slog` is designed for structured logging and supports key-value form, making logs easier to parse, filter, and search. ([Go Packages][8])

In high-performance structured logging scenarios, Uber's Zap is a common choice in the Go ecosystem. The official Zap package documentation states that `Logger` provides fast, leveled, structured logging and is concurrency-safe. Its API favors performance and type safety, while `SugaredLogger` provides a more ergonomic but slightly slower interface. ([Go Packages][14])

In the OpenTelemetry era, the core standard for Go business-side logging SDKs is not only "writing fast". It also includes structured fields, context propagation, trace/span correlation, resource attribute injection, and unified export capability. For new applications, `slog` has the advantage of being in the standard library. For high-throughput scenarios, Zap still has performance and structured logging advantages. For enterprise log governance, both should convert logs into OpenTelemetry LogRecords or Collector-parseable structured logs through adapters, hooks, cores, or bridges.

---

## 5. Log Observability and Challenges in the ELK Era

The typical ELK-era log path is: business applications write files or standard output; Filebeat or Elastic Agent collects them; Logstash or an ingest pipeline processes them; Elasticsearch creates indexes; Kibana queries and visualizes them. In Elastic official documentation, Filebeat monitors and forwards log files, Logstash provides input/filter/output pipelines, Elasticsearch provides search and analytics, and Kibana provides querying, filtering, dashboards, and visualization. ([Elastic][3])

The main challenge of this model comes from split governance boundaries. The log path is usually maintained by Filebeat/Logstash/Elasticsearch, the metrics path may be maintained by Prometheus/node-exporter, and the tracing path may be maintained by Jaeger, Zipkin, or dedicated SDKs. The OpenTelemetry logging specification explicitly points out that the logging ecosystem has historically been split across different logging libraries, agents, protocols, and backends, and defines unified log model and telemetry correlation as goals. ([OpenTelemetry][5])

Therefore, the problem in the ELK era is not only storage cost or indexing cost. It is the lack of unified protocol, unified context, and unified transport layer between log governance and observability governance. Logs can be searched in Kibana, but their correlation with traces and metrics often depends on additional field conventions, manual agreements, or secondary processing by the platform.

---

## 6. Log Best Practices in the OpenTelemetry Era

OpenTelemetry-era log best practices can be summarized into four layers.

First, the business side continues using mature logging libraries, but log content should be structured. The OpenTelemetry logging specification requires all log records to eventually be expressible through a unified data model and support correlation through trace context, resource context, and time. ([OpenTelemetry][5])

Second, deploy OpenTelemetry Collector as an agent on the host or inside the Pod. The official OpenTelemetry agent deployment pattern explains that an application sends data through SDKs or other Collectors to a Collector instance on the same host or nearby, and that Collector then sends data to the backend. ([OpenTelemetry][15])

Third, use receiver, processor, and exporter to form pipelines inside the Collector. The official Collector architecture explains that receivers receive data, processors process it, exporters send it to external systems, and pipelines can separately process traces, metrics, and logs. ([OpenTelemetry][6])

Fourth, decouple the storage system from the collection standard. OpenTelemetry Collector can output logs, metrics, and traces to different backends. It is not a log storage system, but a telemetry component for unified collection, processing, and export. ([OpenTelemetry][2]) Elasticsearch can still be used as a log search and analytics backend, but it no longer has to be the entry point of log governance. ([Elastic][9])

---

## 7. Designing Log Transmission Paths for Large Enterprises

In large enterprises, log pipelines usually need to consider multi-language integration, multi-tenant isolation, peak shaving, unified cleaning, unified routing, access control, cost control, and offline archiving. A standard OpenTelemetry-based path can be expressed as:

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

In this path, OpenTelemetry Collector's receiver, processor, and exporter correspond to receiving, processing, and exporting stages. ([OpenTelemetry][6]) Kafka serves as the event streaming platform in this path. Apache Kafka officially defines itself as a distributed event streaming platform for high-performance data pipelines, stream analytics, data integration, and mission-critical applications, emphasizing high throughput, scalability, and durability. ([Apache Kafka][16])

The key purpose of using Kafka is not to replace the Collector, but to provide buffering, decoupling, and peak shaving between the Collector and storage/query backends. The Collector handles protocol standardization, context processing, and data export. Kafka handles stream buffering and consumer decoupling. Kafka Consumers write to Elasticsearch, offline storage, data lakes, or alerting systems. In this model, Elasticsearch moves back to the role of "log query and analytics backend" rather than the only center of end-to-end log governance.

---

## 8. Tradeoffs between Local Agent Direct-to-Kafka and Adding an OpenTelemetry Gateway

OpenTelemetry officially distinguishes agent and gateway deployment patterns. In the agent pattern, the Collector is deployed on the same host, same Pod, or nearby the application. The application sends OTLP data to the local Collector, and the Collector sends it to the backend. ([OpenTelemetry][15]) In the gateway pattern, applications or other Collectors send telemetry to a centralized OTLP endpoint, and the gateway Collector sends it to the backend. ([OpenTelemetry][17])

If the local agent sends directly to Kafka, the path is shorter and has fewer failure points. Kafka already provides buffering, durability, and peak shaving. This solution fits scenarios where the enterprise internal network boundary is clear, Kafka authentication and topic standards can be distributed to agents, and the main producers are internal business services. The cost is that Kafka addresses, credentials, topic routing, protocol versions, and rate-limit policies need to be pushed down to many agent nodes.

If the local agent first forwards to an OpenTelemetry Gateway and the gateway writes to Kafka, the gateway can provide a unified OTLP entry point, centralized credential management, unified policy, and unified routing. The official OpenTelemetry gateway documentation also lists centralized credentials and centralized policy as advantages, while explicitly noting that a gateway adds extra maintenance objects, potential failure points, latency, and resource consumption. ([OpenTelemetry][17])

Therefore, in the core logging pipeline, whether to add an OpenTelemetry Gateway should not be judged by whether Kafka needs peak shaving, because Kafka itself is already used for event-stream buffering. A more reasonable criterion is whether a unified entry point, cross-network-boundary access, centralized authentication, unified OpenAPI, unified multi-tenant governance, or hiding Kafka from external systems is needed. If only internal service logs enter Kafka, adding a gateway adds one hop of risk. If the access scope needs to expand and admission standards need to be unified, a gateway has engineering necessity.

---

## 9. Engineering Meaning of a Custom OpenTelemetry Collector

OpenTelemetry officially provides Collector Builder, which can generate Collector binaries containing custom or upstream components. The build manifest can declare receivers, processors, exporters, extensions, and other components. ([OpenTelemetry][18]) This provides a foundation for enterprises to customize log agents, protocol adapters, field cleaning, routing policies, authentication extensions, and Kafka exporter wrappers.

`stellhub/stello11y-opentelemetry-collector` is a custom Collector repository in this direction. The repository documentation positions the project as a local log agent responsible for receiving OTLP LogRecords sent by SDKs, standardizing, enriching, cleaning, buffering, retrying, routing logs, and writing them to Kafka. The main path shown in its README is that business applications send OTLP/gRPC to the local agent through SDKs, the agent writes to Kafka, and the data finally enters backend consumption and query systems. ([GitHub][19])

From a learning and extension perspective, this repository can serve as an engineering example for understanding OpenTelemetry Collector secondary development, OTLP log ingestion, Kafka log pipelines, log cleaning, backpressure and retry, and self-observability. For teams that want to migrate from ELK collection mode to OpenTelemetry unified telemetry mode, this project can serve as an experimental entry point and extension base for custom Collectors. ([GitHub][19])

---

## 10. Conclusion

Log governance has gone through four stages: local files, centralized collection, ELK platformization, and OpenTelemetry standardization. ELK solves centralized indexing, search, and visualization. OpenTelemetry further solves the unification of logs, metrics, and traces at the collection, context, processing, and transport layers. Elastic Stack can still serve as a log search and analytics backend, while OpenTelemetry Collector is better suited as the unified telemetry entry point and transport governance layer for enterprises. ([Elastic][1])

On the business side, Java applications should prioritize structured logging based on SLF4J and Spring Boot's default Logback system. High-throughput scenarios can adopt Log4j2 after security version and performance validation. Go applications can build structured logs based on standard-library `slog` or Zap and enter the unified pipeline through OpenTelemetry adapters. ([Home][10])

On the platform side, enterprise logging pipelines are better suited to using OpenTelemetry Collector as a local agent, using processors for cleaning, enrichment, rate limiting, and routing, then using Kafka for peak shaving and buffering, and finally having consumers write to Elasticsearch or offline storage. Whether to introduce an OpenTelemetry Gateway should be judged by unified access, centralized authentication, multi-tenant governance, and network boundary needs, rather than treating the gateway as a replacement for Kafka buffering. ([OpenTelemetry][6])

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
[19]: https://github.com/stellhub/stello11y-opentelemetry-collector "GitHub - stellhub/stello11y-opentelemetry-collector: Custom OpenTelemetry Collector distribution for StellHub observability, telemetry pipelines, metrics, logs, and traces."
