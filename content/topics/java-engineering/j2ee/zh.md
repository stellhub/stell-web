# 从 J2EE 到 Jakarta EE：企业级 Java 规范体系的演进、命名空间迁移与开发者影响

## 摘要

J2EE、Java EE 与 Jakarta EE 是同一条企业级 Java 规范体系在不同治理阶段下的名称与版本形态。J2EE 最初建立在 J2SE 之上，目标是为互联网和企业内部网应用提供可扩展、高可用的多层企业应用开发模型。其核心机制不是提供单个框架，而是通过一组标准 API、组件模型、容器服务、部署模型和兼容性要求，规定企业级 Java 应用及其运行时之间的协作方式。随后，J2EE 更名为 Java EE，并在 Java EE 5、Java EE 6、Java EE 7、Java EE 8 等版本中围绕开发简化、Web 服务、REST、JSON、Servlet、CDI、安全、持久化和事务等方面持续演进。2017 年后，Java EE 的规范、参考实现和兼容性测试体系迁移至 Eclipse Foundation，并以 Jakarta EE 的名称继续发展。Jakarta EE 9 引入从 `javax.*` 到 `jakarta.*` 的命名空间迁移，由此导致 Tomcat 10、Spring Framework 6、Spring Boot 3、Servlet 5.0 及后续版本中的大量 API 包名变化。该变化不是单个框架的独立调整，而是 Jakarta EE 规范体系治理、商标、命名空间和未来演进共同作用的结果。

**关键词：** J2EE；Java EE；Jakarta EE；Servlet；Spring Boot 3；Tomcat 10；javax；jakarta

## 1. 引言

企业级 Java 规范体系的发展可以概括为四个阶段：J2EE、Java EE、Eclipse 移交、Jakarta EE。J2EE 阶段确立了企业应用的组件化、多层架构和容器服务模型；Java EE 阶段在保留标准化和兼容性目标的基础上，逐步引入注解、依赖注入、JPA、REST、JSON、WebSocket、安全 API 等能力；Eclipse 移交阶段改变了规范治理方式；Jakarta EE 阶段则在开放治理基础上继续推进企业级 Java 规范的维护和演进。

这一演进并非单纯的名称变化。对普通 Java Web 开发者而言，最直接的影响集中在 `javax.*` 到 `jakarta.*` 的命名空间迁移。例如，Servlet 4.0 及 Java EE 8 时代常见的 `javax.servlet.*`，在 Jakarta Servlet 5.0 及 Jakarta EE 9 之后迁移为 `jakarta.servlet.*`。当应用从 Tomcat 9 升级到 Tomcat 10，从 Spring Boot 2.x 升级到 Spring Boot 3.x，从 Spring Framework 5.3 升级到 Spring Framework 6.x，或者从 Servlet 4.0 升级到 Servlet 5.0 及以上时，通常会遇到这一变化。

## 2. J2EE 最初定义的内容与作用

J2EE，即 Java 2 Platform, Enterprise Edition，最初是在 J2SE 基础上面向企业级应用场景建立的标准平台。它定义的对象不是单一类库，而是企业应用的整体开发和运行模型。其内容包括企业应用模型、组件类型、容器模型、标准服务、部署方式以及不同厂商实现之间的兼容性要求。

在 J2EE/Java EE 的应用模型中，应用通常被拆分为 Web 层、业务层、客户端层和资源访问层。Servlet、JSP、Enterprise JavaBeans、消息、事务、连接器、安全、JNDI 等能力由规范和容器共同承担。应用开发者将业务逻辑组织成组件，并部署到支持规范的运行时中；运行时通过容器提供生命周期管理、安全、事务、资源池化、JNDI 查找、远程通信、持久化访问等基础能力。[1][2]

J2EE 出现时要解决的问题，是企业应用开发中重复存在的底层复杂性。多层应用通常需要处理事务边界、状态管理、并发、多线程、资源池、数据库连接、权限、安全约束、远程调用和部署差异。J2EE 的平台模型将这些通用问题下沉到容器和标准服务中，使开发者主要关注业务逻辑、用户界面和应用组件本身。[1][2]

因此，J2EE 的主要作用可以归纳为三点。第一，它为企业级 Java 应用提供标准化开发模型。第二，它为应用服务器和 Web 容器提供实现规范，使不同厂商运行时可以围绕同一组 API 和兼容性测试实现产品。第三，它通过容器服务降低企业应用在事务、安全、资源管理、生命周期管理上的重复实现成本。

