# SPIRE-based zero-trust identity system for microservices: standard practices from workload authentication to inter-service authorization

## Abstract

Service instances in microservice systems are dynamically scheduled, elastically scaled, distributed across nodes, and often deployed in multi-tenant environments. Traditional trust models that rely on internal networks, IP allowlists, or fixed service names are no longer sufficient for service-to-service authentication and authorization. Zero-trust architecture does not mean that the system has no trust source. Instead, it requires access decisions to be based on explicit identity, least privilege, continuous verification, and auditable policies. Based on NIST zero-trust architecture, NIST microservice security guidance, SPIFFE/SPIRE, Kubernetes Admission Control, the Istio security model, OAuth2/JWT, and TLS standards, this article systematically analyzes the standard implementation of zero-trust identity for microservices. It focuses on the layered relationship between JWT request-level authentication and mTLS connection-level authentication; explains the roles of SPIRE Server, SPIRE Agent, Node Attestation, Workload Attestation, SVID, Registration Entry, Admission Controller, and ServiceAccount in the identity chain; and discusses trust boundaries between release platforms, Kubernetes, CA/KMS/HSM, and authorization policies. The study shows that a mature microservice zero-trust system does not eliminate roots of trust. Instead, it layers, minimizes, verifies, and revokes trust, and forms a closed loop through SPIRE, mTLS, JWT, Admission Policy, AuthorizationPolicy, and OPA.

**Keywords**: zero trust; microservices; SPIFFE; SPIRE; mTLS; JWT; ServiceAccount; Admission Controller; Workload Identity; service mesh

---

## 1. Introduction

Microservice architecture decomposes a system into independently deployed service units. Services communicate through HTTP, gRPC, message queues, or event buses. As the number of services grows, service-to-service call relationships expand into a mesh, and the traditional security model based on network boundaries gradually fails. Service instances may run on different nodes, namespaces, clusters, and cloud environments, and they may be created, destroyed, and migrated frequently. Therefore, IP addresses, hostnames, fixed ports, internal network zones, or Kubernetes Service names are not sufficient trust bases.

NIST SP 800-207 defines zero-trust architecture as a security architecture that does not grant trust based on implicit network location. Zero trust requires every access to be explicitly verified, and access decisions should be based on identity, device state, context, policy, and resource sensitivity. NIST SP 800-204A further notes that in microservice architectures, a service mesh can serve as infrastructure for secure communication, authentication, authorization, and monitoring.

A common misconception inside microservice systems is that "JWT authentication already exists, so mTLS is unnecessary." This judgment is incomplete. JWT is a request-level credential used to express claims such as request subject, issuer, audience, scope, tenant, user, or client. mTLS is a connection-level mechanism used to prove the identity of the peer workload on the current connection and to protect the confidentiality and integrity of the communication link. They solve different problems and should be used together.

This article focuses on the following questions:

1. Why is mTLS still needed when request-level JWT authentication already exists?
2. What role does SPIFFE/SPIRE play in a microservice zero-trust system?
3. How does SPIRE Server confirm that a SPIRE Agent is not forged?
4. When Kubernetes ServiceAccount names are known internally, how can impersonation be prevented?
5. What is the role of Admission Controller in the identity chain?
6. Does zero trust still rely on roots of trust? If the release platform is compromised, how can the blast radius be controlled?
7. How should an enterprise-grade service-to-service zero-trust system be implemented?

---

## 2. The Essence of Zero Trust: Not No Trust, but Explicit Trust

Zero trust is easily misunderstood as "there are no trusted components in the system." In fact, every authentication system must have a trust anchor, such as a Root CA, trust bundle, Kubernetes API Server, SPIRE Server, HSM/KMS, Admission Controller, or identity policy system. Zero trust does not eliminate roots of trust. It changes how trust is granted.

Traditional models often implicitly trust:

```text
The same internal network is trusted.
The same VPC is trusted.
The same Kubernetes cluster is trusted.
The same namespace is trusted.
Requests from a fixed IP are trusted.
```

A zero-trust model requires explicit verification:

```text
Who is the caller?
Who issued the identity?
Is the identity still valid?
Does the current connection come from the workload that owns this identity?
Is this identity allowed to access the current resource?
Does the JWT in the request match the target service?
Do the current environment, tenant, and data level satisfy policy?
```

