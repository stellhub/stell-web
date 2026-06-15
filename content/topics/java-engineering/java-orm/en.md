# Java ORM Framework Ecosystem Research: Adoption, Performance Boundaries, and Scenario-Based Selection

## Abstract

ORM (Object-Relational Mapping) frameworks in the Java ecosystem can be divided into three groups. The first group consists of full ORM providers that follow the Jakarta Persistence/JPA standard, such as Hibernate ORM, EclipseLink, Apache OpenJPA, and DataNucleus. The second group consists of SQL mappers or semi-ORM tools, such as MyBatis, MyBatis-Plus, and MyBatis-Flex. The third group consists of SQL-first or lightweight mapping persistence tools, such as jOOQ, Jdbi, and Querydsl. The official Jakarta Persistence specification defines itself as the standard for persistence management and object/relational mapping in Java environments. The official Maven Central portal provides artifact metadata lookup, but its public pages do not consistently provide complete download ranking data. Therefore, this article uses Maven Central artifact existence, version information, and MvnRepository "Used By" dependency counts as auxiliary indicators for adoption. The research shows that Hibernate ORM is the most widely used and most complete framework in the traditional Java ORM system. In Spring Boot scenarios, the official starter `spring-boot-starter-data-jpa` is explicitly positioned as a starter for Spring Data JPA with Hibernate. In scenarios where SQL control, complex queries, and predictable performance are prioritized, jOOQ, MyBatis, or Jdbi are closer to the JDBC execution model than full ORM frameworks. There is no absolutely optimal ORM across all business models. Lightweightness must also distinguish between "full ORM" and "SQL mapping tools". For engineering selection, regular Spring Boot business systems can prioritize Spring Data JPA + Hibernate. Systems with complex SQL, legacy database adaptation, or many reporting queries can choose MyBatis/MyBatis-Plus or jOOQ. In non-Spring scenarios, full ORM can use Hibernate, SQL-first scenarios can use jOOQ, and lightweight data access can use Jdbi or MyBatis.

## Keywords

Java ORM; Hibernate; Spring Data JPA; MyBatis; jOOQ; Jdbi; Maven Central; Spring Boot

## 1. Introduction

The goal of ORM is to map Java object models to relational database models, allowing applications to access relational data through objects, entities, repositories, or mapping interfaces. The official Jakarta Persistence specification defines the standard for persistence management and object/relational mapping in Java environments. This standard is usually implemented by concrete ORM providers such as Hibernate ORM, EclipseLink, and Apache OpenJPA [1]. The Hibernate documentation describes Hibernate ORM as a domain model persistence framework for relational databases and states that it provides both native APIs and an implementation of the Jakarta Persistence specification [2].

The Java persistence ecosystem is not limited to traditional ORM. The MyBatis documentation describes MyBatis as a persistence framework that supports custom SQL, stored procedures, and advanced mappings, eliminating a large amount of JDBC code and manual parameter setting and result mapping work [5]. The jOOQ documentation describes jOOQ as a tool that generates Java code from the database and uses a fluent API to build type-safe SQL [9]. The Jdbi documentation explicitly states that Jdbi is not an ORM, but a JDBC-based convenience library for database operations [10]. Therefore, when discussing Java ORM selection, it is necessary to distinguish "full ORM providers", "SQL mappers", "type-safe SQL DSLs", and "lightweight JDBC mapping libraries".

This article researches the current categories, adoption, advantages and disadvantages, performance boundaries, lightweightness, Spring Boot scenario choices, and non-Spring scenario choices of Java ORM frameworks. Its conclusions are based on official documentation, Maven Central artifact information, and public Maven dependency indexes, not on single blog-style experience as the main evidence.

## 2. Research Method and Data Scope

The data in this article is current as of June 11, 2026. Framework information mainly comes from official documentation or official repository descriptions for Jakarta Persistence, Hibernate, Spring Boot, Spring Data JPA, MyBatis, jOOQ, Jdbi, EclipseLink, OpenJPA, DataNucleus, Ebean, Apache Cayenne, ORMLite, Micronaut Data, MyBatis-Plus, MyBatis-Flex, and Jimmer [1]-[18].

