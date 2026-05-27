---
title: "The Evolution of Distributed Tracing: From Call-Chain Visualization to Cloud-Native Observability Standards"
category: "Observability"
summary: "A historical and architectural review of distributed tracing from Dapper, EagleEye, Zipkin, Jaeger, and SkyWalking to OpenTelemetry and Tempo, explaining how tracing became a cloud-native observability signal."
tags:
  - "Distributed Tracing"
  - "OpenTelemetry"
  - "Jaeger"
  - "SkyWalking"
  - "Tempo"
readingDirection: "Read this when studying tracing history, evaluating observability architecture, planning OpenTelemetry adoption, or comparing Zipkin, Jaeger, SkyWalking, and Tempo."
outline: deep
---

# The Evolution of Distributed Tracing: From Call-Chain Visualization to Cloud-Native Observability Standards

## Overview

A historical and architectural review of distributed tracing from Dapper, EagleEye, Zipkin, Jaeger, and SkyWalking to OpenTelemetry and Tempo, explaining how tracing became a cloud-native observability signal.

## Abstract

Distributed tracing is a key technology in distributed systems, microservice architectures, and cloud-native systems. It reconstructs request paths, locates latency sources, and analyzes service dependencies. Its development can be divided into four broad stages. Before 2010, internal systems at large internet companies, represented by Google Dapper and Taobao EagleEye, addressed the "black box" problem of large-scale distributed systems. From 2012 to 2016, open source systems such as Zipkin and Jaeger established a layered architecture for collection, storage, query, and visualization. From 2015 to 2019, SkyWalking reduced business-code intrusion through agent-based automatic instrumentation. After 2019, OpenTracing and OpenCensus merged into OpenTelemetry, and tracing entered the observability era of unified metrics, logs, and traces collection and processing. Based on official materials from Google, CNCF, OpenTelemetry, Jaeger, Zipkin, Apache SkyWalking, and Grafana Tempo, this article reviews the history, representative systems, and technical paradigms of distributed tracing.

**Keywords**: distributed tracing; Dapper; Zipkin; Jaeger; SkyWalking; OpenTelemetry; Tempo; observability

---

## 1. Introduction

Distributed tracing emerged from diagnosability problems caused by the expansion of distributed systems. A user request in a modern service system may pass through gateways, business services, RPC services, caches, databases, message queues, and third-party services. Logs, metrics, or error codes from a single service can only describe local phenomena and cannot directly reconstruct the full propagation path of one request across services. The Google Dapper paper states that, in large-scale systems spanning multiple programming languages, thousands of machines, and multiple physical facilities, tools that help understand system behavior and analyze performance problems are valuable. Dapper's goal was to provide distributed tracing with low overhead, application-level transparency, and large-scale deployment. ([Google Research][1])

Technically, distributed tracing is not a single tool. It is a diagnostic system built around Trace, Span, Context Propagation, Sampling, Storage, Query, and Visualization. Zipkin defines itself as a distributed tracing system that collects timing data needed to troubleshoot latency problems in service architectures and provides collection and query capabilities. Jaeger positions itself as a distributed tracing platform for monitoring and troubleshooting distributed workflows, identifying performance bottlenecks, locating root causes, and analyzing service dependencies. ([Zipkin][2])

---

## 2. Stage One: Emergence and Exploration Before 2010

### 2.1 Background: The "Black Box" Problem in Large Internet Systems

Before 2010, distributed tracing mainly existed as internal infrastructure at large internet companies. Google's Dapper is the representative system of this stage. When the Dapper paper was published, Google had already built and used the system in production for more than two years. The Google Research page explains that Dapper started as a self-contained tracing tool and later evolved into a monitoring platform that supported several analysis tools the designers did not initially expect. ([Google Research][3])

The core problem in this stage was that systems had already become distributed, while diagnostic tools were still centered on single-machine logs, local metrics, and manual investigation. When one request crossed multiple services, threads, machines, data centers, and language runtimes, single-point logs could not answer three basic questions: which services did the request pass through, how long did each service take, and where did failure or slowness occur? Dapper's design choices included sampling, instrumentation in a small number of common libraries, application-level transparency, and low-overhead deployment. These choices show that the core constraint for early tracing systems was not "can everything be recorded," but "can enough diagnostically useful information be continuously recorded at acceptable cost in large-scale production." ([Google Research][3])

### 2.2 Technical Significance of Google Dapper

