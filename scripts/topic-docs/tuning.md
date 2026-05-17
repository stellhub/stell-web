## A Systematic Selection Study of In-Container Data Sharing and Communication Mechanisms

## Abstract

In containerized systems, multiple processes or multiple containers often need to share configuration, transmit logs, report telemetry data, or exchange control commands. Common implementation mechanisms include HTTP, gRPC, gRPC over Unix Domain Socket, shared volumes, standard-output log streams, and shared memory. Shared memory has a mechanism-level advantage in local data-transfer performance, but the system-wide optimum is also constrained by protocol standardization, backpressure, failure recovery, upgrade compatibility, observability, security boundaries, and operational cost. This article uses OpenTelemetry Collector, configuration-center sidecars, and traditional log agents as core cases, and combines Amdahl's Law, Little's Law, tail-latency research, and Kubernetes / OpenTelemetry / gRPC / Linux official documentation to systematically analyze in-container inter-process communication choices. Kubernetes documentation states that containers in the same Pod share a network namespace, can communicate through `localhost`, and can also use mechanisms such as shared volumes, System V semaphores, or POSIX shared memory for inter-process communication. ([Kubernetes][1])

**Keywords:** local performance optimum, system-wide optimum, in-container communication, IPC, OpenTelemetry Collector, sidecar, Unix Domain Socket, shared memory, log agent, Kubernetes

---

## 1. Introduction

In a containerized system, a business unit often contains not only the main business process, but also telemetry collection processes, configuration synchronization processes, log collection processes, security agents, or traffic proxies. Kubernetes officially defines sidecar containers as helper containers that run in the same Pod as the main application container to enhance or extend the application, with common uses including logging, monitoring, security, and data synchronization. ([Kubernetes][2])

The communication problem in this type of system can be abstracted as:

```text
Business process / main container
  <-> local agent / sidecar / collector
  <-> configuration file / log file / shared state / telemetry data
```

On single-point performance metrics, shared memory can usually reduce data copies and system calls. But from a system-wide perspective, the communication mechanism also affects:

```text
Protocol compatibility
Error handling
Backpressure and rate limiting
Failure recovery
Debugging and diagnosis
Version upgrades
Security isolation
Resource consumption
Deployment complexity
```

Therefore, "the local performance optimum is not equivalent to the system-wide optimum" is not merely an experiential statement. It is an engineering proposition supported by system performance models, queueing models, tail-latency research, and cloud-native official practices.

---

## 2. Theoretical Foundations: Why Local Optimum Does Not Represent System Optimum

### 2.1 Amdahl's Law: Local Acceleration Has a System-Wide Return Ceiling

Amdahl's classic 1967 paper, *Validity of the Single Processor Approach to Achieving Large Scale Computing Capabilities*, discussed the boundaries of local optimization in large-scale computing. Amdahl's Law is usually expressed as follows: when only part of a system can be accelerated, the overall speedup is limited by the unoptimized part. ([ACM Digital Library][3])

It can be formalized as:

```text
S_system = 1 / ((1 - p) + p / S_local)
```

Where:

```text
p        = proportion of total time spent in the optimized part
S_local  = local speedup of the optimized part
S_system = overall system speedup
```

This model can explain in-container communication optimization. Even if shared memory significantly accelerates the hop from the business process to the local agent, the overall benefit is still limited if the bottleneck sits in backend storage, network egress, a Collector processor, a remote database, or a log platform.

---

### 2.2 Little's Law: Throughput, Latency, and Queue Length Constrain Each Other

Little's 1961 paper in *Operations Research* proved that, under certain stability conditions in a queueing system, the average number of items in the system `L`, the average arrival rate `lambda`, and the average time in the system `W` satisfy: `L = lambda W`. ([IDEAS/RePEc][4])

The law states:

```text
Queue length = arrival rate x waiting / processing time
```