Therefore, the essence of zero trust can be summarized as:

```text
Zero trust is not no trust.
Zero trust is explicit trust, least trust, continuous verification,
auditable trust, and revocable trust.
```

In SPIFFE/SPIRE scenarios, the system trust chain is usually:

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
Target service
```

If the Root CA, SPIRE Server, Registration Entry, Kubernetes API Server, or release platform receives excessive privileges and is compromised, the identity system can indeed be broken. Therefore, zero-trust architecture must answer the following questions: who is trusted, why they are trusted, how wide the trust scope is, and how compromise is detected and revoked.

---

## 3. The Layered Relationship Between JWT and mTLS

### 3.1 JWT Is Request-Level Authentication

JWT is suitable for expressing the identity and authorization claims of a single request, for example:

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

JWT mainly answers:

```text
Who issued this request credential?
Which user or client does this request represent?
Which audience is this request intended for?
Which scopes or claims does this request contain?
Has this token expired?
```

The advantage of JWT is that resource services can verify signatures locally without contacting a centralized authentication service on every request. However, JWT is usually a bearer token. Whoever holds the token can use it. Therefore, JWT alone cannot sufficiently prove that the peer on the current network connection is a legitimate workload.

### 3.2 mTLS Is Connection-Level Authentication

mTLS proves the workload identity of both sides of the current connection and encrypts the communication link. When Service A calls Service B, both sides perform mutual authentication through X.509 certificates. The certificate can carry a SPIFFE ID in the SAN URI, for example:

```text
spiffe://prod/ns/order/sa/order-service
spiffe://prod/ns/payment/sa/payment-service
```

mTLS mainly answers:

```text
Who is the peer on the current connection?
Was its certificate issued by a trusted trust bundle?
Has the certificate expired?
Does the SPIFFE ID in the certificate match expectations?
Is this service identity allowed to access the target service?
```

### 3.3 Why Both Are Needed

The relationship between JWT and mTLS is as follows:

| Layer | Technology | Problem Solved |
| --- | --- | --- |
| Connection level | mTLS / X.509-SVID | Which workload is the peer on the current connection? |
| Request level | JWT / OAuth2 Access Token / JWT-SVID | Who does the current request represent, what resource is it accessing, and what claims does it have? |
| Authorization level | AuthorizationPolicy / OPA / business permission center | Is this identity allowed to perform this operation? |
| Business level | Internal business service validation | Resource ownership, tenant boundary, data level, and business state |

Risks of using JWT alone include:

```text
JWTs can be replayed after theft.
Internal service ports may be accessed directly by bypassing the gateway.
The current peer cannot be proven to be a legitimate workload.
Audits can see only the token subject and may not identify the source workload.
The token cannot be constrained to a specific certificate holder.
```

Therefore, production-grade microservice zero-trust systems should not use a JWT-only model. A more reasonable model is:

```text
mTLS proves service identity.
JWT proves request identity.
The authorization system evaluates service identity + request identity +
resource + action + environment.
```

---

## 4. Standard Implementation of SPIFFE/SPIRE

### 4.1 The Relationship Between SPIFFE and SPIRE

SPIFFE stands for Secure Production Identity Framework for Everyone. It is a workload identity standard that defines a cross-platform and cross-environment identity model for workloads. SPIRE is a production-grade implementation of SPIFFE. It performs node attestation and workload attestation, and issues SVIDs to workloads.

Core concepts include:

| Concept | Meaning |
| --- | --- |
| SPIFFE ID | Standardized identity identifier for a workload |
| SVID | SPIFFE Verifiable Identity Document |
| X.509-SVID | X.509 certificate-based SVID, suitable for mTLS |
| JWT-SVID | JWT-based SVID, suitable for request-level identity propagation |
| Trust Domain | A trust domain for a set of workload identities |
| Trust Bundle | A trusted root set used to verify SVIDs under a trust domain |
| SPIRE Server | SPIRE control plane responsible for registration, attestation, and identity issuance |
| SPIRE Agent | Node-level agent responsible for workload attestation and the Workload API on the node |
| Registration Entry | Binding rule between SPIFFE ID and selectors |
| Selector | Selection condition that describes workload or node attributes |

### 4.2 Standard SPIRE Chain

In Kubernetes, the standard SPIRE identity chain is as follows:

```text
SPIRE Server
    ↓ manages registration entries, trust bundle, and CA issuance
