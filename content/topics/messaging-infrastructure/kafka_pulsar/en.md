## Abstract

Apache Kafka and Apache Pulsar are both distributed messaging and event-streaming platforms. Kafka officially defines itself as an open-source distributed event streaming platform and emphasizes its use at scale in high-performance data pipelines, streaming analytics, data integration, and mission-critical applications. The Kafka website also states that more than 80% of Fortune 100 companies use Kafka, and that its users span thousands of organizations. Based on the ecosystem scale, enterprise adoption, and tooling maturity reflected by public official materials, Kafka remains one of the mainstream platforms in today's message-queue and event-streaming field. ([Apache Kafka][1])

Pulsar officially defines itself as an open-source distributed messaging and streaming platform built for the cloud. It emphasizes native support for multi-tenancy, multiple clusters, geo-replication, multiple subscription modes, BookKeeper-backed persistent storage, Tiered Storage, Pulsar Functions, Pulsar IO, and transactions. Pulsar did not emerge as a simple repetition of Kafka's existing capabilities. Instead, it forms another architectural option around compute-storage separation, multi-tenancy, large-scale topics, geo-replication, and cloud-storage tiering. ([Pulsar][2])

This article uses the architectural differences between Kafka and Pulsar as the entry point to analyze whether the cloud-native era means everything should adopt stateless design, and whether all middleware should be containerized. The conclusion is that cloud native does not mean "all components are stateless", nor does it mean "all state must be externalized to databases". The official Kubernetes documentation explicitly provides StatefulSet and PersistentVolume mechanisms for managing stateful applications that require stable network identities, stable persistent storage, ordered deployment, and ordered rolling updates. ([Kubernetes][3])

## Keywords

Apache Kafka; Apache Pulsar; message queue; event streaming; cloud native; stateless architecture; stateful middleware; containerization; storage separation; registry center; configuration center

---

## 1. Introduction

The core goal of cloud-native technology is not to eliminate state, but to build scalable, elastic, manageable, and observable systems in dynamic environments. The CNCF definition of cloud native emphasizes containers, service meshes, microservices, immutable infrastructure, and declarative APIs as representative technologies. Together, they serve the goal of loosely coupled, resilient, manageable, and observable systems. ([CNCF][4])

Therefore, the question "after cloud native, should everything choose stateless design?" cannot be reduced to a binary judgment. A more accurate proposition is that a system should distinguish business logic state, metadata state, persistent message state, cache state, and coordination state, then choose different deployment and storage models according to consistency requirements, durability, access patterns, recovery cost, and migratability.

Kafka and Pulsar represent two typical paths. Kafka integrates brokers, partition replicas, log storage, replication protocols, and metadata management into a distributed system oriented toward event streaming. Pulsar separates the Broker service layer from the BookKeeper storage layer and uses metadata storage to support cluster management. Neither system is a purely stateless system, but they organize state differently.

---

## 2. Basic Positioning of Kafka and Pulsar

### 2.1 Kafka: Event Streaming Platform and Mainstream Ecosystem

Kafka officially describes itself as an open-source distributed event streaming platform used for high-performance data pipelines, streaming analytics, data integration, and mission-critical scenarios. The Kafka website also lists high throughput, scalability, permanent storage, high availability, built-in stream processing, and the Kafka Connect ecosystem as core capabilities. ([Apache Kafka][1])

From public official materials, Kafka has clear mainstream ecosystem characteristics: its website states that more than 80% of Fortune 100 companies use Kafka, and that Kafka is used by thousands of organizations with a large-scale community and ecosystem tooling. This fact does not directly mean that Kafka is superior to Pulsar in every scenario, but it is enough to show Kafka's factual mainstream position in event streaming and messaging middleware. ([Apache Kafka][1])

Kafka's core abstractions are Topic, Partition, Replica, and Consumer Group. The Kafka design documentation explains that the unit of replication is the Topic Partition. Normally, a partition has one Leader and zero or more Followers. Writes go to the partition Leader; reads may come from the Leader or Followers; the total number of replicas forms the replication factor. ([Apache Kafka][5])

### 2.2 Pulsar: Cloud-Native Messaging and Streaming Platform