In in-container communication, even if the IPC layer becomes faster, queues will still grow if downstream processing is slower than upstream writes. At that point, the system problem is no longer "single-write speed," but:

```text
Downstream consumption capacity
Queue capacity
Backpressure mechanism
Drop strategy
Retry strategy
Memory limit
```

Therefore, reducing local communication latency does not automatically eliminate system-level backlog.

---

### 2.3 Tail Latency: Average Performance Does Not Represent Overall Response Quality

Google's research paper *The Tail at Scale* points out that as system scale and complexity increase, keeping tail latency low becomes difficult, and transient high latency may dominate overall service performance. ([Google Research][5])

In in-container inter-process communication, a lower average IPC latency does not mean the whole system has improved. The system can still be affected by:

```text
Collector batch waiting
Log agent queue blocking
Configuration reload failure
Shared-memory read/write contention
Downstream backend rate limiting
GC pauses
CPU throttling
I/O jitter
```

Tail-latency research gives a systematic conclusion: when evaluating a communication mechanism, observe p95, p99, p999, drop rate, retry rate, and queue depth rather than only single-transfer latency.

---

### 2.4 Overload Handling: Backpressure and Rejection Are System Stability Metrics

Google SRE documentation points out that no matter how good load balancing is, some parts of the system can eventually overload. Gracefully handling overload is fundamental to reliable services. The documentation also discusses client-side throttling, local request rejection, and preventing cascading failures. ([sre.google][6])

This directly relates to in-container communication. Shared memory can improve write speed, but shared memory itself does not define:

```text
What to do when the buffer is full
What to do when the consumer falls behind
Whether the producer blocks
Whether old data is dropped
Whether new data is dropped
How to record drop counters
How to recover read/write pointers
```

Therefore, the system value of a communication mechanism depends not only on throughput, but also on whether it has, or makes it easy to build, backpressure, rate limiting, retry, rejection, and recovery mechanisms.

---

## 3. System Boundaries of In-Container Process Communication

In-container communication includes at least three boundaries:

| Boundary type | Example | Available mechanisms |
| --- | --- | --- |
| Multiple processes in the same container | Main process + watcher + helper | Files, pipes, UDS, localhost, shared memory, signals |
| Multiple containers in the same Pod | App + OTel Collector sidecar + config sidecar | localhost, shared volumes, UDS files, stdout/stderr, shared memory |
| Different Pods on the same node | App Pod + node-agent DaemonSet | Pod IP, Service, hostPath, node log directory |

Kubernetes documentation states that multiple containers in the same Pod share the network namespace, so they can find each other through `localhost`. Containers in the same Pod can also share files through shared volumes. ([Kubernetes][1])

It is important to distinguish this from `hostPath`. Although `hostPath` allows a Pod to access paths on the host, Kubernetes documentation explicitly warns about its security risks, including exposure of node credentials, container runtime sockets, and possible container escape risks. ([Kubernetes][7])

---

## 4. Communication Mechanism Categories and Objective Characteristics

### 4.1 HTTP

HTTP fits control-plane scenarios such as management APIs, health checks, configuration queries, and reload triggers. Its mechanism advantages include:

```text
Universal protocol
Mature toolchain
Easy debugging with curl / browsers / gateways
Suitable for low-frequency request-response interfaces
```

Typical uses:

```text
GET  /healthz
GET  /metrics
GET  /config/version
POST /reload
```

HTTP's practical boundary is control commands and low-frequency data exchange. For strongly typed, multi-language, streaming RPC, gRPC provides a more precise model.

---

### 4.2 gRPC

The gRPC documentation explains that gRPC organizes interfaces around service definitions, uses Protocol Buffers by default to describe requests and responses, and supports four RPC types: unary, server streaming, client streaming, and bidirectional streaming. ([gRPC][8])

gRPC is suitable for:

```text
Strongly typed interfaces
Cross-language service calls
Streaming communication
Deadline / cancellation
Metadata / status code
Local or remote RPC
```

