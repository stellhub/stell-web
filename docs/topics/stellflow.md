---
title: "Self-Built Enterprise Message Queue Architecture Based on the Distributed Log Model: Stellflow as an Example"
category: "Messaging Infrastructure"
summary: "A Stellflow-based study of self-built enterprise message queue architecture, covering distributed log modeling, data-plane protocol design, broker request paths, storage, controller quorum, replicas, high-throughput data paths, and OpenTelemetry-first observability."
tags:
  - "Stellflow"
  - "Message Queue"
  - "Distributed Log"
  - "Raft"
  - "OpenTelemetry"
readingDirection: "Read this when designing an enterprise message queue, building a distributed log system, planning broker/controller architecture, replication high-watermark rules, protocol evolution, or observability metrics."
outline: deep
---

# Self-Built Enterprise Message Queue Architecture Based on the Distributed Log Model: Stellflow as an Example

## Overview

A Stellflow-based study of self-built enterprise message queue architecture, covering distributed log modeling, data-plane protocol design, broker request paths, storage, controller quorum, replicas, high-throughput data paths, and OpenTelemetry-first observability.

## Abstract

The core problem of an enterprise message queue is not "implementing a message send and consume API." It is building a distributed log system that can be persisted, replicated, scaled, governed, and observed. This paper uses `stellhub/stellflow-service` as a case study, summarizes the design documents under its `docs` and `docs/adr` directories, and combines them with official or authoritative materials for Apache Ratis, Raft, Netty, gRPC, and OpenTelemetry to outline a paper-style self-built architecture for an enterprise message queue. The current Stellflow documentation positions the project as a distributed message queue based on JDK 25. It keeps Kafka-style core semantics such as Topic, Partition, Replica, ISR, Offset, and Controller Quorum, while adopting a more modern engineering path for the control plane, communication framework, and observability.

**Keywords**: message queue; distributed log; Broker; Controller Quorum; Raft; Replica; OpenTelemetry; Netty; gRPC

---

## 1. Introduction

Enterprise message queues usually carry responsibilities such as asynchronous decoupling, event distribution, streaming transmission, high-throughput log aggregation, traffic smoothing, and task buffering. Stellflow's high-level design defines it as a "distributed log and message queue platform" and explicitly centers the domain model on Topic, Partition, Replica, Leader, ISR, Consumer Group, Offset, Epoch, and Metadata Log. This positioning shows that the real focus of a self-built system should be the distributed-log fact model, partition replication, control-plane metadata consistency, broker hot-path processing, client protocol evolution, and observable governance, rather than merely wrapping a producer and consumer SDK.

From an engineering perspective, Stellflow's direction is correct: an enterprise MQ should not first pursue a wide surface of features. It should first stabilize log storage, protocol design, replication, high watermark, metadata, failover, and observability semantics. The Stellflow README also states that the repository is still in the design and skeleton-planning stage, with an emphasis on solidifying the overall architecture, module boundaries, communication, storage, control plane, and observability path.

---

## 2. Summary of Architecture Decision Records

Stellflow's ADR index shows that seven architecture decision records have already been accumulated. They cover key topics such as the communication protocol, control-plane consistency, storage core, observability, multi-language protocol versioning, metadata discovery and broker scaling, and OpenTelemetry metric naming. The ADR documents themselves define their purpose as recording context, alternatives, final choices, reasons, constraints, and consequences. Therefore, these ADRs can serve as the architectural baseline for the current self-built MQ.

Stellflow's communication decision is layered communication: the Broker/Client data plane uses a custom binary protocol, the Java client uses Netty at the lower layer, inter-broker replication reuses the same binary protocol, and the Controller/Broker control plane uses gRPC. This decision preserves binary-protocol control for the high-throughput data plane while giving the control plane IDL, cross-language code generation, and interface evolution capabilities. The official Netty site defines Netty as an asynchronous event-driven network application framework for the rapid development of maintainable high-performance protocol servers and clients, and as an NIO client/server framework. ([netty.io][1]) The gRPC official documentation explains that gRPC is based on service definitions, uses Protocol Buffers by default as the IDL for service interfaces and message structures, and can generate client and server code. ([gRPC][2])

