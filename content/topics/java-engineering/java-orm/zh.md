# Java ORM 框架生态调研：使用现状、性能边界与场景选择

## 摘要

Java 生态中的 ORM（Object-Relational Mapping）框架可分为三类：第一类是遵循 Jakarta Persistence/JPA 标准的完整 ORM 提供者，如 Hibernate ORM、EclipseLink、Apache OpenJPA、DataNucleus；第二类是 SQL Mapper 或半 ORM 工具，如 MyBatis、MyBatis-Plus、MyBatis-Flex；第三类是 SQL-first 或轻映射持久化工具，如 jOOQ、Jdbi、Querydsl。Jakarta Persistence 官方规范将其定义为 Java 环境中持久化管理和对象关系映射的标准。Maven Central 官方门户提供构件元数据查询，但公开页面不稳定提供完整下载量排行榜，因此本文将 Maven Central 构件存在性、版本信息和 MvnRepository 的 “Used By” 被依赖数量作为使用现状的辅助指标。调研结果显示，Hibernate ORM 是 Java 传统 ORM 体系中使用最广、生态最完整的框架；在 Spring Boot 场景中，官方 starter `spring-boot-starter-data-jpa` 明确定位为使用 Spring Data JPA 与 Hibernate；在 SQL 控制权、复杂查询和性能可预测性优先的场景中，jOOQ、MyBatis 或 Jdbi 比完整 ORM 更接近 JDBC 的执行模型。性能不存在跨业务模型的绝对最优 ORM，轻量性也需要区分“完整 ORM”与“SQL 映射工具”。在工程选型上，Spring Boot 常规业务系统可优先选择 Spring Data JPA + Hibernate；SQL 复杂、历史库适配、报表查询较多的系统可选择 MyBatis/MyBatis-Plus 或 jOOQ；非 Spring 场景中，完整 ORM 可选择 Hibernate，SQL-first 场景可选择 jOOQ，轻量数据访问可选择 Jdbi 或 MyBatis。

## 关键词

Java ORM；Hibernate；Spring Data JPA；MyBatis；jOOQ；Jdbi；Maven Central；Spring Boot

## 1 引言

ORM 的目标是将 Java 对象模型与关系型数据库模型建立映射，从而使应用程序可以通过对象、实体、仓储或映射接口访问关系数据。Jakarta Persistence 官方规范定义了 Java 环境中持久化管理和对象关系映射的标准，该标准通常由具体 ORM 提供者实现，例如 Hibernate ORM、EclipseLink、Apache OpenJPA 等[1]。Hibernate 官方文档将 Hibernate ORM 描述为面向关系数据库的领域模型持久化框架，并说明其同时提供原生 API 与 Jakarta Persistence 规范实现[2]。

Java 持久化生态并不只包含传统 ORM。MyBatis 官方文档将 MyBatis 描述为支持自定义 SQL、存储过程和高级映射的持久化框架，它消除了大量 JDBC 代码和手动参数设置与结果映射工作[5]。jOOQ 官方文档将 jOOQ 描述为通过数据库生成 Java 代码，并使用 fluent API 构建类型安全 SQL 的工具[9]。Jdbi 官方文档则明确说明 Jdbi 不是 ORM，而是基于 JDBC 的数据库操作便利库[10]。因此，讨论 Java ORM 选型时，必须区分“完整 ORM 提供者”“SQL Mapper”“类型安全 SQL DSL”和“轻量 JDBC 映射库”。

本文围绕 Java ORM 框架的当前类别、使用现状、优缺点、性能边界、轻量性、Spring Boot 场景选择和非 Spring 场景选择进行调研。调研结论以官方文档、Maven Central 构件信息和公开 Maven 依赖索引为依据，不以单一博客经验作为主要论据。

## 2 调研方法与数据口径

本文数据截止时间为 2026 年 6 月 11 日。框架信息主要来自 Jakarta Persistence、Hibernate、Spring Boot、Spring Data JPA、MyBatis、jOOQ、Jdbi、EclipseLink、OpenJPA、DataNucleus、Ebean、Apache Cayenne、ORMLite、Micronaut Data、MyBatis-Plus、MyBatis-Flex 和 Jimmer 的官方文档或官方仓库说明[1]–[18]。