The official Maven Central portal is used to confirm whether artifacts exist, their current versions, POM information, and dependency metadata [3]. Because public download counts are not equivalent to real production usage, this article does not use "download count" as the only adoption indicator. For the question of "most used", this article uses the "Used By" dependency count and category ranking on MvnRepository pages as proxy indicators. This metric indicates the number of public Maven artifacts that declare a dependency on an artifact. It is not equivalent to the number of real production systems, nor is it equivalent to download counts.

This article divides frameworks into the following four categories:

| Category | Representative frameworks | Definition |
| --- | --- | --- |
| Standard ORM / JPA Provider | Hibernate ORM, EclipseLink, OpenJPA, DataNucleus | Implements or supports Jakarta Persistence/JPA and manages entity lifecycle, object-relational mapping, dirty checking, lazy loading, transaction integration, and related capabilities |
| Non-JPA ORM | Ebean, Apache Cayenne, ORMLite, ActiveJDBC, Jimmer | Provides object-relational mapping capabilities, but does not necessarily position a JPA Provider as its core |
| SQL Mapper / Semi-ORM | MyBatis, MyBatis-Plus, MyBatis-Flex | Centers on SQL mapping, mapper interfaces, and XML/annotation mappings, and does not fully take over the entity lifecycle |
| SQL-first / Lightweight mapping tools | jOOQ, Jdbi, Querydsl, Spring Data JDBC, Micronaut Data | Emphasizes SQL construction, repository abstraction, lightweight mapping, or compile-time queries, and does not necessarily belong to traditional ORM |

## 3. Current State of Java ORM and Persistence Frameworks

### 3.1 Hibernate ORM

Hibernate ORM is one of the most representative full ORM frameworks in the Java ecosystem. The Hibernate documentation states that Hibernate ORM enables Java programs to access relational data in a natural, type-safe form and supports complex queries, synchronization between in-memory object changes and the database, transaction ACID properties, temporal data, auditing, and related capabilities [2]. Hibernate also implements the Jakarta Persistence specification, so it can be used through the JPA API or the Hibernate native API.

Hibernate's strengths are complete functionality, mature ecosystem, clear default integration path with Spring Boot, rich documentation, and a large community. It is suitable for typical enterprise CRUD systems, business systems with stable domain models, systems that need entity lifecycle management, and Spring Boot applications that need a unified JPA programming model. Its constraints are that its abstraction is relatively heavy. Developers must understand entity state, first-level cache, lazy loading, dirty checking, association fetching, N+1 queries, and automatic SQL generation; otherwise, performance may become unpredictable.

### 3.2 Spring Data JPA

Spring Data JPA is not an ORM Provider. It is the JPA-oriented Repository abstraction in the Spring Data family. The Spring Data JPA documentation states that it provides Repository support for the Jakarta Persistence API and enables applications that need to access JPA data sources to develop with a consistent programming model [4]. The official Spring Boot starter list explicitly describes `spring-boot-starter-data-jpa` as a starter that uses Spring Data JPA with Hibernate [4].

The strengths of Spring Data JPA are close integration with Spring Boot auto-configuration, transaction management, repositories, pagination, sorting, derived query methods, and the testing ecosystem. Its constraint is that it does not replace JPA Providers such as Hibernate or EclipseLink. Complex SQL, complex associations, batch writes, and performance-sensitive queries still require developers to understand the behavior of the underlying JPA Provider.

### 3.3 EclipseLink

EclipseLink is a persistence framework under the Eclipse project. Its official documentation states that EclipseLink is the JPA reference implementation and includes JPA enhancements and extension capabilities [11]. EclipseLink's strengths are a high degree of standardization and suitability for scenarios that need Jakarta EE/JPA standard compatibility. Its constraint is that Hibernate is the default integration target of the official starter in the mainstream Spring Boot path, so EclipseLink has a weaker default ecosystem position than Hibernate in regular Spring Boot business systems.

