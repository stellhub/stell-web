# 数据加解密体系的设计与落地解决方案研究：以信封加密、密钥管理与 Vault/KMS 实现为中心

## 摘要

数据加解密是信息系统中保护数据机密性、完整性与访问边界的重要技术组成。现代企业系统通常同时面临静态数据保护、传输过程保护、应用层敏感字段保护、密钥生命周期管理、权限隔离、审计追踪与合规落地等需求。根据 NIST、AWS、Google Cloud、Microsoft Azure 与 HashiCorp Vault 等官方文档，业界通用实践并不是使用单一密钥直接加密所有业务数据，而是采用分层密钥管理体系，其中信封加密是云服务、KMS、HSM 与 Vault Transit 等系统广泛采用的标准模式。信封加密通过数据密钥加密业务数据，再通过密钥加密密钥或主密钥加密数据密钥，从而实现数据加密操作与密钥保护操作的分离。本文围绕常见加解密方式、信封加密的密钥层级、根密钥、主密钥、数据密钥的概念及生命周期、密钥存储与轮转、远程加密与本地加密差异、HashiCorp Vault 标准实现以及云厂商 KMS 实现模式展开分析，并提出面向企业系统的落地设计框架。

**关键词**：数据加密；信封加密；密钥管理；KMS；HashiCorp Vault；数据密钥；主密钥；密钥轮转

---

## 1 引言

随着企业系统中用户数据、交易数据、身份数据、日志数据和业务配置数据规模持续增长，数据安全保护从单点算法选择逐步演进为“算法、密钥、权限、审计、轮转、隔离、可恢复性”协同设计的问题。NIST SP 800-57 将密钥管理定义为密码系统中的核心管理活动，其内容包括密钥材料的生成、保护、使用、分发、存储、轮转、恢复与销毁等多个环节 [1]。因此，企业数据加解密方案不应仅讨论“使用何种算法”，还应明确密钥如何生成、如何存储、如何授权、如何轮转、如何审计以及如何在故障或泄露场景下恢复安全状态。

从算法层面看，AES 是 NIST FIPS 197 指定的对称分组密码标准，可用于保护电子数据 [2]。在现代系统中，AES 通常不会单独使用，而是结合特定工作模式使用。NIST SP 800-38D 规定了 GCM 与 GMAC，其中 GCM 属于认证加密模式，可同时提供机密性和完整性保护 [3]。从工程实践看，AES-GCM、KMS、HSM、Vault Transit、云厂商托管密钥、客户端加密 SDK 等共同组成了企业加解密落地体系。

在大规模数据场景中，直接使用根密钥或主密钥加密业务数据并不符合通用工程实践。AWS KMS、Google Cloud KMS、Azure 加密模型与 HashiCorp Vault 均采用或支持多层密钥结构。其核心思想是：使用短生命周期或细粒度的数据密钥加密具体业务数据，使用更高层级、更受保护的密钥加密数据密钥。该模式即信封加密 [4][5][6]。

---

## 2 常见加解密方式

### 2.1 对称加密

对称加密使用同一个密钥完成加密与解密。AES 是现代系统中最常见的对称加密算法之一。FIPS 197 指出，AES 是一种对称分组密码，可对信息进行加密和解密，并将明文转换为不可理解的密文 [2]。在工程落地中，AES 常与 GCM 模式结合使用。GCM 属于认证加密模式，可以同时提供数据机密性和认证保护 [3]。

对称加密适用于大批量数据加密场景，例如数据库字段加密、对象存储文件加密、日志内容加密、缓存数据加密、备份文件加密等。其主要工程特征是加解密性能较高，适合本地处理大数据块；其关键约束是密钥必须被严格保护，因为获得同一密钥的主体可以同时执行加密和解密。

### 2.2 非对称加密

非对称加密使用公钥和私钥组成密钥对。公钥通常用于加密或验签，私钥用于解密或签名。非对称加密在密钥分发、身份认证、数字签名、跨主体数据共享等场景中具有工程价值。但相较于对称加密，非对称加密通常不直接用于大规模业务数据加密，而是用于加密较小的数据密钥、进行密钥交换或完成签名验签操作。

在信封加密体系中，业务数据通常由对称数据密钥加密，而数据密钥可以由对称 KEK、非对称公钥、HSM 托管密钥或 KMS 托管密钥进行包装。AWS Encryption SDK 官方文档指出，信封加密可以结合对称与非对称算法：数据使用对称加密，数据密钥可使用适合包装密钥的对称或非对称算法加密 [7]。