## 3. 从 J2EE 到 Java EE 的演进原因

J2EE 后来更名为 Java EE，并经历多轮规范改动，原因主要来自 Java 平台自身版本演进、企业应用开发方式变化、Web 技术变化、开发效率要求变化以及云原生运行环境变化。

Java EE 5 是一个关键转折点。JCP 中的 Java EE 5 平台规范说明，Java EE 5 扩展自 J2EE 1.4，并基于 J2SE 5.0，利用 JSR-175 注解能力使 Java EE 应用开发显著简化。该版本涉及 EJB 3.0、JAX-WS、JAXB、JSF、JSTL 等相关规范。[3][4] 这一阶段的变化表明，企业级 Java 规范从早期大量 XML 配置和重量级组件模型，逐步转向注解化、POJO 化和更易用的开发方式。

Java EE 6 及后续版本继续在 Web Profile、CDI、Bean Validation、JAX-RS、JPA、Servlet、JMS 等方向演进。Java EE 8 进一步加入 Servlet 4.0 对 HTTP/2 的支持、JSON-B、JAX-RS Reactive Client、Server-Sent Events、异步 CDI Events 和新的 Security API 等内容。[3] 这些改动反映了规范体系对 Web、REST、JSON、安全和异步处理等企业应用需求的持续吸收。

因此，J2EE 到 Java EE 的改动不是单点重构，而是企业级 Java 标准在不同时代对开发模型、Web 协议、数据交换格式、安全模型、组件模型和运行时要求的连续调整。

## 4. Java EE 移交 Eclipse Foundation 与 Jakarta EE 的形成

2017 年，Oracle、IBM 和 Red Hat 推动 Java EE 迁移至 Eclipse Foundation。Eclipse Foundation 官方公告说明，Java EE 迁移至 Eclipse Foundation 后，将面向更开放、协作式的开发模型继续发展。[5] 这次迁移包含规范项目、参考实现和 Technology Compatibility Kit，即 TCK。TCK 是规范兼容性验证的重要组成部分，决定某个实现是否能够声明与特定规范版本兼容。

迁移完成后，Java EE 在 Eclipse Foundation 下以 Jakarta EE 的名称继续发展。Jakarta EE 8 于 2019 年发布，并保持与 Java EE 8 的兼容性，仍使用 `javax.*` 命名空间。随后，Jakarta EE 9 在 2020 年发布，其核心目标是完成从 `javax.*` 到 `jakarta.*` 的命名空间迁移。[6][7][8]

该阶段的关键变化不在于应用编程模型本身发生大规模功能重写，而在于规范治理主体、商标使用、命名空间所有权和未来演进路径发生变化。由于 Eclipse Foundation 与 Oracle 未能达成允许 Jakarta EE 社区继续演进 `javax` 命名空间和继续使用 Java EE 相关商标的协议，Eclipse 官方说明中明确指出，Jakarta EE 社区不能修改 `javax` 包命名空间，也不能在 Jakarta EE 规范中使用相关 Java 商标。[6]

## 5. `javax.*` 到 `jakarta.*` 的破坏性变更

Jakarta EE 9 的发布计划明确将从 `javax` 命名空间迁移到 `jakarta` 命名空间作为关键目标。[8] 这意味着原属于 Java EE/Jakarta EE 规范体系的一批 API 包名发生变化。例如：

| Java EE / Jakarta EE 8 及以前 | Jakarta EE 9 及以后        |
| -------------------------- | ----------------------- |
| `javax.servlet.*`          | `jakarta.servlet.*`     |
| `javax.servlet.jsp.*`      | `jakarta.servlet.jsp.*` |
| `javax.el.*`               | `jakarta.el.*`          |
| `javax.websocket.*`        | `jakarta.websocket.*`   |
| `javax.persistence.*`      | `jakarta.persistence.*` |
| `javax.validation.*`       | `jakarta.validation.*`  |
| `javax.annotation.*`       | `jakarta.annotation.*`  |
| `javax.inject.*`           | `jakarta.inject.*`      |
| `javax.transaction.*`      | `jakarta.transaction.*` |
| `javax.jms.*`              | `jakarta.jms.*`         |

这一变化属于源码兼容性和二进制兼容性层面的破坏性变更。应用代码、第三方依赖、编译依赖、运行时容器、插件、测试框架、字节码增强工具、JSP、TLD、配置文件以及字符串常量中只要引用了相关 Java EE API 包名，都可能受到影响。