### 3.4 Apache OpenJPA

The Apache OpenJPA documentation states that OpenJPA is a Java persistence project under the Apache Software Foundation. It can be used as a standalone POJO persistence layer or integrated into Java EE containers, Tomcat, Spring, and other lightweight frameworks. The current production release implements the Jakarta Persistence API specification [12]. OpenJPA's strengths are its Apache project background, JPA standard implementation, and container integration capabilities. Its constraint is that its public Maven dependency ecosystem is smaller than Hibernate and Spring Data JPA, and its default priority in new projects is relatively low.

### 3.5 DataNucleus

The DataNucleus documentation describes it as a Java persistence product that supports JDO, JPA, REST API, and multiple data stores [13]. Its strengths are broad standard coverage and broad data source coverage. Its constraints are that it is used less frequently than Hibernate, MyBatis, and Spring Data JPA in mainstream Spring Boot enterprise applications, and team learning cost and ecosystem material availability are also relatively limited.

### 3.6 MyBatis

The MyBatis documentation states that MyBatis is a persistence framework that supports custom SQL, stored procedures, and advanced mappings. It can use XML or annotations to map primitive types, Map interfaces, and Java POJOs to database records [5]. The MyBatis documentation also emphasizes that it focuses on SQL and tries to stay out of the way [5].

MyBatis's strengths are controllable SQL, a learning curve lower than that of full ORM, and suitability for legacy databases, complex SQL, reporting queries, hand-written SQL optimization, and DBA-controlled scenarios. Its constraint is that it is not a full entity lifecycle ORM. It does not automatically manage complex object graphs, nor does it provide complete dirty checking and object state synchronization like Hibernate. Developers need to maintain SQL, result mappings, and association query strategies themselves.

### 3.7 MyBatis-Plus

The MyBatis-Plus documentation defines it as an enhancement toolkit for MyBatis. It provides additional capabilities without changing the core MyBatis framework, with the goal of simplifying development and improving efficiency [7]. Common capabilities include generic CRUD, condition builders, pagination plugins, and code generation. MyBatis-Plus's strength is that it reduces boilerplate CRUD code while preserving MyBatis's controllable SQL model. Its constraint is that its behavior is built on top of MyBatis. It is not a JPA standard implementation and does not provide full ORM object graph lifecycle management.

### 3.8 MyBatis-Flex

The MyBatis-Flex official repository describes it as a MyBatis enhancement framework. It states that its core depends on MyBatis and provides basic CRUD, paginated queries, row mapping, multiple databases, and dialect extension capabilities [17]. MyBatis-Flex's strengths are lightweightness, orientation toward MyBatis users, and a more modern API. Its constraint is that, compared with MyBatis and MyBatis-Plus, its public Maven dependency count and enterprise history are smaller, and its ecosystem maturity is still expanding.

### 3.9 jOOQ

The jOOQ documentation states that jOOQ generates Java code from the database and builds type-safe SQL queries through a fluent API [9]. jOOQ's core strengths are SQL-first design, type safety, database-first workflow, strong expression capability for complex SQL, and good observability of generated SQL. Its constraint is that it is not a full ORM in the traditional sense. It does not manage entity state, object graphs, dirty checking, and persistence contexts the way Hibernate does. jOOQ is more suitable for complex SQL, reporting, statistics, strongly typed queries, and systems with high SQL controllability requirements.

### 3.10 Jdbi

The Jdbi documentation explicitly states that Jdbi is not an ORM. It is a JDBC-based convenience library for database operations, intended to make Java database operations simpler than raw JDBC while avoiding hidden behavior as much as possible [10]. Jdbi's strengths are lightweightness, transparency, closeness to JDBC, and suitability for small services, utility systems, and SQL-explicit scenarios. Its constraint is that it does not provide full ORM capabilities and is not suitable for systems that need complex object graph persistence, automatic cascading, and JPA standard compatibility.

