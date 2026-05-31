# From Data Classification to Masking and Encryption: Security Information Governance Practices for Internet Companies

## Abstract

Security information classification is a foundational system for data security governance, personal information protection, and organizational information asset management. Classification systems differ across countries and regions, but they generally revolve around the degree of impact that information leakage, tampering, destruction, illegal acquisition, illegal use, or illegal disclosure may have on national security, public interests, organizational rights, and individual rights. Based on publicly available official laws, policies, and technical standards from China, the European Union, the United States, the United Kingdom, Singapore, Japan, Australia, and Canada, this article summarizes the classification methods for enterprise information, personal information, sensitive personal information, important data, core data, government classified information, and protected information. It also analyzes how internet companies can process different levels of information through technical controls such as masking, substitution, randomization, hashing, encryption, de-identification, and anonymization. The study shows that most jurisdictions do not specify by law that a particular field must use one specific masking algorithm. Instead, they define control objectives through requirements such as risk appropriateness, purpose limitation, data minimization, security safeguards, de-identification, anonymization, encryption, and key management. When implementing classified protection, internet companies should use data classification as the starting point and bring collection, storage, transmission, use, processing, sharing, export, logging, testing, backup, and destruction into one unified control chain.

## Keywords

Security information classification; data classification and grading; personal information protection; sensitive personal information; data masking; de-identification; anonymization; encryption; internet companies

## 1. Introduction

Security information classification covers enterprise operating information, organizational internal information, personal information, sensitive personal information, regulated industry data, national-security-related data, and protected information used by governments or public-sector organizations. China's Data Security Law defines data as any record of information in electronic or other form, and defines data processing activities as collection, storage, use, processing, transmission, provision, and disclosure. [1] Therefore, security information classification is not limited to database fields. It also covers business documents, API data, logs, model training data, backup data, exported files, and third-party shared data throughout the data lifecycle.

Institutional differences across jurisdictions mainly appear in two dimensions. The first is the information asset dimension, where information is classified by the impact that leakage, tampering, or unavailability may have on national security, public interests, organizational operations, or individual rights. The second is the personal information dimension, where systems distinguish ordinary personal information, sensitive personal information, special categories of personal data, protected health information, anonymized information, pseudonymized information, or de-identified information. The former is closer to security classification and confidentiality management. The latter is closer to privacy protection and the legality of data processing.

This article uses publicly available official documents as its analytical basis, including laws, regulatory guidance, and standards from different countries and regions. It summarizes security information classification and provides a factual analysis of technical controls used by internet companies when processing different levels of data.

## 2. Security Information Classification in Major Jurisdictions

### 2.1 China: Core Data, Important Data, General Data, and Personal Information

China's data security classification system includes data security grading, personal information classification, and the state secrets system. Under the Data Security Law, the state establishes a classified and graded data protection system and applies stricter management to data related to national security, the lifelines of the national economy, important people's livelihood, and major public interests. [1] The national standard GB/T 43697-2024, Data Security Technology - Rules for Data Classification and Grading, classifies data from high to low as core data, important data, and general data. Its grading basis includes the importance of data to economic and social development, as well as the harm that data leakage, tampering, destruction, illegal acquisition, illegal use, or illegal sharing may cause to national security, economic operation, social order, public interests, organizational rights, and individual rights. [2]

In the personal information dimension, the Personal Information Protection Law defines personal information as various kinds of information recorded electronically or otherwise that relate to identified or identifiable natural persons. It defines sensitive personal information as personal information that, once leaked or illegally used, may easily lead to infringement of a natural person's dignity or harm to personal or property safety. Sensitive personal information includes biometric identification, religious belief, specific identity, medical and health information, financial accounts, location tracks, and personal information of minors under the age of 14. [3] GB/T 35273-2020, Information Security Technology - Personal Information Security Specification, further requires that personal information should preferably be de-identified immediately after collection; encryption and other security measures should be used when transmitting and storing sensitive personal information; and technical measures should be applied before storing biometric information, for example storing only digest information. [4]

