## Abstract

A registry center is an infrastructure component in a microservice system. It is responsible for service instance registration, service discovery, health-state maintenance, metadata management, change notification, and multi-node disaster tolerance. Common registry centers or service discovery components in the open-source ecosystem include Nacos, Eureka, Consul, ZooKeeper, etcd, and Kubernetes Service Discovery. These systems differ in architectural model, consistency protocol, and CAP tradeoff: Eureka emphasizes availability during partitions; Consul, etcd, and ZooKeeper rely on majority consensus or atomic broadcast protocols to maintain consistent state; Nacos provides both AP and CP semantics; Kubernetes provides service discovery abstractions inside a cluster through Service, EndpointSlice, and DNS. Based on official documentation and StellMap project documentation, this article systematically summarizes the basic elements, module boundaries, consensus model, storage model, Watch mechanism, cross-region synchronization, operations, and deployment of enterprise-grade registry centers, and uses `stellhub/stellmap-service` as an example to summarize a lightweight, strongly consistent, self-built registry-center implementation path.

**Keywords**: registry center; service discovery; Raft; CAP; CP; AP; Watch; cross-region synchronization; StellMap

## 1. Introduction

In microservice systems, service instances are usually dynamic: instances may scale, restart, migrate, fail, or be deployed across availability zones. Callers cannot rely on static address files to locate services. Instead, they need to obtain the current available instance set from a registry center. The official Nacos documentation defines Nacos as a dynamic service discovery, configuration management, and service management platform. It states that Nacos supports service discovery through DNS and RPC and provides health checks to prevent requests from being sent to unhealthy instances. ([Nacos][1]) The official Kubernetes documentation also states that workloads can query EndpointSlice through the Kubernetes API, and Kubernetes updates EndpointSlice when the backend Pod set of a Service changes. For DNS-based discovery, Kubernetes creates DNS records for Services and Pods so workloads can access services through stable DNS names. ([Kubernetes][2]) ([Kubernetes][3])

The design goal of an enterprise-grade registry center is not merely to "store addresses". It must also handle instance lifecycle, strong or weak consistency, query latency, change push, failure recovery, cross-region synchronization, observability, security, and operational deployment. StellMap positions itself as the registry center in the Stell Hub ecosystem. Its responsibility is to provide unified registration, discovery, and location capabilities for service instances in distributed systems, allowing callers to find target services at runtime and collaborate on routing and governance through consistent metadata. ([GitHub][4])

## 2. Mainstream Open-Source Registry Centers and Their Architecture Types

### 2.1 Nacos

Nacos is a dynamic service discovery, configuration management, and service management platform. It supports service types such as Spring Cloud, Dubbo, gRPC, and Kubernetes, and provides service discovery, health checks, dynamic configuration, dynamic DNS, and service governance capabilities. ([Nacos][1]) The official Nacos FAQ explains that Nacos uses Distro as an AP protocol, mainly for temporary service and instance data synchronization in the registry center, providing high availability and eventual consistency. It also uses Raft as a CP protocol for consistency guarantees around non-temporary services, service instance metadata, and Derby database scenarios. ([Nacos][5])

Therefore, Nacos cannot be simply classified as a single AP or CP system. Its registry semantics cover both AP and CP: temporary instances lean toward AP, while non-temporary instances and some metadata lean toward CP. This architecture fits microservice scenarios that need both high-availability temporary instance discovery and some strongly consistent metadata management.

### 2.2 Eureka

Eureka is a service discovery component in the Netflix OSS ecosystem. The self-preservation mode described in the official Eureka Wiki shows that when Eureka Server detects many abnormal client disconnects and waits for eviction, it enters self-preservation mode to prevent a catastrophic network event from emptying registry data and propagating it downstream. After entering self-preservation mode, Eureka Server stops evicting all instances until heartbeats recover above the threshold or the mode is disabled. ([GitHub][6]) The official Eureka Wiki page on Peer-to-Peer communication also states that during peer network failures, some registrations may occur on isolated servers, some clients may see the new registrations, and some may not. After the network recovers, registration information is automatically propagated to servers that missed it. ([GitHub][7])