### 3.11 Querydsl

The Querydsl official repository states that Querydsl can construct type-safe SQL-like queries for backends such as JPA, MongoDB, and SQL, and can use a fluent API instead of inline strings or XML queries [16]. Querydsl's strengths are type-safe queries and dynamic query expression capability. Its constraint is that it is usually combined with JPA or SQL modules as a query construction tool, and is not an independent full ORM Provider.

### 3.12 Ebean

The Ebean documentation states that Ebean provides multiple levels of query abstraction, including ORM queries, DTO queries, SQL queries, and JDBC, and supports switching between different abstraction levels [14]. Ebean's strengths are mixed ORM and SQL capabilities, a sessionless design, and built-in migration capabilities. Its constraint is that its adoption in the mainstream Java enterprise ecosystem is smaller than Hibernate, MyBatis, and Spring Data JPA.

### 3.13 Apache Cayenne

The Apache Cayenne documentation states that Cayenne is a Java object-relational mapping framework and provides a GUI Modeler for reverse engineering database schemas, editing object-relational mapping projects, and generating Java source code [15]. Its strengths are modeling tools, reverse engineering, and visual mapping capabilities. Its constraint is that its adoption in current mainstream enterprise Java selections is smaller than Hibernate, Spring Data JPA, and MyBatis.

### 3.14 ORMLite

The ORMLite documentation defines it as a lightweight ORM for persisting Java objects while avoiding the complexity and overhead of standard ORM packages. It supports JDBC and Android SQLite [15]. Its strengths are lightweightness, simplicity, and suitability for Android, SQLite, and small Java applications. Its constraint is that its capability for enterprise-level complex domain models, complex transactions, and large-scale Spring Boot ecosystem integration is weaker than Hibernate and the MyBatis family.

### 3.15 Jimmer

The official Maven Central artifact description for Jimmer describes it as a JVM ORM for Java and Kotlin. Its documentation states that its core concept is reading and writing arbitrary shapes of data structures as a whole, rather than simply processing entity objects [18]. Jimmer's strengths are modern ORM design, type safety, and support for Java/Kotlin. Its constraint is that the artifacts are relatively new, public Maven dependency counts are still low, and the ecosystem scale is in an early stage.

### 3.16 Micronaut Data

The Micronaut Data documentation states that Micronaut Data is a database access tool that uses Ahead-of-Time compilation to precompute queries for repository interfaces and execute them through a lightweight runtime layer [18]. Its strengths are compile-time queries, a lightweight runtime, and integration with the Micronaut ecosystem. Its constraint is that it mainly serves the Micronaut technology stack and is not the default data access path for Spring Boot.

## 4. Maven Central and MvnRepository Adoption Status

The official Maven Central portal is used for artifact lookup and metadata display. Because public download counts are not equivalent to real production usage, this article uses the "Used By" dependency count as an approximate indicator of the public dependency ecosystem scale. The following data is used to compare framework ecosystem scale and is not used to represent real production deployment counts.

