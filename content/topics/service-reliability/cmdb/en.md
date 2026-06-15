# Research on the Data Scope, Architecture, and Underlying Storage Design of CMDB

## Abstract

CMDB (Configuration Management Database) is used to record Configuration Items (CIs), services, assets, and their relationships. Official documentation describes a CMDB as a logical representation of assets, services, and relationships, with component details stored as CIs. NIST SP 800-53 CM-8 defines control requirements for system component inventories, including accurately reflecting the system, including all components, avoiding duplicate counting, maintaining the necessary granularity, including accountability information, and updating the inventory regularly. Based on these definitions, a CMDB is not only an asset ledger. It should also include applications, services, instances, networks, software, personnel responsibility relationships, dependencies, current state, historical changes, and data sources. In modern cloud-native environments, application lists and personnel relationships are high-frequency read data, while instances, Pods, virtual machines, IP addresses, and availability-zone state are high-frequency change data. Therefore, the underlying CMDB design should use a combined architecture of "core primary database + event stream + cache + search index + graph relationship projection". The core primary database should use PostgreSQL, or a relational database with equivalent transaction, constraint, indexing, partitioning, and replication capabilities. Caches, search engines, and graph databases should not be the only source of truth. They should be query acceleration layers or relationship-analysis projection layers.

## Keywords

CMDB; Configuration Item; Configuration Management; PostgreSQL; Event-Driven Architecture; Read/Write Separation; Relationship Modeling; Cloud Native

## 1. Introduction

The core goal of a CMDB is to store configuration items and their relationships in an information system, so that an organization can identify system composition, understand service dependencies, track configuration changes, and provide a data foundation for change management, failure impact analysis, security auditing, and capacity management. ServiceNow documentation describes a CMDB as a logical representation of assets, services, and relationships, with component details stored as CIs. Its CMDB Schema Model describes the CMDB as a set of interconnected data tables used to store assets, business services, configurations, and related information [1][2]. NIST SP 800-53 CM-8 treats the system component inventory as a configuration management control and requires the inventory to accurately reflect the system, include system components, avoid duplicate counting, and be maintained at a granularity that satisfies tracking and reporting needs [3].

Therefore, CMDB design cannot focus only on "what machines exist" or "what applications exist". It should cover "objects, attributes, relationships, state, sources, time, and owners". In scenarios involving microservices, Kubernetes, multiple environments, multiple availability zones, and elastic scaling, a CMDB faces both high-frequency reads and high-frequency writes. Application lists, application owners, service ownership, and authorization checks are read by many systems. Instance, Pod, node, IP, version, and availability-zone deployment state change continuously. CMDB architecture must use data stability, query patterns, and change frequency as modeling criteria.

## 2. Information Included and Stored in a CMDB

The basic storage object of a CMDB is the Configuration Item, or CI. A CI can represent an application, service, database, virtual machine, container, Pod, node, network device, software package, certificate, domain name, load balancer, deployment environment, or availability-zone resource. It can also represent relationships between services, between applications and people, and between applications and instances. According to official documentation and configuration management control requirements, a CMDB should include at least the following categories of information.

### 2.1 Configuration Item Identity Information

Every CI should have a unique identifier to avoid duplicate counting and incorrect merging. This identifier can be composed of an internal `ci_id` and external source identifiers. For example, a cloud host can store the cloud provider instance ID, account, region, and availability zone. A Kubernetes object can store the cluster, namespace, resource type, name, and UID. An application can store the application ID, application code, service name, and owning organization. NIST CM-8 requires "no duplicate accounting" and "unique identification" for system component inventories [3], so a CMDB should not rely only on names as unique keys.

### 2.2 Configuration Item Classification and Attribute Information

A CI should include fields such as category, name, status, lifecycle, environment, region, availability zone, version, tags, creation time, update time, and source system. Different CI types have different attributes. Application CIs need to store application name, language stack, repository, owner, runtime environment, and owning team. Instance CIs need to store instance ID, IP, port, image version, runtime state, node, and availability zone. Software CIs need to store name, version, license, and installation path. The metadata collected by AWS Systems Manager Inventory includes applications, AWS components, files, network configurations, Windows updates, instance details, services, tags, registry data, roles, and custom inventory information [4]. These types can serve as references for CMDB attribute boundaries.

### 2.3 Relationship Information

