# HashiCorp Vault：企业密钥治理与动态凭证管理的安全中枢

## 一、结论先行

HashiCorp Vault 的核心定位不是“配置中心”，也不是单纯的“密码保险箱”，更不是 Kubernetes Secret 的增强版。它真正的产品定位，是面向企业级基础设施的 **身份驱动型密钥管理与敏感数据保护平台**。

我的判断很明确：如果企业已经进入微服务、多云、多集群、CI/CD 自动化、数据库账号众多、证书轮换困难、密钥散落在代码仓库和配置文件中的阶段，Vault 是非常值得建设的安全基础设施。但如果企业只有几十个服务，只是想把账号密码从配置文件挪到一个地方，直接上完整 Vault 体系可能是过度设计。

Vault 最有价值的地方，不是“集中存储密码”，而是把静态密钥治理升级为：身份认证、策略授权、动态凭证、短期租约、自动轮换、审计追踪、加密即服务、证书生命周期管理的一整套体系。[S1][S2]

一句话概括：**Vault 解决的不是“密码放哪里”的问题，而是“谁在什么时候，以什么身份，基于什么权限，获取了什么敏感能力”的问题。**

## 二、HashiCorp Vault 的产品定位是什么？

HashiCorp 官方文档对 Vault 的定义是：Vault 为关键数据提供集中化、可审计的特权访问与密钥管理能力，适用于本地、云上和混合环境。[S1]

从企业架构角度看，Vault 的定位可以拆成四层。

第一层是 **Secrets Management**。它可以集中管理 API Key、数据库密码、证书、Token、加密密钥等敏感信息，并通过 UI、CLI、HTTP API 供人、服务、机器、流水线访问。[S1]

第二层是 **Dynamic Secrets**。Vault 不只是保存已有密码，还能按需生成数据库、AWS、Azure、GCP、Kubernetes、SSH、PKI 等系统的短期凭证。凭证可以带 TTL，到期后自动失效或被撤销。这一点是 Vault 区别于普通密钥存储系统的关键。[S2][S3]

第三层是 **Encryption as a Service**。通过 Transit secrets engine，业务可以把加密、解密、签名、验签、HMAC、随机数生成等密码学操作交给 Vault 统一处理，业务系统只保存密文，不需要自己管理加密密钥。[S4]

第四层是 **Privileged Access Management / Zero Trust 的基础能力**。Vault 本身不等于完整 PAM，也不等于完整零信任平台，但它提供了人、机器、服务访问敏感系统时最关键的身份、凭证和审计能力。结合 Boundary、云 IAM、Kubernetes、服务网格、OPA 或企业权限系统，Vault 可以成为零信任体系中的密钥与凭证中枢。[S3]

所以，Vault 的正确定位应该是：**企业安全生命周期管理中的密钥、凭证、证书和敏感数据访问控制平台**。

## 三、Vault 当前的现状是什么？

Vault 当前已经是非常成熟的基础设施产品，不是实验性项目。

从产品归属看，HashiCorp 已经成为 IBM 旗下公司。IBM 于 2025 年 2 月 27 日宣布完成对 HashiCorp 的收购，HashiCorp 的产品被纳入 IBM 混合云和自动化体系中。[S5]

从版本状态看，截至 2026 年 6 月，Vault 官方文档显示当前文档线为 v2.x latest，GitHub 最新 release 是 v2.0.1，发布时间是 2026 年 5 月 19 日。[S6]

从社区活跃度看，Vault GitHub 仓库显示约 35.7k stars、4.7k forks、1.2k open issues、260 个 open pull requests、179 个 releases。这说明 Vault 的生态非常成熟，但同时也说明它不是一个“无复杂度”的工具。[S6]

从产品形态看，Vault 主要有三种使用方式：

第一种是自托管 Vault Community，适合中小团队、内部平台团队、非强合规场景。

第二种是 Vault Enterprise，适合需要 namespace、多租户、性能复制、灾备复制、企业支持、合规治理的大型组织。