gRPC also provides flow-control mechanisms. The official documentation says flow control can prevent a fast sender from overwhelming a receiver, reducing data loss and improving reliability. It also warns that in synchronous read/write models, if both sides write large amounts of data without reading, deadlock may occur. ([gRPC][9])

---

### 4.3 gRPC over Unix Domain Socket

Unix Domain Socket is a Linux socket mechanism for same-machine inter-process communication. Linux man-pages state that `AF_UNIX` / `AF_LOCAL` sockets are used for IPC on the same host and support stream, datagram, and seqpacket types. They also support passing file descriptors and process credentials through ancillary data. ([man7.org][10])

The gRPC documentation also provides Unix Domain Socket target examples, such as:

```text
unix:///run/containerd/containerd.sock
```

([gRPC][11])

Therefore, gRPC over UDS has two characteristics:

```text
It preserves gRPC service / method / protobuf / status-code semantics.
It uses a local Unix Domain Socket as the transport endpoint.
```

When UDS is used across different containers in the same Pod, the socket file usually needs to be placed in a shared volume so both containers can access the same path.

---

### 4.4 Shared Volumes and Files

A Kubernetes volume is the mechanism through which containers in a Pod access and share filesystem data. The official documentation states that a volume is a directory, potentially containing data, that containers in a Pod can access. Each container must declare its own volume mount. ([Kubernetes][7])

Shared volumes are suitable for:

```text
Configuration files
Log files
Certificates
Rule files
State snapshots
Local caches
Unix Domain Socket files
```

For configuration and logs, file sharing has the following system properties:

```text
Can be inspected by shell tools
Can be diagnosed through kubectl exec
Can be atomically replaced with rename
Can retain the last-good version
Can integrate with existing log rotation and tail mechanisms
```

---

### 4.5 Shared Memory

POSIX shared memory allows multiple processes to communicate by sharing the same memory region. Linux documentation explains that processes can create a shared memory object with `shm_open()`, set its size with `ftruncate()`, and map it into the process address space with `mmap()`. ([man7.org][12])

The `mmap()` documentation states that with `MAP_SHARED`, updates to the mapped area are visible to other processes mapping the same region, while `MAP_PRIVATE` is copy-on-write and updates are not visible to other processes. ([man7.org][13])

Shared memory is suitable for:

```text
Large binary data
High-frequency data planes
Video frames
Audio buffers
Machine-learning tensors
Packet buffers
High-throughput ring buffers
```

However, the Linux POSIX shared-memory documentation also states that processes usually need mechanisms such as POSIX semaphores to synchronize access to shared memory objects. ([man7.org][12])

Therefore, shared memory only provides memory visibility. It does not directly provide:

```text
Message boundaries
Protocol versions
Flow control
Backpressure
Retries
Crash recovery
Permission models
Data validation
Observability metrics
```

---

## 5. Case 1: OpenTelemetry Collector

### 5.1 Scenario Definition

OpenTelemetry Collector receives, processes, and exports telemetry data. The official documentation describes Collector responsibilities as receiving, processing, and exporting telemetry data, with pipelines organizing receivers, processors, and exporters. ([OpenTelemetry][14])

A typical path looks like this:

```text
Business process
  -> OpenTelemetry SDK
    -> OTLP Exporter
      -> OpenTelemetry Collector
        -> Processor
          -> Exporter
            -> Observability Backend
```

The OpenTelemetry Collector Quick Start documentation lists default ports:

```text
4317: OTLP over gRPC, used by most SDKs by default
4318: OTLP over HTTP, used by clients that do not support gRPC
```

([OpenTelemetry][15])

The OTLP specification states that OTLP defines the encoding, transport, and delivery mechanism for telemetry data and supports both gRPC and HTTP transports. The default OTLP/gRPC port is 4317, and the default OTLP/HTTP port is 4318. ([OpenTelemetry][16])

---

