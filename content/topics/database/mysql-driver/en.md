# Research on the Evolution of MySQL Java Client Dependency Coordinates: From `mysql:mysql-connector-java` to `com.mysql:mysql-connector-j`

## Abstract

MySQL Connector/J is the official Java client driver provided by MySQL. It allows Java applications to communicate with MySQL Server through the JDBC API and also implements the MySQL X DevAPI. Around Maven dependency management in Java engineering, Connector/J introduced a dependency-coordinate normalization change starting in version 8.0.31: the old coordinate `mysql:mysql-connector-java` was replaced by the new coordinate `com.mysql:mysql-connector-j`. The official release notes define this change as an "Important Change" and state that its purpose is to comply with proper naming guidelines. Starting from 8.0.31, the old coordinate can point to the new coordinate through a Maven relocation POM. Starting from 8.0.32 and later, the official Spring Boot release notes explicitly state that the MySQL JDBC Driver is published only to `com.mysql:mysql-connector-j`. Based on the official MySQL Connector/J documentation, release notes, MySQL release model, and Spring Boot release notes, this article systematically explains the content of this change, its impact scope, server-version relationship, third-party framework upgrade considerations, and official design purpose.

**Keywords:** MySQL Connector/J; JDBC; Maven; Spring Boot; MySQL 8.0; MySQL 9.x; dependency coordinates; breaking change

## 1. Introduction

Java applications usually rely on MySQL Connector/J to access MySQL Server. This driver is a JDBC Type 4 driver, meaning it is a pure Java MySQL protocol client and does not depend on native MySQL client libraries [1]. In the Maven ecosystem, a dependency coordinate is jointly determined by `groupId`, `artifactId`, and `version`. For JDBC drivers, dependency coordinates affect not only compile-time and runtime classpaths, but also Spring Boot BOMs, Gradle version catalogs, internal enterprise dependency platforms, Maven plugins, and automated dependency upgrade tools.

In MySQL Connector/J 8.0.30 and earlier, the common Maven coordinate was:

```xml id="vwdspo"
<dependency>
    <groupId>mysql</groupId>
    <artifactId>mysql-connector-java</artifactId>
    <version>8.0.30</version>
</dependency>
```

Starting from 8.0.31, the officially recommended coordinate became:

```xml id="q7vbjv"
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <version>8.0.31</version>
</dependency>
```

In later versions such as 8.0.33, 8.4.x, and 9.x, projects should use:

```xml id="3ngzqp"
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <version>9.x.x</version>
</dependency>
```

This change occurs at the build and dependency-resolution layer. It is not a change to the JDBC URL, JDBC Driver class name, or MySQL Server protocol name. The official MySQL Connector/J documentation still states that the class implementing `java.sql.Driver` is `com.mysql.cj.jdbc.Driver` [2].

## 2. Background of the MySQL Java Client

MySQL Connector/J is the official Java connector for MySQL. Its functional positioning includes implementing the JDBC API, supporting MySQL X DevAPI, and serving as the client driver for Java applications connecting to MySQL Server [1]. In the 8.0 series, Connector/J evolved together with the MySQL 8.0 ecosystem. In the 9.x series, Connector/J entered the 9.x version line following MySQL's new versioning system.

The official MySQL release model divides MySQL Server releases into LTS and Innovation tracks. LTS is for environments that need a stable feature set and longer support lifecycle. Innovation is for environments that need the latest features, improvements, and changes. The official documentation also states that MySQL Connectors, MySQL Shell, MySQL Router, and similar products use the latest version numbers while maintaining compatibility with supported MySQL Server versions [8]. Therefore, the version number Connector/J 9.x does not mean that it can connect only to MySQL Server 9.x. The current Connector/J 9.7 documentation explicitly states that it supports MySQL Server 8.0 and up [4].

## 3. Version Boundary of the Dependency-Coordinate Change

### 3.1 8.0.30 and Earlier: Old Maven Coordinate

In 8.0.30 and earlier, Java projects commonly used the following dependency coordinate:

```xml id="12licd"
<dependency>
    <groupId>mysql</groupId>
    <artifactId>mysql-connector-java</artifactId>
    <version>8.0.30</version>
</dependency>
```