第三种是 HCP Vault Dedicated，官方文档说明它使用与自管理 Vault Enterprise 相同的 binary，但由 HashiCorp Cloud Platform 托管，适合不想自运维 Vault 集群的企业。[S1]

我的判断是：Vault 已经过了“能不能用”的阶段，现在真正的问题是“企业有没有能力把它治理好”。

## 四、Vault 解决了什么问题？

### 1. 解决密钥散落问题

没有 Vault 的企业，密钥通常散落在配置文件、环境变量、Kubernetes Secret、CI/CD 变量、代码仓库、数据库表、Wiki 文档、个人电脑、运维脚本里。问题不是这些地方完全不能存，而是它们缺少统一生命周期、统一访问控制、统一审计和统一轮换能力。

Vault 把密钥访问统一到一个 API、一个策略模型和一个审计体系下。官方文档明确提到，Vault 用统一接口访问 secret，并提供严格访问控制和详细审计日志。[S2]

### 2. 解决长期静态凭证问题

静态密码最大的问题是：一旦泄露，攻击者可以长期使用；而且轮换成本高，业务不敢频繁改。

Vault 的动态凭证机制可以在应用访问数据库、云资源、SSH、PKI 时临时生成凭证，并通过租约机制自动过期或撤销。官方文档提到，Vault 会给 secret 关联 lease，lease 到期后自动 revoke，客户端也可以通过 API renew。[S2]

这对数据库账号治理非常关键。传统做法是一个服务长期持有一个数据库账号；Vault 的更优做法是服务按需申请短期数据库账号，访问结束后自动回收。

### 3. 解决证书签发和轮换问题

内部 mTLS、服务证书、客户端证书、机器证书是很多企业的隐性债务。证书过期、私钥散落、人工 CSR 流程、吊销困难，都会造成线上事故。

Vault 的 PKI secrets engine 可以动态生成 X.509 证书，服务不必人工生成私钥、CSR、提交 CA、等待签发。官方文档还建议通过较短 TTL 减少对吊销的依赖，并支持更大规模的工作负载证书管理。[S7]

### 4. 解决应用加密能力不一致问题

很多业务团队自己写加密逻辑，常见问题包括算法选择不当、密钥硬编码、密钥轮换困难、加密和签名边界混乱。Vault Transit 可以把密码学能力集中到安全团队维护的平台中。业务只调用 encrypt/decrypt/sign/verify，不直接接触主密钥。[S4]

这对金融、支付、医疗、日志脱敏、隐私字段加密特别有价值。

### 5. 解决审计不可追踪问题

Vault 支持 audit devices，并且默认会对大多数字符串值写入 HMAC-SHA256 哈希，避免审计日志本身泄露敏感内容。[S8]

这意味着安全团队可以追踪“谁访问了哪个路径、何时访问、通过什么 auth method、命中了什么 policy”，而不是事后只能查分散系统日志。

## 五、Vault 目前还有哪些缺陷？

Vault 的缺陷不在于能力弱，而在于它很容易被低估接入和治理成本。

### 1. Vault 是高价值基础设施，自己也会成为关键风险点

Vault 集中管理密钥、证书、数据库凭证、云访问凭证。一旦 Vault 不可用，业务可能无法获取新凭证；一旦 Vault 被错误配置，风险会被集中放大。

官方 HA 文档明确说明，Vault 支持多 Server 高可用模式，但 HA 并不会提升横向扩展能力，Vault 的瓶颈通常在数据存储而不是 Vault core。[S9]

这句话非常重要。很多人以为 Vault 多部署几个节点就能无限扩容，这是错误的。Vault 的集群设计、存储后端、读写模型、租约数量、审计日志、网络延迟都会影响稳定性。

### 2. 生产部署门槛不低

Vault 官方 production hardening 文档给出了一系列基线要求：不要用 root 运行、使用最小写权限、生产环境必须端到端 TLS、关闭 swap、禁用 core dump、尽量单租户运行等。[S10]