Pulsar is officially positioned as "Cloud-Native, Distributed Messaging and Streaming", meaning a cloud-native distributed messaging and streaming platform. Capabilities listed in the Pulsar overview include multiple clusters in one instance, geo-replication across clusters, low publish and end-to-end latency, scalability to more than one million topics, multi-language clients, multiple subscription types, BookKeeper-provided persistent message storage, Pulsar Functions, Pulsar IO, Tiered Storage, and transactions. ([Pulsar][2])

A key architectural fact in Pulsar is the division of responsibility between Broker and BookKeeper Bookie. Pulsar documentation explains that both message data and Consumer Cursor can be persistently stored in BookKeeper. A BookKeeper Ledger is an append-only data structure; one Ledger is assigned to multiple Bookies, and Ledger Entries are replicated to multiple Bookies. ([Pulsar][6])

Therefore, Pulsar's design focus is not "removing storage", but organizing service entry, protocol processing, topic serving, consumer positions, and persistent logs into a layered architecture. The Broker layer is closer to a service layer, the BookKeeper layer carries responsibility for persistent log storage, and metadata storage carries responsibility for cluster metadata.

---

## 3. Why Pulsar Is Still Needed When Kafka Already Exists

The foundation of Pulsar's existence is not that Kafka is unusable. Rather, Kafka's architectural choices do not cover every deployment goal. Both systems face the same broad class of problems, but they optimize in different directions.

First, Pulsar separates the Broker service layer from the BookKeeper storage layer. Pulsar documentation explains that a Ledger is assigned to multiple BookKeeper Bookies, and Entries are replicated to multiple Bookies. Managed Ledger provides a storage abstraction for a single Topic on top of BookKeeper Ledgers. ([Pulsar][6]) This structure makes Broker failure and storage replica failure follow a handling path different from Kafka's Broker-local log replica model.

Second, Pulsar natively emphasizes multi-tenancy. Pulsar documentation explains that Pulsar has been a multi-tenant system from the beginning. Tenants can be distributed across clusters, and authentication, authorization, storage quotas, message TTL, and isolation policies can be managed at the Tenant level. ([Pulsar][7]) This makes Pulsar closer to the resource isolation model in cloud-service and multi-tenant platform scenarios.

Third, Pulsar officially lists multi-cluster support, geo-replication, and million-topic scalability. The Pulsar overview states that it supports multiple clusters in one Pulsar Instance, supports geo-replication across clusters, and lists "Seamless scalability to over a million topics". ([Pulsar][8])

Fourth, Pulsar's Tiered Storage is related to its segmented log architecture. The Pulsar Tiered Storage documentation explains that a Topic is backed by Managed Ledger, the log consists of ordered Segments, Pulsar only writes to the last Segment, historical Segments are sealed and immutable, and they can be copied to long-term storage. ([Pulsar][9])

Therefore, the factual answer to "why do we need Pulsar if Kafka already exists?" is that the core difference between Kafka and Pulsar is not whether they can both send and receive messages, but how they organize message persistence, service layers, storage layers, multi-tenancy, geo-replication, and cold-data tiering. Kafka is the mainstream event streaming platform with the larger ecosystem; Pulsar is another architectural route built around cloud native design, multi-tenancy, storage separation, and large-scale topic management.

---

## 4. Does Cloud Native Mean Middleware Should All Become Stateless?

Cloud native does not require all applications to be stateless. The official Kubernetes documentation clearly distinguishes that Deployment/ReplicaSet is more suitable for stateless replicas, while StatefulSet is suitable for applications that need stable network identities, stable persistent storage, ordered deployment, and ordered rolling updates. ([Kubernetes][3])

Kubernetes also decouples "how storage is provided" from "how applications consume storage" through the PersistentVolume abstraction. The official documentation explains that managing storage is a different problem from managing compute instances. A PersistentVolume is a storage resource in the cluster, and its lifecycle is independent of any individual Pod that uses it. ([Kubernetes][10])

This shows that cloud-native platforms do not deny stateful systems. Instead, they provide declarative orchestration, stable identity, stable storage, and lifecycle management mechanisms for stateful systems. From this, an engineering conclusion follows: whether middleware should become stateless should not be decided directly by "whether it is cloud native", but by the nature of the state managed by the middleware.

For event streaming platforms such as Kafka, the message log itself is part of the product semantics. Kafka lists permanent storage as a core capability and states that it can safely store streams of data in a distributed, durable, fault-tolerant cluster. ([Apache Kafka][1]) Therefore, simplifying Kafka into "only business logic remains, and all storage is handed to an external database" would change its core architectural boundary.

