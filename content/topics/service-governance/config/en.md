# Configuration Center Design Practices: From Configuration Models to Highly Available Read and Write Architecture

## Abstract

As monolithic applications evolve into microservices, cloud-native systems, and multi-cluster deployment architectures, configuration management has gradually evolved from local files, environment variables, and built-in application parameters into centralized, dynamic, auditable, and rollback-capable distributed configuration centers. The core problem of a configuration center is not simply saving key-value pairs. It is providing configuration isolation, configuration delivery, subscription, version management, canary release, access control, audit tracing, and failure fallback across many applications, environments, clusters, regions, tenants, and release stages. Apollo, Spring Cloud Config, Consul, and Nacos represent different implementation paths for enterprise configuration governance, Spring externalized configuration, service-network KV storage, and integrated service discovery plus configuration platforms. This article analyzes configuration centers from five perspectives: background, mainstream system boundaries, configuration type models, scope models, and storage architecture. It then gives an architectural conclusion for enterprise configuration centers: at runtime, configuration centers are usually read-heavy and write-light. A database is suitable as the data foundation for persistence, version management, audit tracing, and failure recovery, but it should not sit directly on the high-frequency client read path. A more reasonable architecture is a weak database dependency model based on "multi-node full in-memory cache + database persistence + change-event synchronization + client local cache."

**Keywords**: configuration center; microservices; dynamic configuration; Apollo; Nacos; Spring Cloud Config; Consul; configuration governance; multi-environment isolation; weak database dependency

## 1. Introduction

Configuration is the set of runtime parameters that vary across deployment environments but should not be hard-coded into application code. Early applications usually managed configuration through local files, environment variables, command-line parameters, or code constants. As application scale increased, problems gradually appeared: configuration files were scattered, formats were inconsistent, environment differences were hard to trace, misconfigured changes were difficult to roll back, sensitive information could leak, and service restarts became costly.

The Twelve-Factor App treats "config separated from code" as an important principle for modern applications. It states that configuration varies across deployment environments, while code itself should not vary across deployments. This principle requires applications to adapt to different deployment environments through external configuration without code changes. Spring Boot also provides externalized configuration capabilities, supporting Java properties, YAML, environment variables, command-line parameters, and other sources so that the same application code can use different configurations in different environments.

However, framework-level externalized configuration only solves how a single application loads configuration. It does not fully solve centralized governance across multiple applications, cross-environment release, configuration-change audit, canary release, client subscription, and failure rollback. In microservice architecture, the number of applications, instances, environments, configuration items, and releases increases significantly. Configuration gradually evolves from "application startup parameters" into part of the runtime control plane of a distributed system.

Therefore, configuration centers have evolved from centralized configuration storage systems into configuration lifecycle governance platforms. They not only store configuration content, but also handle editing, publishing, distribution, subscription, version management, canary control, access control, approval workflows, audit records, rollback recovery, and client-state observability. For large enterprise infrastructure, a configuration center is no longer just a KV storage system. It is critical infrastructure in the service governance system.

## 2. Background and Evolution of Configuration Centers

The evolution of configuration centers can be divided into five stages.

The first stage is code-based and local-file configuration. Configuration is tightly bound to application code or deployment packages, and changes usually require rebuilding, redeploying, or restarting applications. The main problems are that configuration cannot be centrally searched or audited, is difficult to copy across environments, and sensitive configuration can spread through code repositories, images, or deployment packages.

The second stage is externalized configuration. Applications load configuration through environment variables, command-line parameters, external properties files, YAML files, and similar mechanisms, allowing the same codebase to use different configurations in development, testing, staging, and production. Spring Boot externalized configuration belongs to this stage. It solves how an application process assembles configuration by priority at startup.

The third stage is centralized configuration repositories. Spring Cloud Config uses a Config Server as the center and provides server-side and client-side externalized configuration support for distributed systems. Its default backend is Git, so configuration versions can be managed with Git branches, tags, and commit history. The focus of this stage is moving configuration out of application processes and into a unified repository, then exposing it through a central service.