Maven Central 官方门户用于确认构件是否存在、当前版本、POM 信息和依赖元数据[3]。由于 Maven Central 官方搜索页并不稳定提供所有构件的真实下载量排行榜，本文不将“下载量”作为唯一使用量指标。对于“使用最多”这一问题，本文使用 MvnRepository 页面中的 “Used By” 被依赖数量与分类排名作为代理指标。该指标表示公开 Maven 构件中声明依赖某构件的数量，不等同于真实生产系统数量，也不等同于下载次数。

本文将框架划分为以下四类：

| 类别                    | 代表框架                                               | 定义                                                           |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| 标准 ORM / JPA Provider | Hibernate ORM、EclipseLink、OpenJPA、DataNucleus      | 实现或支持 Jakarta Persistence/JPA，负责实体生命周期、对象关系映射、脏检查、延迟加载、事务集成等 |
| 非 JPA ORM             | Ebean、Apache Cayenne、ORMLite、ActiveJDBC、Jimmer     | 提供对象关系映射能力，但不一定以 JPA Provider 作为核心定位                         |
| SQL Mapper / 半 ORM    | MyBatis、MyBatis-Plus、MyBatis-Flex                  | 以 SQL 映射、Mapper 接口、XML/注解映射为核心，不完全接管实体生命周期                   |
| SQL-first / 轻映射工具     | jOOQ、Jdbi、Querydsl、Spring Data JDBC、Micronaut Data | 强调 SQL 构造、Repository 抽象、轻量映射或编译期查询，不一定属于传统 ORM               |

## 3 Java ORM 与持久化框架现状

### 3.1 Hibernate ORM

Hibernate ORM 是 Java 生态中最具代表性的完整 ORM 框架之一。Hibernate 官方文档说明，Hibernate ORM 使 Java 程序能够以自然、类型安全的形式访问关系数据，并支持复杂查询、内存对象变更与数据库同步、事务 ACID 属性、时间数据和审计等能力[2]。Hibernate 同时实现 Jakarta Persistence 规范，因此可以通过 JPA API 或 Hibernate 原生 API 使用。

Hibernate 的优势在于功能完整、生态成熟、Spring Boot 默认集成路径清晰、文档丰富、社区规模大。其适用对象包括典型企业 CRUD 系统、领域模型较稳定的业务系统、需要实体生命周期管理的系统，以及需要统一 JPA 编程模型的 Spring Boot 应用。其约束在于框架抽象较重，实体状态、一级缓存、延迟加载、脏检查、关联抓取、N+1 查询和自动生成 SQL 都需要开发者理解，否则可能导致性能不可控。

### 3.2 Spring Data JPA

Spring Data JPA 不是 ORM Provider，而是 Spring Data 体系中面向 JPA 的 Repository 抽象。Spring Data JPA 官方文档说明，它为 Jakarta Persistence API 提供 Repository 支持，并使需要访问 JPA 数据源的应用以一致的编程模型开发[4]。Spring Boot 官方 starter 列表明确将 `spring-boot-starter-data-jpa` 描述为使用 Spring Data JPA 与 Hibernate 的 starter[4]。

Spring Data JPA 的优势是与 Spring Boot 自动配置、事务管理、Repository、分页、排序、派生查询方法和测试体系集成紧密。其约束是它并不替代 Hibernate、EclipseLink 等 JPA Provider；复杂 SQL、复杂关联、批量写入和性能敏感查询仍然需要开发者理解底层 JPA Provider 的行为。

### 3.3 EclipseLink

EclipseLink 是 Eclipse 项目下的持久化框架。官方文档说明 EclipseLink 是 JPA 参考实现，并包含 JPA 增强与扩展能力[11]。EclipseLink 的优势是标准化程度较高，适合需要 Jakarta EE/JPA 标准兼容的场景。其约束是，在 Spring Boot 主流默认路径中，Hibernate 是官方 starter 默认集成对象，因此 EclipseLink 在 Spring Boot 普通业务系统中的默认生态位置弱于 Hibernate。