### 2.3 哈希、HMAC 与加密的边界

哈希函数并不是加密算法。加密操作要求密文在授权条件下可以被还原为明文，而哈希函数是单向摘要计算，通常用于完整性校验、索引、去重、签名输入或不可逆标识生成。HMAC 是基于密钥的消息认证码，用于验证消息完整性和来源真实性，但同样不用于还原明文。

在企业敏感数据治理中，哈希适用于不需要还原明文的场景，例如唯一性匹配、不可逆指纹、密码摘要存储等；加密适用于需要在授权场景下恢复明文的场景，例如证件号、手机号、邮箱、支付信息、业务配置密钥等。因此，数据治理设计中应明确区分“可逆加密”“不可逆哈希”“脱敏展示”和“访问控制”四类能力。

### 2.4 认证加密

认证加密用于同时保护数据机密性和完整性。AES-GCM 是企业系统中常见的认证加密方案之一。NIST SP 800-38D 将 GCM 定义为认证加密算法，同时定义了 GMAC 用于消息认证 [3]。在工程实现中，AES-GCM 输出通常包含密文、nonce 或 IV、认证标签 tag 以及可选的关联数据 AAD。AAD 不被加密，但参与认证计算，适合绑定租户 ID、表名、字段名、版本号、业务上下文等信息。

---

## 3 信封加密模型

### 3.1 信封加密的基本定义

信封加密是指使用一个密钥加密数据，再使用另一个密钥加密前一个密钥的密钥分层技术。AWS KMS 官方文档将信封加密定义为：使用数据密钥加密明文数据，再使用另一个密钥加密该数据密钥 [4]。Google Cloud KMS 官方文档也将其描述为“用一个密钥加密另一个密钥”的过程 [6]。

信封加密的基本结构如下：

1. 生成数据密钥 DEK。
2. 使用 DEK 对业务明文数据执行本地加密，生成业务密文。
3. 使用主密钥、KEK 或 KMS Key 对 DEK 进行加密包装，生成 encrypted DEK。
4. 将业务密文、encrypted DEK、密钥版本、算法标识、nonce/IV、tag、AAD 元数据一起存储。
5. 解密时，先调用 KMS、Vault 或本地密钥系统解开 encrypted DEK，再使用 DEK 解密业务密文。

该结构将大体量数据加密与高价值密钥保护解耦。业务数据由细粒度 DEK 加密，DEK 由集中式高安全等级密钥保护。Google Cloud KMS 文档明确指出，Cloud KMS 被设计用于管理 KEK，单个 KEK 可以保护多个 DEK，从而支持每个数据对象使用独立 DEK，同时避免中央密钥服务中保存过多密钥 [6]。

### 3.2 信封加密的工程数据结构

在数据库字段、文件对象或消息加密场景中，推荐将加密结果封装为结构化 Envelope Ciphertext。一个典型结构如下：

```json
{
  "ciphertext": "base64(data ciphertext)",
  "encryptedDataKey": "base64(wrapped DEK)",
  "keyId": "kms/vault/key identifier",
  "keyVersion": "version number or key material version",
  "algorithm": "AES-256-GCM",
  "iv": "base64(96-bit nonce)",
  "tag": "base64(auth tag)",
  "aad": {
    "tenantId": "tenant identifier",
    "resourceType": "table or object type",
    "field": "encrypted field name"
  }
}
```

该结构中，业务系统持久化的是密文与被加密的数据密钥，不持久化明文 DEK。Google Cloud KMS 文档明确给出信封加密流程：生成本地 DEK，使用 DEK 加密数据，使用 KEK 包装 DEK，并存储加密数据和被包装的 DEK，同时明确警告不得存储明文 DEK [6]。AWS KMS GenerateDataKey 文档也要求在使用明文数据密钥完成本地加密后，从内存中擦除明文数据密钥，并将加密后的数据密钥与密文一起保存 [5]。

---

## 4 信封加密中的密钥层级

### 4.1 根密钥

根密钥是密钥体系中最高层级或接近最高层级的密钥材料。AWS KMS 文档指出，在多层密钥链中，最终必须有一个保持可用于解密其他密钥和数据的顶层明文密钥，该顶层明文 KEK 被称为 root key；AWS KMS 中的 root key 由 KMS 保护，未加密状态下不会离开 AWS KMS 的硬件安全模块 [4]。

