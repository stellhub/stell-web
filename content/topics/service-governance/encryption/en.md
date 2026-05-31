# Research on Data Encryption and Decryption Architecture and Implementation: Envelope Encryption, Key Management, and Vault/KMS-Centered Design

## Abstract

Data encryption and decryption are important technical components for protecting confidentiality, integrity, and access boundaries in information systems. Modern enterprise systems usually face requirements for data-at-rest protection, data-in-transit protection, application-layer sensitive field protection, key lifecycle management, permission isolation, audit tracing, and compliance implementation at the same time. According to official documentation from NIST, AWS, Google Cloud, Microsoft Azure, and HashiCorp Vault, common industry practice is not to use a single key to directly encrypt all business data. Instead, enterprises use layered key management systems, where envelope encryption is a standard pattern widely used by cloud services, KMS, HSM, and Vault Transit. Envelope encryption encrypts business data with a data key, and then encrypts that data key with a key-encryption key or master key, thereby separating data encryption operations from key protection operations. This article analyzes common encryption and decryption methods, the key hierarchy of envelope encryption, the concepts and lifecycles of root keys, master keys, and data keys, key storage and rotation, the difference between remote encryption and local encryption, the standard implementation of HashiCorp Vault, and cloud provider KMS implementation patterns. It then proposes an implementation framework for enterprise systems.

**Keywords**: data encryption; envelope encryption; key management; KMS; HashiCorp Vault; data key; master key; key rotation

---

## 1. Introduction

As the scale of user data, transaction data, identity data, log data, and business configuration data continues to grow in enterprise systems, data security protection has evolved from a single-point algorithm selection problem into a coordinated design problem involving algorithms, keys, permissions, auditing, rotation, isolation, and recoverability. NIST SP 800-57 defines key management as a core management activity in cryptographic systems. It covers multiple stages such as generation, protection, use, distribution, storage, rotation, recovery, and destruction of keying material [1]. Therefore, an enterprise data encryption and decryption solution should not only discuss "which algorithm to use"; it should also clarify how keys are generated, stored, authorized, rotated, audited, and used to restore a secure state in failure or compromise scenarios.

At the algorithm level, AES is the symmetric block cipher standard specified by NIST FIPS 197 and can be used to protect electronic data [2]. In modern systems, AES is usually not used alone. It is combined with a specific mode of operation. NIST SP 800-38D specifies GCM and GMAC, where GCM is an authenticated encryption mode that can provide confidentiality and integrity protection at the same time [3]. From an engineering perspective, AES-GCM, KMS, HSM, Vault Transit, cloud provider managed keys, and client-side encryption SDKs together form the enterprise encryption implementation system.

In large-scale data scenarios, directly using a root key or master key to encrypt business data does not match common engineering practice. AWS KMS, Google Cloud KMS, Azure encryption models, and HashiCorp Vault all use or support multi-layer key structures. The core idea is to use short-lived or fine-grained data keys to encrypt concrete business data, and then use higher-level, more strongly protected keys to encrypt the data keys. This pattern is envelope encryption [4][5][6].

---

## 2. Common Encryption and Decryption Methods

### 2.1 Symmetric Encryption

Symmetric encryption uses the same key for encryption and decryption. AES is one of the most common symmetric encryption algorithms in modern systems. FIPS 197 states that AES is a symmetric block cipher that can encrypt and decrypt information and transform plaintext into unintelligible ciphertext [2]. In engineering implementation, AES is often combined with GCM mode. GCM is an authenticated encryption mode and can provide both data confidentiality and authentication protection [3].

Symmetric encryption is suitable for bulk data encryption scenarios, such as database field encryption, object storage file encryption, log content encryption, cache data encryption, and backup file encryption. Its main engineering characteristic is high encryption and decryption performance, making it suitable for local processing of large data blocks. Its key constraint is that the key must be strictly protected, because any subject that obtains the same key can perform both encryption and decryption.

### 2.2 Asymmetric Encryption

Asymmetric encryption uses a key pair consisting of a public key and a private key. The public key is usually used for encryption or signature verification, while the private key is used for decryption or signing. Asymmetric encryption has engineering value in key distribution, identity authentication, digital signatures, and cross-subject data sharing. However, compared with symmetric encryption, asymmetric encryption is usually not used directly for large-scale business data encryption. Instead, it is used to encrypt smaller data keys, perform key exchange, or complete signing and verification operations.