SPIRE Agent
    ↓ one per Kubernetes worker node, usually deployed as a DaemonSet
Workload API
    ↓ exposed to workloads on the same node through a Unix Domain Socket
Workload
    ↓ obtains X.509-SVID / JWT-SVID
mTLS / JWT-SVID
    ↓ used for service-to-service authentication
AuthorizationPolicy / OPA
    ↓ used for service-to-service authorization
```

### 4.3 Officially Recommended Deployment Form of SPIRE Agent

In Kubernetes, SPIRE Agent is officially recommended to run as a DaemonSet, not as a sidecar for every business Pod.

The standard deployment form is:

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

Business Pods obtain SVIDs through the Workload API socket exposed by the SPIRE Agent on the same node. The socket can be mounted into business Pods through hostPath or the SPIFFE CSI Driver. The SPIFFE CSI Driver is preferred because it avoids direct hostPath dependency in business Pods.

SPIRE Agent is not suitable as a business sidecar because:

```text
The Agent is a node-level identity proxy, not a per-Pod attached process.
The Agent needs to observe workloads on the node.
One Agent per Pod would cause Agent count explosion.
The Node Attestation model naturally maps to node-level Agents.
Business sidecars are usually Envoy, OPA, or business proxies,
not SPIRE Agent.
```

### 4.4 How SPIRE Server Prevents Forged SPIRE Agents

SPIRE Server does not trust a process merely because it claims to be an Agent. SPIRE Agent must first pass Node Attestation.

In Kubernetes, a common approach is to use Projected Service Account Token, or PSAT. The flow is:

```text
SPIRE Agent starts.
    ↓
It reads the projected service account token from its own Pod.
    ↓
It starts node attestation with SPIRE Server.
    ↓
SPIRE Server calls the Kubernetes TokenReview API to verify the token.
    ↓
Kubernetes returns namespace, service account, pod name, and other information.
    ↓
SPIRE Server generates selectors according to its configuration.
    ↓
After matching succeeds, SPIRE Server issues an Agent SVID.
```

Therefore, forging a SPIRE Agent requires bypassing at least:

```text
A valid projected service account token.
Kubernetes TokenReview validation.
Namespace and service account restrictions for the Agent.
SPIRE Server node attestor configuration.
Agent registration and selector policies.
Subsequent Agent SVID rotation and authentication.
```

This shows that SPIRE's anti-forgery mechanism is not based on the Agent name. The Agent must prove that it runs in a trusted platform, trusted node, or trusted Pod environment.

---

## 5. The Role of Kubernetes Admission Controller in the Chain

### 5.1 Position of Admission Controller

The Kubernetes request chain is usually:

```text
kubectl / release platform / GitOps
        ↓
Kubernetes API Server
        ↓
Authentication: who is the requester?
        ↓
Authorization: is the requester allowed to operate this resource?
        ↓
Admission Controller: does the resource content comply with organizational policy?
        ↓
Persist to etcd
```

Admission Controller is the Kubernetes API Server admission mechanism that runs before an object is written to etcd. It is not responsible for runtime mTLS and is not a SPIRE component. It is a policy enforcement point in the Kubernetes control plane.

### 5.2 What Admission Controller Should Validate

In a zero-trust identity system, Admission Controller should mainly block the following risks:

```text
Illegally specifying serviceAccountName.
Using the default ServiceAccount.
Forging identity-related labels or annotations.
Using unsigned images.
Using the latest image tag.
Image digest not matching the release record.
Enabling privileged mode.
Using hostNetwork, hostPID, or hostIPC.
Mounting hostPath.
Mounting sensitive Secrets.
Modifying securityContext.
Deploying across namespaces.
Bypassing the release platform to create high-privilege workloads directly.
```

For example, the following configuration should be blocked:

```yaml
spec:
  serviceAccountName: payment-service