在 Vault 中，根密钥的概念体现为 Vault 启封过程中的 root key。Vault 官方文档说明，Vault 使用 keyring 中的 encryption key 加密大多数数据；为了保护 encryption key，Vault 使用 root key 加密该 encryption key；root key 又由 unseal key 加密并随其他 Vault 数据存储。Vault 启封的本质是获得 root key，以便解密 keyring [11]。

根密钥的作用不是直接加密业务数据，而是用于保护下一层密钥材料或解开内部密钥环。其作用时间通常较长，但实际暴露窗口应极短。在 HSM/KMS 模型中，根密钥通常位于密码边界内，业务应用不能直接读取。在 Vault Shamir Seal 模型中，root key 需要通过达到阈值数量的 unseal key shares 才能恢复；在 Auto Unseal 模型中，root key 的解密责任委托给云 KMS 或 HSM 等受信服务 [11]。

### 4.2 主密钥、KEK 与 Wrapping Key

主密钥在不同产品中名称不同。在 AWS KMS 中，KMS key 用于保护数据密钥；在 Google Cloud KMS 与 Azure 模型中，KEK 用于包装 DEK；在 AWS Encryption SDK 中，wrapping key 或 master key provider 用于加密数据密钥 [4][6][7][12]。

主密钥的主要职责是加密、解密或包装数据密钥，而不是直接处理大体量业务数据。Google Cloud KMS 文档指出，DEK 由 KEK 加密，也称为 wrapped；KEK 应集中存储并定期轮转 [6]。Azure 文档指出，KEK 用于通过信封加密加密 DEK，且 KEK 不离开 Key Vault，由此可以控制数据密钥并实现访问主体隔离 [12]。

主密钥的作用时间通常长于数据密钥。其生命周期以月、季度、年或合规周期为单位进行管理，并通过版本化机制支持旧密文解密。AWS KMS 文档说明，KMS key 轮转后，加密新数据时使用当前密钥材料，解密旧数据时 AWS KMS 自动选择加密时使用的密钥材料版本 [9]。因此，主密钥轮转通常不要求立即重写所有历史业务密文，但需要保存旧版本密钥材料以支持历史数据解密。

### 4.3 数据密钥

数据密钥是直接加密业务数据的密钥。Google Cloud KMS 文档将用于加密数据本身的密钥称为 Data Encryption Key，即 DEK [6]。Azure 文档也将 DEK 定义为用于加密分区或数据块的对称 AES-256 密钥 [12]。AWS KMS GenerateDataKey 接口会返回一个明文数据密钥和一个由指定 KMS key 加密后的数据密钥副本，应用使用明文数据密钥在 KMS 外部加密数据，再保存 encrypted data key [5]。

数据密钥的作用时间应短于主密钥。Google Cloud KMS 建议每次写入数据时生成新的 DEK，并指出这种模式下不需要轮转 DEK；同时建议不要使用同一个 DEK 加密两个不同用户的数据 [6]。AWS Encryption SDK 也说明，除非使用数据密钥缓存，否则每条消息使用唯一数据密钥加密 [7]。

从工程角度看，DEK 的常见粒度包括：

1. 每条消息一个 DEK。
2. 每个文件一个 DEK。
3. 每个对象一个 DEK。
4. 每个数据库行或敏感字段组一个 DEK。
5. 每个租户、分区或数据块一个 DEK。

DEK 粒度越细，单个密钥泄露影响范围越小，但 encrypted DEK 数量、KMS 调用量和元数据存储成本越高。DEK 粒度越粗，加解密成本越低，但密钥复用范围更大。实际系统应根据数据敏感等级、访问频率、密文体量、租户隔离要求和审计要求确定粒度。

---

## 5 密钥存储最佳实践

### 5.1 密钥与数据分离

密钥存储的核心原则是密钥与密文分离。业务数据库可以保存业务密文和 encrypted DEK，但不应保存明文 DEK、主密钥或根密钥。AWS KMS 文档说明，encrypted data key 可以与 encrypted data 一起安全保存，因为数据密钥本身已经被另一个密钥保护 [4][5]。Google Cloud KMS 也明确要求不要存储明文 DEK [6]。

### 5.2 高层级密钥集中托管

主密钥、KEK、wrapping key 应由集中式密钥管理系统托管，例如 KMS、HSM、Vault 或云厂商 Key Vault。Google Cloud KMS 建议集中存储 KEK；Azure Key Vault 提供密钥、机密与证书管理能力，Premium 层支持由 FIPS 140-3 Level 3 验证的 HSM 保护密钥 [6][12]。AWS Encryption SDK 文档也指出，可以使用 AWS KMS、HSM 或其他密钥管理工具保护 wrapping key [7]。