In envelope encryption systems, business data is usually encrypted by a symmetric data key, while the data key can be wrapped by a symmetric KEK, an asymmetric public key, an HSM-managed key, or a KMS-managed key. AWS Encryption SDK documentation states that envelope encryption can combine symmetric and asymmetric algorithms: data is encrypted using symmetric encryption, while data keys can be encrypted using symmetric or asymmetric algorithms suitable for wrapping keys [7].

### 2.3 Boundaries Between Hashing, HMAC, and Encryption

A hash function is not an encryption algorithm. Encryption requires ciphertext to be recoverable into plaintext under authorized conditions, whereas a hash function is a one-way digest calculation, usually used for integrity checks, indexing, deduplication, signature input, or irreversible identifier generation. HMAC is a keyed message authentication code used to verify message integrity and source authenticity, but it is also not used to recover plaintext.

In enterprise sensitive data governance, hashing is suitable for scenarios where plaintext recovery is unnecessary, such as uniqueness matching, irreversible fingerprints, and password digest storage. Encryption is suitable for scenarios where plaintext must be restored under authorized conditions, such as ID numbers, phone numbers, email addresses, payment information, and business configuration secrets. Therefore, data governance design should clearly distinguish four capabilities: reversible encryption, irreversible hashing, masked display, and access control.

### 2.4 Authenticated Encryption

Authenticated encryption is used to protect data confidentiality and integrity at the same time. AES-GCM is a common authenticated encryption scheme in enterprise systems. NIST SP 800-38D defines GCM as an authenticated encryption algorithm and defines GMAC for message authentication [3]. In engineering implementation, AES-GCM output usually contains ciphertext, nonce or IV, authentication tag, and optional associated data, or AAD. AAD is not encrypted, but it participates in authentication calculation. It is suitable for binding tenant ID, table name, field name, version number, business context, and similar metadata.

---

## 3. Envelope Encryption Model

### 3.1 Basic Definition of Envelope Encryption

Envelope encryption is a layered key technique where one key encrypts data and another key encrypts the first key. AWS KMS official documentation defines envelope encryption as encrypting plaintext data with a data key, and then encrypting that data key with another key [4]. Google Cloud KMS official documentation also describes it as the process of encrypting one key with another key [6].

The basic structure of envelope encryption is as follows:

1. Generate a data key, or DEK.
2. Use the DEK to locally encrypt business plaintext data and produce business ciphertext.
3. Use a master key, KEK, or KMS key to encrypt and wrap the DEK, producing an encrypted DEK.
4. Store business ciphertext, encrypted DEK, key version, algorithm identifier, nonce/IV, tag, and AAD metadata together.
5. During decryption, first call KMS, Vault, or a local key system to unwrap the encrypted DEK, and then use the DEK to decrypt the business ciphertext.

This structure decouples large-volume data encryption from high-value key protection. Business data is encrypted by fine-grained DEKs, while DEKs are protected by centralized high-security-level keys. Google Cloud KMS documentation explicitly states that Cloud KMS is designed to manage KEKs, and that a single KEK can protect multiple DEKs. This supports using an independent DEK for each data object while avoiding the need to store excessive numbers of keys in a central key service [6].

### 3.2 Engineering Data Structure for Envelope Encryption

In database field, file object, or message encryption scenarios, it is recommended to encapsulate encryption results as structured envelope ciphertext. A typical structure is:

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

In this structure, the business system persists ciphertext and encrypted data keys, not plaintext DEKs. Google Cloud KMS documentation clearly provides an envelope encryption flow: generate a local DEK, use the DEK to encrypt data, use a KEK to wrap the DEK, and store the encrypted data and wrapped DEK. It also explicitly warns that plaintext DEKs must not be stored [6]. AWS KMS GenerateDataKey documentation also requires applications to erase plaintext data keys from memory after using them to complete local encryption, and to save encrypted data keys together with ciphertext [5].

---

## 4. Key Hierarchy in Envelope Encryption

### 4.1 Root Key

A root key is the highest-level or near-highest-level keying material in a key hierarchy. AWS KMS documentation states that in a multi-layer key chain, there must ultimately be a top-level plaintext key that remains available to decrypt other keys and data. This top-level plaintext KEK is called a root key. In AWS KMS, the root key is protected by KMS and never leaves AWS KMS hardware security modules in unencrypted form [4].