For Pulsar, although the Broker layer is more service-like, Pulsar does not eliminate storage. It delegates persistent message storage to BookKeeper and moves older data to cheaper long-term storage through Tiered Storage. ([Pulsar][6]) This also shows that "making the service layer stateless" and "making the entire system stateless" are not the same concept.

---

## 5. Are Self-Built Local Storage and Self-Implemented Raft Still Necessary after Cloud Native?

Kafka introduced KRaft mode in newer versions, using the KRaft Controller Quorum as the metadata system to replace the traditional ZooKeeper mode. The official Kafka documentation defines ZK mode as Kafka Brokers using ZooKeeper as the metadata system, and KRaft mode as Kafka Brokers using a KRaft Controller Quorum as the metadata system. ([Apache Kafka][11])

This shows that in systems such as Kafka, metadata consistency is not a peripheral feature, but a core part of the cluster control plane. For message queues, registry centers, configuration centers, distributed locks, service discovery, distributed logs, and similar systems, whether to build a consistency protocol or local storage depends on whether state constitutes the product semantics themselves.

The systems can be divided into three categories:

| Type | Nature of state | Need a self-built strong-state layer? |
| --- | --- | --- |
| Event streaming platforms such as Kafka | Message logs, partition replicas, offsets, and metadata directly constitute product semantics | Usually yes |
| Registry centers / configuration centers | Registration data, configuration data, and change notifications are core semantics, but data scale is usually far smaller than message logs | Can be self-built, or can use external DB / KV |
| Ordinary business middle-platform services | State is mainly business data, and the service itself handles computation and access control | Usually no |

Therefore, the objective answer to "after full cloud native adoption, is it still necessary to build local storage and implement Raft yourself?" is: if the system's core capability depends on log replication, consistent metadata, fast failover, and local sequential writes, the necessity still exists; if the state is only ordinary business data or low-frequency metadata, it is better to prioritize mature databases, cloud storage, or managed KV systems.

---

## 6. Does Externalized Storage Put All Availability Pressure on the Storage Component?

Designing middleware as "stateless service layer + externalized storage layer" brings clear benefits: service-layer scaling becomes simpler, node replacement becomes cheaper, release rollback becomes easier, and compute and storage resources can be scaled separately. The containers, microservices, immutable infrastructure, and declarative APIs mentioned in the CNCF cloud-native definition exist to support scalability, manageability, and automated operations. ([CNCF][4])

But this design does not eliminate availability problems. It only changes the availability boundary. Capabilities that were originally handled by the middleware itself, such as replication, consistency, persistence, recovery, and failover, are transferred to the external storage system. Pulsar is a typical example: after the Broker layer and BookKeeper layer are separated, persistence semantics depend on BookKeeper. Pulsar documentation explicitly states that persistent message storage is provided by BookKeeper. ([Pulsar][8])

Therefore, externalizing storage is reasonable only if the following conditions hold:

1. The availability, durability, and consistency level of the external storage are not lower than the middleware semantics require.
2. The middleware has clear degradation modes when storage is abnormal, such as read-only mode, cached reads, rejecting writes, delayed writes, or fast failure.
3. Storage failures do not cause unbounded service-layer retries, cascading failures, or error propagation.
4. After the service layer recovers, it can restore complete state from storage or logs.
5. The operations system can separately observe the service layer, storage layer, and call paths between them.

Therefore, the conclusion to "should all non-storage middleware components be containerized and separate business logic from actual storage?" should be: feasible when the conditions hold, not unconditionally true. Kubernetes official documentation provides both stateless workloads and StatefulSet, which means containerization does not reject stateful deployment. Containerization solves delivery, orchestration, and lifecycle management problems; it does not automatically eliminate state-management complexity. ([Kubernetes][3])

---

## 7. Is "Full In-Memory + DB Persistence" Feasible for Configuration and Registry Centers?

Configuration centers and registry centers differ from Kafka/Pulsar in that they usually do not treat large-scale message logs as their core storage object. Instead, they manage configuration items, service instances, routing rules, weights, labels, health status, and version changes. Such data usually has these characteristics: relatively limited volume, read-heavy and write-light access, low-latency-sensitive read paths, and write paths whose consistency can be controlled through versions, event notifications, and cache refresh.

In this scenario, "full in-memory containerized deployment + DB persistence" is a feasible architecture, but it must satisfy several prerequisites.

