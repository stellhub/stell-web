# MySQL Java 客户端依赖坐标演进研究：从 `mysql:mysql-connector-java` 到 `com.mysql:mysql-connector-j`

## 摘要

MySQL Connector/J 是 MySQL 官方提供的 Java 客户端驱动，用于 Java 应用通过 JDBC API 与 MySQL Server 通信，同时也实现了 MySQL X DevAPI。围绕 Java 工程中的 Maven 依赖管理，Connector/J 在 8.0.31 版本开始发生依赖坐标规范化变更：原坐标 `mysql:mysql-connector-java` 被新坐标 `com.mysql:mysql-connector-j` 取代。官方 release notes 将该变更定义为“Important Change”，并说明其目的为符合正确命名规范。从 8.0.31 开始，旧坐标可以通过 Maven relocation POM 指向新坐标；从 8.0.32 及以后版本，Spring Boot 官方 release notes 明确说明 MySQL JDBC Driver 只发布到 `com.mysql:mysql-connector-j`。本文基于 MySQL Connector/J 官方文档、release notes、MySQL release model 与 Spring Boot 官方 release notes，系统说明该变更的内容、影响范围、服务端版本关系、第三方框架升级注意点以及官方设计目的。

**关键词**：MySQL Connector/J；JDBC；Maven；Spring Boot；MySQL 8.0；MySQL 9.x；依赖坐标；Breaking Change

## 1 引言

Java 应用访问 MySQL Server 通常依赖 MySQL Connector/J。该驱动是 JDBC Type 4 driver，属于纯 Java 实现的 MySQL 协议客户端，不依赖本地 MySQL client libraries [1]。在 Maven 生态中，依赖坐标由 `groupId`、`artifactId` 和 `version` 共同确定。对于 JDBC 驱动而言，依赖坐标不仅影响编译和运行时 classpath，也影响 Spring Boot BOM、Gradle version catalog、企业内部依赖平台、Maven 插件和自动化依赖升级工具的解析结果。

MySQL Connector/J 在 8.0.30 及以前版本中常见 Maven 坐标为：

```xml id="vwdspo"
<dependency>
    <groupId>mysql</groupId>
    <artifactId>mysql-connector-java</artifactId>
    <version>8.0.30</version>
</dependency>
```

从 8.0.31 开始，官方推荐坐标变更为：

```xml id="q7vbjv"
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <version>8.0.31</version>
</dependency>
```

在 8.0.33、8.4.x、9.x 等后续版本中，项目应使用：

```xml id="3ngzqp"
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <version>9.x.x</version>
</dependency>
```

该变更发生在构建与依赖解析层面，不是 JDBC URL、JDBC Driver 类名或 MySQL Server 协议名称的变更。MySQL Connector/J 官方文档仍说明实现 `java.sql.Driver` 的类名为 `com.mysql.cj.jdbc.Driver` [2]。

## 2 MySQL Java 客户端的发展背景

MySQL Connector/J 是 MySQL 官方 Java 连接器。其功能定位包括：实现 JDBC API、支持 MySQL X DevAPI，并作为 Java 应用连接 MySQL Server 的客户端驱动 [1]。在 8.0 系列中，Connector/J 随 MySQL 8.0 生态共同演进；在 9.x 系列中，Connector/J 跟随 MySQL 新版本号体系进入 9.x 版本线。

MySQL 官方 release model 将 MySQL Server 发布模型划分为 LTS 与 Innovation 两条轨道。LTS 面向需要稳定特性集合和更长支持周期的环境；Innovation 面向需要获得最新功能、改进和变更的环境。官方同时说明，MySQL Connectors、MySQL Shell、MySQL Router 等产品使用最新版本号，但保持与受支持 MySQL Server 版本兼容 [8]。因此，Connector/J 9.x 的版本号并不表示只能连接 MySQL Server 9.x；当前 Connector/J 9.7 文档明确说明其支持 MySQL Server 8.0 and up [4]。