| Framework/artifact | Maven coordinates | Public dependency metric | Notes |
| --- | --- | ---: | --- |
| Hibernate Core (old coordinates) | `org.hibernate:hibernate-core` | Used By about 4.9K | Migrated to `org.hibernate.orm:hibernate-core`, but the old coordinates have a high historical dependency count |
| Spring Boot Data JPA Starter | `org.springframework.boot:spring-boot-starter-data-jpa` | Used By about 3.7K | Official Spring Boot definition: Spring Data JPA with Hibernate |
| MyBatis | `org.mybatis:mybatis` | Used By about 2.1K | Mainstream SQL Mapper framework |
| MyBatis-Plus Boot Starter | `com.baomidou:mybatis-plus-boot-starter` | Used By about 1.4K | MyBatis enhancement toolkit |
| MyBatis Spring Boot Starter | `org.mybatis.spring.boot:mybatis-spring-boot-starter` | Used By about 1.2K | Official MyBatis Spring Boot integration |
| Hibernate Core (new coordinates) | `org.hibernate.orm:hibernate-core` | Used By about 837; high ORM category ranking | Current main Hibernate coordinates |
| jOOQ | `org.jooq:jooq` | Used By about 526 | SQL-first type-safe SQL framework |
| EclipseLink | `org.eclipse.persistence:eclipselink` | Used By about 467 | JPA Provider |
| Jdbi Core | `org.jdbi:jdbi3-core` | Used By about 266 | JDBC convenience library, officially not an ORM |
| DataNucleus Core | `org.datanucleus:datanucleus-core` | Used By about 260 | Core of a JDO/JPA persistence product |
| Querydsl Core | `com.querydsl:querydsl-core` | Used By about 234 | Type-safe query construction tool |
| MyBatis-Flex Spring | `com.mybatis-flex:mybatis-flex-spring` | Used By about 16 | MyBatis enhancement framework |
| Jimmer SQL | `org.babyfish.jimmer:jimmer-sql` | Maven Central shows use in a small number of components | Emerging JVM ORM |

From public Maven dependency ecosystem indicators, Hibernate Core, Spring Boot Data JPA Starter, MyBatis, and MyBatis-Plus are at higher adoption levels. If only traditional full ORM Providers are discussed, Hibernate is the most used and most mature framework in the ecosystem. If the Spring Boot starter is also included, the public dependency count of `spring-boot-starter-data-jpa` reflects the mainstream position of the Spring Boot + Spring Data JPA + Hibernate path in Java applications. If SQL mappers are included in a broad ORM/persistence framework scope, MyBatis and MyBatis-Plus also have high adoption.

## 5. Comparison of Advantages, Disadvantages, and Current State

| Framework | Type | Main strengths | Main constraints | Current state |
| --- | --- | --- | --- | --- |
| Hibernate ORM | Full ORM / JPA Provider | Complete functionality; JPA compatibility; default Spring Boot path; largest ecosystem | Heavy abstraction; requires understanding entity state, lazy loading, N+1, and SQL generation | De facto mainstream full ORM in Java |
| Spring Data JPA | JPA Repository abstraction | Strong Spring Boot integration; less boilerplate; mature Repository model | Not an ORM Provider; complex SQL still requires Hibernate/JPA knowledge | Preferred path for Spring Boot CRUD systems |
| EclipseLink | JPA Provider | JPA reference implementation; standard compatibility; enterprise persistence capabilities | Weaker default Spring Boot ecosystem than Hibernate | Standard JPA alternative |
| OpenJPA | JPA Provider | Apache project; standalone or container integration | Smaller adoption; lower default priority for new projects | Maintained but not the mainstream first choice |
| DataNucleus | JDO/JPA Provider | Broad standard coverage; supports multiple data sources | Relatively small ecosystem; higher team learning cost | Used in specific standard/multi-data-source scenarios |
| MyBatis | SQL Mapper | Controllable SQL; suitable for complex SQL and legacy databases; lower learning cost | Not a full ORM; SQL and mapping maintenance cost is high | Mainstream Java SQL Mapper framework |
| MyBatis-Plus | MyBatis enhancement | Generic CRUD, pagination, and condition builders reduce code | Depends on MyBatis; not JPA; plugin behavior needs governance | Common in domestic Spring Boot projects |
| MyBatis-Flex | MyBatis enhancement | Lightweight; modern API; few dependencies | Smaller ecosystem and less historical adoption | Emerging MyBatis enhancement framework |
| jOOQ | SQL-first DSL | Type-safe SQL; strong complex query capability; predictable SQL | Not a full ORM; requires database-first and code generation workflow | Strong in complex SQL and high controllability scenarios |
| Jdbi | JDBC convenience library | Very lightweight; close to JDBC; little hidden behavior | Officially not an ORM; does not manage object graphs | Suitable for lightweight services and utility systems |
| Querydsl | Type-safe query tool | Strong dynamic query and type-safe expression capability | Usually attached to JPA/SQL modules; not a full ORM | Often used as a query enhancement tool |
| Ebean | Non-JPA mainstream ORM | ORM, DTO, SQL, and JDBC abstractions; sessionless design | Smaller ecosystem than Hibernate/MyBatis | Used by specific teams and lightweight ORM scenarios |
| Apache Cayenne | ORM + Modeler | GUI modeling, reverse engineering, code generation | Weaker mainstream enterprise ecosystem | Long-lived but not a mainstream first choice |
| ORMLite | Lightweight ORM | Lightweight; suitable for Android, SQLite, and small applications | Limited for enterprise complex models | Suitable for lightweight/mobile/embedded scenarios |
| Jimmer | Emerging JVM ORM | Type safety; Java/Kotlin; modern data-structure read/write model | Newer artifacts; ecosystem still small | Emerging framework, requires cautious evaluation |
| Micronaut Data | Compile-time data access | AoT precomputed queries; lightweight runtime layer | Mainly serves Micronaut, not the Spring Boot default route | Suitable for the Micronaut stack |

