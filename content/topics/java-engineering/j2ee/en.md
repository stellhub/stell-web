# From J2EE to Jakarta EE: Evolution of the Enterprise Java Specification System, Namespace Migration, and Developer Impact

## Abstract

J2EE, Java EE, and Jakarta EE are different names and version forms of the same enterprise Java specification system under different governance stages. J2EE was originally built on top of J2SE, with the goal of providing a scalable, highly available, multi-tier enterprise application development model for internet and intranet applications. Its core mechanism was not to provide a single framework, but to define how enterprise Java applications and runtimes cooperate through a set of standard APIs, component models, container services, deployment models, and compatibility requirements. J2EE was later renamed Java EE and continued to evolve through Java EE 5, Java EE 6, Java EE 7, Java EE 8, and other versions around development simplification, web services, REST, JSON, Servlet, CDI, security, persistence, transactions, and related areas. After 2017, the Java EE specifications, reference implementations, and compatibility test system moved to the Eclipse Foundation and continued under the Jakarta EE name. Jakarta EE 9 introduced the namespace migration from `javax.*` to `jakarta.*`, which caused large-scale API package-name changes in Tomcat 10, Spring Framework 6, Spring Boot 3, Servlet 5.0, and later versions. This change was not an independent adjustment by a single framework. It was the result of Jakarta EE specification governance, trademarks, namespace ownership, and future evolution acting together.

**Keywords:** J2EE; Java EE; Jakarta EE; Servlet; Spring Boot 3; Tomcat 10; javax; jakarta

## 1. Introduction

The development of the enterprise Java specification system can be summarized into four stages: J2EE, Java EE, Eclipse transfer, and Jakarta EE. The J2EE stage established the componentized, multi-tier architecture and container-service model for enterprise applications. The Java EE stage retained standardization and compatibility goals while gradually introducing annotations, dependency injection, JPA, REST, JSON, WebSocket, Security API, and other capabilities. The Eclipse transfer stage changed specification governance. The Jakarta EE stage continues the maintenance and evolution of enterprise Java specifications under open governance.

This evolution is not merely a name change. For ordinary Java web developers, the most direct impact is concentrated in the namespace migration from `javax.*` to `jakarta.*`. For example, the common `javax.servlet.*` package from the Servlet 4.0 and Java EE 8 era migrated to `jakarta.servlet.*` after Jakarta Servlet 5.0 and Jakarta EE 9. Applications usually encounter this change when upgrading from Tomcat 9 to Tomcat 10, from Spring Boot 2.x to Spring Boot 3.x, from Spring Framework 5.3 to Spring Framework 6.x, or from Servlet 4.0 to Servlet 5.0 and later.

## 2. What J2EE Originally Defined and Why It Existed

J2EE, Java 2 Platform, Enterprise Edition, was originally a standard platform built on J2SE for enterprise application scenarios. It did not define a single library, but the overall development and runtime model for enterprise applications. Its content included an enterprise application model, component types, container model, standard services, deployment method, and compatibility requirements across implementations from different vendors.

In the J2EE/Java EE application model, applications are usually split into a web tier, business tier, client tier, and resource access tier. Capabilities such as Servlet, JSP, Enterprise JavaBeans, messaging, transactions, connectors, security, and JNDI are jointly handled by specifications and containers. Application developers organize business logic into components and deploy them into runtimes that support the specifications. The runtime provides foundational capabilities through containers, including lifecycle management, security, transactions, resource pooling, JNDI lookup, remote communication, and persistence access. [1][2]

The problem J2EE aimed to solve was the repeated low-level complexity in enterprise application development. Multi-tier applications usually need to handle transaction boundaries, state management, concurrency, multithreading, resource pools, database connections, permissions, security constraints, remote calls, and deployment differences. The J2EE platform model moved these common concerns into containers and standard services, allowing developers to focus mainly on business logic, user interfaces, and application components. [1][2]

Therefore, the main role of J2EE can be summarized in three points. First, it provided a standardized development model for enterprise Java applications. Second, it provided implementation specifications for application servers and web containers, allowing runtimes from different vendors to build products around the same APIs and compatibility tests. Third, it reduced repeated implementation costs around transactions, security, resource management, and lifecycle management through container services.