### 3.4 Apache OpenJPA

Apache OpenJPA 官方文档说明，OpenJPA 是 Apache 软件基金会下的 Java 持久化项目，可作为独立 POJO 持久化层使用，也可集成到 Java EE 容器、Tomcat、Spring 等轻量框架中；当前生产版本实现 Jakarta Persistence API 规范[12]。OpenJPA 的优势是 Apache 项目背景、JPA 标准实现和容器集成能力。其约束是公开 Maven 依赖生态规模小于 Hibernate 与 Spring Data JPA，在新项目中的默认优先级较低。

### 3.5 DataNucleus

DataNucleus 官方文档将其描述为支持 JDO、JPA、REST API，并可面向多种数据存储的 Java 持久化产品[13]。其优势是标准覆盖面和数据源覆盖面广。其约束是主流 Spring Boot 企业应用中使用频率低于 Hibernate、MyBatis 和 Spring Data JPA，团队学习成本和生态资料可得性也相对有限。

### 3.6 MyBatis

MyBatis 官方文档说明，MyBatis 是支持自定义 SQL、存储过程和高级映射的持久化框架，可通过 XML 或注解配置，将基本类型、Map 接口和 Java POJO 映射到数据库记录[5]。MyBatis 文档还强调其关注 SQL，并尽量“不挡路”[5]。

MyBatis 的优势是 SQL 可控、学习曲线低于完整 ORM、适合历史数据库、复杂 SQL、报表查询、手写 SQL 优化和 DBA 强管控场景。其约束是它不是完整实体生命周期 ORM，不自动管理复杂对象图，不像 Hibernate 那样提供完整脏检查和对象状态同步能力；开发者需要自己维护 SQL、结果映射和关联查询策略。

### 3.7 MyBatis-Plus

MyBatis-Plus 官方文档将其定义为 MyBatis 的增强工具包，在不改变 MyBatis 核心框架的基础上提供附加能力，用于简化开发和提高效率[7]。其常见能力包括通用 CRUD、条件构造器、分页插件和代码生成等。MyBatis-Plus 的优势是保留 MyBatis SQL 可控性的同时减少样板 CRUD 代码。其约束是框架行为建立在 MyBatis 之上，不属于 JPA 标准实现，也不提供完整 ORM 对象图生命周期管理。

### 3.8 MyBatis-Flex

MyBatis-Flex 官方仓库将其描述为 MyBatis 增强框架，并说明其核心依赖 MyBatis、提供基本 CRUD、分页查询、行映射、多数据库和方言扩展等能力[17]。MyBatis-Flex 的优势是轻量、面向 MyBatis 使用者、API 更现代。其约束是相较 MyBatis 与 MyBatis-Plus，公开 Maven 被依赖数量和企业历史沉淀较少，生态成熟度仍处于扩展阶段。

### 3.9 jOOQ

jOOQ 官方文档说明，jOOQ 从数据库生成 Java 代码，并通过 fluent API 构建类型安全 SQL 查询[9]。jOOQ 的核心优势是 SQL-first、类型安全、数据库优先、复杂 SQL 表达能力强、生成 SQL 可观察性好。其约束是它不是传统意义上的完整 ORM，不负责像 Hibernate 那样管理实体状态、对象图、脏检查和持久化上下文。jOOQ 更适合复杂 SQL、报表、统计、强类型查询和对 SQL 可控性要求高的系统。

### 3.10 Jdbi

Jdbi 官方文档明确说明，Jdbi 不是 ORM，而是基于 JDBC 的数据库操作便利库，用于使 Java 数据库操作比原始 JDBC 更简单，并且尽量避免隐藏行为[10]。Jdbi 的优势是轻量、透明、接近 JDBC、适合小型服务、工具系统和 SQL 明确的场景。其约束是不提供完整 ORM 能力，不适合需要复杂对象图持久化、自动级联和 JPA 标准兼容的系统。

### 3.11 Querydsl