## 3 依赖坐标变更的版本边界

### 3.1 8.0.30 及以前：旧 Maven 坐标

在 8.0.30 及以前，Java 项目常使用如下依赖坐标：

```xml id="12licd"
<dependency>
    <groupId>mysql</groupId>
    <artifactId>mysql-connector-java</artifactId>
    <version>8.0.30</version>
</dependency>
```

该坐标的命名特点是：`groupId` 使用 `mysql`，`artifactId` 使用 `mysql-connector-java`。从命名含义看，该 artifact 名称保留了早期“Connector/J for Java”的历史表达方式；从 Maven 坐标规范化角度看，它没有使用更接近组织域名的 `com.mysql` groupId，也没有使用 Connector/J 官方产品名中的 `connector-j` 表达。

### 3.2 8.0.31：过渡版本

MySQL Connector/J 8.0.31 是该变更的明确起点。官方 release notes 将该变更列为 Important Change，并说明从该版本开始，为符合正确命名规范，Connector/J 的 Maven `groupId` 和 `artifactId` 变更为：

```text id="h9f6fk"
groupId:    com.mysql
artifactId: mysql-connector-j
```

官方同时说明，旧 `groupId` 和 `artifactId` 仍可用于链接 Connector/J library，但它们会指向 Maven relocation POM，并将用户重定向到新坐标；官方要求用户尽快切换到新坐标，因为旧坐标可能在任何时候停止使用且不另行通知 [3]。

因此，8.0.31 是新旧坐标同时存在的过渡点。旧坐标在该阶段仍可能通过 relocation 解析到新坐标，但旧坐标已经不再是规范坐标。

### 3.3 8.0.32 及以后：新坐标成为唯一发布坐标

Spring Boot 2.7 官方 release notes 对该变化给出了清晰的工程侧描述：8.0.31 同时发布到 `com.mysql:mysql-connector-j` 和 `mysql:mysql-connector-java`；8.0.32 及以后只发布到 `com.mysql:mysql-connector-j`；Spring Boot 2.7.8 升级到 MySQL Connector/J 8.0.32，因此使用 MySQL JDBC Driver 的项目在升级到 Spring Boot 2.7.8 及以后版本时需要同步更新坐标 [6]。

这说明该变更在 8.0.31 处表现为“迁移提醒”，在 8.0.32 及以后表现为“旧坐标无法继续代表新版本实体”。因此，对于 Maven 或 Gradle 构建而言，`mysql:mysql-connector-java:8.0.33` 这类写法不应作为新版本依赖声明。

### 3.4 8.4.x 与 9.x：延续新坐标

MySQL Connector/J 当前官方 Maven 安装文档声明，Connector/J 发布在 Maven Central 的坐标为：

```text id="x2ugke"
groupId:    com.mysql
artifactId: mysql-connector-j
```

官方文档给出的 Maven 示例也使用 `com.mysql:mysql-connector-j:x.y.z` [5]。因此，无论是 8.0.33、8.4.x，还是 9.x，规范写法均应使用新坐标。

## 4 版本变更做出的规范化调整

### 4.1 Maven 坐标规范化

本次变更的第一项规范是 Maven 坐标调整：

| 项目         | 旧规范                    | 新规范                 |
| ---------- | ---------------------- | ------------------- |
| groupId    | `mysql`                | `com.mysql`         |
| artifactId | `mysql-connector-java` | `mysql-connector-j` |
| 起点版本       | 8.0.30 及以前常见           | 8.0.31 开始           |
| 8.0.31 行为  | 旧坐标可 relocation        | 新坐标为推荐坐标            |
| 8.0.32+ 行为 | 不应继续声明旧坐标              | 使用新坐标               |
| 9.x 行为     | 不适用旧坐标                 | 使用新坐标               |

该规范将 Maven groupId 调整为更符合组织命名的 `com.mysql`，并将 artifactId 调整为与产品名称 Connector/J 更一致的 `mysql-connector-j`。