The value of a CMDB comes not only from the attributes of individual CIs, but also from relationships among CIs. Relationship information includes relationships between applications and services, services and instances, applications and databases, applications and message queues, applications and people, applications and teams, instances and nodes, nodes and availability zones, and services and upstream/downstream callers. Relationship tables should include the source CI, target CI, relationship type, source, confidence, effective time, expiration time, and change event ID. High-frequency read data such as application lists and personnel relationship tables should be first-class data models, not only stored in unstructured JSON.

### 2.4 Current State, Historical Changes, and Audit Information

A CMDB needs to store both current state and historical changes. Current state is used for fast queries, such as the instance count, version, availability-zone distribution, and owner of an application in production. Historical changes are used for auditing, backtracking, and fault localization, such as when an instance came online, went offline, or migrated from one availability zone to another. AWS Config documentation states that it can record software inventory changes for EC2 or on-premises instances and view historical changes [4]. Therefore, a CMDB should design both "current snapshot tables" and "change event tables", instead of keeping only the last state.

### 2.5 Data Source and Data Quality Information

The same CI can come from cloud APIs, Kubernetes APIs, agents, CI/CD systems, service registries, monitoring systems, HR systems, or IAM systems. A CMDB should store data source, collection time, last observed time, synchronization batch, raw external ID, data trust level, and conflict handling result. ServiceNow CMDB documentation includes capabilities such as CMDB Health and Identification and Reconciliation, which are used to monitor health issues and identify and reconcile data integrity problems [1]. Therefore, identity recognition, deduplication, conflict merging, and quality checks should be foundational CMDB capabilities.

## 3. Overall CMDB Architecture Design

CMDB architecture should use a layered design that separates data collection, event ingestion, normalization, reconciliation, core storage, query acceleration, and external services. This design reduces the impact of high-frequency changing data on core query paths and allows different query scenarios to use different data views.

### 3.1 Data Source Layer

The data source layer obtains configuration data from different systems. Typical sources include cloud provider resource APIs, Kubernetes APIs, agent inventory collection, CI/CD release systems, service registries, monitoring systems, logging systems, HR/IAM systems, ticketing systems, and code repositories. Kubernetes documentation defines objects as persistent entities representing cluster state and distinguishes the desired state `spec` from the current state `status` [5]. Therefore, when a cloud-native CMDB collects Kubernetes objects, it should store object identity, desired configuration, current state, and resource version at the same time.

### 3.2 Event Ingestion Layer

Instances, Pods, nodes, IP addresses, deployment versions, and availability-zone state are high-frequency change data. This type of data should not be written directly from collectors into core business tables. It should first enter an event stream. The Apache Kafka documentation defines event streaming as a mechanism for capturing data from event sources in real time, persistently storing event streams, processing them in real time or retrospectively, and routing them to target systems [6]. A CMDB can write instance changes, deployment changes, personnel relationship changes, service relationship changes, and resource deletion events into a unified event stream. The CI unique identifier can be used as the event key, so events for the same CI remain ordered within a partition.

### 3.3 Normalization and Reconciliation Layer

Fields, naming, and identity rules differ across data sources. The normalization layer converts external data into a unified CI model. The reconciliation layer merges the same object according to unique identifiers, source priority, timestamps, and rules. This layer must handle several problems: the same instance is reported by both the cloud API and an agent; the same application has different names in CI/CD and the service registry; the same person has different accounts in HR and IAM; and the same relationship comes from tracing data, configuration files, and manual maintenance. Reconciliation results should be written to the core primary database, while original events and source information should be retained.

### 3.4 Core Data Layer

The core data layer stores the factual CMDB data. It should include at least the following tables:

| Table | Purpose |
| --- | --- |
| `ci_core` | Stores the unified identity, type, name, status, lifecycle, source, and time fields of CIs |
| `ci_attribute` | Stores extended attributes for different CI types, suitable for low-frequency changing attributes |
| `ci_relation` | Stores relationships among CIs, including dependency, ownership, runs-on, responsible-for, and calls |
| `ci_relation_type` | Stores relationship type definitions and direction constraints |
| `app_person_relation` | Stores relationships between applications and owners, developers, operations engineers, security owners, and business owners |
| `app_instance_snapshot` | Stores current application instance state, such as environment, region, availability zone, IP, version, and status |
| `ci_change_event` | Stores configuration item change events for auditing and backtracking |
| `ci_baseline` | Stores baselines, approved configurations, and deviation information |
| `ci_source_record` | Stores raw IDs, synchronization time, and raw summaries from external source systems |