Querydsl 官方仓库说明，Querydsl 可为 JPA、MongoDB、SQL 等后端构造类型安全的 SQL-like 查询，并通过 fluent API 代替内联字符串或 XML 查询[16]。Querydsl 的优势是类型安全查询和动态查询表达能力。其约束是它通常作为查询构造工具与 JPA 或 SQL 模块结合使用，不是独立完整 ORM Provider。

### 3.12 Ebean

Ebean 官方文档说明，Ebean 提供多层查询抽象，包括 ORM 查询、DTO 查询、SQL 查询和 JDBC，并支持在不同抽象级别之间切换[14]。Ebean 的优势是 ORM 与 SQL 混合能力、Sessionless 设计和内置迁移能力。其约束是主流 Java 企业生态中使用规模小于 Hibernate、MyBatis 和 Spring Data JPA。

### 3.13 Apache Cayenne

Apache Cayenne 官方文档说明，Cayenne 是 Java 对象关系映射框架，并提供 GUI Modeler，用于反向工程数据库 schema、编辑对象关系映射项目和生成 Java 源码[15]。其优势是模型工具、反向工程和可视化映射能力。其约束是当前企业 Java 主流选型中使用规模小于 Hibernate、Spring Data JPA 和 MyBatis。

### 3.14 ORMLite

ORMLite 官方文档将其定义为轻量 ORM，用于在避免标准 ORM 包复杂性和开销的同时持久化 Java 对象，支持 JDBC 和 Android SQLite[15]。其优势是轻量、简单、适合 Android、SQLite 和小型 Java 应用。其约束是企业级复杂领域模型、复杂事务和大规模 Spring Boot 生态集成能力弱于 Hibernate 与 MyBatis 系列。

### 3.15 Jimmer

Jimmer 官方 Maven Central 构件说明将其描述为面向 Java 与 Kotlin 的 JVM ORM。官方文档说明其核心概念是整体读写任意形状的数据结构，而不是简单处理实体对象[18]。Jimmer 的优势是现代 ORM 设计、类型安全和 Java/Kotlin 支持。其约束是构件发布较新，公开 Maven 被依赖数量仍较少，生态规模处于早期阶段。

### 3.16 Micronaut Data

Micronaut Data 官方文档说明，Micronaut Data 是使用 Ahead-of-Time 编译为 Repository 接口预计算查询的数据库访问工具，并由轻量运行时层执行[18]。其优势是编译期查询、轻运行时和 Micronaut 生态集成。其约束是它主要服务于 Micronaut 技术栈，不是 Spring Boot 默认数据访问路径。

## 4 Maven Central 与 MvnRepository 使用现状

Maven Central 官方门户用于构件查询和元数据展示。由于公开下载量与真实生产使用量并不等价，本文采用 “Used By” 被依赖数量作为公开依赖生态规模的近似指标。以下数据用于比较框架生态规模，不用于表示真实生产部署数量。