Dapper's main contribution was proposing and validating the basic model later used by distributed tracing systems for a long time: one request corresponds to one Trace; each important call segment corresponds to one Span; context propagation organizes multiple spans into parent-child or causal relationships; the result is a call tree that can be queried, aggregated, and displayed. The Dapper paper emphasized low overhead, application-level transparency, and ubiquitous deployment, which later became important design criteria for open source tracing systems and commercial APM systems. ([Google Research][1])

From an engineering perspective, Dapper advanced tracing from a "log search technique" to an infrastructure capability. Instead of requiring every business developer to print logs manually in every code segment, Dapper used common communication libraries, sampling, and a unified data model to turn distributed call relationships into platform data. This idea influenced Zipkin, Jaeger, SkyWalking, OpenTelemetry, and many other systems.

### 2.3 The Position of Taobao EagleEye

Large internet companies in China encountered similar problems in roughly the same period. Public presentation materials describe Taobao EagleEye as a log-based distributed call tracing system used for call-chain tracing and related to Google Dapper's ideas. Because EagleEye was primarily an internal enterprise system and public, verifiable official engineering documentation is limited, a rigorous description should treat it as an early representative of internal tracing practice in large Chinese internet companies, rather than as an open standard or public specification. ([docs.huihoo.com][4])

The historical conclusion of this stage is that distributed tracing was not first invented by the open source community. It was driven by diagnosability needs in large-scale internet production systems. Its initial goal was to solve invisible distributed call chains, experience-dependent failure diagnosis, and performance bottlenecks that were hard to attribute.

---

## 3. Stage Two: Open Source Expansion and Componentization, 2012-2016

### 3.1 Background: Open Source Replication After the Dapper Model

After the Dapper paper became public, the open source community began building distributed tracing systems around similar models. This stage occurred alongside the expansion of microservice architecture: service counts grew, RPC call chains became longer, team boundaries multiplied, and monolithic-era log investigation methods no longer covered cross-service call paths. Distributed tracing gradually moved from internal enterprise infrastructure to open source toolchains.

Zipkin is a key open source project in this stage. Zipkin documentation says its functions include collecting and querying trace data. Applications report trace data through tracers or instrumentation libraries; data can be reported over HTTP, Kafka, and other transports; UI data can be stored in memory or persisted to Cassandra, Elasticsearch, and other backends. ([Zipkin][2])

### 3.2 Zipkin: The Basic Open Source Tracing Architecture

Zipkin's importance is not only that it "can trace." It also split tracing into clearer component boundaries: client instrumentation or tracers generate data, collectors receive data, storage persists data, and query services plus UI retrieve and display data. Zipkin documentation around collection, query, storage, UI, and dependency graphs shows that the basic architecture of open source tracing systems had already taken shape. ([Zipkin][2])

The typical data flow of this stage can be summarized as:

```text
Application / Library Instrumentation
        |
Reporter / Tracer
        |
Collector
        |
Storage
        |
Query API
        |
Web UI / Dependency Graph
```

This layered architecture had significant influence. Jaeger, SkyWalking, and OpenTelemetry Collector plus backend solutions all essentially continue the separation of data generation, receiving, processing, storage, query, and visualization.

### 3.3 Jaeger: A Tracing Platform for Production Microservices

Jaeger is another important representative of the later part of this stage. Jaeger documentation states that it was open sourced by Uber Technologies in 2016, donated to CNCF, and became a CNCF graduated project. Its use cases include monitoring and troubleshooting distributed workflows, identifying performance bottlenecks, locating root causes, and analyzing service dependencies. ([Jaeger][5])

The CNCF project page shows that Jaeger was accepted by CNCF as an incubating project on September 13, 2017 and moved to graduated status on October 31, 2019. This timeline indicates that Jaeger was not a one-off tool; it obtained project governance, production adoption, and community maturity validation in the cloud-native ecosystem. ([CNCF][6])

Architecturally, Jaeger strengthened the production microservice capabilities of the Zipkin-style model. Jaeger documentation lists features including an OpenTracing-inspired data model, OpenTelemetry compatibility, multiple built-in storage backends, Kafka buffering, service dependency graphs, and adaptive sampling. ([Jaeger][5])

This stage can be summarized as the componentization period. Tracing evolved from a paper model and internal systems into deployable open source platforms with replaceable storage, query, and visualization. Zipkin established the basic engineering form of open source tracing, while Jaeger further pushed that form toward production microservices.

---

## 4. Stage Three: Non-Intrusive Instrumentation and Ecosystem Expansion, 2015-2019