In Vault, the concept of root key appears in the Vault unseal process. Vault official documentation explains that Vault uses encryption keys in the keyring to encrypt most data. To protect encryption keys, Vault uses the root key to encrypt those encryption keys. The root key is then encrypted by the unseal key and stored together with other Vault data. The essence of Vault unsealing is obtaining the root key so the keyring can be decrypted [11].

The role of a root key is not to directly encrypt business data, but to protect the next layer of keying material or unlock an internal keyring. Its lifetime is usually long, but its actual exposure window should be extremely short. In HSM/KMS models, root keys are usually inside the cryptographic boundary and cannot be directly read by business applications. In the Vault Shamir Seal model, the root key can be recovered only when the threshold number of unseal key shares is reached. In the Auto Unseal model, responsibility for decrypting the root key is delegated to trusted services such as cloud KMS or HSM [11].

### 4.2 Master Key, KEK, and Wrapping Key

The term master key differs across products. In AWS KMS, a KMS key is used to protect data keys. In Google Cloud KMS and Azure models, a KEK is used to wrap DEKs. In AWS Encryption SDK, a wrapping key or master key provider is used to encrypt data keys [4][6][7][12].

The main responsibility of a master key is to encrypt, decrypt, or wrap data keys, not to directly process large-volume business data. Google Cloud KMS documentation states that DEKs are encrypted, or wrapped, by KEKs, and that KEKs should be centrally stored and rotated periodically [6]. Azure documentation states that KEKs are used to encrypt DEKs through envelope encryption, and KEKs do not leave Key Vault. This enables control over data keys and isolation between access principals [12].

The lifetime of a master key is usually longer than that of a data key. Its lifecycle is managed by month, quarter, year, or compliance cycle, and versioning mechanisms support decryption of old ciphertext. AWS KMS documentation explains that after KMS key rotation, newly encrypted data uses current key material, while AWS KMS automatically selects the key material version used during encryption when decrypting old data [9]. Therefore, master key rotation usually does not require all historical business ciphertext to be rewritten immediately, but old key material versions must be retained to support historical data decryption.

### 4.3 Data Key

A data key is the key that directly encrypts business data. Google Cloud KMS documentation calls the key used to encrypt data itself the Data Encryption Key, or DEK [6]. Azure documentation also defines a DEK as a symmetric AES-256 key used to encrypt a partition or data block [12]. The AWS KMS GenerateDataKey API returns a plaintext data key and a copy of the data key encrypted by the specified KMS key. The application uses the plaintext data key to encrypt data outside KMS, and then saves the encrypted data key [5].

The lifetime of a data key should be shorter than that of a master key. Google Cloud KMS recommends generating a new DEK every time data is written and notes that this pattern means DEKs do not need to be rotated. It also recommends not using the same DEK to encrypt data for two different users [6]. AWS Encryption SDK also states that each message is encrypted using a unique data key unless data key caching is used [7].

From an engineering perspective, common DEK granularities include:

1. One DEK per message.
2. One DEK per file.
3. One DEK per object.
4. One DEK per database row or sensitive field group.
5. One DEK per tenant, partition, or data block.

The finer the DEK granularity, the smaller the impact of a single key compromise. However, the number of encrypted DEKs, KMS calls, and metadata storage costs increase. The coarser the DEK granularity, the lower the encryption and decryption cost, but the wider the key reuse scope. Real systems should determine granularity based on data sensitivity level, access frequency, ciphertext volume, tenant isolation requirements, and audit requirements.

---

## 5. Best Practices for Key Storage

### 5.1 Separation of Keys and Data

The core principle of key storage is separating keys from ciphertext. A business database can store business ciphertext and encrypted DEKs, but it should not store plaintext DEKs, master keys, or root keys. AWS KMS documentation states that encrypted data keys can be safely stored together with encrypted data because the data keys themselves are already protected by another key [4][5]. Google Cloud KMS also explicitly requires plaintext DEKs not to be stored [6].

### 5.2 Centralized Custody of High-Level Keys

Master keys, KEKs, and wrapping keys should be managed by a centralized key management system, such as KMS, HSM, Vault, or a cloud provider Key Vault. Google Cloud KMS recommends centralized storage of KEKs. Azure Key Vault provides key, secret, and certificate management capabilities, and the Premium tier supports HSM-protected keys validated to FIPS 140-3 Level 3 [6][12]. AWS Encryption SDK documentation also states that AWS KMS, HSMs, or other key management tools can be used to protect wrapping keys [7].