Therefore, Eureka better matches the characteristics of an AP-style registry center: during partitions, it prioritizes preserving the existing registry and service discovery availability, while allowing different clients to see different service views for a short time.

### 2.3 Consul

The official Consul documentation defines Consul as a control plane for registering, accessing, and securing services across a network. Its Catalog API tracks registered services and their locations for service discovery and service mesh scenarios. ([HashiCorp Developer][8]) Consul uses the Raft protocol to ensure consistent state. The official documentation explains that a majority of Server Agents and one Leader must agree on a state change before it is committed to the state log. ([HashiCorp Developer][8]) In Consul's Raft documentation, a log entry is defined as the basic unit of work in the Raft system, including cluster changes such as adding nodes, registering services, and updating KV. If a majority is unavailable, the Consul cluster cannot commit new logs. ([HashiCorp Developer][9])

Therefore, Consul's service catalog is a CP-style design: writes depend on Leader and majority commit, and a minority partition cannot continue committing new state.

### 2.4 ZooKeeper

Apache ZooKeeper is officially defined as a centralized service for maintaining configuration information, naming, distributed synchronization, and group services. ([zookeeper.apache.org][10]) ZooKeeper's official internals documentation explains that atomic broadcast and leader election use quorums to ensure a consistent system view, and the default quorum is a majority quorum. A Leader proposal can be committed only after receiving acknowledgments from a quorum of servers. ([zookeeper.apache.org][11])

Therefore, ZooKeeper is a CP-style coordination service. It is not a dedicated microservice registry center, but it has long been used for naming, service registration, distributed coordination, and metadata management.

### 2.5 etcd

The official etcd website defines etcd as a strongly consistent, distributed key-value store that provides a reliable way to store data that needs to be accessed by distributed systems or machine clusters, and states that it uses the Raft protocol for distributed replication. ([etcd][12]) The etcd performance documentation further explains that etcd uses the Raft consensus algorithm to replicate requests among members and reach consensus, and that commit latency is limited by network RTT and disk `fdatasync` latency. ([etcd][13])

Therefore, etcd is a typical CP-style infrastructure component. It is commonly used as metadata storage for Kubernetes and other systems, and can also serve as the underlying storage for service discovery, configuration coordination, or lease metadata.

### 2.6 Kubernetes Service Discovery

Kubernetes Service Discovery is not an independent registry center in the traditional sense, but it plays the service discovery role in cloud-native environments. The official Kubernetes documentation states that applications can query EndpointSlice through the API Server, and Kubernetes updates EndpointSlice when the Pod set behind a Service changes. Kubernetes DNS documentation states that Kubernetes creates DNS records for Services and Pods, so workloads can use stable DNS names rather than IP addresses to access services. ([Kubernetes][2]) ([Kubernetes][3])

Kubernetes control-plane state is usually stored in etcd, so the metadata write path of the control plane depends on etcd's CP capability. However, Service VIP, kube-proxy, CoreDNS, and EndpointSlice together provide an in-cluster service discovery abstraction. This system is better suited to container orchestration environments and is not a direct replacement for all business-level registry centers.

## 3. Basic Requirements of an Enterprise Registry Center

A qualified enterprise-grade registry center should contain at least the following capabilities.

First, **instance registration model**. A registry center must define the logical primary key, network endpoint, protocol, weight, labels, metadata, lease TTL, and last heartbeat time of service instances. Nacos documentation treats services as first-class citizens and supports discovery, health checks, and metadata governance for multiple service types. ([Nacos][1]) StellMap documentation defines its data model as an "instance registry" rather than a generic KV product. Its logical primary key is `namespace / service / instanceId`, and instance content includes endpoints, labels, metadata, lease TTL, last heartbeat, and other registration information. ([GitHub][4])

Second, **service discovery query model**. A registry center should support querying candidate instances by service name, as well as filters such as namespace, group, label, service prefix, region, and version. StellMap's `internal/registry` module is responsible for domain models and rules, including instance models, registration input normalization, candidate-set query, expiration detection, and change event publishing. Its queries support exact service name, `servicePrefix` prefix subscription, and structured hierarchical filters such as organization, business domain, capability domain, application, and role. ([GitHub][14])