### 5.2 Communication Mechanism Mapping in OTel Scenarios

| Sub-scenario | Communication mechanism | Objective basis | Main constraints |
| --- | --- | --- | --- |
| Standard Trace / Metric / Log reporting | OTLP/gRPC | Collector default 4317; OTLP specification defines gRPC transport | Depends on gRPC / HTTP2 |
| HTTP-compatible ingestion | OTLP/HTTP | Collector default 4318; OTLP specification defines HTTP transport | Weaker streaming semantics than gRPC |
| Local same-machine RPC optimization | gRPC over UDS | gRPC supports UDS targets; Collector gRPC transport is configurable | Language SDK endpoint support must be verified |
| File logs into OTel | filelog receiver | OTel filelog receiver tails and parses file logs | Must handle formats, rotation, and offsets |
| Shared-memory ingestion | Custom exporter + custom receiver | OTel custom receivers must convert to the internal telemetry model | Requires custom protocol, synchronization, recovery, and custom distribution build |

The OpenTelemetry Collector gRPC server configuration supports configuring the transport, defaulting to TCP. OpenTelemetry Collector network configuration also lists protocol types such as `tcp`, `unix`, `unixgram`, and `unixpacket`. ([GitHub][17])

---

### 5.3 System Implications of Replacing OTLP/gRPC with Shared Memory

If the communication mechanism from the business process to the Collector is changed from OTLP/gRPC to shared memory, the following components must be added:

```text
Custom exporter on the application side
Custom receiver on the Collector side
Shared-memory layout
Message-boundary protocol
Concurrency synchronization mechanism
Read/write pointer recovery mechanism
Backpressure and drop strategy
Version compatibility strategy
Collector restart recovery logic
Application-process restart recovery logic
Custom diagnostic metrics
```

OpenTelemetry custom receiver documentation states that a receiver needs to convert the original format into the OpenTelemetry internal trace model and implement configuration, factory, and receiver components. ([OpenTelemetry][18])

If the custom component needs to be packaged into the Collector, Collector Builder is also required. OpenTelemetry documentation states that OpenTelemetry Collector Builder can build Collector binaries that contain custom components, upstream components, and custom paths. ([OpenTelemetry][19])

Therefore, a shared-memory solution in OTel is not only a transport-layer replacement. It also changes the data model, component model, release model, and failure-recovery model.

---

### 5.4 Local Acceleration and System Bottlenecks in OTel

OpenTelemetry Collector scaling documentation states that `memory_limiter` limits Collector memory usage and prevents new data from entering under memory pressure. Exporter queues wait in memory for workers; once the queue is full, data is refused. The documentation also states that if the bottleneck is the telemetry database, network, or another backend, adding more Collectors does not solve the problem. ([OpenTelemetry][20])

This is consistent with Amdahl's Law and Little's Law: local IPC acceleration affects only one segment of the path. If the backend, network, processor, or exporter queue becomes the bottleneck, overall system throughput and stability remain constrained by those parts.

---

## 6. Case 2: Configuration-Center Sidecar Sharing Configuration with the Main Process

### 6.1 Scenario Definition

A configuration-center sidecar usually handles:

```text
Pulling configuration from a remote configuration center
Subscribing to configuration changes
Rendering configuration templates
Writing local configuration files
Notifying the main process to reload
Exposing configuration version and health state
```

A Kubernetes ConfigMap is an API object used to store non-confidential key-value data. Pods can consume it as environment variables, command-line arguments, or configuration files in a volume. The documentation also states that ConfigMap does not provide secrecy or encryption, sensitive data should use Secret, and ConfigMap is not suitable for large data because a single ConfigMap cannot exceed 1 MiB. ([Kubernetes][21])

---

### 6.2 Configuration Sharing Mechanism Mapping