First, the service must be able to load complete data from the DB or snapshot during startup. Otherwise, after a container restart, it cannot restore service discovery or configuration query capability.

Second, the runtime read path should mainly access memory, while the DB mainly handles persistence, auditing, version records, and disaster recovery. In this way, the DB is a weak dependency for the read path rather than something accessed for every service discovery request.

Third, the write path should have version control and event propagation mechanisms, such as refreshing each node's memory through version numbers, incremental change logs, database transactions, message notifications, or Watch mechanisms.

Fourth, the system should have clearly defined behavior when the DB fails. A common approach is to continue providing read-only service based on the existing memory snapshot, while rejecting or delaying writes such as new registration, deregistration, and configuration changes.

Fifth, multi-instance deployment must handle cache consistency. DB persistence alone is not enough to guarantee that the memory view of all nodes is consistent in real time. Change broadcasting, pull-based compensation, periodic verification, or version-based eventual consistency is still required.

Therefore, this architecture works for systems such as configuration centers and registry centers, where metadata scale is controllable, reads dominate writes, and short-term eventual consistency is acceptable. But it is not suitable as a direct replacement for message systems such as Kafka/Pulsar, whose core semantics are high-throughput persistent logs, partition replicas, consumption positions, and sequential writes.

---

## 8. Architectural Summary for Middleware Design

Middleware design in the cloud-native era can be summarized into four patterns:

| Pattern | Representative systems | Deployment model | Storage model | Suitable scenarios |
| --- | --- | --- | --- | --- |
| Broker integrated with local log | Kafka | Bare metal, VM, container, StatefulSet | Broker local log replicas + metadata system | High-throughput event streaming, log persistence, strong ordering semantics |
| Service layer separated from storage layer | Pulsar | Broker can be service-like; BookKeeper is stateful | BookKeeper + Metadata Store + Tiered Storage | Multi-tenancy, large-scale topics, geo-distribution, hot/cold tiering |
| Full memory + DB persistence | Configuration center, registry center | Containerized Deployment | DB persistence, memory reads | Read-heavy, controllable data scale, read-only degradation possible |
| Fully stateless business middleware layer | API Gateway, console, governance API | Deployment / HPA | External DB / KV / MQ | Business logic, control plane, management plane |

This classification shows that middleware design should not uniformly apply the principle of statelessness. Instead, it should split state according to whether that state belongs to core semantics. Message logs, consumption positions, partition replicas, and consistent metadata usually belong to core semantics. Configuration, rules, and instance lists can be externalized to a DB when consistency and recovery constraints are satisfied, while an in-memory cache carries the read path.

---

## 9. Conclusion

Based on public official materials, Kafka remains one of the mainstream platforms in the message-queue and event-streaming field. The basis includes officially stated large-scale enterprise usage, a mature ecosystem, high throughput, permanent storage, high availability, and stream-processing capabilities. ([Apache Kafka][1]) Pulsar's value is not to replace Kafka in all scenarios, but to provide another cloud-native messaging and streaming architecture: Broker and BookKeeper separation, multi-tenancy, multiple clusters, geo-replication, million-topic scale, Tiered Storage, and transactions form its differentiated foundation. ([Pulsar][6])

Cloud native does not mean every component is stateless. The official Kubernetes documentation explicitly supports StatefulSet and PersistentVolume for stateful applications that require stable identity, stable storage, and ordered lifecycle. ([Kubernetes][3]) Therefore, the more reasonable design principle in the cloud-native era is not "eliminate state", but "identify state, isolate state, manage state declaratively, and choose deployment models according to the nature of state".

For message systems such as Kafka and Pulsar, persistent logs and consumption state are core product semantics and cannot be simply outsourced to ordinary databases. For systems such as configuration centers and registry centers, where reads dominate writes and metadata scale is controllable, "full memory + DB persistence + change notification + read-only degradation" is a feasible compromise. This design can weaken the DB's dependency in the read path, but it does not remove the need to design persistence, version control, change propagation, and failure recovery.

Ultimately, containerization should be viewed as a delivery and orchestration method, storage separation should be viewed as an architectural layering technique, and statelessness should be viewed as a service-layer design goal rather than an absolute principle for all middleware systems. For middleware architecture, the judgment criteria should always return to state semantics: whether state is a core product capability, whether strong consistency is required, whether sequential writes are required, whether persistent logs are required, whether the state can be recovered from external systems, and whether degradation is allowed during failure.

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