这些要求说明一个现实：Vault 不是“部署一个容器就完事”的组件。它需要专门的安全运维能力，包括初始化、unseal、auto-unseal、HA、备份、快照、审计、TLS、监控、升级、灾备演练。

如果企业没有基础设施平台团队托底，Vault 很容易变成新的运维负担。

### 3. 动态凭证不是所有系统都能无缝适配

Vault 支持很多 secrets engine，但并不代表所有遗留系统都能立即接入动态凭证。老系统可能不支持账号动态创建，不支持短 TTL，不支持连接池凭证热刷新，或者业务代码默认把数据库账号当成长期静态配置。

这意味着 Vault 的收益不是“部署后自动获得”，必须配合应用改造、连接池治理、SDK 封装、Agent 模板、灰度迁移和故障降级。

### 4. Policy 和路径模型容易复杂化

Vault 的 policy 是 path-based，并且默认拒绝所有权限。[S11] 这个模型很灵活，但在大企业中会迅速膨胀：不同环境、团队、应用、命名空间、密钥路径、读写权限、审批流程叠加后，policy 会变得难以维护。

如果没有命名规范和自动化治理，Vault policy 最后会变成另一套 ACL 泥潭。

### 5. 版本和商业边界需要关注

HashiCorp 在 2023 年将未来产品版本切换到 Business Source License 1.1。BSL 是 source-available，不是传统意义上的开源许可证；它允许复制、修改、非生产使用以及特定条件下的商业使用，但对竞争性产品有约束。[S12]

普通企业内部使用 Vault 通常不是问题，但如果你要基于 Vault 做商业化托管服务、二次封装成竞品，或者强依赖开源许可证合规，就必须让法务和合规团队提前评估。

### 6. 当前 v2.x 迁移期仍有边角问题

Vault v2.0.1 的 release notes 提到容器构建时设置了 `cap_ipc_lock` capability，容器运行时需要增加 IPC_LOCK 能力；GitHub 当前 open issue 中也可以看到 v2.0.1 rootless 容器启动、docker-entrypoint、KV UI、snapshot restore、PKI DNS SAN 等问题。[S6][S13]

这不是说 Vault 不稳定，而是说明：**生产环境不要盲目追最新版本，尤其是 2.0 大版本迁移阶段。**

## 六、ROI 有多少？

Vault 没有一个官方统一 ROI 数字，因为它的收益取决于企业规模、密钥数量、系统复杂度、审计要求、合规压力、凭证泄露风险和应用改造成本。强行写“ROI 固定 300%”是不专业的。

比较合理的 ROI 模型是：

**Vault ROI = 密钥泄露风险降低收益 + 凭证轮换自动化收益 + 审计合规收益 + 证书管理自动化收益 + 数据加密治理收益 - 平台建设和迁移成本。**

公开案例中已经能看到一些可量化收益。

Canva 使用 Vault 消除 secret sprawl、集中化密钥管理，并披露 Vault 支撑每月 200 万次 build 和后端 secret reads，迁移了 80% 的后端系统。[S14]

ManTech 使用 Vault 自动化凭证轮换和密钥管理，官方案例显示其节省了每年 400 个工作小时，并把安全设置和服务交付从数月缩短到 2 到 3 周。[S15]

NORD/LB 的官方引用更直接：在使用 Vault 之前，每月手工管理和轮换 key 至少需要 3 到 4 个完整工作日；使用 Vault 后降到不到 5 分钟。[S16]

从风险角度看，IBM 2025 年数据泄露成本报告给出的全球平均数据泄露成本是 440 万美元；报告还强调身份安全、数据加密、密钥管理和非人类身份治理的重要性。[S17]

所以我的判断是：

小团队使用 Vault，ROI 不一定高。因为部署、学习、运维成本可能超过静态密钥治理收益。

