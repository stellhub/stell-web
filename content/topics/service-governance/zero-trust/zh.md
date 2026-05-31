# 基于 SPIRE 的微服务零信任身份体系：从工作负载认证到服务间授权的标准实践

## 摘要

微服务系统中的服务实例具有动态调度、弹性扩缩容、跨节点通信和多租户部署等特征，传统依赖内网、IP 白名单或固定服务名的信任模型难以满足服务间身份认证和权限控制要求。零信任架构并不表示系统不存在信任源，而是要求访问行为基于显式身份、最小权限、持续验证和可审计策略进行判断。本文基于 NIST 零信任架构、NIST 微服务安全指南、SPIFFE/SPIRE、Kubernetes Admission Control、Istio 安全模型、OAuth2/JWT 与 TLS 标准，系统分析微服务间零信任身份体系的标准实现方式。文章重点说明 JWT 请求级认证与 mTLS 连接级认证的分层关系，解释 SPIRE Server、SPIRE Agent、Node Attestation、Workload Attestation、SVID、Registration Entry、Admission Controller 和 ServiceAccount 在身份链路中的角色，并讨论发布平台、Kubernetes、CA/KMS/HSM 和授权策略之间的信任边界。研究表明，成熟的微服务零信任系统不是消除信任根，而是将信任根分层化、最小化、可验证化和可撤销化，并通过 SPIRE、mTLS、JWT、Admission Policy、AuthorizationPolicy 和 OPA 等组件形成闭环。

**关键词**：零信任；微服务；SPIFFE；SPIRE；mTLS；JWT；ServiceAccount；Admission Controller；Workload Identity；服务网格

---

## 1. 引言

微服务架构将系统拆分为多个独立部署的服务单元，服务之间通过 HTTP、gRPC、消息队列或事件总线进行通信。随着服务数量增加，服务间调用关系呈网状扩展，传统基于网络边界的安全模型逐渐失效。服务实例可能运行在不同节点、不同命名空间、不同集群、不同云环境中，并可能频繁创建、销毁和迁移。因此，以 IP、主机名、固定端口、内网区域或 Kubernetes Service 名称作为信任依据并不充分。

NIST SP 800-207 将零信任架构定义为一种不基于隐式网络位置授予信任的安全架构。零信任要求每一次访问都经过显式验证，访问决策应基于身份、设备状态、上下文、策略和资源敏感度。NIST SP 800-204A 进一步指出，在微服务架构中，服务网格可以作为安全通信、认证、授权和监控的基础设施。

在微服务内部，常见的误区是认为“已经有 JWT 认证，就不需要 mTLS”。该判断是不完整的。JWT 是请求级凭证，用于表达请求主体、issuer、audience、scope、tenant、user 或 client 等声明；mTLS 是连接级机制，用于证明当前连接对端工作负载的身份，并保护通信链路的机密性和完整性。二者解决的问题不同，应组合使用。

本文围绕以下问题展开：

1. 已经有请求级 JWT 认证时，为什么仍然需要 mTLS？
2. SPIFFE/SPIRE 在微服务零信任体系中承担什么角色？
3. SPIRE Server 如何确认 SPIRE Agent 不是伪造的？
4. Kubernetes ServiceAccount 名称可被内部人员知晓时，如何防止冒用？
5. Admission Controller 在身份链路中负责什么？
6. 零信任是否仍然依赖信任根？如果发布平台被攻破，如何控制影响范围？
7. 企业级微服务间零信任系统应如何落地？

---

## 2. 零信任的本质：不是无信任，而是显式信任

零信任容易被误解为“系统中没有任何可信组件”。事实上，任何认证系统都必须存在信任起点，例如 Root CA、trust bundle、Kubernetes API Server、SPIRE Server、HSM/KMS、Admission Controller 或身份策略系统。零信任并不消灭信任根，而是改变信任方式。

传统模型通常隐式信任：

```text
同一内网可信；
同一 VPC 可信；
同一 Kubernetes 集群可信；
同一 namespace 可信；
来自固定 IP 的请求可信。
```