集中托管的价值在于统一访问控制、统一审计、统一密钥版本管理、统一禁用与删除策略、统一轮转策略。对于企业系统，业务服务只获得“使用密钥”的权限，不获得“导出密钥”的权限。高层级密钥不应出现在应用配置文件、环境变量、数据库、代码仓库、日志、构建产物和普通配置中心中。

### 5.3 访问控制与最小权限

密钥访问应基于最小权限原则。应用服务通常只需要 `Encrypt`、`Decrypt`、`GenerateDataKey` 或 Vault Transit 某个 named key 的加解密权限，不应具备密钥删除、密钥导出、密钥策略修改、root token、unseal key 管理等权限。Vault Transit 文档说明，可以通过 ACL 限制可信操作员管理 named keys，同时限制应用只能使用其所需 named keys 执行加密或解密 [10]。

企业落地时，应将权限拆分为以下角色：

1. 密钥管理员：创建、禁用、轮转、删除密钥，不接触业务明文。
2. 应用调用方：调用加密、解密或生成数据密钥接口，不管理密钥策略。
3. 审计人员：查看密钥使用日志、访问记录与变更记录，不执行加解密。
4. 安全管理员：配置密钥策略、审批高危操作、处理泄露事件。
5. 平台运维人员：维护 KMS/Vault/HSM 服务高可用，不直接接触业务数据。

### 5.4 明文密钥内存管理

明文 DEK 只应在加解密计算期间短暂存在于内存中。AWS KMS GenerateDataKey 文档要求应用在使用明文数据密钥完成加密或解密后，从内存中擦除明文数据密钥 [5]。在 Java、Go、Python 等运行时中，完全可靠的内存擦除受垃圾回收、对象复制和运行时优化影响，因此工程实现中应尽量使用 byte array、限制作用域、避免字符串化、避免日志打印、避免异常对象携带密钥内容，并减少明文密钥在应用中的驻留时间。

### 5.5 审计与密钥标识

密文结构中应保存 `keyId`、`keyVersion`、`algorithm`、`createdAt`、`aad` 等元数据。该信息用于定位解密所需密钥、支持密钥轮转、支持审计追踪、支持算法升级。AWS Encryption SDK 的 encrypted message 包含 encrypted data keys、算法标识、可选 encryption context 和签名等元数据 [7]。这说明成熟 SDK 并不只返回裸密文，而是返回可携带解密上下文的结构化密文对象。

---

## 6 密钥生命周期与周期轮转

### 6.1 密钥生命周期

NIST SP 800-57 将密钥管理覆盖到密钥材料生命周期中的多个管理问题，包括生成、使用、保护、存储、轮换、恢复与销毁等 [1]。企业系统中的密钥生命周期通常包括：

1. 密钥创建：由 KMS、HSM、Vault 或合规随机源生成。
2. 密钥启用：绑定用途、权限、算法、租户、环境与业务域。
3. 密钥使用：用于 encrypt、decrypt、wrap、unwrap、sign、verify 等操作。
4. 密钥轮转：生成新版本密钥材料或新 named key。
5. 密钥停用：停止用于新数据加密，但保留旧数据解密能力。
6. 密钥禁用：临时禁止使用，用于风险控制。
7. 密钥销毁：在确认无历史数据依赖后删除密钥或密钥材料。
8. 密钥恢复：在备份、灾备或跨地域场景中恢复密钥使用能力。

### 6.2 DEK 轮转

如果采用每条消息、每个对象或每次写入生成新 DEK 的模式，DEK 本身不需要周期性轮转。Google Cloud KMS 明确建议每次写入数据时生成新的 DEK，并指出这种方式意味着不需要轮转 DEK [6]。在该模式下，DEK 生命周期通常与对应密文对象绑定：生成后立即用于加密业务数据，随后只保存 encrypted DEK；解密时短暂恢复明文 DEK，使用后擦除。

### 6.3 KEK/主密钥轮转

KEK 或主密钥应定期轮转，并在怀疑泄露或安全事件后轮转。Google Cloud KMS 建议 KEK 定期轮转，并在疑似事件后轮转 [6]。AWS KMS 支持 customer managed keys 的可选自动轮转与按需轮转；AWS managed keys 每年自动轮转 [9]。AWS KMS 还会保留旧版本密钥材料，以便解密使用旧密钥材料加密的数据 [9]。

主密钥轮转后有两种处理模式：