This coordinate has two naming characteristics: `groupId` uses `mysql`, and `artifactId` uses `mysql-connector-java`. From a naming perspective, the artifact name preserves the historical expression "Connector/J for Java". From the perspective of Maven coordinate normalization, it does not use the organization-domain-like `com.mysql` groupId, nor does it use the `connector-j` expression from the official Connector/J product name.

### 3.2 8.0.31: Transition Version

MySQL Connector/J 8.0.31 is the clear starting point of this change. The official release notes list this change as an Important Change and state that, starting from this version, to comply with proper naming guidelines, the Maven `groupId` and `artifactId` of Connector/J were changed to:

```text id="h9f6fk"
groupId:    com.mysql
artifactId: mysql-connector-j
```

The official release notes also state that the old `groupId` and `artifactId` can still be used to link the Connector/J library, but they point to a Maven relocation POM that redirects users to the new coordinate. The official notes require users to switch to the new coordinate as soon as possible because the old coordinate may stop being usable at any time without notice [3].

Therefore, 8.0.31 is the transition point where both old and new coordinates exist. At this stage, the old coordinate may still resolve to the new coordinate through relocation, but it is no longer the canonical coordinate.

### 3.3 8.0.32 and Later: New Coordinate Becomes the Only Published Coordinate

The Spring Boot 2.7 release notes give a clear engineering-side description of this change: 8.0.31 was published to both `com.mysql:mysql-connector-j` and `mysql:mysql-connector-java`; 8.0.32 and later are published only to `com.mysql:mysql-connector-j`; Spring Boot 2.7.8 upgraded to MySQL Connector/J 8.0.32, so projects using the MySQL JDBC Driver need to update the coordinate when upgrading to Spring Boot 2.7.8 or later [6].

This means the change appears as a migration reminder in 8.0.31, and as the old coordinate no longer representing new version artifacts in 8.0.32 and later. Therefore, for Maven or Gradle builds, declarations such as `mysql:mysql-connector-java:8.0.33` should not be used as new-version dependencies.

### 3.4 8.4.x and 9.x: Continuation of the New Coordinate

The current official Maven installation documentation for MySQL Connector/J states that Connector/J is published to Maven Central with the following coordinate:

```text id="x2ugke"
groupId:    com.mysql
artifactId: mysql-connector-j
```

The Maven example in the official documentation also uses `com.mysql:mysql-connector-j:x.y.z` [5]. Therefore, whether the version is 8.0.33, 8.4.x, or 9.x, the canonical declaration should use the new coordinate.

## 4. Normalization Changes Made by the Version Change

### 4.1 Maven Coordinate Normalization

The first normalization item is the Maven coordinate adjustment:

| Item | Old Convention | New Convention |
| --- | --- | --- |
| groupId | `mysql` | `com.mysql` |
| artifactId | `mysql-connector-java` | `mysql-connector-j` |
| Starting point | Common in 8.0.30 and earlier | Starting from 8.0.31 |
| 8.0.31 behavior | Old coordinate can relocate | New coordinate is recommended |
| 8.0.32+ behavior | Old coordinate should no longer be declared | Use new coordinate |
| 9.x behavior | Old coordinate is not applicable | Use new coordinate |

This specification adjusts the Maven groupId to `com.mysql`, which better matches organization naming, and changes the artifactId to `mysql-connector-j`, which is more consistent with the Connector/J product name.

### 4.2 JAR File Naming Normalization

The official 8.0.31 release notes state that, together with the Maven coordinate change, the `.jar` library in all Oracle distribution channels was renamed to `mysql-connector-j-x.y.z`, not only in the Maven repository [3]. Therefore, this change is not only a coordinate change in POM files. It also affects the JAR file name in binary distributions.

### 4.3 Relocation Transition Mechanism

In 8.0.31, the old coordinate can redirect to the new coordinate through a Maven relocation POM. This mechanism is not intended to preserve the old coordinate in the long term, but to provide a migration buffer for existing projects. The official release notes explicitly state that users should switch to the new coordinate as soon as possible because the old coordinate may stop being usable at any time without notice [3].

### 4.4 Transitive Dependencies and Protobuf Handling

The Maven documentation for MySQL Connector/J states that when Maven manages dependencies, `protobuf-java` usually does not need to be declared explicitly because it is resolved transitively. If the project does not use X DevAPI features, the dependency can be excluded through an exclusion [5]. Therefore, when upgrading Connector/J, projects should check not only the coordinate itself, but also transitive dependency changes, especially Protobuf version conflicts common in enterprise projects.