China's system therefore contains at least four parallel object types: state secrets and related classified information, core data, important data, general data, and personal information including sensitive personal information. Internet companies usually handle general data, important data, personal information, and sensitive personal information. In specific industries, at certain scales, or in high-precision data scenarios, they may also need to identify important data or core data.

### 2.2 European Union: Personal Data, Special Categories of Personal Data, and EU Classified Information

The GDPR defines personal data as any information relating to an identified or identifiable natural person. It defines pseudonymization as processing personal data in such a manner that the data can no longer be attributed to a specific data subject without using additional information, provided that such additional information is kept separately and protected by technical and organizational measures. [5] Article 9 of the GDPR defines special categories of personal data, including data revealing racial or ethnic origin, political opinions, religious or philosophical beliefs, trade union membership, genetic data, biometric data, health data, and data concerning sex life or sexual orientation. [6] Article 32 lists pseudonymization and encryption as possible technical and organizational measures for ensuring processing security, and requires controllers and processors to adopt security measures appropriate to risk in light of the state of the art, implementation cost, processing nature, scope, context, purpose, and the risks to natural persons' rights and freedoms. [7]

At the level of government and institutional classified information, the EU has a separate EUCI classification system: TRES SECRET UE/EU TOP SECRET, SECRET UE/EU SECRET, CONFIDENTIEL UE/EU CONFIDENTIAL, and RESTREINT UE/EU RESTRICTED. The levels are based on the degree of damage that unauthorized disclosure may cause to the essential interests of the European Union or its member states. [8]

Therefore, in the EU system, personal data protection and classified information protection are two different classification systems that may apply in parallel. When internet companies process EU personal data, the core classification basis is ordinary personal data, special categories of personal data, data related to criminal convictions and offenses, pseudonymized data, and anonymized data, rather than EUCI classification levels.

### 2.3 United States: FIPS 199 Impact Levels, PII, PHI, and Cryptographic Module Requirements

United States federal information system categorization uses FIPS 199. This standard classifies the potential impact of federal information and information systems as LOW, MODERATE, or HIGH across the three security objectives of confidentiality, integrity, and availability. The overall security category of an information system depends on the combination of impact values for each security objective. [9] For personally identifiable information, NIST SP 800-122 provides a contextual method for identifying PII and determining an appropriate protection level, requiring PII to be protected against inappropriate access, use, and disclosure. [10]

In health information scenarios, U.S. HHS guidance on HIPAA de-identification states that protected health information may be de-identified using either expert determination or the safe harbor method. [11] The HIPAA Security Rule requires administrative, physical, and technical safeguards for electronic protected health information to protect its confidentiality, integrity, and availability. [12] For cryptography, FIPS 140-3 defines security requirements for cryptographic modules used by federal departments and their contractors, and includes four increasing security levels for cryptographic modules; NIST SP 800-57 provides guidance for key management. [13]

The U.S. system is a combination of impact level, data category, sector-specific rules, and cryptographic standards: federal information systems are categorized as LOW, MODERATE, or HIGH; PII protection is determined by contextual risk; PHI is processed under HIPAA rules; and cryptographic capabilities are implemented according to FIPS and NIST standards.

### 2.4 United Kingdom: OFFICIAL, SECRET, and TOP SECRET

The United Kingdom Government Security Classifications Policy uses three classification levels: OFFICIAL, SECRET, and TOP SECRET. The policy states that protective controls and baseline behaviors for the three levels should match the potential impact of compromise, accidental loss, or incorrect disclosure, as well as the degree of interest from threat actors. OFFICIAL-SENSITIVE is a handling caveat for OFFICIAL information, not a separate classification level. [14]

The UK system mainly applies to government information and to contractors processing government information. If an internet company acts as a government supplier or processes UK government information, it should follow contract terms, security classification markings, and handling requirements. If it processes UK personal data, UK GDPR and the UK data protection framework usually apply.