| 框架/构件                        | Maven 坐标                                                |                        公开依赖指标 | 说明                                                  |
| ---------------------------- | ------------------------------------------------------- | ----------------------------: | --------------------------------------------------- |
| Hibernate Core（旧坐标）          | `org.hibernate:hibernate-core`                          |                Used By 约 4.9K | 已迁移到 `org.hibernate.orm:hibernate-core`，但旧坐标历史依赖量很高 |
| Spring Boot Data JPA Starter | `org.springframework.boot:spring-boot-starter-data-jpa` |                Used By 约 3.7K | Spring Boot 官方定义为 Spring Data JPA with Hibernate    |
| MyBatis                      | `org.mybatis:mybatis`                                   |                Used By 约 2.1K | SQL Mapper 主流框架                                     |
| MyBatis-Plus Boot Starter    | `com.baomidou:mybatis-plus-boot-starter`                |                Used By 约 1.4K | MyBatis 增强工具包                                       |
| MyBatis Spring Boot Starter  | `org.mybatis.spring.boot:mybatis-spring-boot-starter`   |                Used By 约 1.2K | MyBatis 官方 Spring Boot 集成                           |
| Hibernate Core（新坐标）          | `org.hibernate.orm:hibernate-core`                      |      Used By 约 837；ORM 分类排名靠前 | Hibernate 当前主坐标                                     |
| jOOQ                         | `org.jooq:jooq`                                         |                 Used By 约 526 | SQL-first 类型安全 SQL 框架                               |
| EclipseLink                  | `org.eclipse.persistence:eclipselink`                   |                 Used By 约 467 | JPA Provider                                        |
| Jdbi Core                    | `org.jdbi:jdbi3-core`                                   |                 Used By 约 266 | JDBC 便利库，官方明确不是 ORM                                 |
| DataNucleus Core             | `org.datanucleus:datanucleus-core`                      |                 Used By 约 260 | JDO/JPA 持久化产品核心                                     |
| Querydsl Core                | `com.querydsl:querydsl-core`                            |                 Used By 约 234 | 类型安全查询构造工具                                          |
| MyBatis-Flex Spring          | `com.mybatis-flex:mybatis-flex-spring`                  |                  Used By 约 16 | MyBatis 增强框架                                        |
| Jimmer SQL                   | `org.babyfish.jimmer:jimmer-sql`                        | Maven Central 显示 Used in 少量组件 | 新兴 JVM ORM                                          |

从 Maven 依赖生态的公开指标看，Hibernate Core、Spring Boot Data JPA Starter、MyBatis 和 MyBatis-Plus 处于较高使用层级。若仅讨论传统完整 ORM Provider，Hibernate 是使用最多、生态最成熟的框架。若将 Spring Boot starter 也纳入统计，`spring-boot-starter-data-jpa` 的公开依赖数量体现了 Spring Boot + Spring Data JPA + Hibernate 路径在 Java 应用中的主流地位。若将 SQL Mapper 纳入广义 ORM/持久化框架，MyBatis 与 MyBatis-Plus 的使用量也处于高位。

## 5 各框架优缺点与现状比较

| 框架              | 类型                    | 主要优势                                  | 主要约束                                      | 当前现状                    |
| --------------- | --------------------- | ------------------------------------- | ----------------------------------------- | ----------------------- |
| Hibernate ORM   | 完整 ORM / JPA Provider | 功能完整；JPA 兼容；Spring Boot 默认路径；生态最大     | 抽象较重；需理解实体状态、延迟加载、N+1、SQL 生成              | Java 完整 ORM 的事实主流       |
| Spring Data JPA | JPA Repository 抽象     | Spring Boot 集成强；样板代码少；Repository 模型成熟 | 不是 ORM Provider；复杂 SQL 仍需理解 Hibernate/JPA | Spring Boot CRUD 系统首选路径 |
| EclipseLink     | JPA Provider          | JPA 参考实现；标准兼容；企业级持久化能力                | Spring Boot 默认生态弱于 Hibernate              | 标准 JPA 备选               |
| OpenJPA         | JPA Provider          | Apache 项目；可独立或容器集成                    | 使用规模较小；新项目默认优先级低                          | 维护中但非主流首选               |
| DataNucleus     | JDO/JPA Provider      | 标准覆盖面广；支持多数据源                         | 生态规模相对小；团队学习成本较高                          | 特定标准/多数据源场景使用           |
| MyBatis         | SQL Mapper            | SQL 可控；适合复杂 SQL 和历史库；学习成本较低           | 非完整 ORM；SQL 和映射维护成本高                      | Java SQL Mapper 主流框架    |
| MyBatis-Plus    | MyBatis 增强            | 通用 CRUD、分页、条件构造器减少代码                  | 依赖 MyBatis；非 JPA；插件行为需治理                  | 国内 Spring Boot 项目常用     |
| MyBatis-Flex    | MyBatis 增强            | 轻量；API 现代；依赖少                         | 生态规模与历史沉淀较少                               | 新兴 MyBatis 增强框架         |
| jOOQ            | SQL-first DSL         | 类型安全 SQL；复杂查询强；SQL 可预测                | 不是完整 ORM；需要数据库优先和代码生成流程                   | 复杂 SQL 与高可控性场景强势        |
| Jdbi            | JDBC 便利库              | 极轻量；接近 JDBC；隐藏行为少                     | 官方明确不是 ORM；不管理对象图                         | 轻量服务和工具型系统适用            |
| Querydsl        | 类型安全查询工具              | 动态查询和类型安全表达能力强                        | 通常依附 JPA/SQL 模块；非完整 ORM                   | 常作为查询增强工具使用             |
| Ebean           | 非 JPA 主流 ORM          | ORM、DTO、SQL、JDBC 多层抽象；Sessionless 设计  | 生态规模小于 Hibernate/MyBatis                  | 特定团队和轻 ORM 场景使用         |
| Apache Cayenne  | ORM + Modeler         | GUI 建模、反向工程、代码生成                      | 主流企业生态较弱                                  | 长期存在但非主流首选              |
| ORMLite         | 轻量 ORM                | 轻量；适合 Android、SQLite、小型应用             | 企业级复杂模型能力有限                               | 轻量/移动端/嵌入式场景适用          |
| Jimmer          | 新兴 JVM ORM            | 类型安全；Java/Kotlin；现代数据结构读写模型           | 构件较新；生态仍小                                 | 新兴框架，需谨慎评估              |
| Micronaut Data  | 编译期数据访问               | AoT 预计算查询；运行时层轻                       | 主要服务 Micronaut，不是 Spring Boot 默认路线        | Micronaut 技术栈适用         |