```

If the submitter is not the legitimate release subject for the payment service, it must not be allowed to use the `payment-service` ServiceAccount.

### 5.3 Relationship Between Admission Controller and SPIRE

Admission Controller and SPIRE do not replace each other. They connect before and after workload creation:

```text
Admission Controller: prevents dangerous workloads from being created.
SPIRE Agent: identifies workloads that are already running.
SPIRE Server: decides whether to issue identities based on selectors and registration entries.
AuthorizationPolicy / OPA: decides whether the identity may access the target service.
```

Without Admission Controller, an attacker may create a Pod that looks legitimate.
Without SPIRE, the system lacks standardized workload identity.
Without AuthorizationPolicy, a workload may have excessive permissions after obtaining an identity.

---

## 6. ServiceAccount Is Not a Secret; Controlling Usage Rights Is the Key

### 6.1 ServiceAccount Names Should Not Be Security Boundaries

In Kubernetes, ServiceAccount provides identity for processes running in Pods. A Pod can specify which ServiceAccount to use through `spec.serviceAccountName`. ServiceAccount names are usually application names or platform-generated names, such as:

```text
order-service
payment-service
risk-service
account-service
```

These names are not hard to obtain internally. They may appear in:

```text
Deployment YAML.
Helm Chart.
Git repository.
Log platform.
Monitoring system.
Distributed tracing.
Istio configuration.
Platform service catalog.
```

Therefore, ServiceAccount names are not secrets and should not be treated as security boundaries.

### 6.2 Knowing a ServiceAccount Does Not Mean Being Able to Use It

Security systems must not rely on "the attacker does not know the ServiceAccount name." The real security boundary should be:

```text
Whether the requester can create Pods in the target namespace.
Whether the requester is allowed to specify the target serviceAccountName.
Whether Admission Controller allows this binding.
Whether the release platform allows this application to use this identity.
Whether the SPIRE registration entry relies only on ServiceAccount.
Whether AuthorizationPolicy allows this SPIFFE ID to call the target API.
```

A dangerous design is:

```text
As long as a Pod uses the payment-service ServiceAccount,
SPIRE issues the payment-service SPIFFE ID.
```

A more reasonable design is:

```text
Only a workload that runs in the prod-payment namespace,
uses the payment-service ServiceAccount,
is created by the payment-service Deployment,
has an image digest matching the release record,
passes admission policy,
and runs on a trusted node
can obtain the payment-service SPIFFE ID.
```

### 6.3 SPIRE Registration Entry Should Not Rely Only on ServiceAccount

Weak binding example:

```text
SPIFFE ID:
  spiffe://prod/ns/payment/sa/payment-service

Selectors:
  k8s:sa:payment-service
```

This design relies too heavily on the ServiceAccount name. If an attacker can create a Pod using that ServiceAccount in a namespace, the identity may be impersonated.

A more reasonable selector combination should include:

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

The conclusion is:

```text
ServiceAccount can be public.
The right to use a ServiceAccount must be controlled.
SPIFFE ID binding must not rely only on the ServiceAccount name.
```

---

## 7. Release Platform and Trust Boundaries

### 7.1 The Release Platform Is Not the Final Root of Trust

The release platform usually submits application declarations to Kubernetes, such as Deployment, Service, ConfigMap, and image versions. However, the release platform should not directly hold CA private keys and should not directly issue service certificates.

Incorrect design:

```text
Release platform
    ↓
Holds the CA private key
    ↓
Directly issues mTLS certificates to services
```

In this design, once the release platform is compromised, attackers can issue arbitrary service identities.

Correct design:

```text
Release platform
    ↓
Submits controlled deployment declarations
    ↓
Kubernetes API Server
    ↓
Admission Controller validation
    ↓
SPIRE Agent performs workload attestation
    ↓