| Sub-scenario | Communication / sharing mechanism | Objective basis | Main constraints |
| --- | --- | --- | --- |
| Static startup configuration | ConfigMap env / args | Kubernetes supports ConfigMap as environment variables or command-line arguments | Environment-variable consumption does not update automatically |
| Runtime file configuration | ConfigMap volume | Kubernetes supports mounting ConfigMap as volume files | Updates have kubelet sync and cache propagation latency |
| Dynamic sidecar configuration | Sidecar + shared volume | Containers in the same Pod can share files through a volume | Requires atomic writes, versioning, validation, and reload |
| Reload notification | HTTP / gRPC / UDS | Control commands fit request-response interfaces | Requires access control and error handling |
| High-frequency rule reading | File + in-process memory cache | File is used for publication; the main process loads it into local memory | Requires fallback when reload fails |
| Large binary rule table | Shared memory | Suitable for large, high-frequency local data planes | Requires synchronization, versioning, recovery, and permission control |

Kubernetes ConfigMap documentation states that mounted ConfigMap content is eventually updated, and update latency depends on the kubelet sync period and cache propagation. ConfigMaps consumed through environment variables do not update automatically, and ConfigMaps mounted with `subPath` do not receive updates. ([Kubernetes][21])

---

### 6.3 Sidecar + Shared Volume Pattern

The Kubernetes configuration update tutorial shows a combination of ConfigMap, sidecar, and `emptyDir`: one helper container writes to a shared `emptyDir` based on a ConfigMap, and another container reads files from the shared volume. ([Kubernetes][7])

The pattern can be abstracted as:

```text
Remote configuration center / ConfigMap
  -> configuration sidecar
    -> shared volume
      -> main process reads configuration file
        -> HTTP / gRPC / UDS reload
```

Configuration file publishing usually includes these steps:

```text
Generate temporary file
Validate content
Write checksum
Write version
Atomic rename
Notify main process to reload
Main process validates and loads
Keep old configuration when reload fails
```

The data plane here is the file, while the control plane is HTTP, gRPC, or UDS. This separation makes configuration content observable through the filesystem while expressing reload as an explicit control command.

---

### 6.4 Difference Between memory-backed emptyDir and Shared Memory

Kubernetes `emptyDir.medium: "Memory"` uses tmpfs. The official documentation states that tmpfs is fast, but written files count against the memory limit of the writing container. If no size is specified, a memory-backed volume is sized by node allocatable memory. ([Kubernetes][7])

memory-backed `emptyDir` differs from POSIX shared memory:

| Mechanism | Essence | Typical use |
| --- | --- | --- |
| memory-backed `emptyDir` | Shared filesystem on tmpfs | Small runtime files, configuration, socket files |
| POSIX shared memory | Shared memory object mapped through `shm_open` + `mmap` | Large binary buffers, ring buffers |
| mmap file | File mapped as a memory region | File cache, large data reads, shared mappings |

Therefore, in configuration scenarios, memory-backed shared volumes usually still behave as file sharing rather than process-object sharing.

---

## 7. Case 3: Traditional Log Collection Agent

### 7.1 Scenario Definition

Log collection usually includes three patterns:

```text
The business process writes stdout/stderr.
The business process writes log files.
The business process pushes logs directly to a backend or local agent.
```

Kubernetes logging architecture documentation states that the container runtime handles and redirects output written by containerized applications to stdout and stderr, and kubelet can expose logs through the Kubernetes API. ([Kubernetes][22])

---

### 7.2 Log Collection Mechanism Mapping

| Sub-scenario | Communication / collection mechanism | Objective basis | Main constraints |
| --- | --- | --- | --- |
| Cloud-native logs | stdout/stderr + node-level agent | Kubernetes documentation lists node-level logging agents, usually running as DaemonSets | Requires unified log format |
| Traditional file logs | shared volume + sidecar tail | A sidecar can read files and output to stdout/stderr | Adds extra container and resource consumption |
| Multi-format file logs | Multiple sidecars / multiple pipelines | Kubernetes documentation notes that different formats can be separated | Configuration complexity increases |
| OTel file log ingestion | filelog receiver | OTel filelog receiver tails and parses file logs | Must handle rotation, parsing, and offsets |
| Application active push | HTTP / gRPC | Application directly calls local agent or backend | Application side handles retry, blocking, and failure |
| Extreme high-throughput logs | shared memory ring buffer | Suitable for high-frequency local data planes | Requires custom protocol, synchronization, backpressure, and drop strategy |