### 4.1 Background: The Cost of Manual Instrumentation

As microservice scale increased, traditional manual instrumentation exposed clear governance costs. Manual instrumentation required business developers to explicitly integrate SDKs or add instrumentation code at entry points, exits, RPC calls, database access, caches, and message queue boundaries. As services, languages, and framework versions kept increasing, instrumentation consistency, upgrade cost, and coverage became difficult to guarantee.

SkyWalking is a typical representative of this stage. Apache SkyWalking documentation defines it as an open source observability platform for collecting, analyzing, aggregating, and visualizing data from services and cloud-native infrastructure. Its capabilities include distributed tracing, service mesh telemetry analysis, metric aggregation, alerting, and visualization. ([Apache SkyWalking][7])

### 4.2 SkyWalking: Agent-Centered Automatic Instrumentation

SkyWalking's key technical path is agent-based automatic instrumentation. SkyWalking documentation for the Service Auto Instrument Agent states that automatic instrumentation agents are a subset of language-native agents and are usually based on virtual-machine language features. For end users, in most cases, business code does not need to be modified; in reality, the code is modified by the agent at runtime through runtime code manipulation, such as Java's `javaagent premain`. ([Apache SkyWalking][8])

This means "non-intrusive" does not mean "no code changes anywhere." It means business source code usually does not need to change. The actual mechanism is that the agent enhances known frameworks or libraries at runtime, including HTTP servers, RPC clients, database drivers, and message queue clients. It automatically generates spans, propagates trace context, and collects duration and status information. SkyWalking documentation also states that automatic instrumentation has limits: it usually applies only to specific frameworks or libraries, and cross-thread operations are not always naturally supported. ([Apache SkyWalking][8])

### 4.3 Architectural Significance of SkyWalking

SkyWalking's significance is not just "reducing business code changes." It advanced tracing from a tracing backend into an APM and observability platform. The Apache SkyWalking homepage states that SkyWalking is cloud-native, collects, analyzes, aggregates, and visualizes telemetry from services and cloud-native infrastructure, covers distributed tracing, metrics, logs, profiling, and alerting, and supports multi-language agents plus eBPF on Kubernetes. ([Apache SkyWalking][9])

Compared with Zipkin and Jaeger, SkyWalking emphasizes end-to-end application performance monitoring, service topology, agent plugin ecosystems, and out-of-the-box analysis capability. Its typical path is:

```text
Business Service
  + SkyWalking Agent
        |
OAP Server
        |
Storage Backend
        |
SkyWalking UI / Topology / Metrics / Trace / Alarm
```

The historical conclusion of this stage is that the main contradiction of tracing shifted from "whether we have a tracing system" to "how to connect enough services to the tracing system with low cost, stability, and consistency." Agent-based automatic instrumentation became an important path for solving large-scale adoption, and SkyWalking represents that path in the open source ecosystem.

---

## 5. Stage Four: Unification and the Observability Era, 2019 to Present

### 5.1 Background: Trace Alone Is Not Enough and Standards Were Fragmented

After 2019, tracing entered the observability era. This stage has two basic facts. First, Trace alone is not enough to describe system state completely. Trace answers where a request went and how long each segment took, but capacity, throughput, error rate, resource utilization, and log context still require Metrics and Logs. Second, standards such as OpenTracing and OpenCensus coexisted, causing fragmentation across APIs, SDKs, data models, and backend adapters.

Google Open Source Blog published an article on May 21, 2019 explaining that OpenCensus and OpenTracing merged into a new project named OpenTelemetry. The goal was to combine the strengths of both projects and provide a smooth migration experience. The article also stated that OpenTelemetry became a CNCF project. ([Google Open Source Blog][10])

OpenTelemetry's homepage defines it as an open source observability framework for cloud-native software, providing unified APIs, libraries, agents, and Collector services for capturing distributed traces and metrics. It also states that OpenTelemetry builds on years of experience from OpenTracing and OpenCensus and integrates community practice. ([OpenTelemetry][11])

### 5.2 OpenTelemetry: From Tracing Tool to Telemetry Standard

OpenTelemetry's key change is its role. It is not just a Trace UI or a single storage system. It is a standard for generating, collecting, processing, and exporting telemetry data. CNCF's 2024 article on OpenTelemetry certification states that OTel is an open source observability framework for collecting, processing, and exporting telemetry data such as traces, metrics, and logs. It also notes that OpenTelemetry was accepted by CNCF on May 7, 2019, entered incubation on August 26, 2021, and is the second most active CNCF project after Kubernetes. ([CNCF][12])