For control-plane consistency, Stellflow chooses Apache's Raft implementation instead of implementing a general-purpose consensus protocol by itself. This choice is reasonable: consensus protocols have high engineering risk, and the main value of a message queue project should lie in the metadata model, broker collaboration, replicated state machines, and log storage, not in reimplementing a general consensus algorithm. Apache Ratis describes itself as a Java implementation of the Raft protocol for Java applications that need to replicate state across multiple instances, with pluggable transport, state machine, Raft log, and metrics layers. ([ratis.apache.org][3]) The Raft website explains that Raft is a consensus algorithm designed to be easy to understand, equivalent to Paxos in fault tolerance and performance, and decomposes consensus into relatively independent subproblems; a consensus system can make progress as long as a majority of servers are available, and it does not return incorrect results. ([raft.github.io][4])

For the storage core, Stellflow explicitly adopts a self-built `UnifiedLog + LogSegment + OffsetIndex + TimeIndex` model. It does not use a third-party KV store as the primary message storage, and it does not introduce gRPC into the main message read/write path. This judgment is crucial: the primary fact model of an enterprise MQ should be an append-only log, not a KV store. KV storage is suitable for state indexes or auxiliary state, but not as a replacement for the primary message log.

For observability, Stellflow chooses OpenTelemetry-first and no longer treats JMX as the primary exposure method. This decision fits the requirements of multi-language clients, cloud-native platforms, and unified observability pipelines. The OpenTelemetry metrics data model states that OTel Metrics consists of protocol specifications and semantic conventions, can be used to import data from existing systems, export data to existing systems, and generate metrics from Span or Log streams. ([OpenTelemetry][5]) OTel also defines the Event Model, Timeseries Model, and Metric Stream Model for metrics, and defines a time-series entity as a combination of metadata such as metric name, attributes, value type, and unit. ([OpenTelemetry][5])

---

## 3. Overall Architecture Model

An enterprise MQ should be divided into at least four layers: the client layer, the Broker data plane, the Controller control plane, and the operations and observability toolchain. Stellflow's high-level design also separates roles such as Producer/Admin Client, Consumer, Broker Data Plane, Local Log Storage, Replication Plane, Controller Quorum, and Tools/Metrics/Ops. This layering is necessary because message append, fetch, replication, and disk flush belong to the data plane, while Broker registration, partition assignment, Leader election, and metadata changes belong to the control plane.

The Broker should handle Produce, Fetch, ListOffsets, and OffsetCommit requests; local partition logs, indexes, cleanup, and retention policies; and Leader/Follower replica roles. The Controller Quorum should manage the metadata log, Broker registration, Topic/Partition/Replica assignment, partition Leader election, and failover. The Producer should handle metadata fetching, record-batch aggregation, partition routing, retries, timeouts, idempotence, and compression. The Consumer should handle partition fetch, consumption position, Consumer Group, rebalancing, backpressure, and commit strategy.

---

## 4. Data-Plane Protocol Design

Stellflow's protocol specification defines the data plane as "TCP + a custom binary request/response protocol + semantic APIs such as Produce, Fetch, Metadata, and ApiVersions." It explicitly states that this protocol applies to Broker/Client data-plane communication and inter-broker replication communication, but not to Controller/Broker control-plane gRPC. The protocol uses a length prefix, a unified request header, a unified response header, explicit `apiKey`, `apiVersion`, `headerVersion`, `correlationId`, error codes, and capability negotiation.