1. **透明轮转**：密钥 ID 不变，密钥材料版本变化。新加密数据使用最新版本，旧数据解密时由 KMS 自动选择历史版本。
2. **显式重包装**：生成新 KEK 后，将旧 encrypted DEK 解开，再使用新 KEK 重新包装 DEK，业务数据密文不变。

第一种模式对业务改造较小，依赖 KMS 或 Vault 的版本管理能力。第二种模式适用于跨 KMS 迁移、密钥泄露恢复、租户拆分、合规要求变更等场景。

### 6.4 Vault Transit 轮转

HashiCorp Vault Transit 支持 named key 的底层加密密钥轮转。Vault Transit 文档说明，轮转操作会生成新的 encryption key 并加入该 named key 的 keyring；Vault 还建议即使没有泄露事件，也应周期性轮转加密密钥。对于 AES-GCM key，Vault 文档建议在单个 key version 执行约 2^32 次加密之前轮转，并要求操作人员根据加密速率估算轮转频率 [10]。

### 6.5 根密钥与 Vault 内部密钥轮转

Vault 内部密钥体系还包括 unseal key、root key、backend encryption key 等。Vault 官方文档说明，Vault 使用 keyring 中的 encryption key 加密大多数数据，使用 root key 解密 keyring，而 root key 本身需要 unseal key 解密 [11]。Vault 支持 rekey 与 rotate 操作，用于更新 unseal key、root key 或 backend encryption key。Vault 的 security barrier 使用 AES-256-GCM 加密写入存储后端的数据，并为每个加密对象随机生成 nonce [11]。

---

## 7 远程加密与本地加密

### 7.1 远程加密

远程加密是指应用将明文数据发送到 KMS、Vault 或 Key Vault，由远程服务执行加密并返回密文。Vault Transit 属于典型的远程加密服务。HashiCorp 官方文档将 Transit secrets engine 描述为 cryptography as a service 或 encryption as a service；Vault 不存储发送到 Transit 的业务数据，而是处理加密、解密、签名、验签、哈希、HMAC 和随机数生成等密码操作 [10]。

远程加密的客观特征包括：

1. 明文数据需要传输到远程加密服务。
2. 密钥不离开 KMS/Vault/HSM。
3. 加解密行为可以集中审计。
4. 业务应用无需实现底层密码细节。
5. 加解密延迟受网络、服务可用性、限流策略和远程服务性能影响。
6. 大对象直接远程加密会增加网络传输量与服务端计算压力。

远程加密适合小体量敏感字段、统一密码服务、跨语言统一实现、需要强审计的系统，以及应用团队不直接管理密码算法细节的场景。

### 7.2 本地加密

本地加密是指应用在本地进程中使用 DEK 加密业务数据，仅将 DEK 的生成、包装、解包或保护委托给 KMS/Vault/HSM。AWS KMS GenerateDataKey 与 Google Cloud KMS Envelope Encryption 均属于此模式：应用获取或生成 DEK，在本地加密数据，再通过 KMS key 或 KEK 包装 DEK [5][6]。

本地加密的客观特征包括：

1. 大体量业务数据不需要传输到 KMS。
2. KMS 只处理小体量数据密钥或 encrypted DEK。
3. 加解密性能主要由应用本地 CPU 和密码库决定。
4. 应用需要正确实现 nonce、AAD、tag、密文格式、明文密钥内存管理等细节。
5. 明文 DEK 会短暂出现在应用内存中。
6. 适合大文件、大对象、高吞吐数据库字段、日志和消息场景。

AWS KMS FAQ 指出，AWS KMS 支持最多 4 KB 数据直接加密，但信封加密可以带来性能收益，因为直接加密需要将数据通过网络传输到 KMS，而信封加密只需要通过网络传输较小的数据密钥 [8]。这说明在大数据量场景中，本地数据加密加远程密钥包装是更常见的工程模型。

### 7.3 远程加密与本地加密对比

| 维度       | 远程加密                          | 本地加密                          |
| -------- | ----------------------------- | ----------------------------- |
| 数据是否离开应用 | 明文业务数据发送到 KMS/Vault           | 业务数据不发送到 KMS/Vault            |
| 密钥暴露     | 密钥不离开服务端                      | 明文 DEK 短暂出现在应用内存              |
| 性能       | 受网络与服务限流影响                    | 主要受本地 CPU 与密码库影响              |
| 审计       | 集中审计加解密请求                     | KMS 审计密钥操作，本地加密需应用补充审计        |
| 适用数据量    | 小字段、小文本、统一密码服务                | 大对象、大文件、高吞吐数据                 |
| 实现复杂度    | 应用侧较低                         | 应用需处理密码工程细节                   |
| 可用性依赖    | 强依赖远程服务                       | 加密时依赖较低，生成/解包 DEK 时依赖 KMS     |
| 典型实现     | Vault Transit encrypt/decrypt | AWS GenerateDataKey + AES-GCM |