Example:

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

This exclusion applies only to scenarios that do not use X DevAPI. If the project uses X DevAPI, `protobuf-java` remains a required dependency.

## 5. Impact Scope When Upgrading Third-Party Libraries

This change does not affect every Java third-party library. It affects all build and runtime components that directly declare, manage, transitively introduce, or runtime-load MySQL Connector/J.

### 5.1 Spring Boot Dependency Management

Spring Boot is the most typical affected object. The Spring Boot 2.7 release notes clearly record the MySQL JDBC Driver coordinate change and state that Spring Boot 2.7.8 upgraded to Connector/J 8.0.32. Projects using the MySQL JDBC Driver need to update the coordinate when upgrading to Spring Boot 2.7.8 or later [6].

Therefore, the following dependency should be checked:

```xml id="fa3dbx"
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <scope>runtime</scope>
</dependency>
```

In projects using `spring-boot-starter-parent` or the `spring-boot-dependencies` BOM, the version number usually does not need to be written explicitly because it is managed by the Spring Boot BOM. However, the coordinate must use the new coordinate. The official dependency-version pages for Spring Boot 2.7.x and 3.0.x both list `com.mysql:mysql-connector-j`, not the old `mysql:mysql-connector-java` [6][7].

### 5.2 Spring Cloud and Enterprise BOMs

Spring Cloud itself usually does not directly provide the MySQL JDBC Driver, but Spring Cloud projects are commonly used together with the Spring Boot BOM. If an internal enterprise parent POM, BOM, or Gradle platform still manages the old coordinate `mysql:mysql-connector-java`, upgrading Spring Boot, Spring Cloud, or the enterprise dependency platform may cause missing version management, dependency resolution failures, or missing MySQL Driver on the classpath.

Therefore, enterprise BOMs should uniformly replace the dependency with:

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

### 5.3 ORM, SQL Mapper, and Data Access Frameworks

Frameworks such as Hibernate, JPA, MyBatis, MyBatis-Plus, and jOOQ usually do not embed the MySQL JDBC Driver directly. They access databases through JDBC, DataSource, or connection pools, while the actual driver is still provided by the application project. Therefore, when upgrading these frameworks, if the Spring Boot BOM, database access starter, enterprise parent POM, or runtime dependency set is upgraded at the same time, the MySQL Connector/J coordinate must be checked.

Typical engineering locations to check include:

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

### 5.4 Connection Pools and DataSource Components

Connection pools such as HikariCP, Druid, Tomcat JDBC Pool, and Apache Commons DBCP create connections and manage DataSource objects, but the MySQL JDBC Driver itself still comes from the classpath. The coordinate change does not change connection-pool APIs, but it affects whether the MySQL Driver JAR exists at runtime. If a project upgrades a connection pool or Spring Boot starter and adjusts the dependency tree at the same time, it should confirm that `com.mysql:mysql-connector-j` exists in the runtime classpath.

### 5.5 Database Migration and Database Tools

Flyway, Liquibase, ShardingSphere-JDBC, Canal Adapter, Debezium Connector, Testcontainers JDBC scenarios in test environments, Maven plugins, and Gradle tasks for database migration may all require the MySQL JDBC Driver at runtime. They may not directly declare MySQL Connector/J, but as long as a project needs to connect to MySQL through JDBC, the build script or plugin classpath should be checked for the old coordinate.

### 5.6 Third-Party Dependencies Related to Connector/J Itself

The official MySQL Connector/J repository states that some features require additional third-party libraries: X DevAPI requires `protobuf-java`; OCI AIM authentication requires the OCI Java SDK; the default SLF4J logging implementation requires `slf4j-api`; and OpenTelemetry native instrumentation requires OpenTelemetry API and SDK [1]. Therefore, when upgrading Connector/J, projects should check not only the Maven coordinate, but also whether these dependencies conflict with versions already present in the project.

## 6. Relationship with MySQL Server Versions

### 6.1 The Coordinate Change Is Not Triggered by a Server Version

The change from `mysql:mysql-connector-java` to `com.mysql:mysql-connector-j` is a Maven coordinate and distribution naming change in MySQL Connector/J. It is not a change forcibly triggered by a specific MySQL Server protocol version. The official 8.0.31 release notes state that this version applies to MySQL Server 8.0 and 5.7, and introduces the Maven coordinate change in the same version [3]. Therefore, this issue should not be simplified as "the coordinate must be changed starting from a certain MySQL Server version."