The key question is not whether it "looks like Kafka." The key question is whether it satisfies four hard requirements of an enterprise protocol: first, it must be implementable across languages; second, protocol versions must be evolvable; third, requests and responses must be correlatable; and fourth, gray releases must be negotiable. Stellflow's ADR-0005 explicitly requires every protocol request to contain `apiKey` and `apiVersion`, requires the Broker to expose protocol-version query capability, and requires clients to choose an available version based on the capability range returned by the Broker instead of assuming that the server supports the latest version.

The presence of `traceId`, `spanId`, `tenantId`, `quotaKey`, `authContextId`, `trafficClass`, and `trafficTag` in the request header reflects enterprise governance capability. These fields serve distributed tracing, multi-tenancy, quota, authentication context, traffic classification, and experiment tagging respectively. The judgment here is clear: these fields cannot be added as an afterthought. Once a protocol has been released, introducing governance context later will significantly increase compatibility cost.

---

## 5. Broker Request Processing Path

Stellflow's Broker request processing path is divided into eight stages: connection establishment, network read event, request-frame reading and header parsing, protocol-object deserialization, enqueueing into `RequestChannel`, business-thread processing, response encoding, and asynchronous write-back by the network thread. This model prevents I/O threads from carrying heavy business logic and forms a clear main path through `SocketServer -> RequestChannel -> BrokerApis -> Domain Service -> Async Response`.

The correct processing flow for a Produce request should include version validation, authentication, authorization, Topic/Partition/Leader validation, message-size and quota validation, append to `ReplicaManager` and `UnifiedLog` by partition, and then either immediate response or delayed completion according to `acks` and `min.insync.replicas`. Fetch requests need to distinguish ordinary Consumers from Follower Replicas, and visibility must be controlled by the high watermark or the last stable offset. This is the baseline of an enterprise MQ: ordinary consumers must not read data that has not reached the consistency visibility boundary, while replica replication needs to read data that is already persisted even if it is beyond the high watermark.

---

## 6. Storage-Layer Design

Stellflow's detailed storage design limits storage responsibility to maintaining the "local log fact." It is not responsible for the network protocol, Topic metadata assignment, ISR election, or Consumer Group coordination. Core objects include `LogManager`, `UnifiedLog`, `LogSegments`, `LogSegment`, `OffsetIndex`, `TimeIndex`, `TransactionIndex`, `LogCleaner`, `LogRetentionManager`, and `LogRecoveryService`.

From the engineering perspective of an enterprise MQ, `UnifiedLog + LogSegment + OffsetIndex + TimeIndex` is the main trunk that must be completed first. Log segments are responsible for sequential append, offset indexes provide sparse mapping from offset to physical position, time indexes locate offsets by timestamp, and recovery logic rebuilds indexes after startup, truncates partially written tail batches, and calculates LEO and the recovery point. The five capabilities proposed in the Stellflow documentation, namely sequential append, recoverability, truncation, indexing, and replication, are more fundamental delivery standards than upper-layer APIs.

The storage layer should not treat each message as an independent file or independent KV item. The correct model is to maintain a logical log by TopicPartition. Each logical log consists of multiple segment files, and each segment contains a data file, offset index, time index, transaction index, and recovery auxiliary files. The write path must be serial within a single partition and parallel across partitions; the read path should locate data through indexes and then read sequentially; and the recovery process must be idempotent.

---

## 7. Controller and Replica Design

Stellflow's Controller and Replica design separates the control plane from the replication subsystem: the Controller is responsible for metadata commands, the state machine, and change broadcasts; Replica is responsible for partition-replica runtime state, synchronization, and the high watermark; and Storage is responsible for persisting log facts. The Controller uses an append-only metadata log as the source of truth. The metadata-change flow receives commands, generates records, appends the log, replays the state machine after commit, updates the in-memory view, and broadcasts incremental changes.

The core of the Replica side is the Leader/Follower model, ISR set, high-watermark advancement, and Leader Epoch. A Follower sends replication Fetch requests to the Leader through `ReplicaFetcherThread`. The Leader validates the Epoch, partition state, and readable range, then returns data, high watermark, and Leader Epoch. The Follower performs truncation when necessary and writes to the local log through `appendAsFollower`.