## 6 性能最好的 ORM 框架分析

“性能最好的 ORM”不能脱离业务模型、SQL 复杂度、数据库索引、事务边界、连接池、缓存、批处理、关联加载策略和网络延迟独立判断。完整 ORM 的性能主要受实体关系、抓取策略、一级缓存、二级缓存、脏检查、批量写入和 SQL 生成质量影响。SQL Mapper 或 SQL-first 工具的性能主要受手写 SQL、结果映射、网络往返次数和数据库执行计划影响。

从框架设计看，Hibernate 的优势不是原始 SQL 执行开销最低，而是对象生命周期、JPA 标准、事务集成、缓存和领域模型持久化能力完整。Hibernate 在正确配置批量写入、抓取策略、缓存和查询边界时可以支撑大型企业系统，但其自动关联加载和实体状态管理也可能引入额外开销。

MyBatis 的性能边界更接近手写 JDBC，因为 SQL 由开发者控制，框架主要负责参数绑定和结果映射。其性能优劣取决于 SQL 本身、索引设计和映射方式。jOOQ 的性能可预测性来自 SQL-first 与类型安全 DSL，框架不试图隐藏 SQL，也不接管对象图生命周期。Jdbi 则更接近 JDBC 便利封装，官方明确表示其不是 ORM，并尽量避免隐藏行为。

因此，若将 jOOQ、MyBatis、Jdbi 纳入广义 Java 持久化框架，复杂 SQL 与高性能查询场景中性能可预测性最好的通常是 jOOQ 或 MyBatis；若严格限定为完整 ORM Provider，不能客观断言 Hibernate、EclipseLink、OpenJPA 或 DataNucleus 中某一个在所有场景下绝对最快。完整 ORM 场景下，Hibernate 的优势是生态、功能和调优资料最丰富，而不是无条件性能最强。性能敏感系统应通过目标业务模型构建基准测试，而不能只依据框架名称下结论。

## 7 最轻量 ORM 框架分析

“最轻量”需要先区分口径。若严格要求完整 ORM，ORMLite 的官方定位就是轻量 ORM，用于在避免标准 ORM 包复杂性和开销的同时持久化 Java 对象，适合 Android、SQLite 和小型 Java 应用。若采用广义持久化框架口径，Jdbi 最轻量，但它官方明确说明不是 ORM，而是 JDBC 便利库。若采用主流企业 Java 口径，MyBatis 比 Hibernate 轻，因为 MyBatis 不维护完整实体生命周期、持久化上下文、脏检查和对象图同步。