The accurate boundary is as follows:

| Dimension | Version Boundary |
| --- | --- |
| Starting point of Connector/J coordinate change | Connector/J 8.0.31 |
| Actual transition for old coordinate | Connector/J 8.0.31 relocation |
| Old coordinate no longer suitable for new versions | Connector/J 8.0.32 and later |
| Server support for Connector/J 8.0.31 | MySQL Server 8.0 and 5.7 |
| Server support for Connector/J 9.7 | MySQL Server 8.0 and up |

### 6.2 Considerations When Using Connector/J 8.0.31+

If a project still connects to MySQL Server 5.7 or 8.0 but plans to upgrade Connector/J to 8.0.31 or later, it must pay attention to Maven coordinate migration. The server does not necessarily change; the client dependency version change alone is enough to trigger build-layer migration.

### 6.3 Considerations When Using Connector/J 9.x

The current official compatibility documentation for Connector/J 9.7 states that it supports MySQL Server 8.0 and up and requires JRE 8 or higher [4]. Therefore, if the server is still MySQL 5.7 and the project wants to upgrade to Connector/J 9.x, it should first check official compatibility documentation, test certification results, and enterprise runtime requirements. For MySQL Server 8.0, 8.4 LTS, and 9.x Innovation scenarios, Connector/J 9.x is part of the official new version line.

### 6.4 MySQL 8.4 LTS and 9.x Innovation Background

The official MySQL release model divides Server releases into LTS and Innovation tracks. Innovation versions include new features, behavior changes, removal of deprecated features, and standards-alignment adjustments, with support lasting until the next Innovation release. LTS versions are for stable feature sets and long-term support [8]. The official documentation also states that Connectors use the latest version numbers while maintaining compatibility with supported MySQL Server versions [8]. Therefore, the appearance of 9.x Connector/J belongs to connector-version-line evolution under MySQL's new release model, not merely to a Java artifact rename event.

## 7. Official Purpose and Significance of the Change

### 7.1 Naming Normalization

The official direct explanation for the 8.0.31 change is "to comply with proper naming guidelines". Therefore, the direct purpose of this breaking change is to adjust the Maven coordinate and JAR file name of Connector/J into a more standardized naming system [3].

The new coordinate reflects two conventions:

```text id="3591dl"
com.mysql            -> organization namespace
mysql-connector-j    -> product name Connector/J
```

Compared with the old coordinate:

```text id="h3i7x7"
mysql
mysql-connector-java
```

The new coordinate more clearly expresses the Oracle/MySQL official organization namespace and the Connector/J product name.

### 7.2 Distribution Channel Consistency

The official release notes state that the JAR library was renamed to `mysql-connector-j-x.y.z`, and that this naming applies to all Oracle distribution channels, not only the Maven repository [3]. This means the change is not only a coordinate adjustment in Maven Central, but also a consistency change in binary distribution naming.

### 7.3 Dependency Ecosystem Convergence

The old coordinate points to the new coordinate through a relocation POM as a migration compatibility mechanism. After 8.0.32 and later are published only to the new coordinate, the dependency ecosystem gradually converges on `com.mysql:mysql-connector-j`. This convergence reduces version-management divergence caused by one product having multiple public coordinates, and it allows BOMs, starters, dependency management, Gradle version catalogs, and artifact scanning tools to manage versions around a single coordinate.

### 7.4 Alignment with the MySQL Version Model

The MySQL 9.x, 8.4 LTS, and Innovation/LTS release models require Connectors to evolve with the new version-numbering system while maintaining compatibility with supported MySQL Server versions [8]. Using `mysql-connector-j` as the artifactId helps keep the product name consistent across Maven coordinates, official documentation, release notes, and binary distribution names.

## 8. Engineering Migration Specification

### 8.1 Direct Dependency Migration

Old declaration:

```xml id="1hudt3"
<dependency>
    <groupId>mysql</groupId>
    <artifactId>mysql-connector-java</artifactId>
    <version>8.0.30</version>
</dependency>
```

New declaration:

```xml id="pnxfne"
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <version>8.0.33</version>
</dependency>
```

When Spring Boot BOM manages the version:

```xml id="osj6mu"
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <scope>runtime</scope>
</dependency>
```