Kubernetes documentation lists three cluster-level logging approaches: running a node-level logging agent on every node, including a sidecar logging container in the application Pod, and pushing logs directly from the application to a backend. A node-level logging agent usually runs as a DaemonSet. ([Kubernetes][22])

---

### 7.3 Sidecar File Log Collection

Kubernetes documentation states that a sidecar can read logs from files, sockets, or journald and write them to its own stdout/stderr. This approach can reuse kubelet and node logging agents. ([Kubernetes][22])

A typical structure is:

```text
Business process
  -> /var/log/app/app.log
    -> shared volume
      -> log sidecar / filelog receiver
        -> stdout/stderr or log backend
```

OpenTelemetry Collector Contrib `filelogreceiver` documentation states that this receiver tails and parses file logs and supports include, exclude, start_at, multiline, poll_interval, max_log_size, and other settings. ([GitHub][23])

Kubernetes documentation also notes that if an application writes files first and a sidecar then outputs them to stdout/stderr, this may cause extra storage consumption. If the application only needs a single log stream, it can write directly to stdout/stderr. ([Kubernetes][22])

---

## 8. Selection Matrix: Choose Mechanisms by Data Type, Not Single-Point Performance

| Data / operation type | Typical scenario | Applicable mechanism | System constraints |
| --- | --- | --- | --- |
| Low-frequency control command | health, reload, admin API | HTTP | Simple, easy to debug, suitable for control plane |
| Strongly typed RPC | Agent API, configuration query, management interface | gRPC | IDL, cross-language, deadline, status code |
| Same-machine local RPC | Collector sidecar, admin socket | gRPC over UDS | Preserves gRPC semantics, avoids exposing TCP ports |
| Standard telemetry data | Trace, Metric, Log reporting | OTLP/gRPC or OTLP/HTTP | Compatible with OTel SDK and Collector pipeline |
| Configuration sharing | ConfigMap, dynamic configuration files | shared volume / ConfigMap volume | Update semantics, atomic replacement, reload |
| Log stream | Cloud-native logs | stdout/stderr + node-level agent | Depends on container runtime and kubelet log path |
| Traditional log file | File log collection | shared volume + sidecar / filelog receiver | Rotation, offsets, format parsing |
| Large binary data | Video frames, tensors, packet buffers | shared memory | Requires synchronization, protocol, recovery, and flow control |
| Socket-file sharing | UDS endpoint | shared volume | Requires path permissions and lifecycle management |
| Node-level collection | Node log agent, host runtime | DaemonSet + hostPath | hostPath security risk and resource isolation |

This matrix shows that communication mechanisms correspond to data types. Shared memory fits high-frequency large data planes. Standard protocols fit cross-component, cross-language, upgradeable links. Shared volumes fit configuration and file logs. stdout/stderr fits cloud-native logs.

---

## 9. Discussion: Differences Between Local Performance Optimum and System-Wide Optimum

### 9.1 Performance Boundary Differences

Shared memory can reduce local data-copy cost, but Amdahl's Law shows that the overall benefit of local acceleration is limited by other parts of the system. Little's Law further shows that when downstream processing time increases or arrival rate exceeds consumption capacity, queue length grows. ([ACM Digital Library][3])

In OpenTelemetry, if the Collector exporter, remote backend, network, or telemetry database is the bottleneck, local IPC optimization does not directly remove queue buildup. OpenTelemetry scaling documentation also clearly states that when the backend or network is the bottleneck, adding Collectors does not solve the problem and can even have negative effects. ([OpenTelemetry][20])