The fourth stage is dynamic configuration centers. Apollo and Nacos represent this stage. Apollo supports centralized configuration management across environments, clusters, and namespaces. It supports real-time configuration changes, version management, canary release, access control, and operation audit. Nacos provides centralized, externalized, and dynamic configuration management, and supports historical versions, rollback, subscriber queries, beta releases, and configuration-change management. At this stage, a configuration center is no longer just a read service. It provides a complete configuration-change process.

The fifth stage is cloud-native configuration and platform governance. Kubernetes ConfigMap stores non-sensitive configuration as API objects and mounts it as environment variables, command-line parameters, or files, emphasizing decoupling configuration from container images. Kubernetes Secret stores passwords, tokens, keys, and other sensitive data. In cloud-native environments, configuration centers must collaborate with service discovery, release systems, permission systems, secret systems, audit systems, canary systems, and observability systems.

## 3. Comparison of Mainstream Configuration Center Systems

### 3.1 Apollo

Apollo is a configuration center for microservice configuration management. It supports centralized management of configurations across applications, environments, clusters, and namespaces. Its core capabilities include real-time configuration effectiveness, version management, canary release, access control, operation audit, configuration rollback, and client configuration monitoring.

From an architectural-responsibility perspective, Apollo separates configuration reading from configuration management. Config Service provides configuration reading and push capabilities for clients. Admin Service provides configuration modification and publishing capabilities for Portal. Portal is the configuration management UI and accesses Admin Service instances in different environments. Apollo clients use long polling to sense configuration updates and use periodic polling as a fallback. After obtaining configuration, the client stores it in process memory and caches the last successful configuration on the local filesystem for recovery when the configuration center is unavailable.

Apollo's strength is its complete enterprise configuration governance capability. It is suitable for large-scale microservice scenarios with many environments, clusters, teams, and applications. Its limitation is that deployment components and database planning are relatively complex. Apollo servers usually require ApolloPortalDB and ApolloConfigDB, and ApolloConfigDB is usually deployed per environment. Therefore, for small systems with only a few configuration items and no canary release, approval, or audit requirements, Apollo's governance capability may exceed actual needs.

### 3.2 Spring Cloud Config

Spring Cloud Config provides server-side and client-side externalized configuration support for distributed systems. Its model is consistent with Spring Environment and PropertySource abstractions, making it highly suitable for Spring ecosystem applications. Config Server uses Git as the default configuration backend, so branches, tags, and commit records can manage configuration versions.

Spring Cloud Config's strength is its high integration with the Spring ecosystem and flexible storage backends. It supports Git, filesystem, JDBC, Redis, Vault, AWS Parameter Store, AWS Secrets Manager, Google Secret Manager, MongoDB, and other backends. It can also expose configuration as JSON, YAML, properties, plain text, binary files, and other forms.

Its limitation is that it is closer to a "configuration read service + external storage adapter layer" than a complete configuration governance platform. It is not equivalent to Apollo or Nacos, which provide consoles, approvals, canary release, audit, and client-state tracking. Dynamic refresh usually also requires Spring Cloud Bus, webhooks, or client refresh mechanisms. For non-Spring technology stacks, configuration can be read through HTTP, but the model naturally revolves around Spring Environment and PropertySource.

### 3.3 Consul

Consul is a service networking platform that includes service discovery, health checks, KV storage, ACLs, service mesh, and multi-datacenter support. Consul KV can store index objects, configuration parameters, and metadata, and is often used for dynamic application configuration.

Consul's strength is that service discovery, health checks, KV, Watch, ACL, and Consul Template can be combined. It is suitable for storing small-scale dynamic parameters, service metadata, and infrastructure configuration. Consul replicates state among Server nodes through the Raft protocol and uses quorum to ensure safety for writes and membership changes.

The limitations of Consul KV are also clear. Officially, Consul KV is positioned as a basic KV store, not a complete data storage system such as DynamoDB. It is suitable for storing configuration parameters and metadata, but not for carrying complex enterprise configuration governance processes. A single KV object has a size limit, and the KV API, CLI, and UI have been marked as feature complete and are no longer major extension directions. Therefore, Consul KV is better suited as lightweight KV and metadata capability inside a service-network system, rather than the only implementation of a complex configuration governance platform.