### 2.5 Singapore: Personal Data and Anonymization Processing

Singapore's PDPA regulates the collection, use, and disclosure of personal data by organizations, and recognizes the need to balance personal data protection with organizations' legitimate need to collect, use, or disclose personal data. [15] Singapore PDPC's anonymization guidance explains that anonymization and de-identification can be used to reduce re-identification risks in personal data use and sharing. It particularly notes that anonymization practices should be adopted as far as possible when sharing data externally, and may also be used for internal sharing where the processing purpose does not require identifying individuals. [16]

The Singapore PDPA itself does not provide a single statutory list of special categories of personal data like GDPR Article 9. Its official guidance focuses on reasonable security arrangements, anonymization, de-identification, re-identification risk assessment, and organizational accountability.

### 2.6 Japan: Personal Information, Special Care-Required Personal Information, Anonymously Processed Information, and Pseudonymously Processed Information

Japan's APPI establishes the basic framework for personal information protection and is supervised by the Personal Information Protection Commission. The Japanese system includes concepts such as personal information, personal data, retained personal data, special care-required personal information, anonymously processed information, and pseudonymously processed information. Anonymously processed information emphasizes processing that prevents identification of a specific individual. Pseudonymously processed information emphasizes that a specific individual cannot be identified unless compared with other information. This classification allows companies to adopt different processing methods for data use, third-party provision, and internal analytics depending on whether data can still identify individuals, whether re-identification is intended, and whether the purpose is statistical or analytical. [17]

### 2.7 Australia: Government Information Security Classification and Personal Information Security Obligations

Under the Australian Government Protective Security Policy Framework, security classifications include Official: Sensitive, Protected, Secret, and Top Secret. Official and Unofficial are not security classifications. Security-classified information requires protective markings, and information metadata should also be marked. [18] For personal information protection, the Privacy Act 1988 and the Australian Privacy Principles apply to certain government agencies and private-sector organizations. OAIC guidance on APP 11 requires APP entities to take reasonable steps to protect the personal information they hold from misuse, interference, loss, unauthorized access, modification, or disclosure. When personal information is no longer needed, entities should take reasonable steps to destroy or de-identify it unless the law requires otherwise. [19]

Australia also distinguishes government information asset classification from personal information protection obligations. For internet companies processing personal information, the key controls are reasonable security measures, retention periods, destruction, de-identification, and data breach risk control.

### 2.8 Canada: Protected A/B/C and Classified Information

The Canadian government security system distinguishes protected information and assets from classified information and assets. Protected information applies to information whose compromise may harm non-national interests, such as the interests of individuals, organizations, or the government. Its levels include Protected A, Protected B, and Protected C. Classified information applies to information whose compromise may harm national interests, national defense, and the social, political, and economic stability of Canada. Its levels include Confidential, Secret, and Top Secret. [20] For personal information, PIPEDA applies to Canadian private-sector organizations that collect, use, or disclose personal information in the course of commercial activities. The Office of the Privacy Commissioner of Canada notes that health information, financial information, racial or ethnic origin, political opinions, genetic data, biometric data, sex life or sexual orientation, and religious or philosophical beliefs are usually considered sensitive and require a higher level of protection. [21]

Canada uses Protected A/B/C for harm to individuals, organizations, or government interests, and Classified levels for harm to national interests. Together, they form its security information classification framework.

## 3. Cross-Jurisdictional Correspondence of Security Information Levels

The level names used by different jurisdictions cannot be directly mapped to each other. The core reason is that their classification bases differ: some are based on the degree of harm to national security, some on the impact on organizational or individual rights, some on identifiability and sensitivity of personal data, and some on the confidentiality, integrity, and availability impact of systems. Cross-jurisdictional comparison can therefore only establish functional correspondence, not legal equivalence.

From the perspective of internet company data governance, security information can be divided into five categories.

The first category is public information, including lawfully disclosed announcements, public product documentation, public marketing materials, public API descriptions, and public statistical data. This type of information usually does not require masking, but it requires integrity protection, source control, and version management.