## 6. Analysis of the Highest-Performance ORM Framework

"The highest-performance ORM" cannot be judged independently of the business model, SQL complexity, database indexes, transaction boundaries, connection pools, caching, batching, association loading strategies, and network latency. The performance of full ORM is mainly affected by entity relationships, fetch strategies, first-level cache, second-level cache, dirty checking, batch writes, and SQL generation quality. The performance of SQL mappers or SQL-first tools is mainly affected by hand-written SQL, result mapping, the number of network round trips, and database execution plans.

From a framework design perspective, Hibernate's advantage is not the lowest raw SQL execution overhead. Its advantage is complete object lifecycle management, JPA standard support, transaction integration, caching, and domain model persistence capabilities. Hibernate can support large enterprise systems when batch writes, fetch strategies, caches, and query boundaries are configured correctly, but its automatic association loading and entity state management can also introduce extra overhead.

MyBatis's performance boundary is closer to hand-written JDBC because SQL is controlled by developers and the framework mainly handles parameter binding and result mapping. Its performance depends on the SQL itself, index design, and mapping style. jOOQ's performance predictability comes from SQL-first design and a type-safe DSL. It does not try to hide SQL, nor does it take over the object graph lifecycle. Jdbi is closer to a convenience wrapper around JDBC. Its documentation explicitly states that it is not an ORM and tries to avoid hidden behavior.

Therefore, if jOOQ, MyBatis, and Jdbi are included in the broad Java persistence framework scope, jOOQ or MyBatis usually provides the best performance predictability in complex SQL and high-performance query scenarios. If the scope is strictly limited to full ORM Providers, it is not objective to claim that Hibernate, EclipseLink, OpenJPA, or DataNucleus is absolutely fastest in all scenarios. In full ORM scenarios, Hibernate's advantage is the richest ecosystem, functionality, and tuning material, not unconditional performance superiority. Performance-sensitive systems should build benchmarks based on the target business model rather than drawing conclusions only from framework names.

## 7. Analysis of the Most Lightweight ORM Framework

"Most lightweight" requires clarifying the scope first. If a full ORM is strictly required, ORMLite is officially positioned as a lightweight ORM for persisting Java objects while avoiding the complexity and overhead of standard ORM packages. It is suitable for Android, SQLite, and small Java applications. If a broad persistence framework scope is used, Jdbi is the most lightweight, but its documentation explicitly states that it is not an ORM; it is a JDBC convenience library. If a mainstream enterprise Java scope is used, MyBatis is lighter than Hibernate because MyBatis does not maintain a full entity lifecycle, persistence context, dirty checking, and object graph synchronization.