中型企业使用 Vault，ROI 通常为正。尤其是数据库账号、CI/CD Secret、Kubernetes Secret、证书管理、云访问凭证已经失控时，Vault 的收益会很明显。

大型企业使用 Vault，ROI 不应该只按节省人力计算，更应该按风险敞口降低、审计合规效率、凭证泄露概率下降、生产事故减少来算。

## 七、适用于哪些业务和场景？

### 1. 微服务数据库动态凭证

适合每个服务访问不同数据库、不同 schema、不同权限集的场景。Vault 可以为服务动态生成数据库账号，到期自动撤销，减少长期账号泄露风险。

### 2. CI/CD 流水线密钥治理

CI/CD 是密钥泄露重灾区。Buildkite、GitLab CI、GitHub Actions、Jenkins 里经常存在大量云 AK/SK、Docker Registry 密码、部署 Token。Vault 可以通过 OIDC、AppRole、JWT、Kubernetes Auth 等方式让流水线按身份获取短期凭证。

Canva 的案例就从 build system 迁移开始，通过 OIDC 为 Buildkite agents 提供短期、pipeline-specific 的 secret 访问。[S14]

### 3. Kubernetes 应用密钥注入

Kubernetes Secret 本身只是 base64 编码，不等于强密钥治理。Vault 可以通过 Agent Injector、CSI Provider、Vault Secrets Operator 等方式把 secret 注入 Pod 或同步到 Kubernetes Secret。

但这里要注意：如果只是把 Vault secret 同步成 Kubernetes Secret，安全边界又回到了 Kubernetes Secret。因此高安全场景更推荐短 TTL、按需获取、最小权限和应用级 reload 能力。

### 4. 内部 PKI 和服务证书管理

适合内部 mTLS、API Gateway 客户端证书、数据库客户端证书、服务网格外的服务证书、批处理任务证书等场景。Vault PKI 的价值在于自动签发、短 TTL、减少人工 CSR 流程和私钥散落。[S7]

### 5. 敏感字段加密和合规数据保护

适合支付、金融、医疗、用户隐私、日志脱敏、身份证号、手机号、银行卡号、访问令牌等敏感字段加密场景。Transit engine 能让业务系统只保存密文，把密钥管理和加密策略交给 Vault。[S4]

### 6. 多云凭证和非人类身份治理

在 AWS、Azure、GCP、Kubernetes、数据库、SSH 等系统都存在的环境中，Vault 可以通过身份和策略统一控制机器、服务、流水线、AI Agent 访问敏感资源的方式。[S3]

这类场景是 Vault 未来最重要的方向之一，因为非人类身份数量会远超人类用户。

## 八、接入成本有多高？

Vault 的接入成本要分层看。

### 1. PoC 成本：低到中等

如果只是做 KV secret 存储、简单 AppRole、Kubernetes Auth、Vault Agent 模板，1 到 2 周可以完成 PoC。

但这个阶段只能证明“能跑”，不能证明“能生产”。

### 2. 平台建设成本：中到高

真正生产落地需要设计：

Vault 集群拓扑、HA 存储、Integrated Storage 或外部存储、auto-unseal、TLS、audit devices、监控告警、备份恢复、policy 命名规范、secret path 规范、auth method、namespace、多环境隔离、升级回滚、灾备演练。

这通常需要 1 到 2 名资深平台/安全工程师投入 1 到 3 个月。

### 3. 业务迁移成本：取决于使用方式

最低成本方式是 Vault Agent 模板渲染，把 secret 写到文件，业务几乎不改代码。但这种方式对动态凭证和热更新支持有限。

中等成本方式是接入 SDK 或封装企业内部 Secret Client，让业务按需读取和 renew secret。

最高成本方式是全面动态凭证化，包括数据库账号动态生成、连接池重建、证书自动刷新、短 TTL、失败降级和审计联动。这种方式收益最大，但改造成本也最高。

我的建议是：不要一开始全量推广。应该从一个高收益场景切入，例如 CI/CD Secret、数据库动态账号、内部 PKI、Kubernetes Secret 治理，做成标准模板后再推广。