## 3. Why J2EE Evolved into Java EE

J2EE was later renamed Java EE and went through multiple rounds of specification changes. The reasons mainly came from the evolution of the Java platform itself, changes in enterprise application development methods, changes in web technologies, development-efficiency requirements, and cloud-native runtime environments.

Java EE 5 was a key turning point. The Java EE 5 platform specification in the JCP explains that Java EE 5 extended J2EE 1.4, was based on J2SE 5.0, and used the annotation capability from JSR-175 to significantly simplify Java EE application development. This version involved related specifications such as EJB 3.0, JAX-WS, JAXB, JSF, and JSTL. [3][4] These changes showed that the enterprise Java specification system was moving away from early heavy XML configuration and heavyweight component models toward annotation-based, POJO-based, and easier-to-use development methods.

Java EE 6 and later versions continued to evolve around Web Profile, CDI, Bean Validation, JAX-RS, JPA, Servlet, JMS, and related areas. Java EE 8 further added Servlet 4.0 support for HTTP/2, JSON-B, JAX-RS Reactive Client, Server-Sent Events, asynchronous CDI Events, and a new Security API. [3] These changes reflect the specification system's continuous absorption of enterprise application needs around web, REST, JSON, security, and asynchronous processing.

Therefore, the change from J2EE to Java EE was not a single refactoring. It was a continuous adjustment of the enterprise Java standard across different eras in response to development models, web protocols, data exchange formats, security models, component models, and runtime requirements.

## 4. Java EE Transfer to the Eclipse Foundation and the Formation of Jakarta EE

In 2017, Oracle, IBM, and Red Hat promoted the migration of Java EE to the Eclipse Foundation. The official Eclipse Foundation announcement stated that after Java EE moved to the Eclipse Foundation, it would continue to evolve toward a more open and collaborative development model. [5] This migration included specification projects, reference implementations, and the Technology Compatibility Kit, or TCK. The TCK is an important part of specification compatibility verification and determines whether an implementation can claim compatibility with a specific specification version.

After the migration was completed, Java EE continued under the Eclipse Foundation as Jakarta EE. Jakarta EE 8 was released in 2019 and remained compatible with Java EE 8, still using the `javax.*` namespace. Jakarta EE 9 was then released in 2020, with the core goal of completing the namespace migration from `javax.*` to `jakarta.*`. [6][7][8]

The key change at this stage was not a large-scale functional rewrite of the application programming model itself, but a change in specification governance, trademark usage, namespace ownership, and future evolution path. Because the Eclipse Foundation and Oracle could not reach an agreement that allowed the Jakarta EE community to continue evolving the `javax` namespace and continue using Java EE-related trademarks, official Eclipse explanations clearly state that the Jakarta EE community cannot modify the `javax` package namespace and cannot use related Java trademarks in Jakarta EE specifications. [6]

## 5. The Breaking Change from `javax.*` to `jakarta.*`

The Jakarta EE 9 release plan explicitly listed migration from the `javax` namespace to the `jakarta` namespace as a key goal. [8] This means that a group of API package names belonging to the Java EE/Jakarta EE specification system changed. For example:

| Java EE / Jakarta EE 8 and Earlier | Jakarta EE 9 and Later |
| --- | --- |
| `javax.servlet.*` | `jakarta.servlet.*` |
| `javax.servlet.jsp.*` | `jakarta.servlet.jsp.*` |
| `javax.el.*` | `jakarta.el.*` |
| `javax.websocket.*` | `jakarta.websocket.*` |
| `javax.persistence.*` | `jakarta.persistence.*` |
| `javax.validation.*` | `jakarta.validation.*` |
| `javax.annotation.*` | `jakarta.annotation.*` |
| `javax.inject.*` | `jakarta.inject.*` |
| `javax.transaction.*` | `jakarta.transaction.*` |
| `javax.jms.*` | `jakarta.jms.*` |

This change is a breaking change at both source compatibility and binary compatibility levels. Application code, third-party dependencies, compile dependencies, runtime containers, plugins, test frameworks, bytecode enhancement tools, JSP, TLD, configuration files, and string constants may all be affected if they reference related Java EE API package names.

