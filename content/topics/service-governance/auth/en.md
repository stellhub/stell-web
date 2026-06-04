# Standardized Design of Authorization Rule Systems

## Abstract

Authorization rules are a core component of access control systems in information systems. Their goal is to make verifiable judgments about identity trustworthiness, access permissions, request context, and resource boundaries when a subject accesses a resource. According to NIST, IETF OAuth/JWT standards, and Istio's official security model, an authorization system usually includes authentication, authorization, access control policies, policy decisions, policy enforcement, and auditing. Authentication confirms the identity of a user, process, device, or workload. Authorization determines whether a specific subject has permission to access a specific resource or perform a specific operation. Authorization rules express subjects, resources, operations, and environmental attributes as executable policies. This article provides a structured explanation of authorization rule systems from the perspectives of concepts, necessity, rule enforcement locations, chain-level authentication and request-level authorization, JWT mechanisms, the Istio authorization model, and configuration granularity.

**Keywords**: authentication; authorization; access control; JWT; OAuth 2.0; Istio; ABAC; service mesh; zero trust

## 1. Introduction

In distributed systems, microservice architectures, and service mesh environments, service calls are no longer limited to a single trusted network boundary. NIST zero-trust architecture states that access control should center on resource protection, trust should not be implicitly granted, and access should be continuously evaluated during the access process while enforcing least-privilege access control at the finest practical granularity [R1]. In this context, the role of authorization rules is not simply determining "whether a user is logged in." Instead, they express "who is accessing what, what operation is being performed, and under what context" as auditable, executable, and verifiable policies.

Authorization rule design must distinguish authentication from authorization. Authentication addresses identity trustworthiness. Authorization addresses access permissions. Together they form the basis of access control, but they are not equivalent. Successful authentication does not necessarily mean the request is authorized. Authorization rules need to make independent decisions based on authentication results, resource attributes, operation attributes, and environmental conditions.

## 2. Basic Concepts

### 2.1 Authentication

Authentication is the process of verifying the identity of a user, process, or device, usually as a prerequisite before accessing system resources [R2]. In network systems, authentication subjects can be end users, client applications, service workloads, devices, or automated processes. Common authentication mechanisms include username and password, multi-factor authentication, client certificates, mTLS, OIDC ID Tokens, API Keys, and signed credentials.

In service meshes, authentication between workloads is often completed through mTLS. mTLS not only provides transport encryption, but can also confirm caller workload identity through identity information in certificates. Istio PeerAuthentication is used to configure peer authentication policies when workloads receive requests. STRICT mode requires requests to use mutual TLS [R8].

### 2.2 Authorization

Authorization is the granting or denial of rights or permissions for a system entity to access system resources. It can also mean the process of verifying whether a requested action is allowed [R3]. Authorization depends on known identity, but the authorization decision itself is not limited to identity. It can also depend on roles, organizations, service accounts, resource ownership, request methods, paths, source IPs, destination ports, JWT claims, time, environmental risk, and other context.

In OAuth 2.0, an access token represents the access authorization obtained by a client. The client uses the access token to access the resource server instead of directly using the resource owner's credentials [R5]. Therefore, the core goal of OAuth 2.0 is authorization delegation, not pure identity authentication.

### 2.3 Authorization Rules

Authorization rules are executable expressions of access control policies. A rule usually contains the following elements:

1. Subject: a user, client, service account, workload, device, or process.
2. Resource: an API, service, data object, file, topic, queue, database table, business entity, and similar object.
3. Operation: HTTP Method, gRPC Method, read, write, delete, approve, publish, manage, and similar action.
4. Condition: IP, time, namespace, JWT Claim, Header, environment level, tenant, resource state, and similar context attribute.
5. Action: allow, deny, audit, or delegate the decision to an external authorization system.

NIST SP 800-162 defines ABAC as a logical access control method based on attributes. It determines whether an operation is allowed by evaluating attributes of the subject, object, operation, and environmental conditions according to policies, rules, or relationships [R4]. Therefore, modern authorization rules are not limited to RBAC role checks. They can contain RBAC, ABAC, scopes, claims, service identities, and resource attributes at the same time.

## 3. Why Authorization Rules Are Necessary

The necessity of authorization rules comes from the executability requirement of access control. Without rules, a system can only rely on code branches, manual conventions, or implicit trust in network boundaries. This makes permission boundaries difficult to audit, reuse, and change uniformly. NIST zero-trust architecture describes access granting as a process completed through policy decision points and policy enforcement points [R1]. This means access control is not only an abstract principle. It must be policy-based, executable, and auditable.

Authorization rules are also used to express least privilege. Zero-trust architecture requires access rules to be as fine-grained as possible and to grant only the minimum permissions needed to complete the requested action [R1]. In a microservice system, Service A being able to connect to Service B does not mean Service A can access all APIs of Service B. A user having a login session does not mean the user can access any tenant, any resource, or any operation. Therefore, authorization rules need to separately express service-level, interface-level, resource-level, and context-level permissions.

