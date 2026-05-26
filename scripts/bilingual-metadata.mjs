export const topics = [
  {
    slug: "dsl",
    titleEn: "Why CUE Works Well as a Configuration DSL",
    titleZh: "最佳 DSL 语言：CUE",
    categoryEn: "Configuration Engineering",
    categoryZh: "配置工程",
    summaryEn:
      "A practical comparison of type constraints, reuse, validation, and multi-environment governance to explain why CUE is a strong fit for complex declarative configuration.",
    tagsEn: ["DSL", "CUE", "Configuration Language", "Config Governance"],
    readingDirectionEn:
      "Read this when evaluating configuration language choices, schema unification, or platform-level configuration engineering."
  },
  {
    slug: "service-naming",
    titleEn: "Service Naming for Very Large Enterprises",
    titleZh: "面向超大型企业的微服务命名体系研究",
    categoryEn: "Service Governance",
    categoryZh: "服务治理",
    summaryEn:
      "A naming-system discussion for large organizations that need stable, expressive, and governable service identities across many business domains.",
    tagsEn: ["Microservices", "Naming", "Governance", "Architecture"],
    readingDirectionEn:
      "Read this when defining service identity rules or cleaning up inconsistent naming across large service estates."
  },
  {
    slug: "loadbalancer",
    titleEn: "Load-Balancing Architecture Choices for Internal Microservice Calls",
    titleZh: "面向微服务内部调用的负载均衡架构选择",
    categoryEn: "Service Governance",
    categoryZh: "服务治理",
    summaryEn:
      "A practical guide to choosing client-side or sidecar load balancing for east-west traffic while keeping gateways and ingress layers for north-south traffic.",
    tagsEn: ["Load Balancing", "Microservices", "Service Discovery", "gRPC"],
    readingDirectionEn:
      "Read this when deciding how internal service calls should select instances and which load-balancing strategy fits modern microservice traffic."
  },
  {
    slug: "retry",
    titleEn: "Retry Strategy Best Practices in Software Development",
    titleZh: "软件开发中的重试策略最佳实践",
    categoryEn: "Service Reliability",
    categoryZh: "服务可靠性",
    summaryEn:
      "A practical guide to retry boundaries, strategy selection, idempotency, and production rollout across thread pools, message queues, HTTP, and gRPC.",
    tagsEn: ["Retry", "Distributed Systems", "Idempotency", "gRPC"],
    readingDirectionEn:
      "Read this when standardizing fault-tolerance policy, handling transient downstream failures, or defining an enterprise-wide retry baseline."
  },
  {
    slug: "timeout",
    titleEn: "Timeout Definitions and Configuration in Network Communication",
    titleZh: "网络通信中的超时定义与设置",
    categoryEn: "Service Reliability",
    categoryZh: "服务可靠性",
    summaryEn:
      "A structured guide to timeout types, root-cause analysis, observability, and configuration principles across clients, servers, gateways, and gRPC.",
    tagsEn: ["Timeout", "Network Communication", "gRPC", "Service Reliability"],
    readingDirectionEn:
      "Read this when diagnosing timeout failures, designing layered timeout models, or standardizing request deadlines across distributed services."
  },
  {
    slug: "high_availability",
    titleEn: "Typical Cases Where Local Performance Optimization Reduces System Availability",
    titleZh: "局部性能优化导致系统可用性下降的典型案例分析",
    categoryEn: "Service Reliability",
    categoryZh: "服务可靠性",
    summaryEn:
      "A systematic analysis of how local optimizations around thread pools, timeouts, retries, caches, connection pools, aggregation APIs, async execution, read/write splitting, batching, local caches, rate limiting, releases, resource isolation, idempotency, and observability can reduce system-wide availability.",
    tagsEn: ["High Availability", "Performance Optimization", "Fault Isolation", "Rate Limiting", "Idempotency"],
    readingDirectionEn:
      "Read this when reviewing high-concurrency or high-performance optimizations, defining reliability governance rules, evaluating load-test reports, performing incident reviews, planning canary releases, or setting capacity boundaries."
  },
  {
    slug: "three_high",
    titleEn: "Trade-Offs Among High Availability, High Performance, and High Concurrency",
    titleZh: "高可用、高性能与高并发设计取舍研究",
    categoryEn: "Reliability Engineering",
    categoryZh: "可靠性工程",
    summaryEn:
      "A reliability-engineering analysis of conflicts among high availability, high performance, and high concurrency across resources, time, consistency, and complexity, with a production-oriented trade-off framework.",
    tagsEn: ["High Availability", "High Performance", "High Concurrency", "Reliability Engineering", "Rate Limiting"],
    readingDirectionEn:
      "Read this when reviewing system architecture, capacity planning, load-test results, stability governance, rate limiting, circuit breaking, or trade-offs among the three high-level system goals."
  },
  {
    slug: "observability-spec",
    titleEn: "Observability Specification",
    titleZh: "可观测规范",
    categoryEn: "Observability",
    categoryZh: "可观测性",
    summaryEn:
      "A baseline observability specification covering signals, naming, and operational expectations across infrastructure and application layers.",
    tagsEn: ["Observability", "Tracing", "Metrics", "Logging"],
    readingDirectionEn:
      "Read this when standardizing telemetry conventions or defining platform-wide observability contracts."
  },
  {
    slug: "prometheus",
    titleEn: "Technical Comparison and Migration Guide for Prometheus and VictoriaMetrics",
    titleZh: "Prometheus 与 VictoriaMetrics 的技术比较及迁移方法研究",
    categoryEn: "Observability",
    categoryZh: "可观测性",
    summaryEn:
      "A systematic comparison of Prometheus and VictoriaMetrics across system positioning, data ingestion, query compatibility, storage layout, performance mechanisms, and a standard migration path from Prometheus to VictoriaMetrics.",
    tagsEn: ["Prometheus", "VictoriaMetrics", "PromQL", "Remote Write", "Observability"],
    readingDirectionEn:
      "Read this when evaluating Prometheus long-term storage, VictoriaMetrics replacement paths, vmagent/vmalert migration, PromQL compatibility, or large-scale time-series storage architecture."
  },
  {
    slug: "opentelemetry_log",
    titleEn: "Moving Beyond ELK Dependency: Redefining Log Governance in the OpenTelemetry Era",
    titleZh: "告别 ELK 依赖？在 OpenTelemetry 时代重新定义日志治理",
    categoryEn: "Observability",
    categoryZh: "可观测性",
    summaryEn:
      "A study of log governance evolution from local files and ELK to OpenTelemetry, covering Java and Go logging SDK choices, Collector pipelines, Kafka buffering, gateway tradeoffs, and custom Collector engineering.",
    tagsEn: ["OpenTelemetry", "Logs", "ELK", "Collector", "Kafka"],
    readingDirectionEn:
      "Read this when redesigning enterprise log governance, migrating from ELK-centric collection to OpenTelemetry, choosing Java or Go logging SDKs, or designing Collector-to-Kafka log pipelines."
  },
  {
    slug: "elaticsearch",
    titleEn:
      "Elasticsearch Internals: Lucene Storage, Cluster Coordination, and Replication Mechanisms",
    titleZh: "Elasticsearch 底层架构：Lucene 存储、集群协调与复制机制分析",
    categoryEn: "Search Infrastructure",
    categoryZh: "搜索基础设施",
    summaryEn:
      "A systematic analysis of Elasticsearch internals, including Lucene storage, inverted indexes, Doc Values, BKD Tree, FST, segments, translog, cluster coordination, Zen2, and primary-backup shard replication.",
    tagsEn: ["Elasticsearch", "Lucene", "Inverted Index", "Zen2", "PacificA"],
    readingDirectionEn:
      "Read this when studying why Elasticsearch is not a generic KV store, where Lucene query efficiency comes from, how shard replication consistency works, or how Zen2 coordination and read/write paths behave."
  },
  {
    slug: "effective_elasticsearch",
    titleEn:
      "Engineering Practices for Storing Application Logs in Elasticsearch at Very Large Enterprises",
    titleZh: "超大型企业基于 Elasticsearch 存储应用日志的工程实践研究",
    categoryEn: "Search Infrastructure",
    categoryZh: "搜索基础设施",
    summaryEn:
      "A systematic guide to storing application logs in Elasticsearch at very large enterprises, covering data streams, index templates, ILM, ECS, mappings, exception stacks, duplicate-log aggregation, multi-tenancy, high-traffic applications, and very long log handling.",
    tagsEn: ["Elasticsearch", "Application Logs", "Data Streams", "ILM", "ECS"],
    readingDirectionEn:
      "Read this when designing an enterprise log platform, governing Elasticsearch log indexes, handling exception storms, planning multi-tenant isolation, or optimizing log storage cost."
  },
  {
    slug: "acme_https",
    titleEn: "Complete Guide to Enabling HTTPS with acme.sh and Nginx",
    titleZh: "acme.sh + Nginx 接入 HTTPS 完整操作指南",
    categoryEn: "Security Operations",
    categoryZh: "安全运维",
    summaryEn:
      "A practical HTTPS setup guide based on a real stellhub.top rollout, covering acme.sh, Let's Encrypt, Nginx, HTTP-01 validation, certificate installation, automatic renewal, and common troubleshooting.",
    tagsEn: ["HTTPS", "acme.sh", "Nginx", "Let's Encrypt", "TLS"],
    readingDirectionEn:
      "Read this when configuring HTTPS for a self-hosted website, blog, API gateway, or SaaS service, issuing Let's Encrypt certificates, or troubleshooting ACME HTTP-01 validation and Nginx TLS configuration."
  },
  {
    slug: "traces",
    titleEn: "Tracing Research for Large-Scale Enterprises",
    titleZh: "大型企业跨语言微服务链路追踪技术调研方案",
    categoryEn: "Distributed Tracing",
    categoryZh: "链路追踪",
    summaryEn:
      "A research-oriented walkthrough of cross-language tracing design choices, interoperability concerns, and rollout considerations for large enterprises.",
    tagsEn: ["Tracing", "Microservices", "OpenTelemetry", "Research"],
    readingDirectionEn:
      "Read this when comparing tracing architectures or planning a platform-wide tracing rollout."
  },
  {
    slug: "tracing",
    titleEn:
      "The Evolution of Distributed Tracing: From Call-Chain Visualization to Cloud-Native Observability Standards",
    titleZh: "分布式链路追踪的发展历程",
    categoryEn: "Observability",
    categoryZh: "可观测性",
    summaryEn:
      "A historical and architectural review of distributed tracing from Dapper, EagleEye, Zipkin, Jaeger, and SkyWalking to OpenTelemetry and Tempo, explaining how tracing became a cloud-native observability signal.",
    tagsEn: ["Distributed Tracing", "OpenTelemetry", "Jaeger", "SkyWalking", "Tempo"],
    readingDirectionEn:
      "Read this when studying tracing history, evaluating observability architecture, planning OpenTelemetry adoption, or comparing Zipkin, Jaeger, SkyWalking, and Tempo."
  },
  {
    slug: "error-code-spec",
    titleEn: "Error Code Specification",
    titleZh: "错误码规范",
    categoryEn: "Application Contract",
    categoryZh: "应用契约",
    summaryEn:
      "A specification for shaping error codes into a stable contract that is easier to govern, observe, and consume across teams.",
    tagsEn: ["Error Code", "Contract", "API", "Governance"],
    readingDirectionEn:
      "Read this when trying to make service errors more structured, machine-readable, and operationally useful."
  },
  {
    slug: "middleware-evolution",
    titleEn: "Why Enterprises Build Middleware Platforms",
    titleZh: "为什么企业要自研中间件",
    categoryEn: "Platform Strategy",
    categoryZh: "平台战略",
    summaryEn:
      "An engineering and organizational perspective on when self-built middleware becomes justified and what tradeoffs it introduces.",
    tagsEn: ["Middleware", "Platform", "Architecture", "Strategy"],
    readingDirectionEn:
      "Read this when evaluating build-vs-buy decisions or the long-term cost model of infrastructure platforms."
  },
  {
    slug: "kafka_pulsar",
    titleEn:
      "Message Middleware Architecture Evolution in the Cloud-Native Era: Apache Kafka and Apache Pulsar",
    titleZh: "云原生时代消息中间件架构演进研究：以 Apache Kafka 与 Apache Pulsar 为中心",
    categoryEn: "Messaging Infrastructure",
    categoryZh: "消息中间件",
    summaryEn:
      "A study of message middleware architecture evolution in the cloud-native era through Apache Kafka and Apache Pulsar, covering state organization, storage separation, multi-tenancy, containerization, and stateful system boundaries.",
    tagsEn: ["Kafka", "Pulsar", "Message Queue", "Cloud Native", "Stateful Middleware"],
    readingDirectionEn:
      "Read this when comparing Kafka and Pulsar architectures, or evaluating whether middleware should become stateless, containerized, or separated into service and storage layers."
  },
  {
    slug: "stellflow",
    titleEn:
      "Self-Built Enterprise Message Queue Architecture Based on the Distributed Log Model: Stellflow as an Example",
    titleZh: "基于分布式日志模型的企业级消息队列自研架构研究：以 Stellflow 为例",
    categoryEn: "Messaging Infrastructure",
    categoryZh: "消息中间件",
    summaryEn:
      "A Stellflow-based study of self-built enterprise message queue architecture, covering distributed log modeling, data-plane protocol design, broker request paths, storage, controller quorum, replicas, high-throughput data paths, and OpenTelemetry-first observability.",
    tagsEn: ["Stellflow", "Message Queue", "Distributed Log", "Raft", "OpenTelemetry"],
    readingDirectionEn:
      "Read this when designing an enterprise message queue, building a distributed log system, planning broker/controller architecture, replication high-watermark rules, protocol evolution, or observability metrics."
  },
  {
    slug: "distributed-consistency",
    titleEn: "Consistency Challenges in Distributed Systems",
    titleZh: "分布式系统中的一致性挑战及其解决路径",
    categoryEn: "Distributed Systems",
    categoryZh: "分布式系统",
    summaryEn:
      "A concise discussion of consistency challenges, failure modes, and the decision paths commonly used to address them in distributed systems.",
    tagsEn: ["Consistency", "Distributed Systems", "Reliability", "Transactions"],
    readingDirectionEn:
      "Read this when comparing consistency strategies or selecting a reliability model for cross-service workflows."
  },
  {
    slug: "distributed-system-registry-centers",
    titleEn: "Registry Centers in Distributed Systems",
    titleZh: "分布式系统注册中心意义、问题与主流实现",
    categoryEn: "Infrastructure Foundation",
    categoryZh: "基础设施",
    summaryEn:
      "A review of why registry centers exist, what problems they solve, and how mainstream implementations make different engineering tradeoffs.",
    tagsEn: ["Registry", "Discovery", "Distributed Systems", "Infrastructure"],
    readingDirectionEn:
      "Read this when evaluating service discovery patterns or studying registry-center implementation choices."
  },
  {
    slug: "stellmap",
    titleEn:
      "Enterprise Registry Center Architecture, Core Design, and Self-Built Implementation Path: StellMap as an Example",
    titleZh: "企业级注册中心的架构模型、核心设计与自研实现路径研究：以 StellMap 为例",
    categoryEn: "Infrastructure Foundation",
    categoryZh: "基础设施",
    summaryEn:
      "A systematic study of enterprise registry-center architecture, including service discovery, consistency models, storage, Watch, cross-region synchronization, operations, and the self-built StellMap implementation path.",
    tagsEn: ["Registry Center", "Service Discovery", "Raft", "CAP", "StellMap"],
    readingDirectionEn:
      "Read this when comparing registry-center architectures, designing CP/AP service discovery, implementing Raft-backed service registries, or studying StellMap's modular implementation."
  },
  {
    slug: "sre",
    titleEn: "Site Reliability Engineering for Middleware Platforms",
    titleZh: "中间件站点可靠性工程研究",
    categoryEn: "Service Reliability",
    categoryZh: "服务可靠性",
    summaryEn:
      "A systematic study of how middleware and microservice teams should define SLI, SLO, and SLA, and how observability and service governance should form a closed reliability loop.",
    tagsEn: ["SRE", "SLI", "SLO", "SLA", "Service Governance", "Observability"],
    readingDirectionEn:
      "Read this when designing reliability contracts, error-budget policies, or observability-driven governance for middleware and microservice platforms."
  },
  {
    slug: "throughput",
    titleEn: "How to Improve System Throughput by 10x: An End-to-End Network Optimization Guide",
    titleZh: "如何将系统吞吐量提升 10 倍？网络通信全链路优化指南",
    categoryEn: "Performance Engineering",
    categoryZh: "性能工程",
    summaryEn:
      "A systematic guide to improving network-path throughput through batching, lower copy overhead, sequential I/O, zero-copy, pipelining, and fewer repeated serialization passes.",
    tagsEn: ["Throughput", "Performance Optimization", "Zero-Copy", "Pipeline", "Kafka", "Redis"],
    readingDirectionEn:
      "Read this when diagnosing throughput bottlenecks, designing a high-throughput data path, or planning coordinated optimization across network, memory, and storage layers."
  },
  {
    slug: "zero_copy",
    titleEn: "Linux Data Loading, Access, Transfer, and Zero-Copy Mechanisms",
    titleZh: "Linux 系统中的数据加载、访问、传输与零拷贝机制研究",
    categoryEn: "Performance Engineering",
    categoryZh: "性能工程",
    summaryEn:
      "A study of Linux data access paths, virtual-to-physical memory mapping, page cache, task_struct, mm_struct, files_struct, address_space, and zero-copy techniques including Direct Memory, sendfile, and mmap plus write.",
    tagsEn: ["Linux", "Zero Copy", "Page Cache", "mmap", "sendfile"],
    readingDirectionEn:
      "Read this when studying Linux data paths, page cache behavior, Java NIO transferTo, mmap, Direct Memory, or zero-copy performance experiments."
  },
  {
    slug: "protocol",
    titleEn: "Custom Application Protocols over TCP: Kafka, Redis, and MySQL as Case Studies",
    titleZh: "基于 TCP 的自定义应用层协议研究：以 Kafka、Redis、MySQL 为例",
    categoryEn: "Network Protocols",
    categoryZh: "网络协议",
    summaryEn:
      "Using Kafka, Redis, and MySQL as examples, this article explains why infrastructure systems design custom application protocols on top of TCP and what that buys them in performance, semantics, and long-term evolution.",
    tagsEn: ["TCP", "Custom Protocol", "Kafka", "Redis", "MySQL", "gRPC"],
    readingDirectionEn:
      "Read this when evaluating transport choices for infrastructure software, comparing HTTP or gRPC with custom protocols, or designing a high-performance middleware wire protocol."
  },
  {
    slug: "ai-microservice",
    titleEn:
      "Where Should Internet Applications Go in the AI Era? From Traffic Economy to Compute Economy",
    titleZh: "AI 时代下，互联网应用应该何去何从：从流量经济到算力经济的范式迁移",
    categoryEn: "AI Engineering",
    categoryZh: "AI 工程",
    summaryEn:
      "A strategic and engineering analysis of how AI changes internet application economics, covering token cost, model tiering, context infrastructure, workflow automation, value-based pricing, and AI cost governance.",
    tagsEn: ["AI Applications", "Compute Economy", "Cost Governance", "AI Gateway", "Context Engineering"],
    readingDirectionEn:
      "Read this when evaluating AI-enabled product strategy, model routing, cost governance, context infrastructure, or pricing models for internet applications."
  },
  {
    slug: "java-serialization",
    titleEn:
      "Java Serialization Performance Study across JDK, Jackson JSON, Jackson Smile, Protobuf, Kryo, and Hessian2",
    titleZh: "Java 序列化性能调研：JDK、Jackson JSON、Jackson Smile、Protobuf、Kryo、Hessian2",
    categoryEn: "Performance Engineering",
    categoryZh: "性能工程",
    summaryEn:
      "A benchmark-backed comparison of JDK native serialization, Jackson JSON, Jackson Smile, Protobuf, Kryo, and Hessian2 across size, latency, ecosystem fit, cross-language support, schema evolution, and security boundaries.",
    tagsEn: ["Java", "Serialization", "Benchmark", "Protobuf", "Kryo"],
    readingDirectionEn:
      "Read this when evaluating serialization choices for Java RPC, message queues, caches, object persistence, or middleware data exchange."
  },
  {
    slug: "jdk_upgrade",
    titleEn: "Technical Guide for Migrating from JDK 8, 11, and 17 to JDK 21 and Later",
    titleZh: "从 JDK 8 / 11 / 17 迁移至 JDK 21 及以上版本的技术指南",
    categoryEn: "Java Engineering",
    categoryZh: "Java 工程",
    summaryEn:
      "A systematic guide to migrating from JDK 8, JDK 11, and JDK 17 to JDK 21 and later, covering migration paths, benefit sources, upgrade cost, ROI, risk control, observability, and regression testing.",
    tagsEn: ["JDK", "Java", "Virtual Threads", "ZGC", "Performance Regression"],
    readingDirectionEn:
      "Read this when planning enterprise Java runtime upgrades, evaluating JDK 21 or JDK 25, validating virtual threads or Generational ZGC, or designing canary and regression strategies."
  },
  {
    slug: "nio_epoll",
    titleEn: "Evolution of epoll-Based NIO Network Models and Multi-Framework Implementations",
    titleZh: "基于 epoll 的 NIO 网络模型演进与多框架实现研究",
    categoryEn: "Java Engineering",
    categoryZh: "Java 工程",
    summaryEn:
      "A study of Linux epoll, NIO network model evolution, epoll system call semantics, differences between select, poll, and epoll, and event-driven implementations in Netty, Go, Redis, and Nginx.",
    tagsEn: ["epoll", "NIO", "Netty", "Go", "Virtual Threads"],
    readingDirectionEn:
      "Read this when studying the Linux NIO network model, Netty native epoll, Go runtime netpoll, Redis and Nginx event models, or the boundary between virtual threads and EventLoop."
  },
  {
    slug: "netty_options",
    titleEn:
      "Netty Parameter Tuning: A Systematic Analysis Based on Symptoms, Option Semantics, and Official Documentation",
    titleZh: "Netty 参数调优研究：基于问题现象、参数语义与官方文档的系统化分析",
    categoryEn: "Java Engineering",
    categoryZh: "Java 工程",
    summaryEn:
      "A systematic guide to Netty 4.1 tuning across connection establishment, read/write buffering, backpressure, thread models, memory allocation, keepalive, and Linux native transport, grounded in option semantics and observable symptoms.",
    tagsEn: ["Netty", "Java", "Network Tuning", "Backpressure", "epoll"],
    readingDirectionEn:
      "Read this when diagnosing Netty connection spikes, small-packet latency, outbound buffer growth, EventLoop blocking, direct memory growth, or Linux native transport choices."
  },
  {
    slug: "grpc_java",
    titleEn: "gRPC Java's Netty-Based Layered Abstractions and Execution Model",
    titleZh: "gRPC Java 基于 Netty 的分层封装与执行模型研究",
    categoryEn: "Java Engineering",
    categoryZh: "Java 工程",
    summaryEn:
      "A systematic study of how gRPC Java wraps Netty HTTP/2 transport with RPC abstractions such as Stub, Channel, Transport, Stream, Call, Interceptor, Listener, and Observer.",
    tagsEn: ["gRPC Java", "Netty", "HTTP/2", "RPC", "StreamObserver"],
    readingDirectionEn:
      "Read this when studying the layering boundary between gRPC Java and Netty, the difference between Interceptor and ChannelHandler, RPC call lifecycles, or asynchronous streaming execution."
  },
  {
    slug: "tuning",
    titleEn:
      "Fast Is Not the Same as Good: Local Performance Optimum Is Not Equivalent to System-Wide Optimum",
    titleZh: "快不等于优：局部性能最优并不等价于系统整体最优",
    categoryEn: "Performance Engineering",
    categoryZh: "性能工程",
    summaryEn:
      "A systematic analysis of in-container communication choices using OpenTelemetry Collector, configuration sidecars, and log agents, grounded in Amdahl's Law, Little's Law, tail latency, and cloud-native official practices.",
    tagsEn: ["Performance Tuning", "Container Communication", "IPC", "OpenTelemetry", "Sidecar"],
    readingDirectionEn:
      "Read this when evaluating in-container process communication, sidecar data sharing, log collection, telemetry reporting, or shared-memory optimization."
  },
  {
    slug: "containerd",
    titleEn:
      "Understanding Kubernetes and Docker from the Linux Kernel: Pod and Container Creation, Runtime, Syscalls, and Destruction",
    titleZh: "从 Linux 内核视角理解 Kubernetes 与 Docker：Pod / 容器的创建、运行、系统调用与销毁机制",
    categoryEn: "Cloud Native",
    categoryZh: "云原生",
    summaryEn:
      "A kernel-level explanation of container creation, runtime behavior, and destruction through Pod lifecycle, CRI, containerd, Docker, runc, Linux syscalls, namespaces, nsproxy, and cgroups.",
    tagsEn: ["Kubernetes", "Docker", "containerd", "runc", "Linux Kernel"],
    readingDirectionEn:
      "Read this when studying Kubernetes runtime internals, OCI runtime behavior, namespace and cgroup isolation, or container startup and syscall troubleshooting."
  },
  {
    slug: "connection",
    titleEn:
      "Beware Unintentional Short Connections: How Frequent Middleware Client Creation Causes Connection Avalanches",
    titleZh: "警惕无意识的“短连接”：深挖中间件客户端频繁创建引发的连接雪崩",
    categoryEn: "Network Reliability",
    categoryZh: "网络可靠性",
    summaryEn:
      "A practical analysis of how repeatedly creating HTTP, gRPC, registry, configuration, and middleware SDK clients on hot paths can bypass connection reuse and trigger connection avalanches.",
    tagsEn: ["Connection Reuse", "HTTP", "gRPC", "Middleware", "Client Lifecycle"],
    readingDirectionEn:
      "Read this when diagnosing connection storms, fallback-path client creation, HTTP client lifecycle issues, gRPC channel reuse problems, or middleware SDK resource churn."
  },
  {
    slug: "connection_govern",
    titleEn:
      "Connection Governance for High-Concurrency Services: Connection Lifecycle, Troubleshooting, and Operations SOP",
    titleZh: "如何做连接治理：面向高并发服务的连接生命周期、故障定位与运维 SOP 研究",
    categoryEn: "Network Reliability",
    categoryZh: "网络可靠性",
    summaryEn:
      "A systematic connection-governance guide for high-concurrency services, covering TCP, HTTP/gRPC, databases, connection pools, proxies, conntrack, file descriptors, lifecycle management, capacity models, timeout classification, CLOSE_WAIT, TIME_WAIT, and standardized troubleshooting SOPs.",
    tagsEn: ["Connection Governance", "TCP", "Connection Pool", "CLOSE_WAIT", "TIME_WAIT", "SOP"],
    readingDirectionEn:
      "Read this when handling excessive connection counts, connection timeouts, exhausted pools, CLOSE_WAIT or TIME_WAIT buildup, database Too many connections errors, full conntrack tables, or file descriptor exhaustion."
  },
  {
    slug: "connect_reset_by_peer",
    titleEn:
      "Connection Reset by Peer: TCP RST, Connection Lifecycle, and Engineering Troubleshooting",
    titleZh: "Connection reset by peer：TCP RST、连接生命周期与工程排查体系研究",
    categoryEn: "Network Reliability",
    categoryZh: "网络可靠性",
    summaryEn:
      "A systematic explanation of Connection reset by peer, TCP RST semantics, lifecycle timing, common production causes, and practical troubleshooting methods for long-lived network connections.",
    tagsEn: ["TCP", "ECONNRESET", "RST", "Keepalive", "Network Troubleshooting"],
    readingDirectionEn:
      "Read this when diagnosing connection resets, long-connection disconnects, stale connection-pool reuse, idle timeouts, or registry watch failures."
  },
  {
    slug: "task_struct",
    titleEn:
      "Linux task_struct Design Philosophy: From Process Descriptor to Unified Task Model",
    titleZh: "深入研究 Linux task_struct 的设计哲学：从进程描述符到统一任务模型",
    categoryEn: "Operating Systems",
    categoryZh: "操作系统",
    summaryEn:
      "A layered study of how Linux uses task_struct as the central index for schedulable tasks, connecting scheduling, memory, files, signals, credentials, namespaces, cgroups, I/O, and observability.",
    tagsEn: ["Linux", "task_struct", "Process Model", "Threads", "Kernel Scheduling"],
    readingDirectionEn:
      "Read this when studying Linux process and thread semantics, clone resource sharing, kernel scheduling entities, or the boundary between OS threads and user-mode lightweight threads."
  },
  {
    slug: "fd",
    titleEn:
      "Linux File Descriptors: From Everything Is a File to fd Kernel Abstractions and Engineering Practice",
    titleZh: "Linux 文件描述符研究：从“一切皆文件”到 fd 的内核抽象与工程实践",
    categoryEn: "Operating Systems",
    categoryZh: "操作系统",
    summaryEn:
      "A systematic study of Linux file descriptors, open file descriptions, VFS, inodes, sockets, epoll, inheritance semantics, and production engineering practices.",
    tagsEn: ["Linux", "File Descriptor", "VFS", "epoll", "System Programming"],
    readingDirectionEn:
      "Read this when learning the Linux I/O model, troubleshooting fd leaks, understanding socket and epoll lifecycles, or designing resource governance for high-concurrency services."
  },
  {
    slug: "ipc",
    titleEn: "Linux Inter-Process Communication and the mmap User-Space Call Path",
    titleZh: "Linux 进程间通信机制及 mmap 用户态调用路径研究",
    categoryEn: "Operating Systems",
    categoryZh: "操作系统",
    summaryEn:
      "A systematic study of Linux IPC mechanisms, including signals, pipes, FIFOs, UNIX Domain Sockets, message queues, shared memory, mmap, futex, eventfd, epoll, and the mmap path from multiple user-space languages to kernel syscalls.",
    tagsEn: ["Linux", "IPC", "mmap", "Shared Memory", "System Calls"],
    readingDirectionEn:
      "Read this when learning Linux inter-process communication, shared memory, mmap call paths, event loops, or cross-language local communication design choices."
  },
  {
    slug: "v_thread",
    titleEn: "Virtual Threads, Runtime Scheduling, and the Linux Kernel Thread Model",
    titleZh: "虚拟线程的本质、运行时调度与 Linux 内核线程模型研究",
    categoryEn: "Concurrency Engineering",
    categoryZh: "并发工程",
    summaryEn:
      "A comparative explanation of Java virtual threads, Go goroutines, Linux task_struct, user-mode scheduling, blocking I/O unmounting, clone paths, and kernel-visible thread boundaries.",
    tagsEn: ["Virtual Threads", "Project Loom", "Goroutine", "Linux", "task_struct"],
    readingDirectionEn:
      "Read this when evaluating Java virtual threads, Go goroutines, M:N scheduling, blocking I/O behavior, or their relationship with Linux kernel threads."
  }
];