It is important to note that not all `javax.*` packages migrated to `jakarta.*`. Only `javax.*` packages that belong to the Java EE / Jakarta EE specification system migrated. JDK-provided packages such as `javax.crypto`, `javax.net`, `javax.sql`, and `javax.xml` do not migrate uniformly to `jakarta.*` because of Jakarta EE 9. [13]

## 6. Which Upgrades Encounter the `javax` to `jakarta` Migration

In ordinary Java web projects, the following upgrade paths are most likely to trigger namespace migration.

| Upgrade Scenario | Typical Change | Impact Scope |
| --- | --- | --- |
| Tomcat 9 to Tomcat 10.0 | Tomcat 10.0 supports Jakarta Servlet 5.0, Jakarta Pages 3.0, Jakarta EL 4.0, Jakarta WebSocket 2.0, and related specifications; specification API packages changed from `javax.*` to `jakarta.*` | Servlet, JSP, EL, WebSocket, and Authentication-related code must be recompiled and migrated |
| Tomcat 10.0 to Tomcat 10.1 | Tomcat 10.1 supports Jakarta Servlet 6.0, Pages 3.1, EL 5.0, WebSocket 2.1, Authentication 3.0; Java baseline becomes Java 11 | Mainly a Jakarta EE 10 specification upgrade; namespace is already `jakarta.*` |
| Tomcat 10.1 to Tomcat 11 | Tomcat 11 supports Jakarta Servlet 6.1, Pages 4.0, EL 6.0, WebSocket 2.2, Authentication 3.1, Annotations 3.0; Java baseline becomes Java 17 | Mainly a Jakarta EE 11 specification upgrade, plus removal of old mechanisms such as SecurityManager |
| Spring Framework 5.3 to Spring Framework 6.x | Spring Framework 6 raises minimum requirements to Java 17+ and Jakarta EE 9+ | Import paths related to Servlet, JPA, Bean Validation, Annotation, Inject, and similar APIs change |
| Spring Boot 2.x to Spring Boot 3.x | Spring Boot 3 is based on Spring Framework 6 and upgrades Jakarta EE specifications to versions included in Jakarta EE 10, such as Servlet 6.0 and JPA 3.1 | Application code, dependency management, starters, third-party libraries, and test dependencies all need inspection |
| Servlet 4.0 to Servlet 5.0 | The Jakarta Servlet 5.0 specification states that the migration relative to Servlet 4.0 is mainly a namespace change | `javax.servlet.*` changes to `jakarta.servlet.*`; applications must be recompiled against the new API |
| JPA 2.2 to Jakarta Persistence 3.x | `javax.persistence.*` changes to `jakarta.persistence.*` | Entity, Repository, ORM provider, and Hibernate/EclipseLink versions need to align |
| Bean Validation 2.x to Jakarta Validation 3.x | `javax.validation.*` changes to `jakarta.validation.*` | DTO validation, parameter validation, custom constraints, and Hibernate Validator versions need to align |

The official Tomcat migration guide clearly states that there are significant breaking changes between Tomcat 9.0.x and Tomcat 10.0.x. The Java packages used by specification APIs changed from `javax...` to `jakarta...`, and web applications must be recompiled against the new APIs. [9] The official Spring Boot 3.0 migration guide also explains that when Spring Boot 3 depends on Jakarta EE specifications, it upgrades to versions included in Jakarta EE 10. It also requires developers to avoid direct or transitive use of old Java EE dependencies, such as using `jakarta.servlet:jakarta.servlet-api` instead of `javax.servlet:javax.servlet-api`. [10]

## 7. Why the Breaking Change Happened and What It Means

The breaking change from `javax.*` to `jakarta.*` mainly came from Jakarta EE's governance migration and namespace restrictions. Official Eclipse Foundation explanations state that Eclipse and Oracle could not reach an agreement allowing the Jakarta EE community to modify the `javax` namespace or use Java EE-related trademarks. Therefore, the `javax` namespace can only be used as-is and cannot continue evolving under the Jakarta EE community. [6]