## 4. Enforcement Locations for Authorization Rules

Authorization rules should be enforced at locations that can intercept access paths to protected resources. According to the NIST zero-trust model, a policy enforcement point executes authorization decisions, while a policy decision point produces allow or deny results based on policies and context [R1]. In engineering implementations, policy enforcement points can be located in API Gateways, Ingress Gateways, service mesh sidecars, application service interceptors, RPC filters, database proxies, or data access layers.

Different locations are suitable for different rule granularities. Gateways are suitable for entry authentication, token validation, tenant entry restrictions, coarse-grained API access control, and unified auditing. Service meshes are suitable for service-to-service workload identity authentication, namespace isolation, service account authorization, HTTP Method/Path/gRPC Method, and similar protocol-layer rules. Application services are suitable for business resource-level rules, such as resource ownership, order state, project membership, field-level permissions, and row-level data permissions. Data layers are suitable for final data boundaries, such as row-level security policies, field masking, table-level permissions, and auditing.

The frontend should not be the only authorization enforcement point. Frontends can hide buttons or menus, but they cannot guarantee requests will not be bypassed. Access control for protected resources needs to be completed on the server side, gateway, service mesh, or data layer.

## 5. Chain-Level Authentication and Request-Level Authorization

Chain-level authentication and request-level authorization are common layers in service mesh and zero-trust systems. Chain-level authentication mainly solves the identity and transport security of both communication parties. For example, Service A and Service B establish peer identity through mTLS. Request-level authorization mainly solves whether a specific request is allowed. For example, whether Service A can call Service B's `/admin` path, or whether a JWT Subject can perform `POST /orders`.

Istio provides PeerAuthentication, RequestAuthentication, and AuthorizationPolicy. PeerAuthentication is used for peer authentication and mTLS. RequestAuthentication declares request authentication methods supported by workloads and validates JWTs in requests. AuthorizationPolicy enforces access control for workloads in the mesh [R8][R9][R10]. Istio official documentation clearly states that RequestAuthentication rejects requests containing invalid authentication information. Requests without authentication credentials are accepted by default but do not form an authenticated identity. To restrict access to authenticated requests only, authorization rules must be used together [R9]. This shows that request authentication and request authorization are separated in the model.

Therefore, chain-level authentication can confirm caller workload identity, request-level authentication can confirm terminal user or client token identity, and request-level authorization can combine workload identity, request identity, operation, and conditions for access control. This layered structure follows the access control model that separates identity confirmation from permission judgment.

## 6. Inputs for Industry Authorization Rules

Industry authorization rules are mainly based on the following types of information.

First, subject attributes. These include user ID, service account, client ID, workload identity, namespace, organization, department, role, user group, device identity, and similar attributes.

Second, resource attributes. These include resource type, resource ID, tenant, data classification, ownership relationship, namespace, service name, interface path, database object, and similar attributes.

Third, operation attributes. These include HTTP Method, gRPC Method, read, write, delete, approve, publish, manage, export, and similar actions.

Fourth, environment attributes. These include source IP, destination port, time, network zone, authentication strength, risk level, request Header, JWT Claim, TLS SNI, and similar attributes.

Fifth, policy actions. These include ALLOW, DENY, AUDIT, CUSTOM, or decisions made by an external authorization system.

The NIST ABAC model explicitly treats subject, object, operation, and environmental conditions as important attribute sources for authorization decisions [R4]. In OAuth 2.0, scope, audience, client, resource server, and access token form standard elements of authorization delegation [R5][R6]. JWT is often used to carry identity and authorization-related claims, but JWT itself is not an authorization model. It is only a representation and transport format for a set of claims [R6][R7].

## 7. The Role, Advantages, and Limits of JWT

JWT is a compact, URL-safe claims representation format used to pass claims between two parties. JWT Claims can be signed or integrity-protected as the payload of a JWS, or encrypted as plaintext in a JWE [R6]. In OAuth 2.0 access token scenarios, RFC 9068 defines a standard profile for issuing OAuth 2.0 Access Tokens in JWT format, allowing different authorization servers and resource servers to issue and consume access tokens in an interoperable way [R11].

The main advantages of JWT include: compact format suitable for HTTP Authorization Header; integrity and issuer verification through signatures; ability to carry claims such as `iss`, `sub`, `aud`, `exp`, `scope`, `roles`, `groups`, and `entitlements`; and when the resource server has validation keys and validation rules, it can parse and validate tokens directly without necessarily accessing the authorization server on every request [R6][R11].

JWT limitations also come from standard definitions. The basic characteristic of a Bearer Token is that any party holding the token can use it to access associated resources, so the token must be protected from leakage during storage and transmission [R7]. If JWT is used as a Bearer Token, it inherits the same risk. JWT also has engineering risks such as difficult revocation, stale claims before token expiration, excessive token size, exposure of sensitive claims, signature algorithm misuse, and missing audience validation. RFC 8725, JWT Best Current Practice, specifically supplements recommendations for secure JWT implementation and deployment [R12]. RFC 9068 further requires JWT Access Tokens to be signed, prohibits `none` as the signature algorithm, and requires compliant authorization servers and resource servers to support RS256 [R11].

