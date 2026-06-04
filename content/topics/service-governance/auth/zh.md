# 鉴权规则体系的标准化设计研究

## 摘要

鉴权规则是信息系统访问控制体系中的核心组成部分，其目标是在主体访问资源时，对身份可信性、访问权限、请求上下文和资源边界进行可验证的判断。依据 NIST、IETF OAuth/JWT 标准以及 Istio 官方安全模型，鉴权体系通常包含认证、授权、访问控制策略、策略决策、策略执行和审计等部分。认证用于确认用户、进程、设备或工作负载身份；授权用于判断特定主体是否具有访问特定资源或执行特定操作的权限；鉴权规则则将主体、资源、操作和环境属性表达为可执行策略。本文从概念、必要性、规则作用位置、链路级认证与请求级授权、JWT 机制、Istio 鉴权模型以及配置粒度等方面，对鉴权规则体系进行结构化说明。

**关键词**：认证；授权；访问控制；JWT；OAuth 2.0；Istio；ABAC；服务网格；零信任

## 1. 引言

在分布式系统、微服务架构和服务网格环境中，服务调用不再局限于单一可信网络边界。NIST 零信任架构指出，访问控制应围绕资源保护展开，信任不应被隐式授予，而应在访问过程中持续评估，并以尽可能细粒度的方式执行最小权限访问控制 [R1]。在该背景下，鉴权规则的作用不是简单判断“是否登录”，而是将“谁在访问、访问什么、执行什么操作、在什么上下文下访问”表达为可审计、可执行、可验证的策略。

鉴权规则的设计需要区分认证与授权。认证解决身份可信性问题，授权解决访问权限问题。二者共同构成访问控制的基础，但二者并不等价。认证通过后并不必然代表请求被授权；授权规则需要基于认证结果、资源属性、操作属性和环境条件进行独立判断。

## 2. 基本概念

### 2.1 认证

认证是验证用户、进程或设备身份的过程，通常是访问系统资源之前的前置步骤 [R2]。在网络系统中，认证对象可以是终端用户、客户端应用、服务工作负载、设备或自动化进程。常见认证机制包括用户名密码、多因素认证、客户端证书、mTLS、OIDC ID Token、API Key 和签名凭证等。

在服务网格中，工作负载之间的认证常通过 mTLS 完成。mTLS 不仅提供传输加密，还可以通过证书中的身份信息确认调用方工作负载身份。Istio 的 PeerAuthentication 即用于配置工作负载接收请求时的对端认证策略，其中 STRICT 模式要求请求通过 mutual TLS [R8]。

### 2.2 授权

授权是授予或拒绝某个系统实体访问系统资源的权利或权限，也可以表示验证某个请求动作是否被允许的过程 [R3]。授权依赖已知身份，但授权决策本身并不限于身份，还可以依赖角色、组织、服务账号、资源归属、请求方法、路径、来源 IP、目标端口、JWT Claim、时间、环境风险等上下文。

在 OAuth 2.0 中，访问令牌表示客户端获得的访问授权。客户端使用访问令牌访问资源服务器，而不是直接使用资源所有者凭证 [R5]。因此，OAuth 2.0 的核心目标是授权委托，而不是单纯身份认证。

### 2.3 鉴权规则

鉴权规则是访问控制策略的可执行表达。规则通常包含以下要素：

1. 主体，即用户、客户端、服务账号、工作负载、设备或进程。
2. 资源，即 API、服务、数据对象、文件、Topic、队列、数据库表、业务实体等。
3. 操作，即 HTTP Method、gRPC Method、读、写、删除、审批、发布、管理等动作。
4. 条件，即 IP、时间、命名空间、JWT Claim、Header、环境等级、租户、资源状态等上下文属性。
5. 动作，即允许、拒绝、审计或委托外部授权系统判断。