需要注意的是，并不是所有 `javax.*` 包都迁移为 `jakarta.*`。只有属于 Java EE / Jakarta EE 规范体系的 `javax.*` 包发生迁移。JDK 自身提供的 `javax.crypto`、`javax.net`、`javax.sql`、`javax.xml` 等并不因为 Jakarta EE 9 而统一迁移为 `jakarta.*`。[13]

## 6. 哪些升级会遇到 `javax` 到 `jakarta` 的迁移

在普通 Java Web 项目中，以下升级路径最容易触发命名空间迁移。

| 升级场景                                         | 典型变化                                                                                                                              | 影响范围                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Tomcat 9 → Tomcat 10.0                       | Tomcat 10.0 支持 Jakarta Servlet 5.0、Jakarta Pages 3.0、Jakarta EL 4.0、Jakarta WebSocket 2.0 等规范；规范 API 包名从 `javax.*` 改为 `jakarta.*` | Servlet、JSP、EL、WebSocket、Authentication 相关代码需要重编译和包名迁移      |
| Tomcat 10.0 → Tomcat 10.1                    | Tomcat 10.1 支持 Jakarta Servlet 6.0、Pages 3.1、EL 5.0、WebSocket 2.1、Authentication 3.0；Java 基线升级为 Java 11                           | 主要是 Jakarta EE 10 规范级升级，命名空间已是 `jakarta.*`                  |
| Tomcat 10.1 → Tomcat 11                      | Tomcat 11 支持 Jakarta Servlet 6.1、Pages 4.0、EL 6.0、WebSocket 2.2、Authentication 3.1、Annotations 3.0；Java 基线升级为 Java 17             | 主要是 Jakarta EE 11 规范级升级，以及 SecurityManager 等旧机制移除           |
| Spring Framework 5.3 → Spring Framework 6.x  | Spring Framework 6 将最低要求提升为 Java 17+ 和 Jakarta EE 9+                                                                              | Servlet、JPA、Bean Validation、Annotation、Inject 等相关导入路径变化     |
| Spring Boot 2.x → Spring Boot 3.x            | Spring Boot 3 基于 Spring Framework 6，并在依赖 Jakarta EE 规范时升级至 Jakarta EE 10 中包含的版本，例如 Servlet 6.0 和 JPA 3.1                          | 应用代码、依赖管理、Starter、第三方库、测试依赖都需要检查                            |
| Servlet 4.0 → Servlet 5.0                    | Jakarta Servlet 5.0 规范说明，相对 Servlet 4.0 的迁移主要是命名空间变化                                                                              | `javax.servlet.*` 改为 `jakarta.servlet.*`，应用需要基于新 API 重新编译   |
| JPA 2.2 → Jakarta Persistence 3.x            | `javax.persistence.*` 改为 `jakarta.persistence.*`                                                                                  | Entity、Repository、ORM Provider、Hibernate/EclipseLink 版本需要同步 |
| Bean Validation 2.x → Jakarta Validation 3.x | `javax.validation.*` 改为 `jakarta.validation.*`                                                                                    | DTO 校验、参数校验、自定义 Constraint、Hibernate Validator 版本需要同步       |

Tomcat 官方迁移指南明确指出，Tomcat 9.0.x 到 Tomcat 10.0.x 之间存在显著破坏性变化，规范 API 使用的 Java 包从 `javax...` 改为 `jakarta...`，Web 应用需要基于新 API 重新编译。[9] Spring Boot 3.0 官方迁移指南也说明，Spring Boot 3 在依赖 Jakarta EE 规范时升级至 Jakarta EE 10 所包含的版本，并要求开发者避免继续直接或传递使用旧的 Java EE 依赖，例如应使用 `jakarta.servlet:jakarta.servlet-api` 而不是 `javax.servlet:javax.servlet-api`。[10]

## 7. 破坏性变更产生的原因与意义

`javax.*` 到 `jakarta.*` 的破坏性变更主要由 Jakarta EE 的治理迁移和命名空间限制产生。Eclipse Foundation 官方说明中提到，Eclipse 与 Oracle 未能就 Jakarta EE 社区修改 `javax` 命名空间或使用 Java EE 相关商标达成协议，因此 `javax` 命名空间只能按原样使用，不能由 Jakarta EE 社区继续演进。[6]