零信任模型要求显式验证：

```text
调用方是谁？
身份由谁签发？
身份是否仍然有效？
当前连接是否来自该身份对应的工作负载？
该身份是否被允许访问当前资源？
请求中的 JWT 是否与目标服务匹配？
当前环境、租户、数据等级是否满足策略？
```

因此，零信任的本质可以概括为：

```text
零信任不是无信任；
零信任是显式信任、最小信任、持续验证、可审计信任和可撤销信任。
```

在 SPIFFE/SPIRE 场景下，系统信任链通常为：

```text
Root CA / Trust Bundle
        ↓
Intermediate CA / SPIRE Server
        ↓
Node Attestation
        ↓
Workload Attestation
        ↓
X.509-SVID / JWT-SVID
        ↓
mTLS / JWT / AuthorizationPolicy
        ↓
目标服务
```

如果 Root CA、SPIRE Server、Registration Entry、Kubernetes API Server 或发布平台被赋予过大权限且被攻破，身份体系确实可能被破坏。因此，零信任架构必须重点回答：信任谁、为什么信任、信任范围多大、被攻破后如何发现和撤销。

---

## 3. JWT 与 mTLS 的分层关系

### 3.1 JWT 是请求级认证

JWT 适合表达一次请求的身份与权限声明，例如：

```json
{
  "iss": "https://auth.example.com",
  "sub": "user-10001",
  "aud": "payment-service",
  "scope": "payment:create",
  "tenant_id": "tenant-a",
  "exp": 1730000000
}
```

JWT 主要回答：

```text
这个请求是谁签发的？
这个请求代表哪个用户或客户端？
这个请求面向哪个 audience？
这个请求包含哪些 scope 或 claims？
这个 token 是否过期？
```

JWT 的优势是资源服务可以本地验签，不需要每次访问中心化认证服务。但 JWT 通常是 bearer token，谁持有 token，谁就可以使用。因此，单独使用 JWT 无法充分证明当前网络连接对端一定是合法工作负载。

### 3.2 mTLS 是连接级认证

mTLS 用于证明当前连接双方的工作负载身份，并对通信链路进行加密保护。服务 A 调用服务 B 时，双方通过 X.509 证书完成双向认证。证书中可以通过 SAN URI 承载 SPIFFE ID，例如：

```text
spiffe://prod/ns/order/sa/order-service
spiffe://prod/ns/payment/sa/payment-service
```

mTLS 主要回答：

```text
当前连接对端是谁？
它的证书是否由可信 trust bundle 签发？
证书是否过期？
证书中的 SPIFFE ID 是否符合预期？
该服务身份是否允许访问目标服务？
```

### 3.3 为什么二者都需要

JWT 与 mTLS 的关系如下：

| 层级  | 技术                                   | 解决的问题                      |
| --- | ------------------------------------ | -------------------------- |
| 连接级 | mTLS / X.509-SVID                    | 当前连接对端工作负载是谁               |
| 请求级 | JWT / OAuth2 Access Token / JWT-SVID | 当前请求代表谁、访问什么资源、具备哪些 claims |
| 授权级 | AuthorizationPolicy / OPA / 业务权限中心   | 该身份是否允许执行该操作               |
| 业务级 | 业务服务内部校验                             | 资源归属、租户边界、数据等级、业务状态        |

仅使用 JWT 的风险包括：

```text
JWT 被盗后可被重放；
内部服务端口可能被绕过网关直接访问；
无法证明当前连接对端就是合法工作负载；
审计中只能看到 token subject，难以确认 source workload；
无法约束 token 必须由某个证书持有者使用。
```

因此，生产级微服务零信任系统不应采用 JWT-only 模型。更合理的模型是：

```text
mTLS 证明服务身份；
JWT 证明请求身份；
授权系统判断服务身份 + 请求身份 + 资源 + 动作 + 环境是否被允许。
```

---

## 4. SPIFFE/SPIRE 的标准实现

### 4.1 SPIFFE 与 SPIRE 的关系