### 3.4 Nacos

Nacos is a dynamic service discovery, configuration management, and service management platform for cloud-native applications. It provides service discovery, dynamic configuration management, service metadata, and traffic management. The Nacos configuration model includes Namespace, Group, and Data ID. Namespace is commonly used for tenant or environment isolation, Group for configuration grouping, and Data ID for identifying configuration sets.

Nacos's strength is the integration of service discovery and configuration management. It is suitable for platform scenarios that want to unify registry, configuration center, and service metadata management. The Nacos console supports YAML, Properties, TEXT, JSON, XML, HTML, and other configuration formats, and supports historical versions, rollback, subscriber queries, edit diffs, and configuration tags.

The limitation of Nacos is the expanded system boundary brought by capability aggregation. It simultaneously carries registry, configuration center, service metadata, and some traffic-governance capabilities. This is suitable for unified service governance infrastructure, but for systems that only need an independent configuration center, the capability boundary is broader. For storage, Nacos can use embedded Derby by default, while production environments usually configure external MySQL or PostgreSQL and use cluster mode for high availability.

## 4. Configuration Type Model

A configuration center should not place application configuration, shared configuration, environment configuration, cluster configuration, file configuration, sensitive configuration, and governance configuration at the same level. A more reasonable method is splitting the configuration model into two layers: "configuration ownership" and "configuration attributes."

From the perspective of configuration ownership, configuration center data can mainly be divided into application configuration and shared configuration.

Application configuration is independently owned by a single application, service, or module, and usually affects only that application's own runtime behavior. Examples include service ports, thread pool parameters, connection pool parameters, timeouts, retry counts, cache parameters, business switches, application-level rate-limit rules, service-level circuit-breaker rules, and single-service degradation policies. The management boundary of this type of configuration usually centers on applications, services, modules, and APIs.

Shared configuration is depended on by multiple applications, clients, or services. Examples include shared middleware addresses, unified logging parameters, unified authentication parameters, SDK default parameters, global routing rules, client subscription rules, cross-service traffic rules, and platform-level switches. The core problems of this type of configuration are not configuration override for a single application, but shared scope, impact analysis, default inheritance, application override, canary release, and rollback control.

File-based configuration should not be treated as an independent business configuration type. It is essentially a content form, not an ownership type. Application configuration can be KV-based or file-based, such as logback.xml, application.yaml, rule JSON files, and plugin configuration files. Shared configuration can also be KV-based or file-based, such as shared SDK YAML, unified logging templates, unified gateway rule files, and common client policy files. Therefore, a configuration center needs to support multiple content formats, but should not elevate file-based configuration into a business type parallel to application configuration and shared configuration.

Sensitive configuration is also not a separate configuration type outside application configuration and shared configuration. It is a security attribute of configuration. Database passwords, API tokens, certificates, private keys, and access keys may belong to a single application or to shared capabilities used by multiple applications. For example, a single application's database password is application sensitive configuration, while a unified gateway certificate, public CA certificate, or shared authentication key is shared sensitive configuration. Therefore, sensitive configuration can be layered on top of application configuration and shared configuration, and should have stricter access control, encrypted storage, masked display, access audit, and key rotation.

Governance configuration can be further divided by ownership into shared governance configuration and application governance configuration. Shared governance configuration usually affects multiple services or clients, such as global routing rules, client subscription rules, service discovery policies, global traffic scheduling rules, and platform-level switches. Application governance configuration usually affects a single application or server-side service, such as service-level rate-limit rules, API-level rate-limit rules, circuit-breaker rules, degradation rules, instance weights, and application-level canary policies. Therefore, governance configuration is not a third independent type. It is a concrete form of application configuration and shared configuration in runtime service-governance scenarios.

Release and audit metadata should not be classified as application configuration or shared configuration itself. Publisher, publish time, change reason, approval state, version number, canary scope, rollback point, client effectiveness state, and operation audit records are not configuration content directly consumed by applications at runtime. They are system metadata used by the configuration-center control plane to govern the configuration lifecycle. They should be attached to configuration objects, configuration versions, release orders, and change records, and should serve both application configuration and shared configuration.