The second category is general internal information, including ordinary internal documents, general operational data, general system configuration, non-sensitive business metrics, and ordinary enterprise process information. This type of information is usually not open to the public, but leakage mainly affects internal management, business competition, or general reputation.

The third category is restricted enterprise information and ordinary personal information, including customer records, employee records, order information, contact information, general account information, logs that can identify users, general business strategies, non-public contract content, and supplier information. This type of information may trigger personal information protection, contractual confidentiality, or trade secret obligations in multiple jurisdictions.

The fourth category is highly sensitive information, including sensitive personal information, special categories of personal data, protected health information, financial accounts, payment information, precise location tracks, biometric data, minors' information, authentication credentials, keys, tokens, important business risk-control strategies, core algorithm parameters, bulk user data, and high-value commercial data. This type of information usually requires strict access control, encryption, key management, auditing, de-identification, or anonymization.

The fifth category is national-security, public-interest, or sector-critical data, including core data and important data in the Chinese context; government classified information; SECRET/TOP SECRET or Classified information under UK, EU, Australian, and Canadian systems; and high-impact data in U.S. FIPS HIGH information systems. This type of data generally should not enter ordinary internet company data processing pipelines. If a company processes such data because of government-enterprise cooperation, industry regulation, critical infrastructure, public service, or cross-border business, it should establish a dedicated control domain according to requirements from national or industry authorities, contracts, classified protection, commercial cryptography, supply-chain security, and data export rules.

## 4. Masking and Encryption Methods for Different Information Levels

### 4.1 Functional Boundaries of Masking Methods

Masking, substitution, randomization, hashing, and encryption are different kinds of technical measures.

Masking is usually used in presentation layers, reporting layers, customer service back offices, log display, and low-privilege query scenarios. Its function is to hide part of a value, such as displaying only the first three and last four digits of a phone number, showing only selected digits of an ID number, or hiding part of an email address. Masking is not equivalent to source data protection. If the database still stores plaintext, masking only reduces display and accidental disclosure risks. It does not reduce plaintext leakage risk if the database is exfiltrated.

Substitution is usually used for test data, demo data, research and development troubleshooting data, and externally shared samples. Its function is to replace real values with values of the same type but not real, such as replacing real names with fictional names or real addresses with fictional addresses. If the substitution mapping table is retained, the result may still be reversible pseudonymization or reversible masking. If the mapping table is destroyed and no other re-identification path exists, the result is closer to anonymization or irreversible de-identification.

Randomization is usually used for statistical analysis, model training, test environments, and imprecise analysis. It reduces the probability that a single natural person or organization can be identified through perturbation, generalization, bucketing, sampling, or noise injection. Randomization is suitable when the original value does not need to be restored accurately, but it changes the data distribution or field truthfulness. It is therefore not suitable for accounting, transactions, risk attribution, real-name verification, or other business paths that require original values.

Hashing is usually used for irreversible verification, deduplication, association matching, and storage of authentication secrets. Ordinary hashing is vulnerable to dictionary attacks for low-entropy data such as phone numbers, ID numbers, and email addresses. Such fields should not rely only on unsalted ordinary hashes. For association matching, keyed hashing or tokenization should be used, and the key should be managed separately from the data. For passwords and similar authentication secrets, salted password hashing with a cost factor should be used instead of reversible encryption.

Encryption is a reversible protection measure used when the business must recover plaintext, such as payment, real-name verification, risk control, customer service verification, compliance retention, audit investigation, and user rights response. The core of encryption protection is not only the algorithm, but also the key lifecycle, key access permissions, key rotation, key custody, hardware security modules or key management systems, decryption auditing, minimized decryption, and anomalous decryption alerts.

### 4.2 Classification Matrix for Masking and Encryption

Public information usually does not require masking, substitution, randomization, hashing, or encryption protection, but it requires integrity checks, release approval, version control, and anti-tampering measures.