因此，最轻量结论可分为三类：严格轻量 ORM 是 ORMLite；最轻量 SQL 映射/数据库访问库是 Jdbi；主流企业应用中相对轻量且使用广泛的是 MyBatis。MyBatis-Plus 与 MyBatis-Flex属于 MyBatis 增强工具，能减少 CRUD 代码，但轻量性需要同时考虑插件、依赖和团队使用规范。

## 8 Spring Boot 场景选择

在 Spring Boot 场景中，默认选择应是 Spring Data JPA + Hibernate。依据是 Spring Boot 官方 starter 列表明确将 `spring-boot-starter-data-jpa` 定义为使用 Spring Data JPA 与 Hibernate 的 starter，Spring Data JPA 官方文档也将其定位为 Jakarta Persistence API 的 Repository 支持[4]。因此，普通后台管理系统、典型 CRUD、领域模型稳定、团队希望减少样板代码、需要统一事务与 Repository 模型的系统，应优先采用 Spring Data JPA + Hibernate。

在以下场景中，Spring Boot 项目可选择 MyBatis 或 MyBatis-Plus：数据库 schema 已存在且不适合实体优先建模；SQL 由 DBA 或平台团队统一控制；多表复杂查询、报表、统计和分页优化较多；团队已有 MyBatis 规范与代码生成体系；需要显式控制每条 SQL。MyBatis Spring Boot Starter 官方文档说明该 starter 可帮助快速在 Spring Boot 上构建 MyBatis 应用，并减少 XML 配置[6]。

在 Spring Boot 中使用 jOOQ 适合 SQL 复杂度高、查询类型安全要求高、数据库优先设计明确的系统。jOOQ 不适合作为 Hibernate 的简单替代品，因为二者抽象目标不同：Hibernate 以对象关系映射和实体生命周期为核心，jOOQ 以 SQL 构造和类型安全查询为核心。

## 9 非 Spring 场景选择

非 Spring 场景下，若系统需要完整 ORM、JPA 标准兼容、实体生命周期管理和成熟生态，Hibernate ORM 是优先选择。它既可以通过 Jakarta Persistence API 使用，也可以使用 Hibernate 原生 API。该选择适合 Jakarta EE、Quarkus、Micronaut 或普通 Java SE 中需要完整 ORM 能力的场景。

若系统不需要完整对象图持久化，而是以复杂 SQL、报表查询、数据库函数、窗口函数、多表统计和 SQL 可控性为核心，jOOQ 是更合适的选择。它通过数据库 schema 生成类型安全代码，使 SQL 保持可见和可控。

若系统只需要轻量数据库访问，不需要实体状态管理、级联、延迟加载和完整 ORM 功能，Jdbi 或 MyBatis 更适合。Jdbi 更接近 JDBC 便利库，MyBatis 更接近可配置 SQL Mapper。对于历史数据库、存储过程、复杂 XML SQL 映射或团队已有 Mapper 规范的系统，MyBatis 更合适；对于小型服务、工具系统或追求最少隐藏行为的数据访问层，Jdbi 更合适。

## 10 结论

Java ORM 生态已经从单一完整 ORM 演化为多种持久化抽象并存。Hibernate ORM 是传统完整 ORM 中使用最广、生态最成熟的框架；Spring Boot 场景中，Spring Data JPA + Hibernate 是官方默认路径；MyBatis 与 MyBatis-Plus 是 SQL Mapper 路线中使用广泛的选择；jOOQ 是复杂 SQL、类型安全查询和数据库优先设计中的强工具；Jdbi 是轻量 SQL 访问库，但不是 ORM；ORMLite 是严格意义上轻量 ORM 的代表。

“性能最好”的框架不存在跨业务场景的绝对答案。复杂 SQL 与性能可预测性优先时，jOOQ 或 MyBatis 通常优于完整 ORM；完整领域对象持久化、JPA 标准和 Spring Boot 集成优先时，Hibernate 更合适。“最轻量”的答案也依赖口径：严格轻量 ORM 是 ORMLite；轻量数据库访问库是 Jdbi；主流企业级轻量 SQL Mapper 是 MyBatis。