Third, **lease and health-state maintenance**. A registry center needs to maintain instance health through heartbeat, TTL, active probing, or passive reports. The official Nacos documentation states that it supports transport-layer PING/TCP health checks, as well as application-layer health checks for HTTP, Redis, MySQL, custom protocols, and more. ([Nacos][1]) Eureka documentation also describes client heartbeat renewal, background eviction after continuous heartbeat failures, and stopping eviction in self-preservation mode. ([GitHub][6])

Fourth, **change notification mechanism**. A registry center needs to notify callers of instance changes through Watch, long polling, SSE, gRPC Stream, DNS updates, or similar mechanisms. Kubernetes exposes changes through EndpointSlice and DNS record updates. StellMap already provides an SSE-based instance-change Watch API, `GET /api/v1/registry/watch`, and uses the committed log index as the `revision` for incremental event streams. ([Kubernetes][2]) ([GitHub][15])

Fifth, **consistency model**. A registry center must explicitly define AP, CP, or hybrid behavior. Eureka's self-preservation and peer network failure handling reflect AP tradeoffs. Consul, etcd, and ZooKeeper rely on majority commit and reflect CP tradeoffs. Nacos uses different consistency protocols for temporary instances and non-temporary instances. ([GitHub][6]) ([HashiCorp Developer][9]) ([etcd][12]) ([Nacos][5]) For a self-built enterprise registry center, this choice should not be hidden in implementation details; it should become part of product semantics.

Sixth, **persistence and recovery model**. A CP-style registry center must handle consensus logs, state machine data, snapshots, crash recovery, and log compaction. StellMap splits persistence responsibility into WAL, Pebble, and Snapshot: WAL stores the Raft Log, Pebble stores instance registry data and local metadata, and Snapshot stores independent snapshot files. ([GitHub][4]) This split matches the fact in etcd documentation that Raft replicates requests and reaches consensus, while commit is constrained by network and disk, because consensus logs and state machine storage have different lifecycles. ([etcd][13])

Seventh, **multi-node communication and membership changes**. A CP registry center needs Leader election, log replication, node join, node leave, Learner, Joint Consensus, snapshot transfer, and related mechanisms. Consul documentation explains that Raft nodes start as Followers. If a node does not receive entries for a period of time, it becomes a Candidate; after receiving quorum votes, it becomes the Leader. The Leader is responsible for recording the authoritative log and replicating it to other members. ([HashiCorp Developer][9]) StellMap documentation also plans to handle membership changes through Learner and Joint Consensus to avoid majority instability during scale-out or scale-in. ([GitHub][4])

Eighth, **cross-region design**. Cross-region service discovery is not the same as cross-region strong consensus. StellMap's cross-region directory synchronization design explicitly does not combine multiple Regions into a larger Raft consensus domain. Instead, each Region remains an independent consensus domain, remote directories enter the local cluster as asynchronously replicated views, and query-time policies such as local-first, remote fallback, and gateway-entry replacement are applied. ([GitHub][15])

Ninth, **operations and observability capabilities**. A registry center is infrastructure and must have deployment scripts, configuration files, health checks, Prometheus metrics, Grafana dashboards, logs, audit, and version release workflows. StellMap deployment documentation states that the current release method uses GitHub Actions to push directly to a CVM plus a local `/data/start.sh` startup script. The target machine contains `stellmapd.toml`, `stellmapd`, `stellmapctl`, and `start.sh`, and the service is started and health-checked through systemd. ([GitHub][16])

## 4. Module Design of an Enterprise Registry Center

From an engineering implementation perspective, an enterprise registry center can be divided into nine types of modules.

### 4.1 API Access Layer

The API access layer handles registration, deregistration, renewal, query, Watch, management operations, and health checks. Interfaces for business SDKs should be separated from interfaces for internal cluster replication. StellMap's cross-region design document explicitly distinguishes client Watch from sync Watch: client Watch is for business callers, SDKs, and sidecars; sync Watch is for trusted internal replicators. They differ in exposure surface, returned fields, permission requirements, replay semantics, flow control, and rate-limiting strategy. ([GitHub][15])