SPIFFE 是一种工作负载身份标准，全称为 Secure Production Identity Framework for Everyone。它定义了跨平台、跨环境的工作负载身份模型。SPIRE 是 SPIFFE 的生产级实现，用于执行节点认证、工作负载认证，并向工作负载签发 SVID。

核心概念包括：

| 概念                 | 含义                                              |
| ------------------ | ----------------------------------------------- |
| SPIFFE ID          | 工作负载的标准化身份标识                                    |
| SVID               | SPIFFE Verifiable Identity Document，可验证身份文档     |
| X.509-SVID         | 基于 X.509 证书的 SVID，适合 mTLS                       |
| JWT-SVID           | 基于 JWT 的 SVID，适合请求级身份传播                         |
| Trust Domain       | 一组工作负载身份的信任域                                    |
| Trust Bundle       | 验证某个 trust domain 下 SVID 的可信根集合                 |
| SPIRE Server       | SPIRE 控制面，负责注册、认证和签发身份                          |
| SPIRE Agent        | 节点级代理，负责本节点 workload attestation 和 Workload API |
| Registration Entry | SPIFFE ID 与 selectors 的绑定规则                     |
| Selector           | 描述 workload 或 node 属性的选择条件                      |

### 4.2 SPIRE 标准链路

SPIRE 在 Kubernetes 中的标准身份链路如下：

```text
SPIRE Server
    ↓ 管理 registration entries、trust bundle、CA 签发
SPIRE Agent
    ↓ 每个 Kubernetes worker node 一个，通常 DaemonSet 部署
Workload API
    ↓ 通过 Unix Domain Socket 暴露给本节点 workload
Workload
    ↓ 获取 X.509-SVID / JWT-SVID
mTLS / JWT-SVID
    ↓ 用于服务间认证
AuthorizationPolicy / OPA
    ↓ 用于服务间授权
```

### 4.3 SPIRE Agent 的官方推荐部署方式

在 Kubernetes 场景下，SPIRE Agent 官方推荐以 DaemonSet 方式部署，而不是作为每个业务 Pod 的 sidecar 部署。

标准部署形态如下：

```text
Node-1
  ├── spire-agent DaemonSet Pod
  ├── business-pod-a
  └── business-pod-b

Node-2
  ├── spire-agent DaemonSet Pod
  ├── business-pod-c
  └── business-pod-d
```

业务 Pod 通过本节点 SPIRE Agent 暴露的 Workload API socket 获取 SVID。该 socket 可以通过 hostPath 或 SPIFFE CSI Driver 挂载到业务 Pod 中。更推荐通过 SPIFFE CSI Driver 注入 socket，避免业务 Pod 直接依赖 hostPath。

SPIRE Agent 不适合做业务 sidecar，原因包括：

```text
Agent 是节点级身份代理，不是单 Pod 附属进程；
Agent 需要观察节点上的 workload；
每个 Pod 一个 Agent 会造成 Agent 数量膨胀；
Node Attestation 模型天然对应节点级 Agent；
业务 sidecar 通常应是 Envoy、OPA 或业务代理，而不是 SPIRE Agent。
```

### 4.4 SPIRE Server 如何防止 SPIRE Agent 被伪造

SPIRE Server 不会因为某个进程声称自己是 Agent 就信任它。SPIRE Agent 必须先通过 Node Attestation。

在 Kubernetes 场景中，常见方式是使用 Projected Service Account Token，即 PSAT。流程如下：

```text
SPIRE Agent 启动
    ↓
读取自身 Pod 中的 projected service account token
    ↓
向 SPIRE Server 发起 node attestation
    ↓
SPIRE Server 调用 Kubernetes TokenReview API 校验 token
    ↓
Kubernetes 返回 namespace、service account、pod name 等信息
    ↓
SPIRE Server 根据配置生成 selectors
    ↓
匹配通过后签发 Agent SVID
```

因此，伪造 SPIRE Agent 至少需要绕过：

```text
合法的 projected service account token；
Kubernetes TokenReview 校验；
Agent 所属 namespace 和 service account 限制；
SPIRE Server 的 node attestor 配置；
Agent registration / selector 策略；
后续 Agent SVID 的轮换和认证。
```