### 4.2 JAR 文件命名规范化

官方 8.0.31 release notes 说明，配合 Maven 坐标变化，Oracle 所有分发渠道中的 `.jar` library 也被重命名为 `mysql-connector-j-x.y.z`，并非只在 Maven 仓库中变化 [3]。因此，本次变更不仅是 POM 文件中的坐标变化，也影响二进制分发包中的 JAR 文件名称。

### 4.3 relocation 过渡机制

8.0.31 中旧坐标可通过 Maven relocation POM 重定向到新坐标。该机制的目的不是长期保留旧坐标，而是为已有项目提供迁移缓冲。官方 release notes 明确说明应尽快切换到新坐标，因为旧坐标可能随时停止使用且不另行通知 [3]。

### 4.4 依赖传递与 protobuf 处理

MySQL Connector/J 的 Maven 文档说明，当使用 Maven 管理依赖时，通常不需要显式声明 `protobuf-java`，因为它会通过依赖传递解析；若项目不使用 X DevAPI 功能，可以通过 exclusion 排除该子库 [5]。因此，升级 Connector/J 时除了坐标本身，也需要检查传递依赖变化，尤其是企业项目中常见的 Protobuf 版本冲突。

示例：

```xml id="jz0p55"
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <version>9.7.0</version>
    <exclusions>
        <exclusion>
            <groupId>com.google.protobuf</groupId>
            <artifactId>protobuf-java</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```

该排除方式只适用于不使用 X DevAPI 的场景。若项目使用 X DevAPI，则 `protobuf-java` 仍属于必要依赖。

## 5 第三方库升级时的影响范围

该变更影响的对象不是所有 Java 三方库，而是所有“直接声明、管理、传递或运行时加载 MySQL Connector/J”的构建与运行组件。

### 5.1 Spring Boot 依赖管理

Spring Boot 是最典型的影响对象。Spring Boot 2.7 release notes 已明确记录 MySQL JDBC Driver 坐标变化，并指出 Spring Boot 2.7.8 升级到 Connector/J 8.0.32，使用 MySQL JDBC Driver 的项目在升级 Spring Boot 2.7.8 及以后版本时需要更新坐标 [6]。

因此，以下场景需要检查：

```xml id="fa3dbx"
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <scope>runtime</scope>
</dependency>
```

在使用 `spring-boot-starter-parent` 或 `spring-boot-dependencies` BOM 的项目中，通常不需要显式写版本号，由 Spring Boot BOM 管理版本。但坐标必须使用新坐标。Spring Boot 2.7.x 和 3.0.x 的官方依赖版本页面均列出了 `com.mysql:mysql-connector-j`，而不是旧的 `mysql:mysql-connector-java` [6][7]。

### 5.2 Spring Cloud 与企业 BOM

Spring Cloud 本身通常不直接提供 MySQL JDBC Driver，但 Spring Cloud 项目通常与 Spring Boot BOM 联合使用。若企业内部父 POM、BOM 或 Gradle platform 仍管理旧坐标 `mysql:mysql-connector-java`，在升级 Spring Boot、Spring Cloud 或企业统一依赖平台时，可能出现版本管理缺失、依赖解析失败或 classpath 中缺少 MySQL Driver 的问题。

因此，企业 BOM 中应统一替换：

```xml id="0tvfza"
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.mysql</groupId>
            <artifactId>mysql-connector-j</artifactId>
            <version>8.0.33</version>
        </dependency>
    </dependencies>
</dependencyManagement>
```

### 5.3 ORM、SQL Mapper 与数据访问框架

Hibernate、JPA、MyBatis、MyBatis-Plus、jOOQ 等框架通常不直接内置 MySQL JDBC Driver。它们通过 JDBC、DataSource 或连接池访问数据库，实际驱动仍由应用工程提供。因此，升级这些框架时，如果同时升级 Spring Boot BOM、数据库访问 starter、企业父 POM 或运行时依赖集合，就需要检查 MySQL Connector/J 坐标是否已迁移。