The value of centralized custody is unified access control, unified auditing, unified key version management, unified disable and deletion policies, and unified rotation policies. For enterprise systems, business services should receive only "permission to use keys," not "permission to export keys." High-level keys should not appear in application configuration files, environment variables, databases, code repositories, logs, build artifacts, or ordinary configuration centers.

### 5.3 Access Control and Least Privilege

Key access should follow the principle of least privilege. Application services usually need only `Encrypt`, `Decrypt`, `GenerateDataKey`, or permission to use a specific Vault Transit named key for encryption and decryption. They should not have permissions for key deletion, key export, key policy modification, root token use, or unseal key management. Vault Transit documentation explains that ACLs can restrict trusted operators to managing named keys while limiting applications to only the named keys they need for encryption or decryption [10].

In enterprise implementation, permissions should be split into the following roles:

1. Key administrator: creates, disables, rotates, and deletes keys without touching business plaintext.
2. Application caller: calls encryption, decryption, or data key generation APIs without managing key policies.
3. Auditor: views key usage logs, access records, and change records without performing encryption or decryption.
4. Security administrator: configures key policies, approves high-risk operations, and handles compromise events.
5. Platform operations engineer: maintains KMS/Vault/HSM high availability without directly accessing business data.

### 5.4 Plaintext Key Memory Management

Plaintext DEKs should exist in memory only briefly during encryption or decryption calculations. AWS KMS GenerateDataKey documentation requires applications to erase plaintext data keys from memory after using them for encryption or decryption [5]. In runtimes such as Java, Go, and Python, completely reliable memory erasure is affected by garbage collection, object copying, and runtime optimization. Therefore, engineering implementations should use byte arrays as much as possible, limit scope, avoid string conversion, avoid log printing, avoid exception objects carrying key content, and reduce the residence time of plaintext keys in applications.

### 5.5 Auditing and Key Identifiers

Ciphertext structures should save metadata such as `keyId`, `keyVersion`, `algorithm`, `createdAt`, and `aad`. This information is used to locate keys required for decryption, support key rotation, support audit tracing, and support algorithm upgrades. AWS Encryption SDK encrypted messages contain encrypted data keys, algorithm identifiers, optional encryption context, signatures, and other metadata [7]. This shows that mature SDKs do not simply return bare ciphertext; they return structured ciphertext objects that carry decryption context.

---

## 6. Key Lifecycle and Periodic Rotation

### 6.1 Key Lifecycle

NIST SP 800-57 covers multiple management issues throughout the lifecycle of keying material, including generation, use, protection, storage, rotation, recovery, and destruction [1]. The key lifecycle in enterprise systems usually includes:

1. Key creation: generated by KMS, HSM, Vault, or a compliant random source.
2. Key activation: bound to purpose, permissions, algorithm, tenant, environment, and business domain.
3. Key use: used for encrypt, decrypt, wrap, unwrap, sign, verify, and similar operations.
4. Key rotation: generate a new version of key material or a new named key.
5. Key deactivation: stop using it for new data encryption while retaining old data decryption capability.
6. Key disabling: temporarily prohibit use for risk control.
7. Key destruction: delete the key or key material after confirming no historical data dependency remains.
8. Key recovery: restore key usage capability in backup, disaster recovery, or cross-region scenarios.

### 6.2 DEK Rotation

If a new DEK is generated for each message, object, or write, the DEK itself does not need periodic rotation. Google Cloud KMS explicitly recommends generating a new DEK every time data is written and states that this approach means the DEK does not need to be rotated [6]. In this pattern, the DEK lifecycle is usually tied to the corresponding ciphertext object: it is generated and immediately used to encrypt business data, after which only the encrypted DEK is saved. During decryption, the plaintext DEK is briefly restored and erased after use.

### 6.3 KEK/Master Key Rotation

KEKs or master keys should be rotated periodically and after suspected compromise or security incidents. Google Cloud KMS recommends rotating KEKs periodically and after suspected incidents [6]. AWS KMS supports optional automatic rotation and on-demand rotation for customer managed keys, while AWS managed keys rotate automatically every year [9]. AWS KMS also retains old key material versions so data encrypted with old key material can be decrypted [9].

After master key rotation, there are two handling modes:

1. **Transparent rotation**: the key ID remains unchanged while the key material version changes. Newly encrypted data uses the latest version, and old data decryption is handled by KMS automatically selecting the historical version.
2. **Explicit rewrapping**: after a new KEK is generated, the old encrypted DEK is unwrapped and then rewrapped using the new KEK, while the business data ciphertext remains unchanged.

The first mode requires less business change and depends on KMS or Vault version management capabilities. The second mode is suitable for cross-KMS migration, key compromise recovery, tenant splitting, compliance requirement changes, and similar scenarios.

### 6.4 Vault Transit Rotation

HashiCorp Vault Transit supports rotation of the underlying encryption key for a named key. Vault Transit documentation explains that a rotation operation generates a new encryption key and adds it to the keyring of the named key. Vault also recommends periodically rotating encryption keys even without a compromise event. For AES-GCM keys, Vault documentation recommends rotating before a single key version performs about 2^32 encryption operations, and requires operators to estimate rotation frequency based on the encryption rate [10].

### 6.5 Root Key and Vault Internal Key Rotation

Vault's internal key system also includes unseal keys, root keys, backend encryption keys, and related material. Vault official documentation explains that most Vault data is encrypted by encryption keys in the keyring. The root key decrypts the keyring, while the root key itself requires the unseal key for decryption [11]. Vault supports rekey and rotate operations to update unseal keys, root keys, or backend encryption keys. Vault's security barrier uses AES-256-GCM to encrypt data written to the storage backend and randomly generates a nonce for each encrypted object [11].

---

## 7. Remote Encryption and Local Encryption

### 7.1 Remote Encryption

Remote encryption means the application sends plaintext data to KMS, Vault, or Key Vault, and the remote service performs encryption and returns ciphertext. Vault Transit is a typical remote encryption service. HashiCorp official documentation describes the Transit secrets engine as cryptography as a service or encryption as a service. Vault does not store business data sent to Transit. Instead, it processes cryptographic operations such as encryption, decryption, signing, verification, hashing, HMAC, and random number generation [10].

Objective characteristics of remote encryption include:

1. Plaintext business data must be transmitted to the remote encryption service.
2. Keys do not leave KMS/Vault/HSM.
3. Encryption and decryption behavior can be centrally audited.
4. Business applications do not need to implement low-level cryptographic details.
5. Encryption and decryption latency is affected by network, service availability, throttling policies, and remote service performance.
6. Direct remote encryption of large objects increases network traffic and server-side computation pressure.

Remote encryption is suitable for small sensitive fields, unified cryptographic services, cross-language unified implementations, systems requiring strong auditing, and scenarios where application teams should not directly manage cryptographic algorithm details.

### 7.2 Local Encryption

Local encryption means the application uses a DEK in the local process to encrypt business data, while delegating only DEK generation, wrapping, unwrapping, or protection to KMS/Vault/HSM. AWS KMS GenerateDataKey and Google Cloud KMS Envelope Encryption both follow this pattern: the application obtains or generates a DEK, encrypts data locally, and then wraps the DEK with a KMS key or KEK [5][6].

Objective characteristics of local encryption include:

1. Large-volume business data does not need to be sent to KMS.
2. KMS processes only small data keys or encrypted DEKs.
3. Encryption and decryption performance is mainly determined by application-local CPU and cryptographic libraries.
4. The application must correctly implement nonce, AAD, tag, ciphertext format, plaintext key memory management, and similar details.
5. Plaintext DEKs briefly appear in application memory.
6. It is suitable for large files, large objects, high-throughput database fields, logs, and messages.

AWS KMS FAQ states that AWS KMS supports direct encryption of data up to 4 KB, but envelope encryption can provide performance benefits because direct encryption requires data to be transmitted over the network to KMS, while envelope encryption only transmits smaller data keys over the network [8]. This shows that local data encryption plus remote key wrapping is the more common engineering model in large-data scenarios.

### 7.3 Comparison Between Remote Encryption and Local Encryption

| Dimension | Remote Encryption | Local Encryption |
| --- | --- | --- |
| Whether data leaves the application | Plaintext business data is sent to KMS/Vault | Business data is not sent to KMS/Vault |
| Key exposure | Keys do not leave the server side | Plaintext DEK briefly appears in application memory |
| Performance | Affected by network and service throttling | Mainly affected by local CPU and crypto library |
| Auditing | Centralized audit of encryption and decryption requests | KMS audits key operations; application must supplement local encryption auditing |
| Suitable data volume | Small fields, small text, unified cryptographic services | Large objects, large files, high-throughput data |
| Implementation complexity | Lower on the application side | Application must handle cryptographic engineering details |
| Availability dependency | Strong dependency on remote service | Lower dependency during encryption; DEK generation/unwrapping still depends on KMS |
| Typical implementation | Vault Transit encrypt/decrypt | AWS GenerateDataKey + AES-GCM |