这说明 SPIRE 防伪的关键不是 Agent 名称，而是 Agent 必须证明自己运行在可信平台、可信节点或可信 Pod 环境中。

---

## 5. Kubernetes Admission Controller 在链路中的角色

### 5.1 Admission Controller 的位置

Kubernetes 请求链路通常为：

```text
kubectl / 发布平台 / GitOps
        ↓
Kubernetes API Server
        ↓
Authentication：请求者是谁
        ↓
Authorization：请求者是否有权限操作该资源
        ↓
Admission Controller：资源内容是否符合组织策略
        ↓
etcd 持久化
```

Admission Controller 是 Kubernetes API Server 在对象写入 etcd 之前执行的准入机制。它不负责运行时 mTLS，也不是 SPIRE 的组件，而是 Kubernetes 控制面中的策略执行点。

### 5.2 Admission Controller 应校验什么

在零信任身份体系中，Admission Controller 应重点拦截以下风险：

```text
非法指定 serviceAccountName；
使用 default ServiceAccount；
伪造身份相关 labels / annotations；
使用未签名镜像；
使用 latest 镜像标签；
镜像 digest 与发布记录不一致；
开启 privileged；
使用 hostNetwork、hostPID、hostIPC；
挂载 hostPath；
挂载敏感 Secret；
修改 securityContext；
跨 namespace 部署；
绕过发布平台直接创建高权限 workload。
```

例如，以下配置应被拦截：

```yaml
spec:
  serviceAccountName: payment-service
```

如果提交者并非支付服务的合法发布主体，则不能允许其使用 `payment-service` 这个 ServiceAccount。

### 5.3 Admission Controller 与 SPIRE 的关系

Admission Controller 和 SPIRE 不是替代关系，而是前后衔接：

```text
Admission Controller：防止危险 workload 被创建；
SPIRE Agent：识别已经运行的 workload；
SPIRE Server：根据 selectors 和 registration entry 判断是否签发身份；
AuthorizationPolicy / OPA：判断该身份是否允许访问目标服务。
```

如果没有 Admission Controller，攻击者可能创建一个看起来合法的 Pod。
如果没有 SPIRE，系统缺少标准化工作负载身份。
如果没有 AuthorizationPolicy，拿到身份后权限可能过大。

---

## 6. ServiceAccount 不是秘密，关键是限制使用权

### 6.1 ServiceAccount 名称不应作为安全边界

在 Kubernetes 中，ServiceAccount 为 Pod 中运行的进程提供身份。Pod 可以通过 `spec.serviceAccountName` 指定使用哪个 ServiceAccount。ServiceAccount 名称通常是应用名称或平台生成名称，例如：

```text
order-service
payment-service
risk-service
account-service
```

这些名称在内部并不难获取，可能出现在：

```text
Deployment YAML；
Helm Chart；
Git 仓库；
日志平台；
监控系统；
链路追踪；
Istio 配置；
平台服务目录。
```

因此，ServiceAccount 名称不是秘密，也不应该被当作安全边界。

### 6.2 知道 ServiceAccount 不等于可以使用

安全系统不能依赖“攻击者不知道 ServiceAccount 名称”。真正的安全边界应是：

```text
是否有权限在目标 namespace 创建 Pod；
是否允许指定目标 serviceAccountName；
Admission Controller 是否允许该绑定；
发布平台是否允许该应用使用该身份；
SPIRE registration entry 是否只依赖 ServiceAccount；
AuthorizationPolicy 是否允许该 SPIFFE ID 调用目标接口。
```

危险设计如下：

```text
只要 Pod 使用 payment-service ServiceAccount，
SPIRE 就签发 payment-service 的 SPIFFE ID。
```

更合理的设计是：

```text
只有运行在 prod-payment namespace、
使用 payment-service ServiceAccount、
由 payment-service Deployment 创建、
镜像 digest 匹配发布记录、
通过 admission policy、
运行在可信节点上的 workload，
才可以获得 payment-service 的 SPIFFE ID。
```