General internal information can use masking or substitution in non-production environments, low-privilege display, and cross-team sharing. For business secrets, non-public contracts, supplier quotations, internal strategies, and system configuration, access control, transport encryption, and storage encryption should be used. System keys, API tokens, database passwords, and certificate private keys are not ordinary internal information. They should be treated as highly sensitive information.

Ordinary personal information should be masked or minimized at the field level in display, logs, customer service back offices, operation back offices, and exported files. In test and development environments, substitution, randomization, or anonymized data should be used. For user deduplication, blacklist matching, and cross-system association, keyed hashes or tokenization may be used. For original business processing where plaintext must be restored, transport encryption and storage encryption should be used, and decryption permissions should be limited.

Sensitive personal information, special categories of personal data, PHI, financial accounts, precise location, biometric information, minors' information, ID images, and other highly sensitive information should prioritize encrypted storage, encrypted transmission, field-level access control, separate authorization, operation auditing, and decryption approval. Display layers should use strong masking or complete hiding. Logs should prohibit plaintext output by default. Test, analysis, and sharing scenarios should use substitution, generalization, randomization, anonymization, or irreversible de-identification. Biometric information should not directly store original images or raw features. Technically processed templates, digests, or irreversible results should be stored instead, together with encryption and access control.

Authentication credentials, passwords, private keys, tokens, session cookies, refresh tokens, SMS verification codes, one-time passwords, and other security secrets should not be stored in reversible plaintext form. Passwords should use salted password hashing with a cost factor. API tokens, refresh tokens, private keys, and certificates should be placed in a key or secret management system. Business databases should not store directly usable plaintext secrets as ordinary fields.

Important data, core data, national-security-related information, government SECRET/TOP SECRET information, or Classified information should prioritize isolated domains, dedicated networks, dedicated terminals, dedicated authorization, dedicated auditing, strong encryption, media control, access approval, and full-lifecycle tracking. Masking such data cannot replace requirements from authorities, contracts, or national security systems. If such data is used for statistics, testing, model training, or external sharing, data classification, impact assessment, approval, and necessary anonymization or de-identification should be completed first.

## 5. Operational Paths for Internet Companies Processing Encrypted Information at Different Levels

### 5.1 Data Asset Identification and Tagging

The first step for internet companies processing security information is to establish a data asset inventory. The inventory should cover structured databases, data warehouses, object storage, caches, search indexes, log systems, message queues, backups, offline files, model training sets, reporting platforms, and third-party data interfaces. Each data object should record at least its source, business system, data subject, field meaning, personal information attribute, sensitive attribute, whether it involves important data or core data, storage location, purpose of use, retention period, sharing recipients, cross-border attribute, and responsible owner.

Tagging is the foundation for implementing classified controls. Field-level tags can include public, internal, personal information, sensitive personal information, authentication secret, financial information, health information, location track, minors' information, enterprise secret, important data, and core data. Object-level tags can include table, file, topic, index, API, report, model dataset, and backup set. Data tags should feed into permission, audit, masking, export, encryption, and alerting policies, rather than remaining only in documentation ledgers.

### 5.2 Data Minimization Controls During Collection

The collection stage should limit field scope according to business purpose. Ordinary personal information collection should be directly related to the business function. Sensitive personal information collection should have a specific purpose and sufficient necessity, and should use separate consent or another lawful processing basis. For biometric information, financial accounts, precise location, minors' information, and other highly sensitive data, impact assessment, notice, authorization, storage plan, access scope, and retention period should be confirmed before collection.

Internal enterprise data collection should also be limited in scope. Log systems, event tracking systems, distributed tracing systems, and error reporting systems should not collect ID numbers, bank card numbers, passwords, tokens, cookies, or sensitive fields from raw request bodies by default. When collection cannot be avoided, masking, truncation, hashing, tokenization, or encryption should be completed at the collection side or before data enters the lake.

### 5.3 Layered Encryption During Storage