SPIRE Server issues SVIDs according to registration entries
```

The release platform is only one input source. It should not hold the final power to issue identities.

### 7.2 What Happens If the Release Platform Is Compromised

If the release platform has the following permissions:

```text
Create arbitrary namespaces.
Bind arbitrary ServiceAccounts.
Modify arbitrary Deployments.
Modify SPIRE registration entries.
Modify AuthorizationPolicy.
Push arbitrary images.
Bypass Admission Controller.
Access KMS or CA signing interfaces.
Modify the trust bundle.
```

Then after compromise, the identity system will likely be broken.

If release platform permissions are strictly limited:

```text
It can publish only specified applications to specified namespaces.
It cannot freely specify ServiceAccounts.
Images must be signed.
Deployments must pass Admission Controller.
It cannot modify SPIRE registration entries.
It cannot modify AuthorizationPolicy.
It cannot access CA/KMS.
Production releases require approval and dual control.
```

Then the impact of a compromised release platform can be limited to a specific application, namespace, or ServiceAccount.

The goal of a zero-trust system is not to guarantee that no component will ever be compromised. It is to ensure that one compromised component cannot expand laterally without limit.

---

## 8. Boundaries of CA, KMS, HSM, and Certificate Issuance

### 8.1 KMS Should Not Be a Direct Business Certificate Issuance Entry Point

mTLS certificates should be issued by PKI, CA, or workload identity systems such as SPIRE. The responsibility of KMS/HSM is to protect CA private keys or signing keys, not to let business services directly call KMS to issue certificates.

A reasonable structure is:

```text
Offline Root CA
        ↓
Intermediate CA per environment / cluster / trust domain
        ↓
SPIRE Server / Istiod CA / Vault PKI
        ↓
Workload X.509-SVID
```

Business services should not directly call:

```text
kms.sign(csr)
```

They should go through a controlled CA service:

```text
workload attestation
    ↓
registration entry match
    ↓
CA issues short-lived SVID
```

### 8.2 How to Reduce the Impact of CA/KMS Compromise

CA/KMS is critical infrastructure and cannot be "fully removed from trust." Engineering practices should reduce the blast radius through:

```text
Keep the Root CA offline.
Split Intermediate CAs by environment, cluster, or trust domain.
Place CA private keys in HSM/KMS and mark them non-exportable.
Do not allow business services to directly access signing interfaces.
Use short-lived leaf certificates.
Support rapid trust bundle rotation.
Fully audit issuance behavior.
Alert on abnormal issuance.
Maintain rapid revocation and rebuild procedures for CA compromise.
```

---

## 9. Service-to-Service Authorization Model

### 9.1 Authentication Is Not Authorization

Authentication answers:

```text
Who is the caller?
Is the request credential valid?
Is the connection peer trusted?
```

Authorization answers:

```text
Is this caller allowed to access this resource?
Is this request allowed to perform this action?
Do the current environment, tenant, path, method, and data level satisfy policy?
```

Passing authentication does not mean passing authorization. Service A proving that it is `order-service` does not mean it can access every API of `payment-service`.

### 9.2 Recommended Authorization Conditions

Service-to-service authorization should include at least:

```text
source SPIFFE ID;
destination workload;
HTTP method / gRPC method;
path / RPC service / RPC method;
JWT issuer;
JWT audience;
JWT subject;
JWT scope;
tenant;
namespace;
environment;
data level;
request risk level.
```

Example authorization logic:

```text
Allow the request if and only if:

1. mTLS authentication succeeds.
2. source principal = spiffe://prod/ns/order/sa/order-service.
3. JWT issuer is a trusted identity provider.
4. JWT audience = payment-service.
5. JWT has not expired.
6. JWT scope contains payment:create.
7. Request path = /internal/payments/create.
8. The current tenant, environment, and data level satisfy policy.
9. The business layer confirms that the caller may operate this order.
```

### 9.3 Policy Implementation Methods

Coarse-grained service-to-service authorization can use Istio AuthorizationPolicy. Complex authorization can use OPA or an enterprise permission center. Resource-level, tenant-level, and row-level permissions should still be checked again by business services.

A reasonable layering is:

| Layer | Responsibility |
| --- | --- |
| API Gateway | External user authentication and external request admission |
| Service Mesh | Service-to-service mTLS, service identity authentication, and coarse-grained authorization |
| OPA / Permission Center | Complex policies, ABAC, and cross-service policies |
| Business Service | Resource ownership, data permissions, and business state validation |

---

## 10. Authentication Algorithms, Key Types, and Signature Algorithm Selection

### 10.1 Connection-Level Authentication

Service-to-service connection-level authentication should use:

```text
mTLS + X.509-SVID + TLS 1.3
```

Certificate private keys should be generated independently for each workload. Multiple services should not share the same private key. Certificates should be rotated automatically with short lifetimes.

Certificate signature algorithms can be selected according to compliance requirements and infrastructure support:

```text
ECDSA P-256: good compatibility and compliance, suitable for most enterprises.
Ed25519 / EdDSA: performance and signature-size advantages, but runtime,
service mesh proxy, HSM/KMS, and compliance support must be confirmed.
RSA-PSS: suitable for enterprises with existing RSA PKI, but key and signature
sizes are larger.
```

### 10.2 Request-Level JWT Signatures

HS256 is not recommended as the primary signature algorithm for JWT in multi-service verification scenarios. HS256 is symmetric signing, which means issuer and verifier share the same key. If any verifier leaks the key, it may forge tokens.

For production environments, asymmetric signing is more reasonable:

```text
ES256: recommended first choice; short signature, good performance and compatibility.
EdDSA: suitable for modern systems when runtime and compliance conditions are met.
PS256: suitable for systems with existing RSA stacks and RSA-PSS requirements.
RS256: historically compatible, but not recommended as the first choice for new systems.
```

JWT validation must explicitly check:

```text
alg allowlist;
iss;
aud;
exp;
nbf;
kid;
signature;
scope;
token type;
required business claims.
```

---

## 11. Enterprise-Grade Standard Implementation Chain

Based on the previous sections, the recommended chain is:

```text
Developer / release platform
    ↓ can only submit changes