The least negotiable part is the high-watermark rule. The Stellflow documentation explicitly requires the Leader high watermark to depend on the minimum synchronized position among replicas in the ISR, requires the high watermark to advance monotonically, and requires high-watermark advancement to trigger read-visibility updates and delayed-request completion. ISR changes must be persisted by the Controller as metadata records and then applied back to the Broker runtime. Changing ISR only in Broker local memory is not acceptable, because it splits the source of truth for the control plane.

---

## 8. Metadata Discovery and Scaling

Stellflow's ADR-0006 defines metadata discovery as `bootstrap servers + metadata + stable logical addresses`. A client is bootstrapped by a set of bootstrap servers. After connecting to any reachable node, it obtains the full cluster view through a Metadata request, and then connects directly to the Broker address of each partition Leader. Broker addresses should use stable logical addresses such as domain names instead of raw IP addresses. Scaling relies on control-plane metadata updates and partition migration, not on manually reconfiguring all client connection targets.

This design is correct. If an enterprise MQ pushes all data-plane traffic through a fixed gateway or a single entry point, it weakens partition-level routing capability and introduces a throughput bottleneck. A reasonable approach is for clients to treat bootstrap only as the entry for discovery, while real reads and writes are routed directly to partition Leaders according to metadata. In this way, scaling, migration, and Leader switching can all be completed through metadata refresh, instead of requiring every business application to restart or change configuration.

---

## 9. High-Throughput Data-Plane Design

Stellflow's data-plane performance target document sets the single-Broker data-plane throughput target at `500 MB/s+` and points out that the upper bound is not determined by dozens of bytes in the protocol header, but by batch size, memory copy, sequential I/O, pipeline, flush strategy, and replication window. This judgment is very accurate. Enterprise MQ throughput is not achieved by "switching to another RPC framework," but by converging the end-to-end byte path.

The high-throughput main path should be `Producer Batch -> Client Buffer -> TCP Socket -> Broker Netty Direct Buffer -> Request Decode -> Partition Append -> Log Segment/Page Cache -> Replica Fetch -> Consumer Fetch/Response Write`. Stellflow's documentation suggests that producer batches can start from `256KB - 1MB`, and high-throughput scenarios can reach `1MB - 4MB`; replica synchronization can use `4MB - 16MB`. At the same time, the Netty main path should use `PooledByteBufAllocator`, `DirectByteBuf`, `CompositeByteBuf`, or gather write, and avoid reassembling large disk data into heap byte arrays.

Fetch and Replica Fetch should prioritize zero-copy paths such as Java `FileChannel.transferTo` and Netty `DefaultFileRegion`. The Netty official site also emphasizes performance goals such as higher throughput, lower latency, lower resource consumption, and reduced unnecessary memory copies. ([netty.io][1])

---

## 10. Observability and Metrics System

Stellflow adopts OpenTelemetry-first and defines unified metric naming and label rules in ADR-0007: metric names use the `stellflow.` prefix and dot-separated style; labels retain only high-value, low-cardinality dimensions; Broker, Controller, and clients share basic semantic vocabulary; and high-cardinality `client.id`, `connection.id`, `request.id`, or raw IP values are forbidden in core metrics.

The metric dictionary further divides metrics into categories such as Broker network and requests, Produce/Fetch, storage, replication and high watermark, coordinator and quota, Controller, Client Producer, and Client Consumer. Priority alerting metrics include request latency, decoding errors, flush latency, replica lag, ISR shrink, controller election, Broker heartbeat timeout, and consumer lag.