需要检查的典型工程位置包括：

```text id="5102cc"
pom.xml
dependencyManagement
Gradle version catalog
company-parent-pom
database-starter
mybatis-starter
jpa-starter
internal-platform-bom
runtime image layer
```

### 5.4 连接池与数据源组件

HikariCP、Druid、Tomcat JDBC Pool、Apache Commons DBCP 等连接池负责创建连接和管理 DataSource，但 MySQL JDBC Driver 本身仍来自 classpath。坐标变更不会改变连接池 API，但会影响运行时是否存在 MySQL Driver JAR。若工程升级连接池或 Spring Boot starter 后同时调整依赖树，需要确认 `com.mysql:mysql-connector-j` 在运行时 classpath 中存在。

### 5.5 数据库迁移和数据库工具

Flyway、Liquibase、ShardingSphere-JDBC、Canal Adapter、Debezium Connector、测试环境中的 Testcontainers JDBC 场景、Maven Plugin 或 Gradle task 中的数据库迁移任务，都可能在运行时需要 MySQL JDBC Driver。它们未必直接声明 MySQL Connector/J，但只要工程需要通过 JDBC 连接 MySQL，就应检查构建脚本或插件 classpath 中是否仍使用旧坐标。

### 5.6 Connector/J 自身相关三方依赖

MySQL Connector/J 官方仓库说明，某些功能需要额外三方库：X DevAPI 需要 `protobuf-java`；OCI AIM authentication 需要 OCI Java SDK；默认 SLF4J 日志实现需要 `slf4j-api`；启用 OpenTelemetry native instrumentation 需要 OpenTelemetry API 和 SDK [1]。因此，升级 Connector/J 时除了 Maven 坐标，还应检查这些依赖是否与项目内已有版本冲突。

## 6 对应 MySQL Server 版本的关系

### 6.1 坐标变更不是由服务端版本触发

`mysql:mysql-connector-java` 到 `com.mysql:mysql-connector-j` 的变化是 MySQL Connector/J 的 Maven 坐标和分发命名变化，不是 MySQL Server 协议在某个版本中强制触发的变化。官方 8.0.31 release notes 表明该版本适用于 MySQL Server 8.0 和 5.7，同时在同一版本中引入 Maven 坐标变更 [3]。因此，不能把该问题简单理解为“从 MySQL Server 某个版本开始必须修改坐标”。

准确边界如下：

| 维度                       | 版本边界                          |
| ------------------------ | ----------------------------- |
| Connector/J 坐标变更起点       | Connector/J 8.0.31            |
| 旧坐标实际过渡                  | Connector/J 8.0.31 relocation |
| 旧坐标不再适合新版本               | Connector/J 8.0.32 及以后        |
| Connector/J 8.0.31 适配服务端 | MySQL Server 8.0 和 5.7        |
| Connector/J 9.7 适配服务端    | MySQL Server 8.0 and up       |

### 6.2 使用 Connector/J 8.0.31+ 时需要注意

如果项目仍连接 MySQL Server 5.7 或 8.0，但计划将 Connector/J 升级到 8.0.31 及以后，则需要注意 Maven 坐标迁移。此时服务端不一定变化，客户端依赖版本变化已经足以触发构建层面的迁移。

### 6.3 使用 Connector/J 9.x 时需要注意

当前 Connector/J 9.7 官方兼容性文档说明其支持 MySQL Server 8.0 and up，并要求 JRE 8 or higher [4]。因此，如果服务端仍是 MySQL 5.7，而项目希望升级到 Connector/J 9.x，则需要首先核对官方兼容性说明、测试认证结果和企业运行要求。对于 MySQL Server 8.0、8.4 LTS 和 9.x Innovation 场景，Connector/J 9.x 是官方新版本线的一部分。