As of May 21, 2026, CNCF announced OpenTelemetry's graduation and described it as a vendor-neutral open source observability framework for standardizing collection, processing, and export of metrics, logs, and traces. CNCF also said this milestone reflected broad production adoption and a stable vendor-neutral observability standard. ([CNCF][13])

The OpenTelemetry Collector is a key component in this system. Official documentation states that the Collector provides a vendor-agnostic way to receive, process, and export telemetry data, reducing the need to run and maintain multiple agents or collectors. It can receive open source observability data formats from Jaeger, Prometheus, Fluent Bit, and others, and send data to one or more open source or commercial backends. Collector goals also include usability, performance, observability, extensibility, and unification. Unification means one codebase can be deployed as an agent or collector and support traces, metrics, and logs. ([OpenTelemetry][14])

A typical OpenTelemetry data path is:

```text
Application
  + OTel SDK / Auto Instrumentation
        | OTLP
OpenTelemetry Collector
  + receivers
  + processors
  + exporters
        |
Tracing Backend / Metrics Backend / Logging Backend
        |
Grafana / Alerting / Analysis
```

This architecture decouples instrumentation standards from backend systems. Applications only need to follow OpenTelemetry APIs, SDKs, semantic conventions, and OTLP. Backends can be Jaeger, Tempo, Prometheus, Loki, commercial APM systems, or enterprise-built systems.

### 5.3 Tempo: A Tracing Backend in the OpenTelemetry Era

After OpenTelemetry solves collection and standardization, Trace data still needs backend systems for storage, query, and visualization. Grafana Tempo is a common tracing backend in the OpenTelemetry era. Grafana Tempo documentation defines it as an open source, easy-to-use, high-scale distributed tracing backend. It supports searching traces, generating metrics from spans, and correlating tracing data with logs and metrics. ([Grafana Labs][15])

Tempo's core engineering direction is reducing the complexity of large-scale Trace storage and query. Documentation states that Tempo only needs object storage to run and integrates deeply with Grafana, Mimir, Prometheus, and Loki. It also supports open source tracing protocols such as Jaeger, Zipkin, and OpenTelemetry. ([Grafana Labs][15])

Tempo architecture documentation further states that Tempo stores all tracing data in object storage and supports object storage APIs such as S3, GCS, and Azure Storage. On the query path, Querier searches for a specified Trace ID in ingesters and backend storage, using bloom filters and indexes to locate trace data inside object-storage blocks. ([Grafana Labs][16])

The OpenTelemetry + Tempo implementation model can be summarized as:

```text
Business application
  | OTel SDK / Java Agent / Go SDK / Node SDK
OTLP gRPC / HTTP
  |
OpenTelemetry Collector
  |
Tempo Distributor / Ingester
  |
Object Storage
  |
Tempo Query Frontend / Querier
  |
Grafana Trace UI
  <-> Loki Logs
  <-> Prometheus / Mimir Metrics
```

This combination has clear responsibility boundaries: OpenTelemetry unifies instrumentation, protocols, collection, and forwarding; Tempo stores and queries traces; Grafana visualizes and correlates logs, metrics, and traces. It reflects the key paradigm of the fourth stage: tracing is no longer an isolated system, but one signal source in an observability platform.

---

## 6. Comparison of the Four Stages

| Stage | Time | Representative Systems | Core Problem | Technical Paradigm |
| --- | ---: | --- | --- | --- |
| Emergence and exploration | Before 2010 | Google Dapper, Taobao EagleEye | Distributed systems became black boxes; call paths were invisible | Trace/Span model, context propagation, sampling, common-library instrumentation |
| Open source and componentization | 2012-2016 | Zipkin, Jaeger | Microservices needed deployable open source tracing systems | Collector, Storage, Query, UI layering |
| Non-intrusive instrumentation and ecosystem expansion | 2015-2019 | SkyWalking | Manual instrumentation had high rollout cost and uncertain coverage | Agent automatic instrumentation, APM, topology, metrics, alerting |
| Unification and observability era | 2019 to present | OpenTelemetry, Tempo | Standard fragmentation and Trace-alone insufficiency | Unified Metrics/Logs/Traces collection, OTLP, Collector, backend decoupling |

---

## 7. Discussion: The Main Line of Distributed Tracing Evolution

Distributed tracing did not evolve through simple tool replacement. It evolved along three directions.