Git / GitOps / approval system
    ↓ controlled changes
Kubernetes API Server
    ↓ creates restricted workloads
Admission Controller
    ↓ validates namespace / SA / image / labels / securityContext
SPIRE Agent
    ↓ workload attestation
SPIRE Server
    ↓ registration entry match
CA / KMS / HSM
    ↓ issues short-lived SVID
Workload
    ↓ uses SVID for mTLS
AuthorizationPolicy / OPA
    ↓ decides whether access is allowed
Target service
```

Production-grade recommendations:

```text
1. Deploy SPIRE Server as a highly available control plane.
2. Run SPIRE Agent as a DaemonSet on every worker node.
3. Use SPIFFE CSI Driver to inject the Workload API socket into workloads.
4. Workloads obtain X.509-SVID through the Workload API.
5. Enforce STRICT mTLS for service-to-service communication.
6. Continue using JWT for request-level authentication.
7. JWT validation must check issuer, audience, scope, and expiration.
8. AuthorizationPolicy should authorize based on source SPIFFE ID and request claims.
9. OPA or a permission center should handle complex ABAC policies.
10. Business services should perform resource-level secondary authorization.
11. Admission Controller should restrict ServiceAccount, image, labels, and securityContext.
12. ServiceAccount usage rights should be controlled by the platform and admission policies.
13. SPIRE registration entries should not bind only ServiceAccount; they should also bind namespace, owner, image digest, and other attributes.
14. Keep the Root CA offline and manage Intermediate CAs per environment or cluster.
15. KMS/HSM should protect CA private keys only and should not expose arbitrary signing capability to business services.
16. Certificate issuance, authentication failures, authorization denials, and policy changes must all be audited.
```

---

## 12. Conclusion

The core of a service-to-service microservice zero-trust system is not merely introducing JWT, mTLS, or SPIRE. It is building a complete trust chain from release, admission, node attestation, workload attestation, certificate issuance, service-to-service communication, and authorization auditing.

JWT solves request-level identity and claims. mTLS solves connection-level workload identity and transport security. SPIFFE/SPIRE provides a standardized workload identity model. SPIRE Server is responsible for identity registration and issuance. SPIRE Agent runs on nodes as a DaemonSet and provides X.509-SVID or JWT-SVID to workloads through Node Attestation and Workload Attestation. Admission Controller prevents illegal workloads from being created in Kubernetes. It must especially restrict ServiceAccount impersonation, unsigned images, dangerous securityContext settings, and forged identity labels. ServiceAccount names are not secrets. Security boundaries should be built on usage-right control, admission policies, SPIRE selector combinations, and authorization policies.

Zero trust still relies on roots of trust. The difference is that a mature zero-trust system layers, isolates, audits, shortens the lifetime of, and revokes trust roots, instead of treating the entire internal network, release platform, or Kubernetes cluster as trusted. Only when the release platform, Kubernetes, SPIRE, CA/KMS, service mesh, Admission Controller, and authorization system form separation of duties and mutual constraints can a microservice zero-trust system be trustworthy in engineering practice.

---

## References

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