Therefore, an enterprise configuration center is better modeled as "ownership classification + scope attributes + content form + governance metadata." Ownership is divided into application configuration and shared configuration. Scope supports environment, region, availability zone, cluster, namespace, and group. Content form supports KV and files. Security attributes support normal and sensitive configuration. Governance capabilities support versions, canary release, approval, audit, and rollback. This model keeps configuration ownership simple while covering many environments, clusters, regions, teams, and governance scenarios.

## 5. Scope Model and Configuration Read Rules

Environment, region, availability zone, and cluster should not be treated as independent configuration types. They should be treated as scope attributes of configuration objects. However, their isolation strength is not the same. Environment is a strong isolation boundary for a configuration center. Region, availability zone, and cluster are deployment topology boundaries. They are isolated by default, but can support cross-region, cross-zone, or cross-cluster replication according to explicit governance rules.

Environment isolation distinguishes different runtime stages such as development, testing, staging, and production. Because configuration risk level, release workflow, approval requirement, and impact scope differ between environments, a configuration center should not allow runtime configuration to automatically fall back or inherit across environments. The same shared configuration may logically use the same template, but in different environments it should generate independent release versions, approval records, and rollback points. For example, the same shared logging configuration may exist in development, testing, and production, but each environment's configuration version and release state should be managed separately. This preserves template reuse while avoiding the coupling of release lifecycles across environments.

Region, availability zone, and cluster belong to deployment topology dimensions. They should have isolation by default, but can support replication, inheritance, or sharing according to explicit governance rules. For example, the same shared SDK configuration, unified logging configuration, or client subscription rule can be configured to replicate to multiple clusters or availability zones within the same environment. Application-level rate-limit rules, service-level circuit-breaker rules, canary weights, and instance-routing policies usually need to take effect only in a specific region, zone, or cluster. Therefore, a configuration center should allow a configuration object to declare its effective scope, such as env, regionList, zoneList, and clusterList. This multi-scope capability should be understood as deployment-scope expansion within the same environment, not cross-environment sharing.

When clients read configuration, the configuration center should return the configuration that most precisely matches the client's runtime context. A client usually needs to report metadata such as application identifier, environment, region, availability zone, and cluster. The configuration center can match by priority according to "same environment, same region, same availability zone, same cluster." If no precise configuration exists, it can then read a higher-level scope within the same environment according to explicit inheritance rules.

The read order can be designed as follows:

First, exact match on same environment, region, availability zone, and cluster.

Second, same environment, same region, same availability zone, default cluster.

Third, same environment, same region, default availability zone, default cluster.

Fourth, same environment, default region, default availability zone, default cluster.

Fifth, global default configuration within the same environment.

This fallback process must be limited to the same environment. It should not read across environments. A production client must not fall back to staging, testing, or development configuration. This rule prevents test configuration from entering production and prevents release lifecycles between environments from contaminating each other.

Therefore, the configuration center's scope model should distinguish strong isolation boundaries from topology isolation boundaries. Environment expresses release stage and risk level and must be strongly isolated. Region, availability zone, and cluster express deployment topology, are isolated by default, and can use replication, inheritance, and binding mechanisms to support multi-scope sharing within the same environment. This model protects production configuration while reducing repeated maintenance for shared configuration across clusters and availability zones.

## 6. Configuration Center Architecture Design

### 6.1 Read and Write Characteristics

At runtime, a configuration center usually shows read-heavy and write-light characteristics. Configuration writes mainly happen during manual editing, API publishing, approval completion, canary adjustment, rollback, and automated release workflows. Configuration reads happen during application startup, client subscription, periodic polling, long polling, instance scaling, failure recovery, and configuration state verification.

Read-heavy and write-light does not mean the write path can be weakened. Configuration writes are low-frequency but high-risk. A single wrong configuration release can affect many service instances. Therefore, the write path must have access control, approval workflows, version management, audit records, canary release, impact analysis, and rollback. The read path should focus on high availability, low latency, and failure fallback.

Therefore, the configuration center should separate read and write paths. The write path faces the configuration management control plane and emphasizes consistency, traceability, and recoverability. The read path faces client runtime and emphasizes cache hits, fast reads, and failure availability.