NIST SP 800-162 将 ABAC 定义为一种基于属性的逻辑访问控制方法，该方法通过评估主体、对象、操作以及环境条件等属性，并根据策略、规则或关系确定是否允许操作 [R4]。因此，现代鉴权规则并不局限于 RBAC 的角色判断，而是可以同时包含 RBAC、ABAC、Scope、Claim、服务身份和资源属性。

## 3. 鉴权规则存在的必要性

鉴权规则的必要性来自访问控制的可执行性要求。没有规则，系统只能依赖代码分支、人工约定或网络边界隐式信任，这会使权限边界难以审计、难以复用、难以统一变更。NIST 零信任架构将访问授予描述为通过策略决策点和策略执行点完成的过程 [R1]。这意味着访问控制不是抽象原则，而是需要被策略化、执行化和审计化。

鉴权规则还用于表达最小权限。零信任架构要求访问规则尽可能细粒度，并仅授予完成请求动作所需的最小权限 [R1]。在微服务系统中，服务 A 能够连接服务 B，并不等于服务 A 可以访问服务 B 的所有接口；用户具备登录态，也不等于其可以访问任意租户、任意资源或任意操作。因此，鉴权规则需要将服务级、接口级、资源级和上下文级权限分离表达。

## 4. 鉴权规则的作用位置

鉴权规则应作用在能够拦截受保护资源访问路径的位置。按照 NIST 零信任模型，策略执行点负责执行授权决策，策略决策点负责根据策略和上下文产生允许或拒绝结果 [R1]。在工程实现中，策略执行点可以位于 API Gateway、Ingress Gateway、Service Mesh Sidecar、应用服务拦截器、RPC Filter、数据库代理或数据访问层。

不同位置适合不同粒度的规则。网关适合执行入口认证、Token 校验、租户入口限制、粗粒度 API 访问控制和统一审计。服务网格适合执行服务到服务的工作负载身份认证、命名空间隔离、服务账号授权、HTTP Method/Path/gRPC Method 等协议层规则。应用服务适合执行业务资源级规则，例如资源归属、订单状态、项目成员关系、字段级权限、数据行级权限等。数据层适合执行最终的数据边界，例如行级安全策略、字段脱敏、表级权限和审计。

前端不应作为唯一鉴权执行点。前端可以隐藏按钮或菜单，但前端无法保证请求不会被绕过。受保护资源的访问控制需要在服务端、网关、服务网格或数据层完成。

## 5. 链路级认证与请求级授权

链路级认证与请求级授权是服务网格和零信任系统中的常见分层方式。链路级认证主要解决通信双方身份和传输安全问题，例如服务 A 与服务 B 之间通过 mTLS 建立对端身份。请求级授权主要解决某个具体请求是否被允许的问题，例如服务 A 是否可以调用服务 B 的 `/admin` 路径，某个 JWT Subject 是否可以执行 `POST /orders` 操作。

Istio 同时提供 PeerAuthentication、RequestAuthentication 和 AuthorizationPolicy。PeerAuthentication 用于对端认证和 mTLS；RequestAuthentication 用于声明工作负载支持的请求认证方式，并对请求中的 JWT 进行校验；AuthorizationPolicy 用于对网格中的工作负载执行访问控制 [R8][R9][R10]。Istio 官方文档明确指出，RequestAuthentication 对包含无效认证信息的请求会拒绝；对于未携带认证凭证的请求，默认可被接受但不会形成已认证身份，如需限制只有认证请求可访问，需要配合授权规则 [R9]。这表明，请求认证与请求授权在模型上是分离的。

因此，链路级认证可以确认调用方工作负载身份，请求级认证可以确认终端用户或客户端令牌身份，请求级授权可以将工作负载身份、请求身份、操作和条件组合起来进行访问控制。该分层结构符合“身份确认”和“权限判断”分离的访问控制模型。

## 6. 业界鉴权规则的依据

业界鉴权规则主要基于以下几类信息：

第一，主体属性。包括用户 ID、服务账号、客户端 ID、工作负载身份、命名空间、组织、部门、角色、用户组、设备身份等。