This model separates stable data, relationship data, current snapshots, and historical events, allowing it to support different read and write patterns.

### 3.5 Query Acceleration Layer

CMDB queries should not all hit the core primary database. Application lists, application owners, service ownership, and application topology are high-frequency read data, so caches, materialized views, and read-only replicas should be built for them. Redis documentation describes Redis as an in-memory data store that can be used as a cache to reduce database load and improve read speed [9]. PostgreSQL materialized views can store query results and return them directly, which is suitable for periodic refresh or event-triggered refresh [7]. OpenSearch documentation defines it as a distributed search and analytics engine, suitable for storing JSON documents and executing search and analytics [10]. Therefore, a CMDB can use Redis for hot key-value queries, PostgreSQL materialized views for structured reporting queries, and OpenSearch for full-text search and complex filtering.

### 3.6 Graph Relationship Projection Layer

Service dependencies, impact analysis, call topology, and multi-hop relationship queries can be projected into a graph database. Amazon Neptune documentation states that graph databases are suitable for highly connected datasets and can query a large number of relationships with millisecond-level responses [8]. Therefore, a graph database is suitable as the CMDB relationship analysis layer, but should not replace the core primary database. The reason is that the CMDB source of truth needs primary keys, foreign keys, unique constraints, transactional consistency, audit events, and lifecycle state, while graph databases are better suited for relationship traversal and impact analysis.

### 3.7 API Service Layer

The API service layer should provide interfaces by query type: CI query API, application query API, instance snapshot API, relationship query API, topology query API, change history API, audit API, and data quality API. High-frequency read data such as application lists and personnel relationships should preferably be read from caches or materialized views. Strongly consistent writes and audit queries should read the core primary database. Full-text search should read the search index. Multi-hop dependency analysis should read the graph relationship projection.

## 4. Underlying Database Selection for CMDB

The core primary database of a CMDB should be PostgreSQL, or an enterprise-grade relational database with equivalent transaction, constraint, indexing, partitioning, replication, and JSON extension capabilities. This conclusion is based on the objective characteristics of CMDB data models: CIs need unique identities, relationships need referential integrity, changes need transactional consistency, queries need composite indexes, historical events need partitions, and extended attributes need semi-structured fields.

PostgreSQL documentation states that its Multi-Version Concurrency Control (MVCC) enables reads and writes not to block each other: reading never blocks writing, and writing never blocks reading [7]. This matches CMDB scenarios with many reads and many writes. PostgreSQL also provides primary keys, unique constraints, and foreign keys to maintain entity uniqueness and referential integrity [7]. For differentiated attributes of different CI types, PostgreSQL `jsonb` supports binary decomposed storage and indexes, making it suitable for extended attributes [7]. For high-frequency write tables such as change event tables and instance state tables, PostgreSQL partitioning can split large tables into multiple physical partitions, improving maintenance and query efficiency in specific scenarios [7]. For read scaling and downstream synchronization, PostgreSQL logical replication can continuously send data changes [7].

However, PostgreSQL should not independently carry all query workloads. A CMDB can use the following database responsibilities:

| Layer | Database/component | Main use |
| --- | --- | --- |
| Core source of truth | PostgreSQL | CIs, relationships, personnel relationships, instance snapshots, change events, constraints, and transactions |
| Hot cache | Redis | Application lists, application owners, basic application information, and relationships needed for authorization checks |
| Search and analytics | OpenSearch | Application search, instance search, tag filtering, fuzzy queries, and audit retrieval |
| Graph relationship projection | Neptune or another graph database | Multi-hop dependencies, impact analysis, service topology, and call relationships |
| Event stream | Kafka | High-frequency change ingestion, asynchronous projection, cache invalidation, and CDC distribution |

Therefore, the underlying database should not be understood as a single component. The accurate description is: the CMDB core source of truth uses PostgreSQL, while Redis, OpenSearch, a graph database, and Kafka respectively handle caching, search, relationship analysis, and event streaming responsibilities.

## 5. Design Points for Read-Heavy and Write-Heavy Scenarios

### 5.1 Separate Stable Data from High-Frequency Change Data