### 6.3 SPIRE Registration Entry 不应只依赖 ServiceAccount

弱绑定示例：

```text
SPIFFE ID:
  spiffe://prod/ns/payment/sa/payment-service

Selectors:
  k8s:sa:payment-service
```

该设计过于依赖 ServiceAccount 名称。如果攻击者能在某个 namespace 中创建使用该 ServiceAccount 的 Pod，就可能冒用身份。

更合理的 selector 组合应包括：

```text
k8s:cluster:prod-cluster-a
k8s:ns:prod-payment
k8s:sa:payment-service
k8s:pod-owner:deployment/payment-service
k8s:container-name:payment-service
k8s:image-digest:sha256:xxxx
node:uid:xxxx
env:prod
```

结论是：

```text
ServiceAccount 可以公开；
ServiceAccount 的使用权必须受控；
SPIFFE ID 不能只靠 ServiceAccount 名称绑定。
```

---

## 7. 发布平台与信任边界

### 7.1 发布平台不是最终信任根

发布平台通常负责将应用声明发布到 Kubernetes，例如 Deployment、Service、ConfigMap、镜像版本等。但发布平台不应该直接持有 CA 私钥，也不应该直接签发服务证书。

错误设计：

```text
发布平台
    ↓
持有 CA 私钥
    ↓
直接给服务签发 mTLS 证书
```

该设计中，发布平台一旦被攻破，攻击者就可以签发任意服务身份。

正确设计：

```text
发布平台
    ↓
提交受控部署声明
    ↓
Kubernetes API Server
    ↓
Admission Controller 校验
    ↓
SPIRE Agent 做 workload attestation
    ↓
SPIRE Server 根据 registration entry 签发 SVID
```

发布平台只是输入来源之一，不应是身份签发权力的最终持有者。

### 7.2 如果发布平台被攻破会怎样

如果发布平台拥有以下权限：

```text
创建任意 namespace；
绑定任意 ServiceAccount；
修改任意 Deployment；
修改 SPIRE registration entry；
修改 AuthorizationPolicy；
推送任意镜像；
绕过 Admission Controller；
访问 KMS 或 CA 签名接口；
修改 trust bundle。
```

那么发布平台被攻破后，身份体系大概率会被破坏。

如果发布平台权限被严格限制：

```text
只能向指定 namespace 发布指定应用；
不能自由指定 ServiceAccount；
镜像必须签名；
Deployment 必须通过 Admission Controller；
不能修改 SPIRE registration entry；
不能修改 AuthorizationPolicy；
不能访问 CA/KMS；
生产发布需要审批和双人复核。
```

那么发布平台被攻破后的影响面会被限制在特定应用、特定 namespace 或特定 ServiceAccount 范围内。

零信任系统的目标不是保证任何组件永远不会被攻破，而是保证单点被攻破后不能无限横向扩散。

---

## 8. CA、KMS、HSM 与证书签发边界

### 8.1 KMS 不应直接作为业务证书签发入口

mTLS 证书应由 PKI、CA 或 SPIRE 这类工作负载身份系统签发。KMS/HSM 的职责是保护 CA 私钥或签名密钥，而不是让业务服务直接调用 KMS 签发证书。

合理结构如下：

```text
Offline Root CA
        ↓
Intermediate CA per env / cluster / trust domain
        ↓
SPIRE Server / Istiod CA / Vault PKI
        ↓
Workload X.509-SVID
```

业务服务不应直接调用：

```text
kms.sign(csr)
```

而应通过受控 CA 服务完成：

```text
workload attestation
    ↓
registration entry 匹配
    ↓
CA 签发短周期 SVID
```

### 8.2 如何降低 CA/KMS 被攻破的影响

CA/KMS 是关键基础设施，无法被“完全信任消除”。工程上应通过以下方式降低影响范围：