One point must be explicit: observability is not a "plugin" added at the end to connect Prometheus. For a strongly stateful system such as MQ, the metric dictionary must be defined before implementation. Otherwise, later pressure-test results cannot be explained, failure reviews cannot be reproduced, and observability semantics across language SDKs will split. The OpenTelemetry Timeseries Model defines a time-series entity as metric name, attributes, value type, and unit, so Stellflow is correct to control label cardinality early. ([OpenTelemetry][5])

---

## 11. Phased Implementation Path

Given the current maturity of the documentation, Stellflow's implementation should be divided into five phases.

The first phase is the protocol and network skeleton: implement `SocketServer`, `Acceptor`, `Processor`, `RequestChannel`, unified Request/Response, ApiVersions, Metadata, Produce, and Fetch as a minimal closed loop. The Broker request-path document also recommends first completing `SocketServer`, `RequestChannel`, `RequestContext`, the protocol dispatcher, `BrokerApis`, the Produce/Fetch main path, and delayed operations.

The second phase is local log storage: implement `TopicPartition`, `LogConfig`, `AppendInfo`, `FetchDataInfo`, `LogSegment`, `FileRecords`, `OffsetIndex`, `TimeIndex`, `UnifiedLog`, `LogManager`, recovery, checkpoints, and cleanup background tasks. Without this path, the Broker is only a network forwarder, not a message queue.

The third phase is replication and the high watermark: implement `ReplicaManager`, `Partition`, `ReplicaFetcherManager`, `ReplicaFetcherThread`, ISR management, high-watermark advancement, Leader Epoch validation, and truncation. Only after this phase can the project meaningfully discuss `acks=all`, replica consistency, and failover.

The fourth phase is Controller Quorum and the metadata log: integrate Apache Ratis, and complete Broker registration, heartbeat, fencing, Topic/Partition metadata, Leader election, incremental metadata broadcast, snapshots, and recovery. Apache Ratis provides pluggable state machines and a Raft log, so it can serve as the foundation for control-plane metadata consistency. ([ratis.apache.org][3])

The fifth phase is enterprise governance: complete ACL, quota, Consumer Group, OffsetCommit, transactions, idempotence, multi-language SDKs, OTel metrics, traces, audit logs, pressure-test matrices, and operations tools. This phase should not cover the main path too early. Before log storage, replication, and the control plane are stable, introducing complex governance only increases refactoring cost.

---

## 12. Conclusion

The essence of building an enterprise message queue in-house is building a distributed log system that is replicable, recoverable, observable, and governable. Based on Stellflow's current documentation, the reasonable architecture conclusion is clear: the data plane should use a custom binary protocol and Netty; the control plane should use gRPC; Controller Quorum should use Apache Ratis/Raft; primary message storage should use self-built log segments and indexes; replication should be designed around Leader/Follower, ISR, high watermark, and Leader Epoch; observability should be OpenTelemetry-first; and governance fields such as trace, tenant, quota, auth, traffic class, and traffic tag should be embedded in the protocol early.

The final judgment is also clear: the current Stellflow documentation is moving in the right direction, and it is much closer to the real problem domain of enterprise middleware than "writing a simple MQ from scratch." Future success will not depend on whether the concepts are complete, but on whether the implementation can land in the order of "protocol closed loop -> log storage -> replication high watermark -> Controller Quorum -> governance and observability -> pressure-test matrix." Skipping storage and replication to build upper-layer features is the wrong path. First nailing down the five main paths of `UnifiedLog + Protocol + Replica + MetadataLog + OTel` is the correct implementation route for a self-built enterprise message queue.

[1]: https://netty.io/ "Netty: Home"
[2]: https://grpc.io/docs/what-is-grpc/core-concepts/ "Core concepts, architecture and lifecycle | gRPC"
[3]: https://ratis.apache.org/ "Apache Ratis"
[4]: https://raft.github.io/ "Raft Consensus Algorithm"
[5]: https://opentelemetry.io/docs/specs/otel/metrics/data-model/ "Metrics Data Model | OpenTelemetry"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/stellflow)