Applications, teams, people, service definitions, and application owners are relatively stable data. Instances, Pods, IP addresses, nodes, deployment versions, runtime state, and availability-zone distribution are high-frequency change data. The table structures, indexes, cache strategies, and write paths for these two data classes should not be the same. Stable data is suitable for normalized primary tables and relationship tables. High-frequency change data is suitable for a dual-table model of "event table + current snapshot table".

### 5.2 Use Caches and Materialized Views for Application Lists and Personnel Relationships

Application lists and personnel relationships are high-frequency read data. Applications, release systems, authorization systems, gateway systems, monitoring systems, and alerting systems may all read them. This type of data should form independent read models, such as `app_read_model`, `app_owner_read_model`, and `app_team_read_model`. Read models can be carried by PostgreSQL materialized views or ordinary wide tables and synchronized to Redis. Cache keys can be designed by version or timestamp, such as `cmdb:app:list:{version}` and `cmdb:app:{app_id}:owners`. When an application or personnel relationship changes, the event stream or CDC can trigger cache invalidation and read-model updates.

### 5.3 Use Event Tables and Snapshot Tables for Instance Information

Instance changes are frequent, especially in multi-environment, multi-availability-zone, elastic scaling, and Kubernetes scenarios. Instance data should be divided into two parts: `app_instance_snapshot` stores current state, and `ci_change_event` stores historical events. Every instance online, offline, restart, migration, IP change, version change, and availability-zone change should generate an event. Event consumers update the current snapshot based on the event. This design can satisfy both fast current-state reads and historical change tracing.

### 5.4 Use Partitions and Idempotency Keys for High-Frequency Write Tables

`ci_change_event` and instance-snapshot-related tables should be partitioned by time, environment, region, or availability zone. Event tables should include fields such as `event_id`, `ci_id`, `source`, `event_type`, `event_time`, `sequence`, and `payload_hash`. The idempotency key can be composed of source system, external resource ID, event type, and resource version, avoiding state errors caused by duplicate consumption. The Kubernetes API watch mechanism observes resource changes based on `resourceVersion`, and clients also need to handle resynchronization when resource versions become too old [5]. This mechanism shows that a CMDB must store version numbers or sequence numbers when collecting cloud-native objects.

### 5.5 Avoid Putting High-Frequency Fields into One Large JSON Document

PostgreSQL `jsonb` is suitable for storing extended attributes of different CI types, but it is not suitable for placing all high-frequency changing fields into a single large JSON field. PostgreSQL documentation states that updating JSON data obtains row-level locks, so frequently changing fields should be split into structured columns or independent snapshot tables [7]. For example, instance status, IP, availability zone, version, and heartbeat time should be stored in structured columns of `app_instance_snapshot`; low-frequency extended attributes can be stored in `jsonb`.

### 5.6 Relationship Tables Must Record Validity Period and Source

Relationships between applications and people, applications and instances, and services and services change over time. Relationship tables should not store only current relationships. They should also store `valid_from`, `valid_to`, `source`, `observed_at`, `confidence`, and `change_event_id`. This supports historical tracing, responsibility attribution, and restoration of fault-time context. For example, after an application changes owner on a certain day, historical alerts should still be able to link to the owner relationship at that time.

### 5.7 Data Quality Controls Should Be Moved Forward into the Write Path

The CMDB write path should execute identity recognition, required field validation, uniqueness validation, relationship legality validation, source priority handling, and conflict recording. NIST CM-8 requires the inventory to accurately reflect the system and include information with necessary granularity [3]. ServiceNow CMDB Health and Identification and Reconciliation also treat health checks, identification, and reconciliation as CMDB capabilities [1]. Therefore, data quality control should not rely only on offline inspection. It should be continuously executed during collection, ingestion, and projection.

### 5.8 External Reads Should Be Layered by Consistency Requirements

Different read scenarios have different consistency requirements. Authorization decisions, release approvals, and application ownership need relatively high consistency and should read the primary database or a strongly consistent read model. Application list display, search, and topology browsing can read caches or search indexes. Failure impact analysis can read the graph relationship projection. Auditing and change backtracking should read the event table. By grading consistency, CMDB design can avoid sending all requests to the core primary database.

## 6. Conclusion