### 6.4 MySQL 8.4 LTS 与 9.x Innovation 背景

MySQL 官方发布模型将 Server 划分为 LTS 与 Innovation。Innovation 版本包含新功能、行为变化、弃用功能移除和标准一致性调整，支持周期到下一个 Innovation release；LTS 版本面向稳定特性集合和长期支持 [8]。官方同时说明 Connectors 使用最新版本号并保持与受支持 MySQL Server 版本兼容 [8]。因此，9.x Connector/J 的出现属于 MySQL 新发布模型中的连接器版本线演进，而不是单独的 Java artifact 改名事件。

## 7 官方变更目的与意义

### 7.1 命名规范化

官方对 8.0.31 变更的直接解释是“to comply with proper naming guidelines”。因此，该 breaking change 的直接目的，是将 Connector/J 的 Maven 坐标和 JAR 文件命名调整到更规范的命名体系中 [3]。

新坐标体现了两个规范：

```text id="3591dl"
com.mysql            -> 组织命名空间
mysql-connector-j    -> 产品名称 Connector/J
```

相比旧坐标：

```text id="h3i7x7"
mysql
mysql-connector-java
```

新坐标更明确地表达了 Oracle/MySQL 官方组织命名空间和 Connector/J 产品名称。

### 7.2 分发渠道一致性

官方说明 JAR library 被重命名为 `mysql-connector-j-x.y.z`，并且该命名适用于 Oracle 的所有分发渠道，而不只是 Maven 仓库 [3]。这意味着本次变更不仅是 Maven Central 中的坐标调整，也是二进制分发命名的一致化。

### 7.3 依赖生态收敛

旧坐标通过 relocation POM 指向新坐标，属于迁移兼容机制。8.0.32 及以后只发布到新坐标后，依赖生态逐步收敛到 `com.mysql:mysql-connector-j`。这种收敛减少了同一个产品同时存在多个公开坐标带来的版本管理分歧，也使 BOM、starter、dependency management、Gradle version catalog 和制品扫描工具可以围绕同一坐标管理版本。

### 7.4 与 MySQL 版本模型一致

MySQL 9.x、8.4 LTS 和 Innovation/LTS 发布模型要求 Connectors 跟随新版本号体系演进，同时保持与受支持 MySQL Server 版本兼容 [8]。Connector/J 使用 `mysql-connector-j` 作为 artifactId，有助于在 Maven 坐标中保持产品名称与官方文档、release notes 和二进制分发名称一致。

## 8 工程迁移规范

### 8.1 直接依赖迁移

旧写法：

```xml id="1hudt3"
<dependency>
    <groupId>mysql</groupId>
    <artifactId>mysql-connector-java</artifactId>
    <version>8.0.30</version>
</dependency>
```

新写法：

```xml id="pnxfne"
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <version>8.0.33</version>
</dependency>
```

Spring Boot BOM 管理版本时：

```xml id="osj6mu"
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <scope>runtime</scope>
</dependency>
```

### 8.2 依赖管理迁移

旧写法：

```xml id="pt3ruh"
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>mysql</groupId>
            <artifactId>mysql-connector-java</artifactId>
            <version>8.0.30</version>
        </dependency>
    </dependencies>
</dependencyManagement>
```

新写法：

```xml id="cqyr3n"
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.mysql</groupId>
            <artifactId>mysql-connector-j</artifactId>
            <version>8.0.33</version>
        </dependency>
    </dependencies>
</dependencyManagement>
```

### 8.3 Gradle 迁移

旧写法：

```gradle id="vicsfr"
runtimeOnly "mysql:mysql-connector-java:8.0.30"
```

新写法：

```gradle id="2qf6qx"
runtimeOnly "com.mysql:mysql-connector-j:8.0.33"
```

使用 Spring Boot Gradle Plugin 管理版本时：

```gradle id="40y8c5"
runtimeOnly "com.mysql:mysql-connector-j"
```