因此，工程选型结论为：Spring Boot 常规业务系统优先 Spring Data JPA + Hibernate；Spring Boot SQL 强控制场景选择 MyBatis/MyBatis-Plus 或 jOOQ；非 Spring 完整 ORM 场景选择 Hibernate；非 Spring SQL-first 场景选择 jOOQ；非 Spring 轻量数据访问场景选择 Jdbi 或 MyBatis。

## 参考文献

[1] Jakarta Persistence 官方规范。
[2] Hibernate ORM 官方文档。
[3] Maven Central / Sonatype Central Portal。
[4] Spring Boot 与 Spring Data JPA 官方文档。
[5] MyBatis 官方文档。
[6] MyBatis Spring Boot Starter 官方文档。
[7] MyBatis-Plus 官方文档。
[8] Maven Repository / MvnRepository 构件依赖数据。
[9] jOOQ 官方文档。
[10] Jdbi 官方文档。
[11] EclipseLink 官方文档。
[12] Apache OpenJPA 官方文档。
[13] DataNucleus 官方文档。
[14] Ebean 官方文档。
[15] Apache Cayenne 与 ORMLite 官方文档。
[16] Querydsl 官方文档。
[17] MyBatis-Flex 官方仓库与 Maven Central 构件信息。
[18] Jimmer 与 Micronaut Data 官方文档。

* Jakarta Persistence 官方说明：它定义 Java 环境中的持久化管理和对象关系映射标准。([jakarta.ee][1])
* Hibernate 官方说明：Hibernate ORM 面向关系数据库提供领域模型持久化，并兼容 Jakarta Persistence/JPA。([Hibernate][2])
* Spring Boot 官方 starter 列表明确写明 `spring-boot-starter-data-jpa` 是 “Spring Data JPA with Hibernate”；Spring Data JPA 官方说明其提供 JPA Repository 支持。([Home][3])
* MyBatis 官方说明其支持自定义 SQL、存储过程和高级映射，并强调框架关注 SQL；MyBatis Spring Boot Starter 官方说明其用于快速在 Spring Boot 上构建 MyBatis 应用。([mybatis.org][4])
* MyBatis-Plus 官方说明其是 MyBatis 增强工具包；MyBatis-Flex 官方仓库说明其依赖 MyBatis 并提供 CRUD、分页和多数据库支持。([MyBatis-Plus][5])
* jOOQ 官方说明其从数据库生成 Java 代码，并用 fluent API 构建类型安全 SQL；Jdbi 官方明确说明 Jdbi 不是 ORM，而是基于 JDBC 的便利库。([jOOQ][6])
* EclipseLink、OpenJPA、DataNucleus、Ebean、Apache Cayenne、ORMLite 的定位分别来自其官方文档或官方页面。([eclipse.dev][7])
* Maven Central 官方搜索由 Maven Central Repository 维护方提供；本文的 “Used By” 采用 MvnRepository 公开索引作为代理指标，不等同于真实下载量或生产系统数量。([Maven Central][8])

[1]: https://jakarta.ee/specifications/persistence/?utm_source=chatgpt.com "Jakarta Persistence | Jakarta EE | The Eclipse Foundation"
[2]: https://hibernate.org/orm/?utm_source=chatgpt.com "Your relational data. Objectively. - Hibernate ORM"
[3]: https://docs.spring.io/spring-boot/reference/using/build-systems.html?utm_source=chatgpt.com "Build Systems :: Spring Boot"
[4]: https://mybatis.org/mybatis-3/?utm_source=chatgpt.com "MyBatis 3 | Introduction"
[5]: https://baomidou.com/en/introduce/?utm_source=chatgpt.com "Introduction"
[6]: https://www.jooq.org/?utm_source=chatgpt.com "jOOQ: The easiest way to write SQL in Java"
[7]: https://eclipse.dev/eclipselink/documentation/2.5/jpa/extensions/intro.htm?utm_source=chatgpt.com "Introduction | EclipseLink 2.5.x Java Persistence API (JPA ..."
[8]: https://central.sonatype.com/?utm_source=chatgpt.com "Maven Central"