第二，资源属性。包括资源类型、资源 ID、租户、数据分级、归属关系、命名空间、服务名、接口路径、数据库对象等。

第三，操作属性。包括 HTTP Method、gRPC Method、读、写、删除、审批、发布、管理、导出等动作。

第四，环境属性。包括来源 IP、目标端口、时间、网络区域、认证强度、风险等级、请求 Header、JWT Claim、TLS SNI 等。

第五，策略动作。包括 ALLOW、DENY、AUDIT、CUSTOM 或外部授权系统决策。

NIST ABAC 模型明确将主体、对象、操作和环境条件作为授权判断的重要属性来源 [R4]。OAuth 2.0 体系中，Scope、Audience、Client、Resource Server 和 Access Token 构成授权委托的标准要素 [R5][R6]。JWT 则常被用于承载身份和授权相关声明，但 JWT 本身不是授权模型，它只是声明集合的表示和传输格式 [R6][R7]。

## 7. JWT 的作用、优点与限制

JWT 是一种紧凑、URL 安全的声明表示格式，用于在两方之间传递 Claim。JWT 的 Claim 可以作为 JWS 的载荷被签名或完整性保护，也可以作为 JWE 的明文被加密 [R6]。在 OAuth 2.0 访问令牌场景中，RFC 9068 定义了以 JWT 格式签发 OAuth 2.0 Access Token 的标准 Profile，使不同授权服务器和资源服务器可以以可互操作的方式签发和消费访问令牌 [R11]。

JWT 的主要优点包括：格式紧凑，适合 HTTP Authorization Header；可以通过签名验证完整性和签发方；可以携带 `iss`、`sub`、`aud`、`exp`、`scope`、`roles`、`groups`、`entitlements` 等声明；资源服务器在掌握验证密钥和验证规则时，可以直接解析和验证令牌，而不一定每次请求都访问授权服务器 [R6][R11]。

JWT 的限制同样来自标准定义。Bearer Token 的基本特征是任何持有令牌的一方都可以使用该令牌访问关联资源，因此令牌必须在存储和传输过程中防泄漏 [R7]。JWT 如果作为 Bearer Token 使用，同样继承该风险。JWT 还存在撤销困难、令牌过期前声明可能滞后、令牌体积过大、敏感 Claim 暴露、签名算法误用、Audience 校验缺失等工程风险。RFC 8725 作为 JWT Best Current Practice，专门用于补充 JWT 安全实现和部署建议 [R12]。RFC 9068 进一步要求 JWT Access Token 必须签名，不得使用 `none` 作为签名算法，并要求符合规范的授权服务器和资源服务器支持 RS256 [R11]。

因此，JWT 适合作为身份和授权声明的传输载体，但不应替代授权规则本身。资源服务器或策略执行点仍需校验签名、Issuer、Audience、有效期、Token 类型和授权 Claim，并根据本地或集中式策略做最终授权决策。

## 8. Istio 鉴权规则模型

Istio 的安全模型将认证和授权分为多个资源类型。PeerAuthentication 负责对端认证和 mTLS 策略；RequestAuthentication 负责请求级 JWT 认证；AuthorizationPolicy 负责访问控制 [R8][R9][R10]。

AuthorizationPolicy 支持 CUSTOM、DENY、ALLOW 和 AUDIT 动作。CUSTOM 用于委托扩展授权系统处理，DENY 用于显式拒绝，ALLOW 用于允许匹配请求，AUDIT 用于标记审计请求但不改变允许或拒绝结果。Istio 的策略评估顺序为 CUSTOM、DENY、ALLOW；当没有 ALLOW 策略作用于工作负载时，请求默认允许；当存在 ALLOW 策略但请求不匹配任何 ALLOW 策略时，请求被拒绝 [R10]。