### 8.4 Driver 类名检查

依赖坐标迁移不要求把 Driver 类名改成 artifactId。MySQL Connector/J 官方文档说明实现 `java.sql.Driver` 的类名是：

```properties id="bqe1py"
spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver
```

如果项目依赖 JDBC 4 自动注册，也可以不显式配置 driver class；但若已有配置，`com.mysql.cj.jdbc.Driver` 是当前官方文档给出的类名 [2]。

### 8.5 依赖树检查

迁移后应检查依赖树中是否同时出现旧坐标和新坐标。Maven 可使用：

```bash id="ymmyqv"
mvn dependency:tree -Dincludes=mysql:mysql-connector-java,com.mysql:mysql-connector-j
```

Gradle 可使用：

```bash id="m3ufh2"
./gradlew dependencies --configuration runtimeClasspath
```

若同时出现旧坐标和新坐标，应在直接依赖、BOM、starter 或企业父 POM 中统一到 `com.mysql:mysql-connector-j`。

## 9 讨论

该变更属于构建坐标层面的 breaking change，而不是 JDBC 编程模型层面的 breaking change。对于已经显式声明旧坐标且升级到 8.0.32 及以后版本的项目，Maven 或 Gradle 可能无法按预期解析依赖；对于通过 Spring Boot BOM 管理版本的项目，若坐标仍写旧 artifact，BOM 中的新坐标版本管理不会作用到旧坐标。Spring Boot 2.7.8 之后该问题尤其常见，因为其升级到 Connector/J 8.0.32，并在官方 release notes 中要求用户更新坐标 [6]。

该问题也不是单纯的 MySQL Server 升级问题。项目即使仍连接 MySQL Server 5.7 或 8.0，只要 Connector/J 客户端依赖升级到 8.0.31 及以后，就需要注意 Maven 坐标。反过来，项目升级 MySQL Server 到 8.4 LTS 或 9.x Innovation 时，通常也会同步升级 Connector/J；这时需要同时核对服务端兼容性、客户端依赖坐标、JRE 版本、传递依赖和连接配置。

## 10 结论

MySQL Connector/J 从 `mysql:mysql-connector-java` 到 `com.mysql:mysql-connector-j` 的变化，是官方从 8.0.31 开始实施的依赖坐标和 JAR 命名规范化。8.0.31 是过渡版本，旧坐标通过 relocation POM 指向新坐标；8.0.32 及以后应使用新坐标；8.4.x 与 9.x 均延续 `com.mysql:mysql-connector-j`。

该变更的直接目的，是符合官方命名规范，并使 Maven 坐标、产品名称和 JAR 分发命名保持一致。其工程影响主要集中在 Maven、Gradle、Spring Boot BOM、企业父 POM、数据库 starter、连接池、ORM、SQL Mapper、数据库迁移工具和运行时 classpath。对应服务端版本方面，该变更不是由某个 MySQL Server 版本直接触发；Connector/J 8.0.31 本身适用于 MySQL Server 8.0 和 5.7，而当前 Connector/J 9.7 支持 MySQL Server 8.0 and up。迁移时应以 Connector/J 客户端版本和依赖管理体系为主要检查对象。

## 参考文献

[1] MySQL Connector/J Developer Guide, Overview of MySQL Connector/J.
[2] MySQL Connector/J Developer Guide, Driver/Datasource Class Name.
[3] MySQL Connector/J Release Notes, Changes in MySQL Connector/J 8.0.31.
[4] MySQL Connector/J Developer Guide, Compatibility with MySQL and Java Versions.
[5] MySQL Connector/J Developer Guide, Installing Connector/J Using Maven.
[6] Spring Boot 2.7 Release Notes, MySQL JDBC Driver.
[7] Spring Boot Dependency Versions, Managed Dependency Coordinates.
[8] MySQL Reference Manual, MySQL Releases: Innovation and LTS.