从企业落地角度，远程加密适合作为统一敏感字段加密服务，本地加密适合作为高吞吐数据加密基础能力。两者不是替代关系，而是应按照数据体量、访问频率、密钥隔离要求和审计要求共同使用。

---

## 8 HashiCorp Vault 的标准实现

### 8.1 Vault Transit

Vault Transit secrets engine 是 Vault 提供的加密即服务能力。官方文档说明，Transit 处理传输中数据的密码函数，不存储发送给该 secrets engine 的数据；它可被视为 cryptography as a service 或 encryption as a service [10]。其主要用途是让应用将加密后的数据存储在自己的主数据库中，同时将加解密能力交给 Vault 操作员统一管理 [10]。

Vault Transit 的基本落地流程如下：

1. 启用 Transit secrets engine。
2. 创建 named encryption key。
3. 应用调用 `/transit/encrypt/{key}` 对明文加密。
4. 应用将返回的 Vault ciphertext 保存到业务数据库。
5. 解密时应用调用 `/transit/decrypt/{key}`，由 Vault 返回明文。
6. 使用 ACL 限制不同应用只能访问其授权 named key。
7. 定期调用 rotate 生成新 key version。
8. 对历史密文按需执行 rewrap。

Vault Transit 适合应用侧不希望直接处理 DEK、nonce、tag、算法选择和密钥版本的场景。它把密码工程复杂度集中到 Vault，由 Vault 统一管理 named key、版本、权限和审计。

### 8.2 Vault Transit 与信封加密

Vault Transit 既可以作为远程加密服务，也可以支持数据密钥生成，用于信封加密。官方文档说明，datakey generation 允许进程请求指定长度的高熵密钥，该密钥由 named key 加密返回；通常也可返回明文，以便立即使用，也可以禁用明文返回以满足审计要求 [10]。这与 AWS KMS GenerateDataKey 模式相似：Vault 负责生成和包装 DEK，应用使用明文 DEK 本地加密业务数据，并保存 encrypted DEK。

因此，Vault 的两种典型使用方式为：

1. **远程加密模式**：业务明文发给 Vault Transit，由 Vault 返回密文。
2. **信封加密模式**：Vault 生成或包装 DEK，业务应用本地使用 DEK 加密数据。

### 8.3 Vault 内部安全屏障

Vault 的内部存储后端按不可信设计处理。Vault 官方安全模型说明，Vault 对所有发往存储后端的请求使用 security barrier，所有离开 Vault 的数据都会被 AES-256-GCM 自动加密，并使用 96-bit nonce，nonce 为每个加密对象随机生成 [11]。这意味着即使 Vault 使用外部存储后端，存储后端也不能直接读取 Vault 内部明文数据。

Vault Seal/Unseal 文档进一步说明，Vault 大多数数据由 keyring 中的 encryption key 加密；encryption key 由 root key 加密；root key 由 unseal key 加密。默认 Shamir Seal 会将 unseal key 分割为多个 shares，并要求达到阈值数量后重构 unseal key，以解开 root key [11]。该设计形成了 Vault 内部的分层密钥保护模型。

---

## 9 业界标准实现模式

### 9.1 云 KMS 模式

AWS KMS、Google Cloud KMS、Azure Key Vault 均提供密钥集中托管能力。AWS KMS 的 GenerateDataKey 接口返回明文数据密钥和由 KMS key 加密的数据密钥，应用可在 KMS 外部使用明文数据密钥加密数据，并保存 encrypted data key [5]。Google Cloud KMS 建议本地生成 DEK，使用 DEK 加密数据，再使用 Cloud KMS 中的 KEK 包装 DEK，并保存 encrypted data 与 wrapped DEK [6]。Azure 静态数据加密模型使用 envelope encryption，其中 DEK 加密分区或数据块，KEK 加密 DEK，KEK 不离开 Key Vault [12]。

云 KMS 模式的标准结构是：

1. KMS/HSM 托管主密钥或 KEK。
2. 应用使用 SDK 调用 KMS 生成或包装 DEK。
3. 应用在本地使用 DEK 执行业务数据加密。
4. 业务库保存密文、encrypted DEK、keyId、keyVersion、algorithm、AAD。
5. KMS 负责主密钥保护、访问控制、审计和轮转。
6. 应用负责业务密文存储、DEK 内存清理和密文格式兼容。