Istio AuthorizationPolicy 的规则结构由 `from`、`to` 和 `when` 组成。`from` 表示请求来源，可基于 peer principal、request principal、namespace、service account、IP、trust domain 等字段匹配。`to` 表示请求操作，可基于 host、port、HTTP method、path 等字段匹配；对于 gRPC，path 可以表示为 `/package.service/method` 形式的全限定方法名。`when` 表示附加条件，可基于 Istio 支持的属性进行匹配，例如请求 Header、source IP、remote IP、source namespace、source principal、JWT principal、JWT audience、JWT claims、destination IP、destination port、SNI 等 [R10][R13]。

因此，Istio 的鉴权规则既支持服务身份，也支持请求身份；既支持 L4 连接属性，也支持 L7 HTTP/gRPC 属性；既支持允许和拒绝，也支持审计和外部授权扩展。

## 9. 鉴权规则的配置方式与粒度

鉴权规则的配置方式通常分为声明式配置和代码式配置两类。声明式配置适合基础设施层、网关层和服务网格层，例如 Istio 通过 Kubernetes CRD 定义 PeerAuthentication、RequestAuthentication 和 AuthorizationPolicy。代码式配置适合应用内部的业务资源权限，例如 Spring Security 注解、RPC Filter、领域服务校验、数据访问层规则等。

从粒度上看，规则至少应支持服务级、接口级和方法级。HTTP 场景中的方法级通常表现为 Method + Path，例如 `GET /orders/{id}`；gRPC 场景中的方法级通常表现为 `/package.service/method`。Istio AuthorizationPolicy 已支持 HTTP Method、Path、Host、Port，并支持 gRPC 全限定方法名，因此服务网格层可以覆盖通用方法级访问控制 [R10]。

参数级鉴权需要区分“协议可见参数”和“业务语义参数”。如果参数存在于 Header、JWT Claim、Path、Query 或代理可解析属性中，基础设施层可以参与判断。例如 Istio 支持基于请求 Header 和 JWT Claim 的条件匹配 [R13]。如果参数需要解析请求体、访问数据库、判断资源所有者、判断订单状态、项目成员关系或字段级权限，则该判断属于业务语义授权，通常需要由应用服务或外部授权系统完成。Istio 的 CUSTOM 动作可以将匹配请求委托给外部授权系统，但外部授权系统仍需具备理解业务上下文的能力 [R10]。

因此，标准化配置边界应为：平台层规则覆盖连接身份、请求身份、服务、接口、方法、路径、Header、Claim、IP、端口和命名空间；应用层规则覆盖资源实例、资源归属、业务状态、字段级权限和数据行级权限。将所有参数级规则都放在服务网格或网关中，会受限于协议解析能力和业务语义缺失；将所有规则都写在应用代码中，则会降低统一治理、审计和跨服务复用能力。

## 10. 结论

鉴权规则是认证结果、授权策略和访问控制执行之间的连接层。认证用于确认身份，授权用于判断权限，鉴权规则用于表达可执行的访问控制条件。依据 NIST 零信任架构，访问控制应通过策略决策点和策略执行点完成，并以尽可能细粒度的方式执行最小权限。依据 NIST ABAC，鉴权规则可基于主体、对象、操作和环境条件进行判断。依据 OAuth 2.0 与 JWT 标准，访问令牌和 JWT 可以承载授权与身份声明，但不能替代服务端授权规则。依据 Istio 官方模型，链路级 mTLS、请求级 JWT 认证和请求级 AuthorizationPolicy 可以组合形成分层鉴权体系。

在工程设计中，鉴权规则应以声明式配置为主、代码式业务校验为补充；以网关和服务网格承担通用认证与通用授权，以应用服务承担资源实例和业务语义授权。规则粒度应至少覆盖服务级、接口级和方法级；参数级规则应在参数对执行点可见且语义明确时下沉到平台层，否则应保留在应用层或外部授权系统中。