From an enterprise implementation perspective, remote encryption is suitable as a unified sensitive field encryption service, while local encryption is suitable as a high-throughput data encryption capability. The two are not substitutes. They should be used together according to data volume, access frequency, key isolation requirements, and audit requirements.

---

## 8. Standard Implementation of HashiCorp Vault

### 8.1 Vault Transit

The Vault Transit secrets engine is Vault's encryption-as-a-service capability. Official documentation explains that Transit handles cryptographic functions for data in transit and does not store data sent to this secrets engine. It can be viewed as cryptography as a service or encryption as a service [10]. Its main purpose is to allow applications to store encrypted data in their own primary databases while letting Vault operators centrally manage encryption and decryption capabilities [10].

The basic Vault Transit implementation flow is:

1. Enable the Transit secrets engine.
2. Create a named encryption key.
3. The application calls `/transit/encrypt/{key}` to encrypt plaintext.
4. The application stores the returned Vault ciphertext in the business database.
5. During decryption, the application calls `/transit/decrypt/{key}`, and Vault returns plaintext.
6. ACLs restrict different applications to only their authorized named keys.
7. Rotate periodically to generate a new key version.
8. Rewrap historical ciphertext as needed.

Vault Transit is suitable when the application side does not want to directly handle DEK, nonce, tag, algorithm selection, and key versioning. It concentrates cryptographic engineering complexity in Vault, where named keys, versions, permissions, and auditing are centrally managed.

### 8.2 Vault Transit and Envelope Encryption

Vault Transit can act as both a remote encryption service and a data key generation service for envelope encryption. Official documentation explains that data key generation allows a process to request a high-entropy key of a specified length. The key is returned encrypted by a named key. Usually, plaintext can also be returned for immediate use, while plaintext return can be disabled to satisfy audit requirements [10]. This is similar to the AWS KMS GenerateDataKey model: Vault generates and wraps the DEK, the application locally encrypts business data using the plaintext DEK, and the encrypted DEK is saved.

Therefore, Vault has two typical usage modes:

1. **Remote encryption mode**: business plaintext is sent to Vault Transit, and Vault returns ciphertext.
2. **Envelope encryption mode**: Vault generates or wraps the DEK, and the business application locally encrypts data with the DEK.

### 8.3 Vault Internal Security Barrier

Vault's internal storage backend is designed as untrusted. Vault's official security model explains that Vault uses a security barrier for all requests sent to the storage backend. All data leaving Vault is automatically encrypted with AES-256-GCM and a 96-bit nonce, where the nonce is randomly generated for each encrypted object [11]. This means that even if Vault uses an external storage backend, that backend cannot directly read Vault internal plaintext data.

Vault Seal/Unseal documentation further explains that most Vault data is encrypted by encryption keys in the keyring; encryption keys are encrypted by the root key; and the root key is encrypted by the unseal key. The default Shamir Seal splits the unseal key into multiple shares and requires the threshold number of shares to reconstruct the unseal key and unlock the root key [11]. This design forms Vault's internal layered key protection model.

---

## 9. Industry Standard Implementation Patterns

### 9.1 Cloud KMS Pattern

AWS KMS, Google Cloud KMS, and Azure Key Vault all provide centralized key custody capabilities. The AWS KMS GenerateDataKey API returns a plaintext data key and a data key encrypted by a KMS key. The application can use the plaintext data key outside KMS to encrypt data and save the encrypted data key [5]. Google Cloud KMS recommends locally generating a DEK, encrypting data with the DEK, wrapping the DEK with a KEK in Cloud KMS, and saving encrypted data and the wrapped DEK [6]. Azure's data-at-rest encryption model uses envelope encryption, where DEKs encrypt partitions or data blocks, KEKs encrypt DEKs, and KEKs do not leave Key Vault [12].

The standard structure of the cloud KMS pattern is:

1. KMS/HSM manages the master key or KEK.
2. The application calls KMS through SDKs to generate or wrap DEKs.
3. The application locally encrypts business data with the DEK.
4. The business database stores ciphertext, encrypted DEK, keyId, keyVersion, algorithm, and AAD.
5. KMS is responsible for master key protection, access control, auditing, and rotation.
6. The application is responsible for business ciphertext storage, DEK memory cleanup, and ciphertext format compatibility.

### 9.2 Client-Side Encryption SDK Pattern

AWS Encryption SDK is a client-side envelope encryption library. Official documentation states that the SDK protects data using envelope encryption: each message is encrypted using a unique data key, and then the data key is encrypted using a specified wrapping key. The encrypted message contains encrypted data, encrypted data keys, algorithm ID, optional encryption context, and digital signatures [7]. This pattern reduces the complexity of business systems designing their own ciphertext formats.

Client-side encryption SDKs are suitable for the following scenarios:

1. Multi-language services need a unified ciphertext format.
2. Applications need high-performance local encryption and decryption.
3. Data keys, wrapping keys, algorithm suites, and encryption context should be handled automatically.
4. Multiple wrapping keys need to wrap the same data key to support cross-account, cross-region, or multi-recipient decryption.

### 9.3 HSM and BYOK Pattern

HSMs are used to generate, store, and use high-value keys inside a hardware security boundary. Azure Key Vault Premium provides HSM-protected keys. AWS KMS with CloudHSM and Google Cloud HSM also provide hardware protection capabilities [12]. In BYOK scenarios, enterprises can import their own key material into cloud KMS or HSM, but responsibilities for imported key material rotation, backup, expiration, and deletion must be clearly defined.

HSM/BYOK is suitable for organizations with high requirements for key control, compliance auditing, hardware protection levels, and cross-cloud key governance. Its engineering constraints are that deployment, operations, disaster recovery, availability, and cost complexity are higher than ordinary managed KMS.

---

## 10. Enterprise Implementation Design

### 10.1 Overall Architecture

An enterprise data encryption and decryption platform can adopt the following architecture:

1. **Key management layer**: KMS, Vault, HSM, or cloud Key Vault, responsible for root keys, KEKs, named keys, key versions, access control, auditing, and rotation.
2. **Encryption SDK layer**: encapsulates AES-GCM, DEK generation, KMS/Vault calls, encrypted DEK management, ciphertext format, AAD, exception handling, and metrics.
3. **Business integration layer**: database field encryption, object storage encryption, message encryption, configuration encryption, and log sensitive field encryption.
4. **Governance layer**: key approval, permission approval, rotation policies, audit reports, key usage baselines, and anomalous-call alerts.
5. **Disaster recovery layer**: key backup, cross-region replication, historical version retention, key recovery drills, and ciphertext compatibility tests.

### 10.2 Recommended Encryption Flow

For most enterprise business data, envelope encryption is recommended:

1. When the service starts, it loads encryption SDK configuration and does not load any plaintext master key.
2. When data is written, the SDK generates a DEK for each record or object.
3. The SDK encrypts business plaintext using AES-256-GCM.
4. The SDK calls KMS/Vault to wrap the DEK using the KEK.
5. The SDK returns ciphertext, encrypted DEK, keyId, keyVersion, iv, tag, algorithm, and aad together.
6. The business system stores only the structured ciphertext object.
7. When data is read, the SDK calls KMS/Vault according to keyId and keyVersion to unwrap the encrypted DEK.
8. The SDK locally decrypts the business ciphertext using the DEK.
9. The SDK cleans up the plaintext DEK and records audit metrics.

### 10.3 Key Naming and Isolation

Key names should include environment, business domain, data level, purpose, and region. For example:

```text
prod/payment/pii/phone/aes-gcm
prod/account/identity/id-card/aes-gcm
prod/log/security/event/aes-gcm
```

Key isolation granularity should be determined by risk. Highly sensitive data should use a separate KEK or named key. Cross-tenant systems should avoid multiple tenants sharing the same DEK. Data involving payment, identity, and authentication credentials should use independent key spaces, independent permission policies, and independent audit rules.

### 10.4 AAD Design

AES-GCM AAD can bind context and prevent ciphertext from being copied across scenarios. AAD can include:

1. tenantId
2. appId
3. tableName
4. fieldName
5. resourceId
6. dataClass
7. keyPurpose
8. schemaVersion

AAD does not need to be confidential, but it must be consistent during decryption. If an attacker copies ciphertext from one field to another, authentication verification should fail because AAD does not match.