### 4.2 Domain Model Layer

The domain model layer defines services, instances, endpoints, labels, metadata, leases, query conditions, and Watch events. StellMap's `internal/registry` module does not handle HTTP, gRPC, Raft startup, or storage assembly. Instead, it focuses on registry-center business semantics. It trims whitespace from `namespace/service/instanceId`, normalizes multi-level service identifiers, validates endpoint protocol, address, port, and weight, fills in default TTL and default endpoint weight, and constructs the final `Value` that is applied to the state machine. ([GitHub][14])

### 4.3 Consistency and Consensus Layer

A CP-style registry center needs to carry writes through a replicated state machine. StellMap uses a single Raft Group and implements a replicated state machine based on `etcd-io/raft`. It explicitly adopts a CP architecture: when a network partition occurs, minority nodes stop providing linearizable write service; only after a majority survives and elects a leader does the system continue accepting writes. ([GitHub][4]) This tradeoff is consistent with the majority consensus model of Consul and etcd: if quorum is unavailable, new logs cannot be committed. ([HashiCorp Developer][9])

### 4.4 Linearizable Read Layer

If a registry center query returns expired instances, it affects call-chain correctness. StellMap explicitly requires all read requests to be linearizable and does not provide stale reads by default. Its path is: external read requests enter `raftnode.LinearizableRead`, apply a read barrier through `ReadIndex`, and then read from the local state machine only after `appliedIndex >= readIndex`. ([GitHub][4])

### 4.5 State Machine and Storage Layer

The state machine converts committed logs into local registry state. StellMap's `internal/storage` provides state machine abstraction and a Pebble storage implementation, carrying the question "how do Raft-committed registry changes finally land in local registry state". Its state machine interface includes `Apply`, `Get`, `Scan`, `Snapshot`, `Restore`, and `AppliedIndex`. The production implementation `PebbleStore` stores instance registry data, `applied index`, `applied term`, and member address metadata. ([GitHub][17])

### 4.6 WAL Log Layer

The WAL layer is responsible for safely persisting consensus logs and supporting crash recovery. StellMap's `internal/wal` provides write-ahead logging for Raft logs. It persists `HardState` and `Entry` and restores them after node restart. Its interface includes `Open`, `Append`, `Load`, `TruncatePrefix`, `Sync`, and `Close`. The production implementation `FileWAL` uses `hardstate.bin` to store the latest `HardState` and `*.wal` files to store log entry segments. ([GitHub][18])

### 4.7 Snapshot Layer

The Snapshot layer is responsible for exporting, installing, restoring, and cleaning historical state sections. StellMap's `internal/snapshot` provides snapshot abstraction and snapshot storage implementation. It exports the current instance-registry view into independent snapshot files and supports restore and install. `FileStore` uses `*.snap` to store snapshot content and `*.meta` to store snapshot metadata. During creation, it writes a temporary `.snap.tmp`, calculates a SHA-256 checksum, and then atomically renames it to the formal snapshot file. ([GitHub][19])

### 4.8 Runtime Cluster Communication Layer

The Runtime layer is responsible for the inter-node address book, Raft message forwarding, and snapshot transfer. StellMap's `internal/runtime` maintains mappings from node ID to HTTP, gRPC, and admin addresses. `PeerTransport` consumes `Ready` generated by the local Raft node, groups normal Raft messages by target node, and forwards them in batches over gRPC. `InternalTransportService` receives remote Raft messages, receives snapshot chunks and installs them, and can also read the latest snapshot from local snapshot storage and split it into chunks for remote download. ([GitHub][20])

### 4.9 Operations and Release Layer

The operations and release layer needs to support local builds, automated release, configuration management, systemd or container deployment, health checks, and rollback. StellMap deployment documentation explains that after release, the target CVM's `/data` directory contains the configuration file, server binary, control-plane CLI, and startup script. `start.sh` installs files into `/opt/stellmap/bin`, installs configuration into `/etc/stellmapd/stellmapd.toml`, generates a systemd service, and starts health checks. ([GitHub][16])