---

### 9.2 Backpressure and Failure-Recovery Differences

gRPC provides flow-control semantics. The OTLP specification defines gRPC and HTTP transport, and the Collector pipeline includes Receiver, Processor, and Exporter. ([gRPC][9])

Shared memory only provides memory-region sharing. It does not include:

```text
Flow control
Backpressure
Retry
Rejection
Timeout
Status code
Message acknowledgement
Recovery protocol
```

Therefore, when shared memory is used, these mechanisms must be defined by the application or agent.

---

### 9.3 Standardization and Upgrade-Evolution Differences

OTLP uses Protocol Buffers schema and defines gRPC / HTTP transport. When standard OTLP is used, the business SDK, Collector receiver, processor, exporter, and backend system share the same data model. ([OpenTelemetry][16])

A shared-memory solution usually needs to define:

```text
Memory layout
Record header
Schema version
Endianness
Alignment
String table
Checksum
Read/write pointer protocol
Compatibility strategy
```

If this solution is used for OpenTelemetry, a custom receiver is also needed, and Collector Builder must be used to build a Collector distribution containing the custom component. ([OpenTelemetry][18])

---

### 9.4 Observability and Diagnosis Differences

stdout/stderr logs can be handled by the container runtime, kubelet, and `kubectl logs`. File logs can be inspected with `kubectl exec`, tail, grep, and similar tools. HTTP and gRPC can be observed through request logs, status codes, metrics, and tracing. ([Kubernetes][22])

Data in shared memory is not naturally text-readable and does not automatically expose:

```text
Queue depth
Drop count
Read latency
Write latency
Consumer liveness
Version incompatibility errors
Recovery count
```

These metrics must be added explicitly by the protocol implementer.

---

### 9.5 Security Boundary Differences

Unix Domain Socket can express access boundaries through filesystem paths and permissions, and it supports passing process credentials and file descriptors. ([man7.org][10])

Kubernetes `hostPath` has security risks. The official documentation clearly warns that it may expose node credentials, container runtime sockets, or cause container escape risks. ([Kubernetes][7])

Shared-memory objects are usually located under `/dev/shm` tmpfs. Linux documentation states that POSIX shared-memory objects are visible at that location and can have permissions set through ACLs. ([man7.org][12]) Therefore, shared-memory solutions also require explicit design for permissions, naming, lifecycle, and cleanup.

---

## 10. Conclusion

This article systematically analyzed in-container inter-process communication mechanisms around the proposition that "the local performance optimum is not equivalent to the system-wide optimum." Amdahl's Law shows that local acceleration has an overall return ceiling. Little's Law shows that throughput, waiting time, and queue length constrain one another. Tail-latency research shows that average performance does not represent whole-system response quality. SRE overload-handling principles show that backpressure, rejection, and recovery are part of system stability. ([ACM Digital Library][3])

Based on three scenarios, OpenTelemetry Collector, configuration-center sidecar, and log agent, in-container communication mechanisms can be summarized as:

```text
Standard telemetry data:
  OTLP/gRPC or OTLP/HTTP

Same-machine local RPC:
  gRPC over Unix Domain Socket

Configuration sharing:
  ConfigMap / shared volume / atomic file / reload API

Cloud-native logs:
  stdout/stderr + node-level logging agent

Traditional file logs:
  shared volume + sidecar tail / filelog receiver

Large high-frequency local data plane:
  shared memory + custom synchronization protocol
```

Therefore, choosing an in-container communication mechanism should not compare only single-point transfer speed. It should also include:

```text
Protocol standardization
Backpressure capability
Queue behavior
Failure recovery
Version evolution
Security boundary
Debuggability
Operational complexity
Resource isolation
```