在这一约束下，Jakarta EE 9 选择一次性完成命名空间迁移。Jakarta EE 9 发布计划将迁移命名空间列为关键目标；Jakarta 官方资料也说明，Jakarta EE 8 仍使用 `javax.*`，而 Jakarta EE 9 引入 `jakarta.*` 作为替代命名空间。[7][8]

这一破坏性变更产生了三个直接结果。

第一，Jakarta EE 规范获得了可继续演进的新命名空间。由于 `javax` 不能继续修改，后续规范版本需要在 `jakarta` 命名空间下发展。

第二，生态系统形成了清晰的版本分界线。Java EE 8 / Jakarta EE 8 及以前主要使用 `javax.*`；Jakarta EE 9 及以后使用 `jakarta.*`。Tomcat 9 与 Tomcat 10、Spring Boot 2 与 Spring Boot 3、Spring Framework 5.3 与 Spring Framework 6 之间的升级差异，均可放在这一分界线下理解。

第三，应用迁移从单纯替换依赖升级为全链路兼容性检查。开发者不仅需要修改 import，还需要检查运行时容器、ORM、校验框架、模板引擎、安全框架、测试框架、自动配置、Maven/Gradle 依赖树以及间接依赖是否已经支持 Jakarta EE 9 及以上。

## 8. 当下发展状态与未来方向

截至 2026 年 6 月，Jakarta EE 官方发布页显示，Jakarta EE 11 已于 2025 年 6 月 26 日发布，Jakarta EE 12 处于开发中。[14] Jakarta EE 11 的官方说明强调，该版本围绕开发者生产力、TCK 现代化、Java 21 对齐、Jakarta Data 新规范以及多个现有规范更新展开。[15] Jakarta EE 11 包含 Platform、Web Profile 和 Core Profile 三个层级，并覆盖 Servlet 6.1、Persistence 3.2、CDI 4.1、Validation 3.1、Security 4.0、RESTful Web Services 4.0、JSON Processing 2.1、JSON Binding 3.0 等规范。[15][16]

Jakarta EE 12 官方页面显示，该版本仍处于 under development 状态，目标表述为面向可靠、灵活的企业级 Java，支持模块化、互操作性和架构选择。其公开页面列出了 Query 1.0、Data 1.1、Persistence 4.0、CDI 5.0、Servlet 6.2、RESTful Web Services 5.0、JSON Processing 2.2、JSON Binding 3.1 等拟更新或候选规范。[17]

因此，Jakarta EE 当前的发展方向可以从官方资料中归纳为：继续维护企业级 Java 标准平台；围绕 Platform、Web Profile、Core Profile 分层；强化 TCK 和兼容性；对齐较新的 Java LTS 版本；继续更新 Web、REST、持久化、依赖注入、校验、安全、JSON 和数据访问相关规范。

## 9. 普通开发者应关注的规范与问题

对于普通 Java 后端开发者，最常直接接触的 Jakarta EE 规范不是完整 Platform 中的全部内容，而是 Web 应用、数据访问、校验、依赖注入和安全相关规范。

| 规范                                        | 普通项目中的典型接触点                                                    |
| ----------------------------------------- | -------------------------------------------------------------- |
| Jakarta Servlet                           | Spring MVC、Filter、Interceptor、Servlet 容器、Tomcat、Jetty、Undertow |
| Jakarta Persistence                       | JPA、Hibernate、EclipseLink、Entity、Repository、事务持久化              |
| Jakarta Validation                        | DTO 参数校验、`@NotNull`、`@Size`、自定义校验注解                            |
| Jakarta Annotations                       | `@PostConstruct`、`@PreDestroy`、资源注入相关注解                        |
| Jakarta Dependency Injection              | `jakarta.inject.Inject`、标准依赖注入注解                               |
| Jakarta Contexts and Dependency Injection | CDI 容器、上下文生命周期、依赖注入模型                                          |
| Jakarta RESTful Web Services              | JAX-RS、REST API 标准实现、MicroProfile 相关运行时                        |
| Jakarta JSON Processing / JSON Binding    | JSON-P、JSON-B、标准 JSON 处理                                       |
| Jakarta WebSocket                         | WebSocket 服务端和客户端 API                                          |
| Jakarta Security / Authentication         | 标准安全 API、认证、授权、容器安全机制                                          |
| Jakarta Transactions                      | JTA、跨资源事务、容器事务边界                                               |
| Jakarta Mail                              | 邮件发送、MIME 消息处理                                                 |

在升级实践中，需要重点关注以下问题。