```text
Root CA 离线保存；
Intermediate CA 按环境、集群、trust domain 拆分；
CA 私钥放入 HSM/KMS，设置为不可导出；
业务服务不得直接访问签名接口；
leaf certificate 使用短周期；
trust bundle 支持快速轮换；
签发行为必须完整审计；
异常签发必须告警；
CA 泄露时具备快速吊销和重建流程。
```

---

## 9. 服务间授权模型

### 9.1 认证不等于授权

认证回答：

```text
调用方是谁？
请求凭证是否有效？
连接对端是否可信？
```

授权回答：

```text
该调用方是否允许访问该资源？
该请求是否允许执行该动作？
当前环境、租户、路径、方法、数据等级是否符合策略？
```

认证通过不代表授权通过。服务 A 能证明自己是 `order-service`，不代表它可以访问 `payment-service` 的所有接口。

### 9.2 推荐授权判断条件

服务间授权应至少包含：

```text
source SPIFFE ID；
destination workload；
HTTP method / gRPC method；
path / RPC service / RPC method；
JWT issuer；
JWT audience；
JWT subject；
JWT scope；
tenant；
namespace；
environment；
数据等级；
请求风险等级。
```

示例授权逻辑：

```text
允许请求当且仅当：

1. mTLS 认证通过；
2. source principal = spiffe://prod/ns/order/sa/order-service；
3. JWT issuer 是可信认证中心；
4. JWT audience = payment-service；
5. JWT 未过期；
6. JWT scope 包含 payment:create；
7. 请求路径 = /internal/payments/create；
8. 当前租户、环境、数据等级符合策略；
9. 业务层确认调用方有权操作该订单。
```

### 9.3 策略实现方式

粗粒度服务间授权可以使用 Istio AuthorizationPolicy。复杂授权可以使用 OPA 或企业权限中心。资源级、租户级、数据行级权限仍应由业务服务进行二次授权。

合理分层如下：

| 层级           | 责任                    |
| ------------ | --------------------- |
| API Gateway  | 入口用户身份认证、外部请求准入       |
| Service Mesh | 服务间 mTLS、服务身份认证、粗粒度授权 |
| OPA / 权限中心   | 复杂策略、ABAC、跨服务策略       |
| 业务服务         | 资源归属、数据权限、业务状态校验      |

---

## 10. 认证算法、密钥类型与签名算法选择

### 10.1 连接级认证

服务间连接级认证应使用：

```text
mTLS + X.509-SVID + TLS 1.3
```

证书私钥应为每个工作负载独立生成，不应多个服务共享同一私钥。证书应短周期自动轮换。

证书签名算法可根据合规要求和基础设施支持选择：

```text
ECDSA P-256：兼容性和合规性较好，适合多数企业环境；
Ed25519 / EdDSA：性能和签名长度有优势，但需确认运行时、网格代理、HSM/KMS 和合规支持；
RSA-PSS：适合已有 RSA PKI 的企业，但密钥和签名体积较大。
```

### 10.2 请求级 JWT 签名

请求级 JWT 不建议在多服务验证场景中使用 HS256 作为主签名算法。原因是 HS256 属于对称签名，签发方和验证方共享同一密钥，任何验证方泄露密钥后都可能伪造 token。

生产环境更合理的是使用非对称签名：

```text
ES256：推荐优先选择，签名较短，性能和兼容性较好；
EdDSA：适合运行时和合规条件满足的现代系统；
PS256：适合已有 RSA 体系且需要 RSA-PSS 的系统；
RS256：历史兼容性强，但新系统不建议优先选择。
```

JWT 验证必须显式校验：

```text
alg 白名单；
iss；
aud；
exp；
nbf；
kid；
signature；
scope；
token type；
必要的业务 claims。
```

---

## 11. 企业级标准落地链路

综合前文，推荐链路如下：

```text
开发人员 / 发布平台
    ↓ 只能提交变更
Git / GitOps / 审批系统
    ↓ 受控变更
Kubernetes API Server
    ↓ 创建受限 workload
Admission Controller
    ↓ 校验 namespace / SA / image / labels / securityContext
SPIRE Agent
    ↓ workload attestation
SPIRE Server
    ↓ registration entry 匹配
CA / KMS / HSM
    ↓ 签发短周期 SVID
Workload
    ↓ 使用 SVID 做 mTLS
AuthorizationPolicy / OPA
    ↓ 判断是否允许访问
目标服务
```