The storage stage should distinguish infrastructure-layer encryption, database transparent encryption, field-level encryption, and application-layer encryption. Public data and general internal data can use disk encryption, object storage encryption, and transport encryption as baseline controls. Ordinary personal information should use database access control, backup encryption, and transport encryption. Fields displayed frequently can use field-level masking strategies. Sensitive personal information, highly sensitive enterprise information, and authentication secrets should use field-level encryption, application-layer encryption, or tokenization, and keys should be separated from data.

Key management should be independent from business databases. Key generation, distribution, storage, use, rotation, revocation, and destruction should be controlled by a key management system or hardware security module. Business applications should receive only minimized decryption capability. Production operations staff should not obtain bulk decryption capability through direct database connections. Key access logs should be retained independently and should be correlatable with data access logs for auditing.

### 5.4 Dynamic Masking and Minimized Decryption During Use

The use stage should apply dynamic masking by role, scenario, and purpose. When customer service staff query user phone numbers, only partial numbers may be displayed. When risk control systems perform model computation, tokenized or encrypted features may be used. When accounting systems perform clearing and settlement, necessary fields may be decrypted in controlled workflows. When developers troubleshoot issues, masked logs and masked samples should be used by default instead of production plaintext data.

Minimized decryption is the core control for highly sensitive data during use. Decryption should satisfy business necessity, authorized identity, access scope, time window, and audit requirements. Bulk decryption, cross-database correlated decryption, decrypting after export, offline plaintext analysis, screenshot sharing, and copying to local files are all high-risk operations. They should be governed by approval, second-factor authentication, watermarking, behavior auditing, and anomaly alerts.

### 5.5 De-Identification During Processing, Analysis, and Model Training

Data processing, analysis, and model training usually do not need to directly identify natural persons. These scenarios should prioritize de-identification, anonymization, generalization, randomization, aggregation, or differential privacy to reduce re-identification risk. If model training requires stable user association, keyed hashes or tokenized IDs can be used. If the training task does not require user-level tracking, direct identifiers should be removed and quasi-identifiers should be reduced in granularity, such as age bands, geographic generalization, and time-window aggregation.

Anonymization is not a one-time field deletion operation. For location tracks, device fingerprints, behavior sequences, medical records, minority-group attributes, and long-text content, individuals may still be re-identified through combined features even after names, phone numbers, and ID numbers are removed. Therefore, anonymization should include re-identification risk assessment, assumptions about attacker capability, quasi-identifier processing, output data utility assessment, and residual risk records.

### 5.6 Sharing, Export, and Third-Party Processing

Sharing and export are concentrated points of data leakage risk. Exports of ordinary personal information should apply field minimization, masking, watermarking, approval, download count limits, validity period limits, and operation logging. Before exporting sensitive personal information, highly sensitive enterprise information, or bulk user data, companies should perform risk assessment, secondary approval, multi-factor authentication, recipient verification, transport encryption, and destruction requirements upon expiration. Test, outsourcing, supplier analysis, and cross-department sharing scenarios should use masked data by default and should not directly provide production plaintext data.

Third-party processors should be constrained through contracts, data processing agreements, API permissions, audit rights, deletion obligations, sub-processing restrictions, security incident notification, and cross-border transfer conditions. Shared data still requires traceability. Especially for highly sensitive data and important data, companies should retain dataset versions, field lists, recipients, transmission time, transmission method, approval records, and destruction evidence.

### 5.7 Logging, Monitoring, and Incident Response

Logging systems should not become side-channel copies of sensitive data. Application logs, access logs, gateway logs, error stacks, audit logs, message retry failure logs, distributed tracing tags, and BI query logs may all record personal information or security secrets. Internet companies should implement sensitive field detection, masking, and blocking rules in SDKs, gateways, log collection agents, message middleware, and data ingestion layers.