第一，不能只替换 import。`javax.servlet` 到 `jakarta.servlet` 的变化必须同时匹配 Servlet API 依赖、运行时容器和框架版本。使用 Tomcat 10 时，如果应用仍依赖 `javax.servlet-api`，应用不能按照 Jakarta Servlet 5+ 的方式正常编译和运行。

第二，不能混用 Java EE 与 Jakarta EE API。Spring 官方迁移说明指出，通常不能在同一个项目中混用 Java EE 与 Jakarta EE API，应用代码和第三方库都需要统一到 `jakarta.*` 包导入。[10]

第三，要检查传递依赖。即使应用代码已经迁移，旧版第三方库仍可能传递引入 `javax.servlet-api`、`javax.persistence-api`、`validation-api` 或旧版 Hibernate Validator、Hibernate ORM、JAX-RS 实现。

第四，要区分 Java EE 的 `javax.*` 与 JDK 的 `javax.*`。`javax.sql`、`javax.crypto`、`javax.net` 等 JDK 标准包不属于 Jakarta EE 迁移范围，不应机械替换。

第五，要关注运行时基线。Spring Boot 3 要求 Java 17 或以上，并基于 Spring Framework 6；Spring Framework 6 的最低要求是 Java 17+ 和 Jakarta EE 9+；Tomcat 10.1 要求 Java 11+；Tomcat 11 要求 Java 17+。升级 Jakarta EE 命名空间时，通常也会伴随 JDK、应用服务器和框架主版本升级。

第六，要关注测试代码、Mock、Filter、Listener、Servlet API 类型、JSP/TLD、XML 配置、反射字符串和字节码增强工具。包名迁移不仅发生在 Java 源码 import 中，也可能出现在配置文件、模板文件、测试工具和运行时扫描逻辑中。

## 10. 结论

J2EE 最初定义的是企业级 Java 应用的标准平台模型，其核心作用是通过组件、容器、标准服务和兼容性要求，解决企业应用开发中的事务、安全、资源管理、生命周期管理和多层架构复杂性。Java EE 阶段延续并扩展了这一体系，通过注解、简化编程模型、REST、JSON、Servlet、安全和持久化等规范更新适应新的开发需求。2017 年后，Java EE 移交 Eclipse Foundation，并以 Jakarta EE 名称继续发展。由于商标和命名空间限制，Jakarta EE 9 引入 `javax.*` 到 `jakarta.*` 的迁移，形成企业 Java 生态中的重要版本分界线。

开发者在 Tomcat 9 到 Tomcat 10、Spring Boot 2 到 Spring Boot 3、Spring Framework 5 到 Spring Framework 6、Servlet 4 到 Servlet 5 及相关 JPA、Validation、JAX-RS、CDI 规范升级时，会遇到这一命名空间变化。该变化的处理范围包括源码、依赖、容器、第三方库、测试代码和配置文件。当前 Jakarta EE 11 已发布，Jakarta EE 12 处于开发中，企业级 Java 规范体系仍围绕标准化、兼容性、云原生运行环境、现代 Java LTS 和核心企业 API 继续演进。

## 参考文献

[1] Oracle. Java 2 Platform, Enterprise Edition Overview.
[2] Oracle. The Java EE 5 Tutorial: Java EE Containers and Container Services.
[3] Oracle. Java Platform, Enterprise Edition at a Glance.
[4] JCP. JSR 244: Java Platform, Enterprise Edition 5 Specification.
[5] Eclipse Foundation. Java EE Moves to the Eclipse Foundation.
[6] Eclipse Foundation. Update on Jakarta EE Rights to Java Trademarks.
[7] Jakarta EE. Javax to Jakarta Namespace Ecosystem Progress.
[8] Jakarta EE Platform Project. Jakarta EE 9 Release Plan.
[9] Apache Tomcat. Migration Guide — Tomcat 10.0.x.
[10] Spring. Spring Boot 3.0 Migration Guide.
[11] Jakarta EE. Jakarta Servlet Specification 5.0.
[12] Spring. Spring Framework 6.0 Release Notes.
[13] Apache Tomcat. Tomcat Migration Tool for Jakarta EE.
[14] Jakarta EE. Jakarta EE Release Versions.
[15] Eclipse Foundation / Jakarta EE. Jakarta EE 11 Release Materials.
[16] Jakarta EE. Jakarta EE Specifications.
[17] Jakarta EE. Jakarta EE 12 Release Materials.