## 5. Summary of StellMap's Self-Built Design Process

StellMap's design process can be summarized as a three-stage evolution from "registry-center semantics" to "strongly consistent replicated state machine" and then to "cross-region projected synchronization".

The first stage is defining the product boundary. StellMap is not a generic configuration center and not a generic KV product. It is a registry center centered on the instance registry. The project README clearly states that its responsibility is to provide unified registration, discovery, and location capabilities for service instances, and it plans service registration, service discovery, instance heartbeat, health-state maintenance, service metadata, namespace and group isolation, and collaboration interfaces with governance, configuration, and control-plane modules. ([GitHub][4])

The second stage is defining the consistency tradeoff. StellMap explicitly adopts a CP architecture, prioritizing linearizability and correctness. When a network partition occurs, minority nodes stop providing linearizable write service, and the majority continues accepting writes after leader election completes. ([GitHub][4]) This differs from Eureka's AP tradeoff: during network failures, Eureka allows clients to see different service views and protects the existing registry through self-preservation. ([GitHub][7]) StellMap's design is closer to the majority commit model of Consul and etcd. ([HashiCorp Developer][9]) ([etcd][12])

The third stage is splitting storage responsibilities. StellMap separates WAL, Pebble, and Snapshot: WAL is only responsible for Raft replication logs and necessary consensus metadata; Pebble is responsible for instance registration data after apply and a small amount of local metadata; Snapshot is responsible for independent state-section recovery. ([GitHub][4]) This split is further implemented in module documentation: `internal/wal` persists `HardState` and `Entry`; `internal/storage` handles state-machine apply, query, scan, snapshot export and restore; `internal/snapshot` handles the snapshot file lifecycle. ([GitHub][18]) ([GitHub][17]) ([GitHub][19])

The fourth stage is defining registry-center domain semantics. `internal/registry` is limited to the registry-center business semantics layer. It is responsible for what an instance is, how it is registered, how candidate sets are queried, how expiration is judged, and how change events are published. Its multi-level service identifier uses `organization.businessDomain.capabilityDomain.application.role`, while retaining both normalized service name and structured fields to support prefix subscription, permission governance, and monitoring aggregation. ([GitHub][14])

The fifth stage is defining cluster runtime boundaries. `internal/runtime` does not handle registry queries, filtering, registry storage, WAL, or external HTTP APIs. It focuses on internal cluster runtime communication and snapshot transfer. This boundary allows registry-domain logic, Raft consensus, node communication, storage recovery, and API access to evolve independently. ([GitHub][20])

The sixth stage is defining cross-region synchronization principles. StellMap's cross-region design is not a single cross-region Raft cluster. Instead, each Region remains an independent consensus domain. Local data is maintained strongly consistently by the local cluster, while remote data enters the local cluster as an asynchronously replicated view. During query, the local native directory and remote replicated directory are merged. ([GitHub][15]) The design also explicitly requires different prefixes for local native directories and remote replicated directories: local directories use `/registry/{namespace}/{service}/{instanceId}`, while remote replicated directories use `/replication/regions/{sourceRegion}/clusters/{sourceClusterId}/registry/{namespace}/{service}/{instanceId}`. This avoids accidental deletion of remote directories by local expiration cleanup, Watch loops, and source confusion. ([GitHub][15])

## 6. Conclusion

Open-source registry center architectures can be summarized into three categories. The first is AP-style service discovery represented by Eureka, which preserves availability and the existing registry during partitions but allows short-term inconsistency. The second is CP-style coordination and service catalog represented by Consul, etcd, and ZooKeeper, which rely on majority, Leader, log replication, or atomic broadcast to maintain consistent state. The third is the hybrid model represented by Nacos, which uses AP and CP protocols according to temporary instance, non-temporary instance, and metadata scenarios. Kubernetes Service Discovery provides service discovery abstraction in container orchestration environments through Service, EndpointSlice, and DNS mechanisms. ([GitHub][6]) ([HashiCorp Developer][9]) ([etcd][12]) ([zookeeper.apache.org][10]) ([Nacos][5]) ([Kubernetes][2])