Incident response should determine handling priority by data level. Leakage of ordinary internal information mainly triggers internal investigation and access control repair. Leakage of personal information may trigger notification, reporting, and protection of user rights. Leakage of sensitive personal information, authentication credentials, financial information, health information, or minors' information usually requires higher-level response. Leakage of important data, core data, or government classified information may trigger processes involving industry authorities, national security, cybersecurity, and contractual liability.

### 5.8 Destruction, Anonymization, and Retention Periods

When personal information exceeds the period necessary to achieve the processing purpose, or when the business no longer needs it, it should be deleted or anonymized. Backups, archives, search indexes, caches, object storage replicas, offline wide tables, training samples, and third-party copies should also be included in deletion or anonymization scope. Deleting records only from the primary database cannot be considered complete data destruction. Destruction of highly sensitive information should retain operation records. Key destruction can make ciphertext unrecoverable, but it should still be combined with media destruction, backup expiration, and index cleanup to close the loop.

## 6. Conclusion

Major jurisdictions do not use a unified naming system for security information classification, but they all use impact level, identifiability, sensitivity, processing purpose, and risk proportionality as core bases. China has formed a parallel classification system of core data, important data, general data, personal information, and sensitive personal information. The EU is based on GDPR personal data, special categories of personal data, pseudonymization, and encryption requirements, while also maintaining an EUCI classified information system. The United States forms a combined protection framework through FIPS 199 LOW/MODERATE/HIGH impact levels, NIST PII guidance, HIPAA PHI rules, and cryptographic standards. The United Kingdom, Australia, and Canada use OFFICIAL/SECRET/TOP SECRET, Official: Sensitive/Protected/Secret/Top Secret, and Protected A/B/C plus Classified levels in government information classification. Singapore and Japan have institutional requirements around personal data, anonymization, de-identification, pseudonymization, and anonymously processed information.

Masking and encryption are not the same kind of control. Masking mainly reduces display risk. Substitution and randomization mainly serve testing, analysis, and sharing. Hashing mainly supports irreversible verification, association matching, and authentication secret protection. Encryption mainly protects confidentiality when the business needs to recover plaintext. Internet companies should use data classification as the entry point and bring masking, encryption, key management, access control, auditing, export approval, log governance, third-party management, incident response, and destruction mechanisms into one unified data security governance system. For sensitive personal information, special categories of personal data, protected health information, financial accounts, biometric information, authentication secrets, important data, and core data, masking alone is insufficient to meet protection objectives. Encryption, de-identification, anonymization, key separation, minimized decryption, and full-chain auditing should be combined.

## References

[1] Data Security Law of the People's Republic of China.
[2] GB/T 43697-2024, Data Security Technology - Rules for Data Classification and Grading.
[3] Personal Information Protection Law of the People's Republic of China.
[4] GB/T 35273-2020, Information Security Technology - Personal Information Security Specification.
[5] Regulation (EU) 2016/679, Article 4.
[6] Regulation (EU) 2016/679, Article 9.
[7] Regulation (EU) 2016/679, Article 32.
[8] Council of the European Union, Protection of European Union Classified Information.
[9] NIST FIPS 199, Standards for Security Categorization of Federal Information and Information Systems.
[10] NIST SP 800-122, Guide to Protecting the Confidentiality of Personally Identifiable Information.
[11] U.S. HHS, Guidance Regarding Methods for De-identification of Protected Health Information.
[12] U.S. HHS, Summary of the HIPAA Security Rule.
[13] NIST FIPS 140-3; NIST SP 800-57.
[14] UK Government Security Classifications Policy.
[15] Singapore Personal Data Protection Act 2012 and PDPC materials.
[16] Singapore PDPC, Guide to Basic Anonymisation and Advisory Guidelines.
[17] Japan Act on the Protection of Personal Information and PPC materials.
[18] Australian Government Protective Security Policy Framework and Style Manual.
[19] OAIC, Australian Privacy Principles and APP 11 guidance.
[20] Government of Canada, Levels of Security and Security Categorization materials.
[21] Office of the Privacy Commissioner of Canada, PIPEDA and sensitive information guidance.