### 8.2 Dependency Management Migration

Old declaration:

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

New declaration:

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

### 8.3 Gradle Migration

Old declaration:

```gradle id="vicsfr"
runtimeOnly "mysql:mysql-connector-java:8.0.30"
```

New declaration:

```gradle id="2qf6qx"
runtimeOnly "com.mysql:mysql-connector-j:8.0.33"
```

When the Spring Boot Gradle Plugin manages the version:

```gradle id="40y8c5"
runtimeOnly "com.mysql:mysql-connector-j"
```

### 8.4 Driver Class Name Check

Dependency-coordinate migration does not require changing the Driver class name to match the artifactId. The official MySQL Connector/J documentation states that the class implementing `java.sql.Driver` is:

```properties id="bqe1py"
spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver
```

If the project relies on JDBC 4 automatic registration, explicit driver-class configuration can also be omitted. However, if configuration already exists, `com.mysql.cj.jdbc.Driver` is the class name given by the current official documentation [2].

### 8.5 Dependency Tree Check

After migration, projects should check whether both old and new coordinates appear in the dependency tree. Maven can use:

```bash id="ymmyqv"
mvn dependency:tree -Dincludes=mysql:mysql-connector-java,com.mysql:mysql-connector-j
```

Gradle can use:

```bash id="m3ufh2"
./gradlew dependencies --configuration runtimeClasspath
```

If both old and new coordinates appear, direct dependencies, BOMs, starters, or enterprise parent POMs should be unified to `com.mysql:mysql-connector-j`.

## 9. Discussion

This change is a breaking change at the build-coordinate layer, not at the JDBC programming-model layer. For projects that explicitly declare the old coordinate and upgrade to 8.0.32 or later, Maven or Gradle may fail to resolve dependencies as expected. For projects managed by the Spring Boot BOM, if the coordinate still uses the old artifact, the version management for the new coordinate in the BOM will not apply to the old coordinate. This issue is especially common after Spring Boot 2.7.8 because it upgraded to Connector/J 8.0.32 and requires users to update the coordinate in the official release notes [6].

This issue is also not simply a MySQL Server upgrade issue. Even if a project still connects to MySQL Server 5.7 or 8.0, as long as the Connector/J client dependency is upgraded to 8.0.31 or later, the Maven coordinate must be considered. Conversely, when a project upgrades MySQL Server to 8.4 LTS or 9.x Innovation, it will usually upgrade Connector/J at the same time. In that case, it must check server compatibility, client dependency coordinates, JRE version, transitive dependencies, and connection configuration together.

## 10. Conclusion

The change in MySQL Connector/J from `mysql:mysql-connector-java` to `com.mysql:mysql-connector-j` is an official dependency-coordinate and JAR naming normalization introduced starting from 8.0.31. Version 8.0.31 is a transition version in which the old coordinate points to the new coordinate through a relocation POM. Version 8.0.32 and later should use the new coordinate. Versions 8.4.x and 9.x continue to use `com.mysql:mysql-connector-j`.

The direct purpose of this change is to comply with official naming guidelines and keep Maven coordinates, product names, and JAR distribution names consistent. Its engineering impact is mainly concentrated in Maven, Gradle, Spring Boot BOMs, enterprise parent POMs, database starters, connection pools, ORMs, SQL mappers, database migration tools, and runtime classpaths. Regarding server versions, this change is not directly triggered by a specific MySQL Server version. Connector/J 8.0.31 itself applies to MySQL Server 8.0 and 5.7, while the current Connector/J 9.7 supports MySQL Server 8.0 and up. During migration, the Connector/J client version and dependency management system should be the primary inspection targets.

## References

[1] MySQL Connector/J Developer Guide, Overview of MySQL Connector/J.
[2] MySQL Connector/J Developer Guide, Driver/Datasource Class Name.
[3] MySQL Connector/J Release Notes, Changes in MySQL Connector/J 8.0.31.
[4] MySQL Connector/J Developer Guide, Compatibility with MySQL and Java Versions.
[5] MySQL Connector/J Developer Guide, Installing Connector/J Using Maven.
[6] Spring Boot 2.7 Release Notes, MySQL JDBC Driver.
[7] Spring Boot Dependency Versions, Managed Dependency Coordinates.
[8] MySQL Reference Manual, MySQL Releases: Innovation and LTS.