## 九、当前有哪些公司已经在用？

公开官方案例中，Vault 相关实践比较明确的包括：

Canva：使用 Vault 消除 secret sprawl、集中化密钥管理、支撑每月 200 万次 build 和后端 secret reads。[S14]

ManTech：使用 Vault 与 Terraform、Boundary 构建零信任和自动化凭证治理体系，节省每年 400 个工作小时，把交付周期从数月缩短到 2 到 3 周。[S15]

Simpli.fi：在云成熟度模型和零信任框架中使用 Terraform、Consul、Nomad 和 Vault，用于提升云基础设施一致性、安全性和成本效率。[S18]

NORD/LB：官方产品页引用其使用 Vault 后把手工 key 轮换从每月 3 到 4 个工作日降到不到 5 分钟。[S16]

此外，HashiCorp 官网展示了多个大型组织客户和受信组织，包括 Walgreens、Lufthansa、Indeed、GSK、Deutsche Bank、Airbnb、ADT、Wayfair、Samsung、Autodesk、BNP Paribas、AstraZeneca 等。[S19]

但这里必须严谨：官网 logo 不等于每家公司都公开披露了 Vault 细节。能作为 Vault 深度案例引用的，还是 Canva、ManTech、Simpli.fi、NORD/LB 这类公开材料。

## 十、当前迭代情况和还存在的 issue

截至 2026 年 6 月，Vault 最新 release 是 v2.0.1。这个版本包含安全修复、插件升级、Identity 模板通配符限制、审计路径校验、Secrets Sync UI 的 Workload Identity Federation 支持、billing dashboard、消费计量改进、Transit PQC 签名实现相关改进，以及多项数据库、PKI、UI、Secrets Sync 修复。[S6]

v2.0.0 是一个更大的版本节点，包含 SDK Docker helper 从 Docker 迁移到 Moby、多个安全依赖升级、AWS Auth 缓存绕过认证问题修复、证书续期校验增强、Authorization header 处理修复，以及 token header size 限制来缓解潜在 DoS 风险。[S20]

当前 GitHub open issue 主要集中在几类：

第一类是容器和 Kubernetes 部署问题，例如 v2.0.1 UBI image 在 rootless 环境中因 IPC_LOCK 要求无法启动，以及 docker-entrypoint.sh broken。[S13]

第二类是 UI 和易用性问题，例如 KV UI 中 Manage 按钮可能导致误禁用 engine、Enterprise license 不存在时隐藏 recover tab 等。[S13]

第三类是存储和恢复问题，例如 snapshot restore functionality broken。[S13]

第四类是 secrets engine 边角问题，例如 LDAP bind 失败、PKI DNS SAN 下划线处理、KV 只读 key 不读 value 的权限需求等。[S13]

第五类是权限模型增强需求，例如创建 orphan token 的单独权限、读取 secret key 但不读取 value 的角色需求。[S13]

我的判断是：Vault 当前仍在高频迭代，能力很强，但复杂度也在持续上升。企业生产环境更应该关注稳定性、升级路径和兼容性，而不是盲目追新。

## 十一、最终建议

如果你的企业存在以下问题，应该认真评估 Vault：

密钥散落在代码仓库、配置中心、Kubernetes Secret、CI/CD 变量和运维脚本里；

数据库账号长期不轮换，多个服务共享账号；

证书签发、过期、吊销依赖人工流程；

云 AK/SK 长期保存在配置文件中；

安全审计无法回答“谁访问了哪个 secret”；

微服务、批处理、CI/CD、AI Agent 等非人类身份越来越多；

业务需要字段级加密，但不想让每个团队自己管理密钥。

如果企业还很小，只是单集群、少量服务、无强合规要求，Vault 可以先作为规划，不一定马上建设完整体系。先把密钥从代码中移走、规范 Kubernetes Secret、减少明文配置，再逐步引入 Vault。