Under this constraint, Jakarta EE 9 chose to complete the namespace migration in one step. The Jakarta EE 9 release plan listed namespace migration as a key goal. Official Jakarta material also explains that Jakarta EE 8 still used `javax.*`, while Jakarta EE 9 introduced `jakarta.*` as the replacement namespace. [7][8]

This breaking change produced three direct results.

First, Jakarta EE specifications obtained a new namespace that can continue evolving. Since `javax` could no longer be modified, later specification versions needed to develop under the `jakarta` namespace.

Second, the ecosystem formed a clear version boundary. Java EE 8 / Jakarta EE 8 and earlier mainly use `javax.*`; Jakarta EE 9 and later use `jakarta.*`. Upgrade differences between Tomcat 9 and Tomcat 10, Spring Boot 2 and Spring Boot 3, and Spring Framework 5.3 and Spring Framework 6 can all be understood under this boundary.

Third, application migration changed from simply replacing dependencies into full-chain compatibility inspection. Developers not only need to modify imports, but also need to inspect whether the runtime container, ORM, validation framework, template engine, security framework, test framework, auto-configuration, Maven/Gradle dependency tree, and indirect dependencies already support Jakarta EE 9 or later.

## 8. Current Development Status and Future Direction

As of June 2026, the official Jakarta EE release page shows that Jakarta EE 11 was released on June 26, 2025, and Jakarta EE 12 is under development. [14] Official Jakarta EE 11 material emphasizes developer productivity, TCK modernization, alignment with Java 21, the new Jakarta Data specification, and updates to multiple existing specifications. [15] Jakarta EE 11 includes three levels: Platform, Web Profile, and Core Profile. It covers Servlet 6.1, Persistence 3.2, CDI 4.1, Validation 3.1, Security 4.0, RESTful Web Services 4.0, JSON Processing 2.1, JSON Binding 3.0, and related specifications. [15][16]

The official Jakarta EE 12 page shows that this version is still under development. Its stated goal is enterprise Java for reliable, flexible applications, supporting modularity, interoperability, and architectural choice. Its public page lists proposed or candidate updates such as Query 1.0, Data 1.1, Persistence 4.0, CDI 5.0, Servlet 6.2, RESTful Web Services 5.0, JSON Processing 2.2, and JSON Binding 3.1. [17]

Therefore, Jakarta EE's current direction can be summarized from official material as: continue maintaining the enterprise Java standard platform; structure it around Platform, Web Profile, and Core Profile; strengthen TCK and compatibility; align with newer Java LTS versions; and continue updating specifications related to web, REST, persistence, dependency injection, validation, security, JSON, and data access.

## 9. Specifications and Issues Ordinary Developers Should Watch

For ordinary Java backend developers, the Jakarta EE specifications most often encountered are not every specification in the full Platform, but those related to web applications, data access, validation, dependency injection, and security.

| Specification | Typical Touchpoints in Ordinary Projects |
| --- | --- |
| Jakarta Servlet | Spring MVC, Filter, Interceptor, Servlet containers, Tomcat, Jetty, Undertow |
| Jakarta Persistence | JPA, Hibernate, EclipseLink, Entity, Repository, transaction persistence |
| Jakarta Validation | DTO parameter validation, `@NotNull`, `@Size`, custom validation annotations |
| Jakarta Annotations | `@PostConstruct`, `@PreDestroy`, resource injection annotations |
| Jakarta Dependency Injection | `jakarta.inject.Inject`, standard dependency injection annotations |
| Jakarta Contexts and Dependency Injection | CDI containers, context lifecycle, dependency injection model |
| Jakarta RESTful Web Services | JAX-RS, REST API standard implementations, MicroProfile-related runtimes |
| Jakarta JSON Processing / JSON Binding | JSON-P, JSON-B, standard JSON processing |
| Jakarta WebSocket | Server-side and client-side WebSocket APIs |
| Jakarta Security / Authentication | Standard security APIs, authentication, authorization, container security mechanisms |
| Jakarta Transactions | JTA, cross-resource transactions, container transaction boundaries |
| Jakarta Mail | Mail sending and MIME message processing |

In upgrade practice, the following issues need special attention.