A CMDB should store configuration items, attributes, relationships, current state, historical changes, responsible people, sources, and quality information. Its architecture should use a layered design covering data collection, event ingestion, normalization and reconciliation, core source of truth, query acceleration, graph relationship projection, and API services. For the underlying database, PostgreSQL is suitable as the core source of truth because its transaction, constraint, MVCC, JSONB, partitioning, replication, and materialized-view capabilities match the data characteristics of a CMDB. Redis, OpenSearch, graph databases, and Kafka should serve as caching, search, relationship analysis, and event-streaming components, rather than replacements for the core source of truth.

In read-heavy and write-heavy scenarios, the key CMDB design principles are: separate stable master data from high-frequency change data; build read models and caches for application lists and personnel relationships; use event tables and current snapshot tables for instance changes; use partitions and idempotency keys for high-frequency event tables; store validity periods and sources in relationship tables; and move data quality control forward into the write path. This design can support high-frequency application-level reads, high-frequency instance-level changes, cross-environment and cross-availability-zone queries, historical audits, and service impact analysis at the same time.

## References

[1] ServiceNow official documentation states that a CMDB is used to build a logical representation of assets, services, and relationships, stores component details as CIs, and includes capabilities such as CMDB Health and Identification and Reconciliation. ([ServiceNow][1])

[2] ServiceNow CMDB Schema Model official documentation states that the CMDB Schema Model is a set of interconnected data tables containing assets, business services, configurations, computers, network devices, software contracts, licenses, and related information. ([ServiceNow][2])

[3] The CM-8 control in NIST SP 800-53 Rev. 5 requires system component inventories to accurately reflect the system, include all components, avoid duplicate counting, have granularity that satisfies tracking and reporting needs, and include enhancements such as accountability information, automated maintenance, unauthorized component detection, and centralized repositories.

[4] AWS Systems Manager Inventory official documentation lists metadata that can be collected, including applications, components, files, network configurations, instance details, services, tags, registry data, roles, and custom inventories. AWS Config documentation states that it can record software inventory changes and view historical changes. ([AWS Documentation][3])

[5] Kubernetes official documentation states that Kubernetes objects are persistent entities representing cluster state and include `spec` and `status`. The API watch mechanism observes subsequent changes based on `resourceVersion` and requires clients to handle outdated versions. ([Kubernetes][4])

[6] Apache Kafka official documentation describes event streams as real-time capture, persistent storage, processing, and routing of event streams. Topics can be partitioned, and events with the same key enter the same partition, supporting ordered processing. ([kafka.apache.org][5])

[7] PostgreSQL official documentation states that MVCC keeps reads and writes from blocking each other; constraints, primary keys, and foreign keys maintain data validity and referential integrity; `jsonb` supports indexing; partitioning can split large tables into physical child tables; logical replication can continuously send data changes; and materialized views can store query results. ([PostgreSQL][6])

[8] Amazon Neptune official documentation states that graph databases are suitable for highly connected datasets and support low-latency queries over a large number of relationships. ([AWS Documentation][7])

[9] Redis official documentation states that Redis is an in-memory data store that can be used as a cache to reduce database load and improve read speed. ([Redis][8])

[10] OpenSearch official documentation states that OpenSearch is a distributed search and analytics engine, where documents are stored as JSON and indexes are used to query data. ([docs.opensearch.org][9])

[1]: https://www.servicenow.com/docs/r/servicenow-platform/configuration-management-database-cmdb/c_ITILConfigurationManagement.html "Configuration Management Database (CMDB)"
[2]: https://www.servicenow.com/docs/r/servicenow-platform/configuration-management-database-cmdb/c_ConfigurationManagementDatabase.html "CMDB schema model"
[3]: https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-inventory.html "AWS Systems Manager Inventory - AWS Systems Manager"
[4]: https://kubernetes.io/docs/concepts/overview/working-with-objects/ "Objects In Kubernetes | Kubernetes"
[5]: https://kafka.apache.org/intro "Introduction | Apache Kafka"
[6]: https://www.postgresql.org/docs/current/mvcc-intro.html "PostgreSQL: Documentation: 18: 13.1. Introduction"
[7]: https://docs.aws.amazon.com/neptune/latest/userguide/intro.html "What Is Amazon Neptune? - Amazon Neptune"
[8]: https://redis.io/tutorials/what-is-redis/ "What is Redis? In-memory database, cache, and message broker"
[9]: https://docs.opensearch.org/latest/getting-started/intro/ "Intro to OpenSearch - OpenSearch Documentation"