生产级建议如下：

```text
1. SPIRE Server 部署为高可用控制面；
2. SPIRE Agent 以 DaemonSet 方式运行在每个 worker node；
3. 使用 SPIFFE CSI Driver 向 workload 注入 Workload API socket；
4. workload 通过 Workload API 获取 X.509-SVID；
5. 服务间通信强制 STRICT mTLS；
6. 请求级认证继续使用 JWT；
7. JWT 必须校验 issuer、audience、scope 和有效期；
8. AuthorizationPolicy 基于 source SPIFFE ID 和 request claims 授权；
9. OPA 或权限中心负责复杂 ABAC 策略；
10. 业务服务负责资源级二次授权；
11. Admission Controller 限制 ServiceAccount、镜像、label 和 securityContext；
12. ServiceAccount 使用权由平台和准入策略控制；
13. SPIRE registration entry 不只绑定 ServiceAccount，还应绑定 namespace、owner、image digest 等属性；
14. Root CA 离线，Intermediate CA 分环境或集群管理；
15. KMS/HSM 只保护 CA 私钥，不向业务服务开放任意签名能力；
16. 所有证书签发、认证失败、授权拒绝、策略变更必须审计。
```

---

## 12. 结论

微服务间零信任系统的核心不是单纯引入 JWT、mTLS 或 SPIRE，而是建立一条从发布、准入、节点认证、工作负载认证、证书签发、服务间通信到授权审计的完整信任链。

JWT 解决请求级身份与声明问题，mTLS 解决连接级工作负载身份与传输安全问题。SPIFFE/SPIRE 提供标准化工作负载身份模型，其中 SPIRE Server 负责身份注册和签发，SPIRE Agent 以 DaemonSet 方式运行在节点上，通过 Node Attestation 和 Workload Attestation 为 workload 提供 X.509-SVID 或 JWT-SVID。Admission Controller 负责阻止非法 workload 在 Kubernetes 中创建，尤其要限制 ServiceAccount 冒用、未签名镜像、危险 securityContext 和伪造 identity label。ServiceAccount 名称本身不是秘密，安全边界应建立在使用权控制、准入策略、SPIRE selector 组合和授权策略之上。

零信任仍然依赖信任根。区别在于，成熟的零信任系统会将信任根分层、隔离、审计、短周期化和可撤销化，而不是把整个内部网络、发布平台或 Kubernetes 集群整体视为可信。只有当发布平台、Kubernetes、SPIRE、CA/KMS、服务网格、Admission Controller 和授权系统形成职责分离与相互约束时，微服务间零信任体系才具备工程上的可信性。

---

## 参考文献

[1] NIST SP 800-207, Zero Trust Architecture.
[2] NIST SP 800-204A, Building Secure Microservices-based Applications Using Service-Mesh Architecture.
[3] SPIFFE Documentation, SPIFFE and SPIRE Concepts.
[4] SPIRE Documentation, SPIRE Concepts, Node Attestation, Workload Attestation.
[5] SPIRE Documentation, Install SPIRE Agents on Kubernetes.
[6] SPIRE Helm Charts Hardened Documentation.
[7] Kubernetes Documentation, Admission Controllers.
[8] Kubernetes Documentation, Service Accounts.
[9] Istio Documentation, PeerAuthentication.
[10] Istio Documentation, RequestAuthentication.
[11] Istio Documentation, AuthorizationPolicy.
[12] IETF RFC 8446, The Transport Layer Security Protocol Version 1.3.
[13] IETF RFC 8705, OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens.
[14] IETF RFC 8725, JSON Web Token Best Current Practices.
[15] IETF RFC 9068, JSON Web Token Profile for OAuth 2.0 Access Tokens.
[16] NIST SP 800-57 Part 1 Rev.5, Recommendation for Key Management.