### 6.2 The Role of the Database

It is reasonable for a database to be the data foundation of a configuration center. A configuration center needs to save configuration content, versions, release records, approval records, audit logs, permission relationships, canary rules, scope relationships, and system metadata. These data have clear persistence and query requirements.

However, a reasonable database foundation does not mean all client reads should directly access the database. If every client startup, subscription, long-polling request, or configuration verification request penetrates to the database, the database becomes the central bottleneck of the configuration delivery path and expands the impact of database failures on runtime systems.

Therefore, the database's role in a configuration center should be persistence foundation, not high-frequency read entry. The database should handle configuration saving, version recovery, audit tracing, canary state persistence, permission relationship persistence, and server-side cache rebuild. Runtime client reads should first access Config Service in-memory cache and client local cache.

### 6.3 Multi-Node Full In-Memory Cache and Weak Database Dependency

A configuration center should not use a production architecture of "single-node full memory + database." A more reasonable architecture is "multi-node full in-memory cache + database persistence + change-event synchronization + client local cache."

In this architecture, multiple Config Service nodes load a full configuration cache, or a cache partitioned by scope, and maintain configuration content, version numbers, checksums, release states, and subscription relationships in memory. The configuration write flow first performs format validation, permission validation, approval validation, and database persistence through Admin Service or a release service. After the database write succeeds, change events, message queues, database version polling, or internal notification mechanisms synchronize changes to all Config Service nodes. After refreshing local in-memory cache, Config Service nodes notify clients through long polling, push, or client polling.

Client SDKs should also have local cache capabilities. After successfully obtaining configuration for the first time, the client should store configuration in process memory and persist it to the local filesystem. When the configuration center is unavailable, the network is abnormal, or the client cannot connect to the server during startup, the client can use the last successful local configuration to start or continue running. Client local cache is not merely a performance optimization. It is a stability guarantee during configuration-center failures.

Therefore, database dependency in a configuration center should be "strong dependency for persistence, weak dependency for runtime read paths." The database is the final persistent source of configuration data, but client read paths should first hit Config Service in-memory cache and client local cache. This architecture ensures configuration data can be recovered, audited, and rolled back while reducing the direct impact of database failures on the configuration read path.

### 6.4 Recommended Logical Architecture

An enterprise configuration center can be divided into control plane, data plane, storage layer, and client layer.

The control plane includes Portal, OpenAPI, permission system, approval system, audit system, and release system. It is responsible for configuration editing, format validation, permission validation, approval flow, canary release, version rollback, impact analysis, and operation audit.

The data plane includes the Config Service cluster. Config Service is responsible for configuration queries, subscription, long polling, push notification, client-state reporting, configuration cache, and read-path degradation. Config Service should be as stateless as possible, but it may hold rebuildable in-memory cache.

The storage layer uses a relational database as the configuration persistence foundation. It stores configuration definitions, configuration content, versions, release records, approval records, audit logs, permission relationships, canary rules, and scope relationships. Large files, binary files, model files, or massive rule data should not be stored directly in the core tables of the configuration center. They should enter object storage, file services, or dedicated rule storage. The configuration center should only store reference addresses, version numbers, checksums, and effective scopes.

The client layer includes multilingual SDKs, Spring integration modules, Go/Node.js/Python clients, CLI, and sidecar adapters. Client SDKs should support startup fetching, runtime subscription, long polling or streaming updates, periodic polling fallback, in-process cache, local file cache, configuration-change listeners, and failure fallback.

## 7. Discussion

The core value of a configuration center is not moving configuration from local files into a database. Its value is turning configuration change from an uncontrolled operation into an auditable, canary-capable, rollback-capable, and observable engineering process.

Apollo is more suitable for enterprise scenarios that emphasize configuration governance and release workflows. It provides multi-environment, multi-cluster, namespace, canary release, version management, permission, and audit capabilities, and is suitable for microservice systems with strict requirements on configuration-change processes.

Spring Cloud Config is more suitable for externalized configuration scenarios in the Spring ecosystem where Git or another backend is the configuration source. It aligns closely with Spring Environment and PropertySource models, and is suitable for systems already built around Spring Cloud. However, if a complete console, approval, canary release, client-state tracking, and audit are required, additional systems must be built or integrated.