When building an enterprise registry center, the key is not to copy the interface of an open-source product, but to clearly define the registry center's own consistency semantics, instance model, lease model, Watch model, storage recovery model, membership change model, and cross-region model. StellMap currently adopts a CP architecture, single Raft Group, linearizable reads, layered WAL/Pebble/Snapshot persistence, SSE Watch, modular Runtime, and asynchronous cross-region replicated views. Together, these form a clear implementation path for enterprise service governance scenarios. ([GitHub][4]) ([GitHub][14]) ([GitHub][20]) ([GitHub][15])

## 7. Project Promotion

StellMap is a self-built registry center in the Stell Hub ecosystem. It provides service registration, service discovery, instance heartbeat, health-state maintenance, metadata management, namespace isolation, and governance collaboration for distributed systems. The project is implemented in Go. Its design chooses a CP architecture, Raft replicated state machine, linearizable reads, independent WAL, Pebble state-machine storage, and Snapshot recovery. It has also accumulated module documentation, deployment documentation, and cross-region directory synchronization design. For developers interested in microservice governance, registry-center internals, Raft engineering, service discovery, and cross-region directory synchronization, `stellhub/stellmap-service` provides an open-source sample that can be read, evolved, and contributed to from both engineering code and design documents. ([GitHub][4])

[1]: https://nacos.io/en/docs/latest/what-is-nacos/ "Nacos Configuration Center profile | Nacos"
[2]: https://kubernetes.io/docs/concepts/services-networking/service/ "Service | Kubernetes"
[3]: https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/ "DNS for Services and Pods | Kubernetes"
[4]: https://github.com/stellhub/stellmap-service "GitHub - stellhub/stellmap-service: StellMap Service is a cloud-native message queue server for distributed messaging, routing, and StellHub Cloud integration."
[5]: https://nacos.io/blog/faq/nacos-user-question-history10487/?utm_source=chatgpt.com "How does Nacos ensure high availability?"
[6]: https://github.com/netflix/eureka/wiki/server-self-preservation-mode "Server Self Preservation Mode - Netflix/eureka Wiki"
[7]: https://github.com/Netflix/eureka/wiki/Understanding-Eureka-Peer-to-Peer-Communication "Understanding Eureka Peer to Peer Communication - Netflix/eureka Wiki"
[8]: https://developer.hashicorp.com/consul "Consul | HashiCorp Developer"
[9]: https://developer.hashicorp.com/consul/docs/concept/consensus "Consensus | Consul | HashiCorp Developer"
[10]: https://zookeeper.apache.org/ "Apache ZooKeeper"
[11]: https://zookeeper.apache.org/doc/current/zookeeperInternals.html?utm_source=chatgpt.com "ZooKeeper Internals"
[12]: https://etcd.io/?utm_source=chatgpt.com "etcd"
[13]: https://etcd.io/docs/v3.2/op-guide/performance/ "Performance | etcd"
[14]: https://github.com/stellhub/stellmap-service/blob/main/docs/modules/registry.md "stellmap-service/docs/modules/registry.md at main"
[15]: https://github.com/stellhub/stellmap-service/blob/main/docs/design/cross-region-directory-sync.md "stellmap-service/docs/design/cross-region-directory-sync.md at main"
[16]: https://github.com/stellhub/stellmap-service/blob/main/docs/operations/deploy.md "stellmap-service/docs/operations/deploy.md at main"
[17]: https://github.com/stellhub/stellmap-service/blob/main/docs/modules/storage.md "stellmap-service/docs/modules/storage.md at main"
[18]: https://github.com/stellhub/stellmap-service/blob/main/docs/modules/wal.md "stellmap-service/docs/modules/wal.md at main"
[19]: https://github.com/stellhub/stellmap-service/blob/main/docs/modules/snapshot.md "stellmap-service/docs/modules/snapshot.md at main"
[20]: https://github.com/stellhub/stellmap-service/blob/main/docs/modules/runtime.md "stellmap-service/docs/modules/runtime.md at main"