### 9.2 客户端加密 SDK 模式

AWS Encryption SDK 属于客户端信封加密库。官方文档说明，该 SDK 使用信封加密保护数据：每条消息使用唯一数据密钥加密，然后使用指定 wrapping key 加密该数据密钥；encrypted message 中包含 encrypted data、encrypted data keys、algorithm ID、可选 encryption context 和数字签名 [7]。这种模式降低了业务系统自行设计密文格式的复杂度。

客户端加密 SDK 适合以下场景：

1. 多语言服务需要统一密文格式。
2. 应用需要本地高性能加解密。
3. 需要自动处理 data key、wrapping key、algorithm suite、encryption context。
4. 需要支持多个 wrapping keys 包装同一个 data key，以实现跨账号、跨区域或多接收方解密。

### 9.3 HSM 与 BYOK 模式

HSM 用于在硬件安全边界内生成、保存和使用高价值密钥。Azure Key Vault Premium 层提供 HSM-protected keys；AWS KMS 与 CloudHSM、Google Cloud HSM 等也提供硬件保护能力 [12]。BYOK 场景中，企业可以将自有密钥材料导入云 KMS 或 HSM，但导入密钥材料的轮转、备份、过期和删除责任需要明确。

HSM/BYOK 适合对密钥控制权、合规审计、硬件保护等级和跨云密钥治理要求较高的组织。其工程约束是部署、运维、灾备、可用性和成本复杂度高于普通托管 KMS。

---

## 10 企业落地方案设计

### 10.1 总体架构

企业数据加解密平台可采用如下架构：

1. **密钥管理层**：KMS、Vault、HSM 或云 Key Vault，负责 root key、KEK、named key、key version、访问控制、审计与轮转。
2. **加密 SDK 层**：封装 AES-GCM、DEK 生成、KMS/Vault 调用、encrypted DEK 管理、密文格式、AAD、异常处理与指标。
3. **业务接入层**：数据库字段加密、对象存储加密、消息加密、配置加密、日志敏感字段加密。
4. **治理层**：密钥审批、权限审批、轮转策略、审计报表、密钥使用基线、异常调用告警。
5. **灾备层**：密钥备份、跨区域复制、历史版本保留、密钥恢复演练、密文兼容测试。

### 10.2 推荐加密流程

对于大多数企业业务数据，推荐采用信封加密：

1. 服务启动时加载加密 SDK 配置，不加载任何明文主密钥。
2. 写入数据时，SDK 为每条记录或对象生成 DEK。
3. SDK 使用 AES-256-GCM 加密业务明文。
4. SDK 调用 KMS/Vault 使用 KEK 包装 DEK。
5. SDK 将密文、encrypted DEK、keyId、keyVersion、iv、tag、algorithm、aad 一并返回。
6. 业务系统只保存结构化密文对象。
7. 读取数据时，SDK 根据 keyId 和 keyVersion 调用 KMS/Vault 解开 encrypted DEK。
8. SDK 使用 DEK 本地解密业务密文。
9. SDK 清理明文 DEK，并记录审计指标。

### 10.3 密钥命名与隔离

密钥命名应包含环境、业务域、数据等级、用途和区域。例如：

```text
prod/payment/pii/phone/aes-gcm
prod/account/identity/id-card/aes-gcm
prod/log/security/event/aes-gcm
```

密钥隔离粒度应根据风险确定。高敏感数据应单独使用 KEK 或 named key；跨租户系统应避免多个租户共享同一 DEK；涉及支付、身份、认证凭证的数据应独立密钥空间、独立权限策略和独立审计规则。

### 10.4 AAD 设计

AES-GCM 的 AAD 可绑定上下文，防止密文被跨场景复制使用。AAD 可包含：

1. tenantId
2. appId
3. tableName
4. fieldName
5. resourceId
6. dataClass
7. keyPurpose
8. schemaVersion

AAD 不需要保密，但解密时必须一致。若攻击者将某字段密文复制到另一个字段，由于 AAD 不匹配，认证校验应失败。

### 10.5 轮转与重包装流程

密钥轮转流程应包含：

1. 安全团队创建新 key version 或触发 KMS/Vault rotate。
2. 新写入数据使用新版本密钥。
3. 旧密文继续保留原 key version 元数据。
4. 解密流程根据元数据自动选择对应版本。
5. 对需要升级保护层级的数据执行 rewrap，只重包装 encrypted DEK，不重加密业务数据。
6. 对疑似泄露场景执行强制 re-encrypt，重新生成 DEK 并重加密业务数据。
7. 轮转后验证新旧数据可读性、审计日志完整性和异常率。
8. 在确认无历史依赖前，不删除旧 key material。