Consul KV is more suitable for lightweight configuration parameters and service metadata in a service-network system. It can be combined with service discovery, health checks, Watch, ACL, and Consul Template, but is not suitable as the only implementation of a complex enterprise configuration governance platform.

Nacos is more suitable for scenarios that want to unify registry, configuration center, service metadata, and part of traffic governance into one platform. Its strength is the integration of service discovery and configuration management. Its limitation is that the platform boundary is broader, and independent configuration-center scenarios need to evaluate capability complexity and operations cost.

From an architectural design perspective, a configuration center is a read-heavy and write-light system, but configuration write risk is higher than normal business writes. The read path should avoid strong database dependency, while the write path must strongly depend on persistence, versions, permissions, and audit. Database dependency itself is not the problem. The problem is whether the database sits in the high-frequency online read path. A reasonable design should prevent database failure from immediately affecting clients that read existing configuration, allow configuration service nodes to rebuild from the database or snapshots after restart, and allow clients to start or run with the last successful local configuration when the configuration center is unavailable.

From a configuration model perspective, using only application configuration and shared configuration as primary categories is acceptable, but not a complete model. A complete model must also support scope, content form, security attributes, governance attributes, and release metadata. Environment must be strongly isolated. Region, availability zone, and cluster are isolated by default, but can share within the same environment through replication, inheritance, and binding mechanisms. File configuration is a content form. Sensitive configuration is a security attribute. Governance configuration can be divided by impact scope into application governance configuration and shared governance configuration. Release and audit information is control-plane metadata, not business configuration content.

## 8. Conclusion

Configuration centers arise from the engineering need to decouple configuration from code, and under microservice and cloud-native architectures they evolve into configuration governance control planes. Mainstream systems have clear differences in design goals: Apollo emphasizes enterprise configuration governance, Spring Cloud Config emphasizes externalized configuration and Spring ecosystem integration, Consul emphasizes KV and metadata capability in service networking, and Nacos emphasizes integrated service discovery, configuration management, and service metadata.

The data model of an enterprise configuration center should not simply enumerate application configuration, shared configuration, file configuration, sensitive configuration, governance configuration, and audit configuration. A more reasonable model is "ownership classification + scope attributes + content form + governance metadata." Ownership is mainly divided into application configuration and shared configuration. Scope supports environment, region, availability zone, cluster, namespace, and group. Content form supports KV and files. Security attributes support normal and sensitive configuration. Governance capabilities support versioning, canary release, approval, audit, and rollback.

For scope governance, environment is a strong isolation boundary and should not support cross-environment inheritance, fallback, or automatic replication. Region, availability zone, and cluster are deployment topology boundaries. They are isolated by default, but can support replication, inheritance, and priority-based reads within the same environment according to explicit rules. When clients read configuration, they should first match configuration with the same environment, region, availability zone, and cluster. If no exact configuration exists, they may only fall back to higher-level scope or default configuration inside the same environment according to predefined rules.

For architecture design, a configuration center is usually read-heavy and write-light at runtime, but configuration writes are high-risk, so read and write paths should be separated. A database is suitable as the foundation for persistence, versioning, audit, and recovery, but it is not suitable for directly handling all high-frequency client read requests. An enterprise configuration center is better suited to a weak database dependency architecture based on "multi-node full in-memory cache + database persistence + change-event synchronization + client local cache." This architecture can ensure configuration data is recoverable, auditable, and rollback-capable while reducing the direct impact of database failures on runtime configuration reads.

## References

[1] The Twelve-Factor App. Config.
[2] Spring Boot Reference Documentation. Externalized Configuration.
[3] Spring Cloud Config Reference Documentation.
[4] Apollo official documentation and Apollo configuration center introduction.
[5] Nacos official documentation: What is Nacos, console guide, and deployment guide.
[6] HashiCorp Consul official documentation: KV Store, Consistency Modes, and Consensus.
[7] Kubernetes official documentation: ConfigMap.
[8] Kubernetes official documentation: Secret.