At the system design level, local communication performance is only one variable in the overall objective function. The system-wide optimum for a communication solution must be solved jointly across performance, stability, maintainability, upgradeability, and evolvability.

---

## References

[1] Gene M. Amdahl, *Validity of the single processor approach to achieving large scale computing capabilities*. ([ACM Digital Library][3])
[2] John D. C. Little, *A Proof for the Queuing Formula: L = lambda W*. ([IDEAS/RePEc][4])
[3] Google Research, *The Tail at Scale*. ([Google Research][5])
[4] Google SRE, *Handling Overload*. ([sre.google][6])
[5] Kubernetes Documentation, Pods / Volumes / ConfigMap / Logging Architecture. ([Kubernetes][1])
[6] Linux man-pages, Unix Domain Socket / POSIX Shared Memory / mmap. ([man7.org][10])
[7] gRPC Documentation, Core Concepts / Unix Domain Socket target / Flow Control. ([gRPC][8])
[8] OpenTelemetry Documentation, Collector / OTLP / Custom Receiver / Collector Builder. ([OpenTelemetry][15])

[1]: https://kubernetes.io/docs/concepts/workloads/pods/ "Pods | Kubernetes"
[2]: https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/?utm_source=chatgpt.com "Sidecar Containers"
[3]: https://dl.acm.org/doi/10.1145/1465482.1465560?utm_source=chatgpt.com "Validity of the single processor approach to achieving large ..."
[4]: https://ideas.repec.org/a/inm/oropre/v9y1961i3p383-387.html "A Proof for the Queuing Formula: L = (lambda) W"
[5]: https://research.google/pubs/the-tail-at-scale/ "The Tail at Scale"
[6]: https://sre.google/sre-book/handling-overload/ "Google SRE: Load Balancing with Client Side Throttling"
[7]: https://kubernetes.io/docs/concepts/storage/volumes/ "Volumes | Kubernetes"
[8]: https://grpc.io/docs/what-is-grpc/core-concepts/ "Core concepts, architecture and lifecycle | gRPC"
[9]: https://grpc.io/docs/guides/flow-control/ "Flow Control | gRPC"
[10]: https://man7.org/linux/man-pages/man7/unix.7.html "unix(7) - Linux manual page"
[11]: https://grpc.io/docs/guides/custom-name-resolution/ "Custom Name Resolution | gRPC"
[12]: https://man7.org/linux/man-pages/man7/shm_overview.7.html "shm_overview(7) - Linux manual page"
[13]: https://man7.org/linux/man-pages/man2/mmap.2.html "mmap(2) - Linux manual page"
[14]: https://opentelemetry.io/docs/collector/architecture/ "Architecture | OpenTelemetry"
[15]: https://opentelemetry.io/docs/collector/quick-start/ "Quick start | OpenTelemetry"
[16]: https://opentelemetry.io/docs/specs/otlp/ "OTLP Specification 1.10.0 | OpenTelemetry"
[17]: https://github.com/open-telemetry/opentelemetry-collector/blob/main/config/configgrpc/README.md "opentelemetry-collector/config/configgrpc/README.md at main · open-telemetry/opentelemetry-collector · GitHub"
[18]: https://opentelemetry.io/docs/collector/extend/custom-component/receiver/ "Build a receiver | OpenTelemetry"
[19]: https://opentelemetry.io/docs/collector/extend/ocb/ "Build a custom Collector with OpenTelemetry Collector Builder | OpenTelemetry"
[20]: https://opentelemetry.io/docs/collector/scaling/ "Scaling the Collector | OpenTelemetry"
[21]: https://kubernetes.io/docs/concepts/configuration/configmap/ "ConfigMaps | Kubernetes"
[22]: https://kubernetes.io/docs/concepts/cluster-administration/logging/ "Logging Architecture | Kubernetes"
[23]: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/receiver/filelogreceiver/README.md?utm_source=chatgpt.com "opentelemetry-collector-contrib/receiver/filelogreceiver ..."