Therefore, JWT is suitable as a transport carrier for identity and authorization claims, but it should not replace authorization rules themselves. Resource servers or policy enforcement points still need to validate signature, issuer, audience, expiration, token type, and authorization claims, and then make the final authorization decision according to local or centralized policies.

## 8. Istio Authorization Rule Model

Istio's security model divides authentication and authorization across multiple resource types. PeerAuthentication is responsible for peer authentication and mTLS policies. RequestAuthentication is responsible for request-level JWT authentication. AuthorizationPolicy is responsible for access control [R8][R9][R10].

AuthorizationPolicy supports CUSTOM, DENY, ALLOW, and AUDIT actions. CUSTOM delegates processing to an extension authorization system. DENY explicitly rejects requests. ALLOW allows matching requests. AUDIT marks requests for audit without changing the allow or deny result. Istio policy evaluation order is CUSTOM, DENY, and ALLOW. When no ALLOW policy applies to a workload, requests are allowed by default. When an ALLOW policy exists but a request does not match any ALLOW policy, the request is denied [R10].

Istio AuthorizationPolicy rules are composed of `from`, `to`, and `when`. `from` indicates request sources and can match fields such as peer principal, request principal, namespace, service account, IP, and trust domain. `to` indicates request operations and can match fields such as host, port, HTTP method, and path. For gRPC, path can be represented as a fully qualified method name in the form `/package.service/method`. `when` indicates additional conditions and can match Istio-supported attributes, such as request headers, source IP, remote IP, source namespace, source principal, JWT principal, JWT audience, JWT claims, destination IP, destination port, and SNI [R10][R13].

Therefore, Istio authorization rules support both service identity and request identity; both L4 connection attributes and L7 HTTP/gRPC attributes; and allow, deny, audit, and external authorization extension.

## 9. Authorization Rule Configuration Methods and Granularity

Authorization rule configuration usually falls into declarative configuration and code-based configuration. Declarative configuration is suitable for the infrastructure layer, gateway layer, and service mesh layer. For example, Istio defines PeerAuthentication, RequestAuthentication, and AuthorizationPolicy through Kubernetes CRDs. Code-based configuration is suitable for business resource permissions inside applications, such as Spring Security annotations, RPC filters, domain service checks, and data access layer rules.

In terms of granularity, rules should support at least service level, interface level, and method level. In HTTP scenarios, method level usually appears as Method plus Path, such as `GET /orders/{id}`. In gRPC scenarios, method level usually appears as `/package.service/method`. Istio AuthorizationPolicy already supports HTTP Method, Path, Host, and Port, and supports fully qualified gRPC method names, so the service mesh layer can cover generic method-level access control [R10].

Parameter-level authorization needs to distinguish "protocol-visible parameters" from "business-semantic parameters." If parameters exist in headers, JWT claims, paths, query strings, or proxy-parsable attributes, the infrastructure layer can participate in decisions. For example, Istio supports conditional matching based on request headers and JWT claims [R13]. If a parameter requires parsing request bodies, accessing databases, determining resource owners, checking order state, project membership, or field-level permissions, the decision belongs to business-semantic authorization and usually needs to be completed by application services or external authorization systems. Istio's CUSTOM action can delegate matching requests to an external authorization system, but that external authorization system still needs the ability to understand business context [R10].

Therefore, the standardized configuration boundary should be: platform-layer rules cover connection identity, request identity, service, interface, method, path, header, claim, IP, port, and namespace; application-layer rules cover resource instances, resource ownership, business state, field-level permissions, and row-level data permissions. Putting all parameter-level rules into the service mesh or gateway is limited by protocol parsing capability and missing business semantics. Writing all rules in application code reduces unified governance, auditing, and cross-service reuse.

## 10. Conclusion

Authorization rules are the connecting layer between authentication results, authorization policies, and access control enforcement. Authentication confirms identity. Authorization determines permissions. Authorization rules express executable access control conditions. According to NIST zero-trust architecture, access control should be completed through policy decision points and policy enforcement points, and least privilege should be enforced at the finest practical granularity. According to NIST ABAC, authorization rules can make decisions based on subjects, objects, operations, and environmental conditions. According to OAuth 2.0 and JWT standards, access tokens and JWTs can carry authorization and identity claims, but they cannot replace server-side authorization rules. According to Istio's official model, chain-level mTLS, request-level JWT authentication, and request-level AuthorizationPolicy can be combined into a layered authorization system.

In engineering design, authorization rules should primarily use declarative configuration, supplemented by code-based business validation. Gateways and service meshes should handle generic authentication and generic authorization, while application services should handle resource-instance and business-semantic authorization. Rule granularity should at least cover service level, interface level, and method level. Parameter-level rules should be moved down to the platform layer only when the parameters are visible to the enforcement point and their semantics are clear. Otherwise, they should remain in the application layer or an external authorization system.