真正成熟的落地路径应该是：

第一阶段，集中静态 secret，建立审计和访问控制；

第二阶段，接入 CI/CD 和 Kubernetes，减少密钥散落；

第三阶段，数据库和云凭证动态化；

第四阶段，PKI、Transit、零信任和非人类身份治理；

第五阶段，企业多租户、灾备复制、跨区域高可用和合规体系。

一句话总结：**Vault 的价值不是“保存密码”，而是把企业的密钥、凭证、证书和敏感数据访问，从人工经验治理推进到身份驱动、策略控制、自动轮换、可审计、可撤销的工程化治理。**

## 来源索引

[S1] HashiCorp Developer 官方文档定义 Vault 为集中化、可审计的特权访问和 secret management 平台，并说明其可通过 UI、CLI、HTTP API 管理 token、password、certificate、encryption key 等敏感数据。([HashiCorp Developer][1])

[S2] Vault GitHub README 说明 Vault 提供统一 secret 接口、访问控制、详细审计日志，并支持 secure secret storage、dynamic secrets、data encryption、leasing/renewal、revocation。([GitHub][2])

[S3] HashiCorp 官方 cloud access management 文档说明 Vault 可基于服务身份和策略授予 secret 访问，并原生支持 Google Cloud、Azure、AWS、Kubernetes、SSH、Database、PKI 等 secrets engines。([HashiCorp Developer][3])

[S4] Transit secrets engine 官方文档说明其可作为 cryptography/encryption as a service，处理加密、解密、签名、验签、HMAC、随机数生成，且 Vault 不存储发送给 transit 的业务数据。([HashiCorp Developer][4])

[S5] IBM 官方新闻稿：IBM 于 2025 年 2 月 27 日宣布完成对 HashiCorp 的收购。([IBM Newsroom][5])

[S6] Vault GitHub release 与仓库信息：最新版本 v2.0.1 发布于 2026 年 5 月 19 日；仓库展示 stars、forks、issues、pull requests、release 数等信息；v2.0.1 release notes 包含 breaking changes、安全更新、WIF、billing、PQC transit 等更新。([GitHub][6])

[S7] PKI secrets engine 官方文档说明 Vault 可动态生成 X.509 证书，并通过短 TTL、减少吊销依赖、支持 ephemeral certificates 来适应大规模工作负载。([HashiCorp Developer][7])

[S8] Vault audit devices 官方文档说明 Vault 默认对大多数字符串值在审计日志中写入 HMAC-SHA256，以保护敏感信息。([HashiCorp Developer][8])

[S9] Vault HA 官方文档说明 Vault 支持多 server HA，但 HA 不提升横向扩展能力，瓶颈通常在 datastore 而非 Vault core。([HashiCorp Developer][9])

[S10] Vault production hardening 官方文档列出生产基线：不以 root 运行、最小写权限、端到端 TLS、关闭 swap、禁用 core dump、单租户等。([HashiCorp Developer][10])

[S11] Vault policies 官方文档说明 Vault policy 是 path-based，并且默认拒绝访问，空 policy 不授予任何权限。([HashiCorp Developer][11])

[S12] HashiCorp 官方 BSL 说明与 license FAQ：HashiCorp 于 2023 年采用 Business Source License，BSL 是 source-available，并对复制、修改、非生产使用、商业使用条件、竞争性产品等作出约束。([HashiCorp | An IBM Company][12])

[S13] Vault GitHub 当前 open issues 列表显示 v2.0.1 rootless IPC_LOCK、docker-entrypoint、KV UI、NO_PROXY、LDAP、snapshot restore、PKI DNS SAN、orphan token 权限等 open issues。([GitHub][13])

[S14] Canva 官方案例：Canva 使用 Vault 消除 secret sprawl、自动化 secret rotation，支撑每月 200 万次 build 和 backend secret reads，并迁移了 80% backend systems。([HashiCorp | An IBM Company][14])