### 10.6 观测与审计

加解密平台应采集以下指标：

1. encrypt/decrypt/generateDataKey 调用量。
2. KMS/Vault 请求延迟。
3. KMS/Vault 错误码与限流次数。
4. keyId/keyVersion 使用分布。
5. 解密失败原因，包括 tag 校验失败、AAD 不匹配、权限拒绝、key disabled。
6. 明文解密调用来源、调用时间、调用用户、调用服务。
7. 高危密钥操作，包括 disable、delete、rotate、policy change。
8. 异常访问模式，例如非业务时间大量 decrypt、跨区域异常调用、失败率突增。

审计日志不得记录明文数据、明文 DEK、token、root key、unseal key shares 或任何可恢复密钥材料。

---

## 11 风险与控制措施

### 11.1 密钥泄露风险

密钥泄露会导致密文保护失效。控制措施包括：高层级密钥不出 KMS/HSM/Vault，应用仅获得最小使用权限，明文 DEK 短时存在内存，密钥访问全量审计，疑似泄露后立即轮转 KEK 或重新加密数据。

### 11.2 密钥丢失风险

密钥丢失会导致密文不可恢复。AWS Encryption SDK 文档指出，如果 wrapping keys 丢失或删除，加密数据将不可恢复 [7]。因此，密钥删除必须设置审批、延迟删除、备份、恢复演练和依赖扫描。业务侧必须记录 keyId 和 keyVersion，否则历史密文可能无法定位对应密钥。

### 11.3 算法与参数错误风险

AES-GCM 的 nonce 复用会破坏安全性。工程系统应由 SDK 统一生成随机 nonce，不允许业务开发手动传入固定 nonce。算法标识、tag、AAD、keyVersion 必须与密文绑定保存。禁止使用自研密码算法、硬编码 IV、ECB 模式、固定盐值派生密钥、字符串保存明文密钥等实现。

### 11.4 远程服务依赖风险

KMS/Vault 故障会影响加密或解密链路。控制措施包括：高可用部署、跨区域灾备、客户端超时、熔断、限流、降级策略、数据密钥缓存策略和密钥服务 SLA 管理。数据密钥缓存可以降低 KMS 调用频率，但会延长明文密钥在应用侧的驻留时间，因此应限制缓存时间、缓存条数和缓存用途。

---

## 12 结论

数据加解密的企业级落地不是单一 AES 调用，而是由标准算法、密钥层级、密钥托管、权限控制、审计、轮转、恢复和应用 SDK 共同构成的体系。信封加密是该体系中的核心模式。其基本思想是使用 DEK 加密业务数据，使用 KEK、主密钥或 KMS key 包装 DEK，并由根密钥、KMS、HSM 或 Vault 保护更高层级密钥。该模式兼顾了大规模数据本地加密的性能、集中式密钥管理的可控性和密钥轮转的可操作性。

HashiCorp Vault Transit 提供了加密即服务和数据密钥生成能力，适合统一密码服务和私有化密钥平台。AWS KMS、Google Cloud KMS 与 Azure Key Vault 则代表云厂商托管 KMS 的标准实现路径。企业在落地时，应基于数据敏感等级、吞吐量、合规要求、租户隔离、审计要求和灾备要求选择远程加密、本地信封加密或二者结合的模式。对于高吞吐、大对象和跨语言系统，本地信封加密加集中式 KMS/Vault 管理是更通用的架构；对于小字段、强审计和统一平台化场景，Vault Transit 或远程 KMS 加密具有明确工程价值。

## 参考文献

[1] NIST SP 800-57 Part 1 Rev. 5, Recommendation for Key Management.
[2] NIST FIPS 197, Advanced Encryption Standard.
[3] NIST SP 800-38D, Recommendation for Block Cipher Modes of Operation: GCM and GMAC.
[4] AWS KMS Cryptography Essentials.
[5] AWS KMS GenerateDataKey API Reference.
[6] Google Cloud KMS Envelope Encryption.
[7] AWS Encryption SDK Concepts.
[8] AWS KMS FAQ.
[9] AWS KMS Key Rotation Documentation.
[10] HashiCorp Vault Transit Secrets Engine.
[11] HashiCorp Vault Security Model and Seal/Unseal Documentation.
[12] Azure Key Vault and Azure Encryption at Rest Documentation.