Therefore, the conclusion on lightweightness can be divided into three categories: the strict lightweight ORM is ORMLite; the most lightweight SQL mapping/database access library is Jdbi; and the relatively lightweight and widely used mainstream enterprise SQL Mapper is MyBatis. MyBatis-Plus and MyBatis-Flex are MyBatis enhancement tools that reduce CRUD code, but lightweightness should also consider plugins, dependencies, and team usage conventions.

## 8. Spring Boot Scenario Selection

In Spring Boot scenarios, the default choice should be Spring Data JPA + Hibernate. The basis is that the official Spring Boot starter list explicitly defines `spring-boot-starter-data-jpa` as a starter that uses Spring Data JPA with Hibernate, and the Spring Data JPA documentation also positions it as Repository support for the Jakarta Persistence API [4]. Therefore, regular backend management systems, typical CRUD, stable domain models, teams that want to reduce boilerplate code, and systems that need a unified transaction and Repository model should prioritize Spring Data JPA + Hibernate.

Spring Boot projects can choose MyBatis or MyBatis-Plus in the following scenarios: the database schema already exists and is not suitable for entity-first modeling; SQL is centrally controlled by DBAs or platform teams; there are many complex multi-table queries, reports, statistics, and pagination optimizations; the team already has MyBatis conventions and code generation systems; or each SQL statement needs explicit control. The MyBatis Spring Boot Starter documentation states that the starter helps quickly build MyBatis applications on Spring Boot and reduces XML configuration [6].

Using jOOQ in Spring Boot is suitable for systems with high SQL complexity, high type-safety requirements for queries, and a clear database-first design. jOOQ is not suitable as a simple replacement for Hibernate because the two abstractions have different goals: Hibernate centers on object-relational mapping and entity lifecycle, while jOOQ centers on SQL construction and type-safe queries.

## 9. Non-Spring Scenario Selection

In non-Spring scenarios, if a system needs full ORM, JPA standard compatibility, entity lifecycle management, and a mature ecosystem, Hibernate ORM is the preferred choice. It can be used through the Jakarta Persistence API or the Hibernate native API. This choice is suitable for Jakarta EE, Quarkus, Micronaut, or plain Java SE scenarios that need full ORM capabilities.

If a system does not need full object graph persistence and instead centers on complex SQL, reporting queries, database functions, window functions, multi-table statistics, and SQL controllability, jOOQ is a better choice. It generates type-safe code from the database schema, keeping SQL visible and controllable.

If a system only needs lightweight database access and does not need entity state management, cascading, lazy loading, or full ORM features, Jdbi or MyBatis is more suitable. Jdbi is closer to a JDBC convenience library, while MyBatis is closer to a configurable SQL Mapper. MyBatis is more appropriate for legacy databases, stored procedures, complex XML SQL mappings, or teams that already have Mapper conventions. Jdbi is more appropriate for small services, utility systems, or data access layers that pursue minimal hidden behavior.

## 10. Conclusion

The Java ORM ecosystem has evolved from a single full ORM pattern into coexistence among multiple persistence abstractions. Hibernate ORM is the most widely used and most mature framework among traditional full ORMs. In Spring Boot scenarios, Spring Data JPA + Hibernate is the official default path. MyBatis and MyBatis-Plus are widely used choices in the SQL Mapper route. jOOQ is a strong tool for complex SQL, type-safe queries, and database-first design. Jdbi is a lightweight SQL access library, but it is not an ORM. ORMLite represents a lightweight ORM in the strict sense.

There is no absolute answer to "the highest-performance framework" across business scenarios. When complex SQL and performance predictability are prioritized, jOOQ or MyBatis usually outperforms full ORM. When full domain object persistence, the JPA standard, and Spring Boot integration are prioritized, Hibernate is more appropriate. The answer to "most lightweight" also depends on scope: the strict lightweight ORM is ORMLite; the lightweight database access library is Jdbi; and the mainstream enterprise lightweight SQL Mapper is MyBatis.