[S15] ManTech 官方案例：ManTech 使用 Vault 自动化 credential cycling 和 key management，节省每年 400 工作小时，并将服务交付从数月缩短到 2–3 周。([HashiCorp | An IBM Company][15])

[S16] HashiCorp Vault 产品页引用 NORD/LB：使用 Vault 前每月手工管理和轮换 key 至少需要 3 到 4 个完整工作日，使用后不到 5 分钟。([HashiCorp | An IBM Company][16])

[S17] IBM Cost of a Data Breach Report 2025：全球平均数据泄露成本为 440 万美元，并强调身份安全、数据安全、加密和密钥管理的重要性。([IBM][17])

[S18] Simpli.fi 官方案例：Simpli.fi 使用 Terraform、Consul、Nomad 和 Vault 支撑云成熟度模型和零信任安全框架。([HashiCorp | An IBM Company][18])

[S19] HashiCorp 官网展示的受信组织 logo 包括 Walgreens、Lufthansa、Indeed、GSK、Deutsche Bank、Airbnb、ADT、Wayfair、Samsung、Autodesk、BNP Paribas、AstraZeneca 等。([HashiCorp | An IBM Company][19])

[S20] Vault v2.0.0 release notes：包含 Docker helper 迁移、多个安全依赖升级、AWS Auth 认证绕过修复、cert renew 校验、Authorization header 处理、token header size 限制等。([GitHub][6])

[1]: https://developer.hashicorp.com/vault/docs/about-vault/what-is-vault "What is Vault? | Vault | HashiCorp Developer"
[2]: https://github.com/hashicorp/vault "GitHub - hashicorp/vault: A tool for secrets management, encryption as a service, and privileged access management · GitHub"
[3]: https://developer.hashicorp.com/vault/docs/concepts/cloud-access-management "Cloud access management | Vault | HashiCorp Developer"
[4]: https://developer.hashicorp.com/vault/docs/secrets/transit?utm_source=chatgpt.com "Transit secrets engine | Vault"
[5]: https://newsroom.ibm.com/2025-02-27-ibm-completes-acquisition-of-hashicorp%2C-creates-comprehensive%2C-end-to-end-hybrid-cloud-platform "IBM Completes Acquisition of HashiCorp, Creates Comprehensive, End-to-End Hybrid Cloud Platform"
[6]: https://github.com/hashicorp/vault/releases "Releases · hashicorp/vault · GitHub"
[7]: https://developer.hashicorp.com/vault/docs/secrets/pki "PKI secrets engine | Vault | HashiCorp Developer"
[8]: https://developer.hashicorp.com/vault/docs/audit?utm_source=chatgpt.com "Audit Devices | Vault"
[9]: https://developer.hashicorp.com/vault/docs/concepts/ha "High Availability | Vault | HashiCorp Developer"
[10]: https://developer.hashicorp.com/vault/docs/concepts/production-hardening "Production hardening | Vault | HashiCorp Developer"
[11]: https://developer.hashicorp.com/vault/docs/concepts/policies "Policies | Vault | HashiCorp Developer"
[12]: https://www.hashicorp.com/en/license-faq?utm_source=chatgpt.com "HashiCorp Licensing FAQ"
[13]: https://github.com/hashicorp/vault/issues "Issues · hashicorp/vault · GitHub"
[14]: https://www.hashicorp.com/en/case-studies/canva?utm_source=chatgpt.com "Canva"
[15]: https://www.hashicorp.com/en/case-studies/mantech?utm_source=chatgpt.com "ManTech"
[16]: https://www.hashicorp.com/en/products/vault "HashiCorp Vault | Identity-based secrets management"
[17]: https://www.ibm.com/reports/data-breach?utm_source=chatgpt.com "Cost of a Data Breach Report 2025"
[18]: https://www.hashicorp.com/en/case-studies/simpli-fi?utm_source=chatgpt.com "Simpli.fi"
[19]: https://www.hashicorp.com/en "HashiCorp | An IBM Company"