First, do not only replace imports. The change from `javax.servlet` to `jakarta.servlet` must match the Servlet API dependency, runtime container, and framework version at the same time. When using Tomcat 10, if the application still depends on `javax.servlet-api`, it cannot compile and run normally as a Jakarta Servlet 5+ application.

Second, do not mix Java EE and Jakarta EE APIs. Spring's migration guide states that Java EE and Jakarta EE APIs generally cannot be mixed in the same project. Application code and third-party libraries need to be unified on `jakarta.*` package imports. [10]

Third, inspect transitive dependencies. Even if application code has already migrated, old third-party libraries may still transitively introduce `javax.servlet-api`, `javax.persistence-api`, `validation-api`, old Hibernate Validator, old Hibernate ORM, or old JAX-RS implementations.

Fourth, distinguish Java EE `javax.*` from JDK `javax.*`. JDK standard packages such as `javax.sql`, `javax.crypto`, and `javax.net` are not part of the Jakarta EE migration scope and should not be mechanically replaced.

Fifth, pay attention to runtime baselines. Spring Boot 3 requires Java 17 or later and is based on Spring Framework 6. Spring Framework 6 has minimum requirements of Java 17+ and Jakarta EE 9+. Tomcat 10.1 requires Java 11+. Tomcat 11 requires Java 17+. Upgrading the Jakarta EE namespace is usually accompanied by major-version upgrades of the JDK, application server, and framework.

Sixth, pay attention to test code, mocks, Filter, Listener, Servlet API types, JSP/TLD, XML configuration, reflection strings, and bytecode enhancement tools. Package-name migration does not only occur in Java source imports. It may also appear in configuration files, template files, test tools, and runtime scanning logic.

## 10. Conclusion

J2EE originally defined the standard platform model for enterprise Java applications. Its core role was to solve the complexity of transactions, security, resource management, lifecycle management, and multi-tier architecture in enterprise application development through components, containers, standard services, and compatibility requirements. The Java EE stage continued and expanded this system, adapting to new development needs through annotations, a simplified programming model, REST, JSON, Servlet, security, persistence, and other specification updates. After 2017, Java EE was transferred to the Eclipse Foundation and continued under the Jakarta EE name. Due to trademark and namespace restrictions, Jakarta EE 9 introduced the migration from `javax.*` to `jakarta.*`, forming an important version boundary in the enterprise Java ecosystem.

Developers encounter this namespace change when upgrading from Tomcat 9 to Tomcat 10, Spring Boot 2 to Spring Boot 3, Spring Framework 5 to Spring Framework 6, Servlet 4 to Servlet 5, and related JPA, Validation, JAX-RS, and CDI specification versions. Handling this change covers source code, dependencies, containers, third-party libraries, test code, and configuration files. Jakarta EE 11 has now been released, Jakarta EE 12 is under development, and the enterprise Java specification system continues to evolve around standardization, compatibility, cloud-native runtime environments, modern Java LTS releases, and core enterprise APIs.

## References

[1] Oracle. Java 2 Platform, Enterprise Edition Overview.
[2] Oracle. The Java EE 5 Tutorial: Java EE Containers and Container Services.
[3] Oracle. Java Platform, Enterprise Edition at a Glance.
[4] JCP. JSR 244: Java Platform, Enterprise Edition 5 Specification.
[5] Eclipse Foundation. Java EE Moves to the Eclipse Foundation.
[6] Eclipse Foundation. Update on Jakarta EE Rights to Java Trademarks.
[7] Jakarta EE. Javax to Jakarta Namespace Ecosystem Progress.
[8] Jakarta EE Platform Project. Jakarta EE 9 Release Plan.
[9] Apache Tomcat. Migration Guide - Tomcat 10.0.x.
[10] Spring. Spring Boot 3.0 Migration Guide.
[11] Jakarta EE. Jakarta Servlet Specification 5.0.
[12] Spring. Spring Framework 6.0 Release Notes.
[13] Apache Tomcat. Tomcat Migration Tool for Jakarta EE.
[14] Jakarta EE. Jakarta EE Release Versions.
[15] Eclipse Foundation / Jakarta EE. Jakarta EE 11 Release Materials.
[16] Jakarta EE. Jakarta EE Specifications.
[17] Jakarta EE. Jakarta EE 12 Release Materials.