### 10.5 Rotation and Rewrapping Flow

The key rotation flow should include:

1. The security team creates a new key version or triggers KMS/Vault rotation.
2. Newly written data uses the new key version.
3. Old ciphertext keeps its original key version metadata.
4. The decryption flow automatically selects the corresponding version according to metadata.
5. Data that needs upgraded protection executes rewrap, only rewrapping the encrypted DEK without re-encrypting business data.
6. Suspected compromise scenarios execute forced re-encrypt, regenerating DEKs and re-encrypting business data.
7. After rotation, verify readability of new and old data, audit log completeness, and anomaly rates.
8. Do not delete old key material until confirming that no historical dependency remains.

### 10.6 Observability and Auditing

An encryption and decryption platform should collect the following metrics:

1. Number of encrypt/decrypt/generateDataKey calls.
2. KMS/Vault request latency.
3. KMS/Vault error codes and throttling counts.
4. Distribution of keyId/keyVersion usage.
5. Causes of decryption failure, including tag verification failure, AAD mismatch, permission denial, and key disabled.
6. Plaintext decryption call source, call time, calling user, and calling service.
7. High-risk key operations, including disable, delete, rotate, and policy change.
8. Anomalous access patterns, such as large numbers of decrypt calls outside business hours, abnormal cross-region calls, and sudden failure-rate increases.

Audit logs must not record plaintext data, plaintext DEKs, tokens, root keys, unseal key shares, or any recoverable key material.

---

## 11. Risks and Controls

### 11.1 Key Compromise Risk

Key compromise causes ciphertext protection to fail. Controls include keeping high-level keys inside KMS/HSM/Vault, granting applications only minimum usage permissions, allowing plaintext DEKs to exist briefly in memory, fully auditing key access, and immediately rotating KEKs or re-encrypting data after suspected compromise.

### 11.2 Key Loss Risk

Key loss makes ciphertext unrecoverable. AWS Encryption SDK documentation states that if wrapping keys are lost or deleted, encrypted data cannot be recovered [7]. Therefore, key deletion must include approval, delayed deletion, backup, recovery drills, and dependency scanning. The business side must record keyId and keyVersion, otherwise historical ciphertext may not be able to locate the corresponding key.

### 11.3 Algorithm and Parameter Error Risk

AES-GCM nonce reuse breaks security. Engineering systems should let SDKs generate random nonces uniformly and should not allow business developers to manually pass fixed nonces. Algorithm identifiers, tags, AAD, and keyVersion must be bound to ciphertext and saved. Self-developed cryptographic algorithms, hardcoded IVs, ECB mode, fixed-salt derived keys, plaintext keys stored in strings, and similar implementations should be prohibited.

### 11.4 Remote Service Dependency Risk

KMS/Vault failures affect encryption or decryption paths. Controls include high-availability deployment, cross-region disaster recovery, client timeouts, circuit breaking, rate limiting, degradation strategies, data key caching policies, and key service SLA management. Data key caching can reduce KMS call frequency, but it extends the residence time of plaintext keys on the application side. Therefore, cache duration, entry count, and purpose must be limited.

---

## 12. Conclusion

Enterprise-grade implementation of data encryption and decryption is not a single AES call. It is a system composed of standard algorithms, key hierarchy, key custody, permission control, auditing, rotation, recovery, and application SDKs. Envelope encryption is the core pattern in this system. Its basic idea is to use DEKs to encrypt business data, use KEKs, master keys, or KMS keys to wrap DEKs, and use root keys, KMS, HSM, or Vault to protect higher-level keys. This pattern balances the performance of local encryption for large-scale data, the controllability of centralized key management, and the operability of key rotation.

HashiCorp Vault Transit provides encryption-as-a-service and data key generation capabilities, making it suitable for unified cryptographic services and private key management platforms. AWS KMS, Google Cloud KMS, and Azure Key Vault represent standard implementation paths for cloud provider managed KMS. When implementing encryption, enterprises should choose remote encryption, local envelope encryption, or a combination of both based on data sensitivity, throughput, compliance requirements, tenant isolation, audit requirements, and disaster recovery requirements. For high-throughput, large-object, and cross-language systems, local envelope encryption plus centralized KMS/Vault management is the more general architecture. For small fields, strong auditing, and unified platform scenarios, Vault Transit or remote KMS encryption has clear engineering value.

## References

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