First, **from local logs to request-level causality chains**. Dapper modeled a request's cross-service propagation path as a traceable object, solving the inability of single-point logs to describe global call relationships. ([Google Research][1])

Second, **from internal systems to open source platforms**. Zipkin combined collection, query, storage, and UI into a deployable system. Jaeger further engineered that pattern and entered CNCF governance, becoming a mature tracing platform for cloud-native microservice environments. ([Zipkin][2])

Third, **from tracing tools to observability standards**. SkyWalking reduced adoption cost through agent-based automatic instrumentation. OpenTelemetry solved ecosystem fragmentation through unified APIs, SDKs, protocols, and Collector. Tempo serves as a backend system for high-scale trace storage and query. ([Apache SkyWalking][8])

---

## 8. Conclusion

The development of distributed tracing can be summarized as a clear line: large internet companies first solved the invisibility of distributed calls in internal systems; the open source community then engineered the Dapper model into deployable systems such as Zipkin and Jaeger; as microservices scaled, agent-based platforms such as SkyWalking reduced business adoption cost; after 2019, OpenTelemetry advanced tracing from a single tool into a unified telemetry standard for metrics, logs, and traces, while backends such as Tempo handled high-scale trace storage, query, and Grafana ecosystem integration in cloud-native scenarios.

Based on current facts, distributed tracing is no longer merely a tool for "viewing call chains." It is a foundational signal in cloud-native observability. A more accurate technical boundary is: OpenTelemetry standardizes collection, processing, and export; Tempo, Jaeger, SkyWalking, and similar systems provide different forms of storage, analysis, and visualization; Grafana and similar platforms provide correlated views across Trace, Metric, and Log. This responsibility split is the main engineering form of distributed tracing in the observability era.

---

## References

[1] Google Research, *Dapper, a Large-Scale Distributed Systems Tracing Infrastructure*.
[2] OpenZipkin official documentation.
[3] Jaeger official documentation and CNCF Jaeger project page.
[4] Apache SkyWalking official documentation.
[5] Google Open Source Blog, *OpenTelemetry: The Merger of OpenCensus and OpenTracing*.
[6] OpenTelemetry official documentation and CNCF OpenTelemetry announcements.
[7] Grafana Tempo official documentation.

[1]: https://research.google.com/archive/papers/dapper-2010-1.pdf?utm_source=chatgpt.com "Dapper, a Large-Scale Distributed Systems Tracing ..."
[2]: https://zipkin.io/ "OpenZipkin · A distributed tracing system"
[3]: https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/ "Dapper, a Large-Scale Distributed Systems Tracing Infrastructure"
[4]: https://docs.huihoo.com/javaone/2013/CON1361-Taobao.pptx?utm_source=chatgpt.com "EagleEye under Taobao"
[5]: https://www.jaegertracing.io/docs/latest/ "Introduction | Jaeger"
[6]: https://www.cncf.io/projects/jaeger/ "Jaeger | CNCF"
[7]: https://skywalking.apache.org/docs/main/next/readme/ "Welcome | Apache SkyWalking"
[8]: https://skywalking.apache.org/docs/main/next/en/concepts-and-designs/service-agent/ "Service Auto Instrument Agent | Apache SkyWalking"
[9]: https://skywalking.apache.org/?utm_source=chatgpt.com "Apache SkyWalking"
[10]: https://opensource.googleblog.com/2019/05/opentelemetry-merger-of-opencensus-and.html "OpenTelemetry: The Merger of OpenCensus and OpenTracing | Google Open Source Blog"
[11]: https://opentelemetry.io/?utm_source=chatgpt.com "OpenTelemetry"
[12]: https://www.cncf.io/blog/2024/11/15/gain-insights-into-cloud-native-applications-with-the-opentelemetry-certified-associate-otca/ "Gain insights into cloud native applications with the OpenTelemetry Certified Associate (OTCA) | CNCF"
[13]: https://www.cncf.io/announcements/2026/05/21/cloud-native-computing-foundation-announces-opentelemetrys-graduation-solidifying-status-as-the-de-facto-observability-standard/ "Cloud Native Computing Foundation Announces OpenTelemetry's Graduation, Solidifying Status as the De Facto Observability Standard | CNCF"
[14]: https://opentelemetry.io/docs/collector/ "Collector | OpenTelemetry"
[15]: https://grafana.com/docs/tempo/latest/ "Grafana Tempo | Grafana Tempo documentation"
[16]: https://grafana.com/docs/tempo/latest/introduction/architecture/ "Tempo architecture | Grafana Tempo documentation"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/tracing)