Therefore, the engineering selection conclusion is: regular Spring Boot business systems should prioritize Spring Data JPA + Hibernate; Spring Boot scenarios with strong SQL control should choose MyBatis/MyBatis-Plus or jOOQ; non-Spring full ORM scenarios should choose Hibernate; non-Spring SQL-first scenarios should choose jOOQ; and non-Spring lightweight data access scenarios should choose Jdbi or MyBatis.

## References

[1] Jakarta Persistence official specification.
[2] Hibernate ORM official documentation.
[3] Maven Central / Sonatype Central Portal.
[4] Spring Boot and Spring Data JPA official documentation.
[5] MyBatis official documentation.
[6] MyBatis Spring Boot Starter official documentation.
[7] MyBatis-Plus official documentation.
[8] Maven Repository / MvnRepository artifact dependency data.
[9] jOOQ official documentation.
[10] Jdbi official documentation.
[11] EclipseLink official documentation.
[12] Apache OpenJPA official documentation.
[13] DataNucleus official documentation.
[14] Ebean official documentation.
[15] Apache Cayenne and ORMLite official documentation.
[16] Querydsl official documentation.
[17] MyBatis-Flex official repository and Maven Central artifact information.
[18] Jimmer and Micronaut Data official documentation.

* The official Jakarta Persistence description states that it defines the standard for persistence management and object-relational mapping in Java environments. ([jakarta.ee][1])
* The official Hibernate description states that Hibernate ORM provides domain model persistence for relational databases and is compatible with Jakarta Persistence/JPA. ([Hibernate][2])
* The official Spring Boot starter list explicitly states that `spring-boot-starter-data-jpa` is "Spring Data JPA with Hibernate"; the official Spring Data JPA documentation states that it provides JPA Repository support. ([Home][3])
* The official MyBatis description states that it supports custom SQL, stored procedures, and advanced mappings, and emphasizes that the framework focuses on SQL. The official MyBatis Spring Boot Starter documentation states that it is used to quickly build MyBatis applications on Spring Boot. ([mybatis.org][4])
* The official MyBatis-Plus description states that it is a MyBatis enhancement toolkit. The official MyBatis-Flex repository states that it depends on MyBatis and provides CRUD, pagination, and multiple database support. ([MyBatis-Plus][5])
* The official jOOQ description states that it generates Java code from the database and builds type-safe SQL with a fluent API. The official Jdbi documentation explicitly states that Jdbi is not an ORM, but a JDBC-based convenience library. ([jOOQ][6])
* The positioning of EclipseLink, OpenJPA, DataNucleus, Ebean, Apache Cayenne, and ORMLite comes from their official documentation or official pages. ([eclipse.dev][7])
* Official Maven Central search is provided by the maintainer of the Maven Central Repository. The "Used By" data in this article uses the public MvnRepository index as a proxy indicator and is not equivalent to real download counts or production system counts. ([Maven Central][8])

[1]: https://jakarta.ee/specifications/persistence/?utm_source=chatgpt.com "Jakarta Persistence | Jakarta EE | The Eclipse Foundation"
[2]: https://hibernate.org/orm/?utm_source=chatgpt.com "Your relational data. Objectively. - Hibernate ORM"
[3]: https://docs.spring.io/spring-boot/reference/using/build-systems.html?utm_source=chatgpt.com "Build Systems :: Spring Boot"
[4]: https://mybatis.org/mybatis-3/?utm_source=chatgpt.com "MyBatis 3 | Introduction"
[5]: https://baomidou.com/en/introduce/?utm_source=chatgpt.com "Introduction"
[6]: https://www.jooq.org/?utm_source=chatgpt.com "jOOQ: The easiest way to write SQL in Java"
[7]: https://eclipse.dev/eclipselink/documentation/2.5/jpa/extensions/intro.htm?utm_source=chatgpt.com "Introduction | EclipseLink 2.5.x Java Persistence API (JPA ..."
[8]: https://central.sonatype.com/?utm_source=chatgpt.com "Maven Central"