[R1] NIST SP 800-207《Zero Trust Architecture》：零信任强调资源保护、持续评估、最小权限、PDP/PEP 结构。([美国国家标准与技术研究所][1])
[R2] NIST CSRC Authentication Glossary：认证是验证用户、进程或设备身份的过程。([NIST计算机安全资源中心][2])
[R3] NIST CSRC Authorization Glossary：授权是授予系统实体访问资源的权利或权限，也包含批准特定请求动作的过程。([NIST计算机安全资源中心][3])
[R4] NIST SP 800-162 ABAC：ABAC 基于主体、对象、操作和环境条件等属性进行授权判断。([NIST计算机安全资源中心][4])
[R5] RFC 6749 OAuth 2.0：OAuth 2.0 允许第三方应用获得对 HTTP 服务的有限访问权限。([RFC Editor][5])
[R6] RFC 7519 JWT：JWT 是紧凑、URL 安全的 Claim 表示格式，可被签名、完整性保护或加密。([IETF Datatracker][6])
[R7] RFC 6750 Bearer Token：持有 Bearer Token 的一方即可访问关联资源，因此令牌需要在存储和传输中防泄漏。([IETF Datatracker][7])
[R8] Istio Authentication Policy：PeerAuthentication 可配置 mesh、namespace 或 workload 级 mTLS，STRICT 模式要求 TLS 加密请求。([Istio][8])
[R9] Istio RequestAuthentication：声明工作负载支持的请求认证方式；无效认证信息会被拒绝，缺失凭证默认不形成认证身份，需配合授权规则限制。([Istio][9])
[R10] Istio AuthorizationPolicy：支持 CUSTOM、DENY、ALLOW、AUDIT；规则包含 from、to、when；支持 source、operation、condition 等匹配项。([Istio][10])
[R11] RFC 9068 JWT Profile for OAuth 2.0 Access Tokens：定义 OAuth 2.0 JWT Access Token Profile，并要求 JWT Access Token 必须签名、不得使用 `none` 算法。([IETF Datatracker][11])
[R12] RFC 8725 JWT Best Current Practices：补充 JWT 安全实现和部署建议。([RFC Editor][12])
[R13] Istio Authorization Policy Conditions：支持 request.headers、source.ip、remote.ip、source.principal、request.auth.principal、request.auth.claims、destination.port、connection.sni 等条件。([Istio][13])

[1]: https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=930420 "Zero Trust Architecture"
[2]: https://csrc.nist.gov/glossary/term/authentication "authentication - Glossary | CSRC"
[3]: https://csrc.nist.gov/glossary/term/authorization "authorization - Glossary | CSRC"
[4]: https://csrc.nist.gov/pubs/sp/800/162/upd2/final "SP 800-162, Guide to Attribute Based Access Control (ABAC) Definition and Considerations | CSRC"
[5]: https://www.rfc-editor.org/rfc/rfc6749.html "www.rfc-editor.org"
[6]: https://datatracker.ietf.org/doc/html/rfc7519 "RFC 7519 - JSON Web Token (JWT)"
[7]: https://datatracker.ietf.org/doc/html/rfc6750 "RFC 6750 - The OAuth 2.0 Authorization Framework: Bearer Token Usage"
[8]: https://istio.io/latest/docs/tasks/security/authentication/authn-policy/ "Istio / Authentication Policy"
[9]: https://istio.io/latest/docs/reference/config/security/request_authentication/ "Istio / RequestAuthentication"
[10]: https://istio.io/latest/docs/reference/config/security/authorization-policy/ "Istio / Authorization Policy"
[11]: https://datatracker.ietf.org/doc/html/rfc9068 "RFC 9068 - JSON Web Token (JWT) Profile for OAuth 2.0 Access Tokens"
[12]: https://www.rfc-editor.org/rfc/rfc8725.html "RFC 8725: JSON Web Token Best Current Practices"
[13]: https://istio.io/latest/docs/reference/config/security/conditions/ "Istio / Authorization Policy Conditions"