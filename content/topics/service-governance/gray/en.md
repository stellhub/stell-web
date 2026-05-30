# Full-Link Canary Design and Implementation: Traffic Identity, Routing Isolation, and Governance for Hundred-Service Call Chains

## Abstract

Full-link canary means that during a user request, task execution, or message flow, the gray identity is continuously propagated from the entry layer to all subsequent services, message queues, configuration centers, governance rules, data access layers, and observability systems, so that traffic in the same call chain always reaches instances, configurations, and governance policies that match its gray identity. This mechanism differs from single-service canary release. A single-service canary only controls the traffic ratio of one application version. Full-link canary must solve context consistency across applications, protocols, middleware, synchronous calls, and asynchronous calls.

When a microservice call chain contains more than one hundred applications, the core of canary design is no longer a single routing rule, but unified gray context, unified propagation specifications, a unified control plane, unified rule delivery, unified observability, and unified rollback. This article proposes a full-link canary design model for large enterprise microservice systems from the perspectives of industry standards, service mesh, API gateways, message queues, databases, configuration centers, service governance, rate limiting, circuit breaking, authorization policies, and anti-confusion mechanisms.

**Keywords**: full-link canary; Canary Release; Service Mesh; Traffic Routing; Baggage; Trace Context; Gateway API; Istio; Argo Rollouts; message queue; configuration center

---

## 1. Introduction

Canary release is usually used to reduce production change risk. In the Kubernetes ecosystem, the official Argo Rollouts documentation describes Canary Deployment as a deployment strategy that releases a new version to a small portion of production traffic. It also states that there is no universally accepted standard for Canary Deployment, so the Rollouts Controller allows users to define their own canary process through steps, including setting traffic weights and pause steps. This shows that the industry has common canary release practices, but there is no single standard implementation covering every system layer.

In a microservice system, a user request usually passes through an entry gateway, authentication service, business orchestration service, many downstream microservices, cache, database, message queue, asynchronous consumers, task scheduling, and external dependencies. If only the entry layer performs canary traffic splitting while downstream calls do not continue carrying the gray identity, gray traffic may return to baseline instances later in the chain. If message queues do not carry the gray marker, asynchronous consumption may deliver gray events to baseline consumers. If configuration centers and service governance rules do not distinguish gray context, gray instances may read baseline configuration or use baseline rate-limit rules. The goal of full-link canary is to avoid this kind of cross-layer confusion.

---

## 2. Related Standards and Industry Implementations

### 2.1 Standard Headers and Context Propagation

In HTTP scenarios, W3C Trace Context defines standard HTTP headers and value formats for distributed tracing, used to propagate context information that can uniquely identify a request between services. The core purpose of Trace Context is trace-context propagation, not a direct standard for business canary routing.

W3C Baggage defines a standard format for representing and propagating application-defined properties in distributed requests or workflows. The `baggage` header represents a set of user-defined properties associated with a distributed request, and libraries and platforms are encouraged to propagate this header. Therefore, gray identity can enter propagated context as an application-defined property. Whether it is allowed to participate in routing decisions must be uniformly defined by an enterprise gateway, service framework, service mesh, or governance platform.

Therefore, full-link canary can contain three types of headers:

```text
traceparent: W3C Trace Context, used for tracing context
tracestate: W3C Trace Context, used for vendor-specific tracing state
baggage: W3C Baggage, used to propagate application-defined context
```

Enterprises can also define dedicated gray headers, such as:

```text
x-gray-tag: gray-a
x-gray-env: pre
x-gray-route: lane-a
x-gray-rule-id: rule-1001
```

Here, `traceparent` should not be abused as a gray routing field. `baggage` can carry gray attributes propagated across services. Dedicated `x-gray-*` headers can be used by gateways, sidecars, SDKs, and business frameworks for routing, authorization, configuration selection, and auditing.

### 2.2 Service Mesh and Traffic Routing

In Istio official documentation, VirtualService defines traffic routing rules applied when accessing a host. Each rule contains matching conditions. If traffic matches a rule, it is forwarded to a destination service or subset/version in the service registry. DestinationRule defines policies applied to traffic for the target service after routing, including load balancing, connection pool size, and outlier detection. Subsets can select service endpoints through labels.

This shows that service mesh already provides the two most important capabilities for full-link canary:

1. Routing matching based on request attributes such as headers, URI, and source.
2. Defining stable/canary/gray subsets based on service instance labels.

A typical model is:

```text
Request Header: x-gray-route=lane-a
        |
        v
Istio VirtualService
        |
        |-- match x-gray-route=lane-a -> reviews subset gray
        `-- default -> reviews subset stable
        |
        v
Istio DestinationRule
        |-- subset stable -> labels: version=stable
        `-- subset gray   -> labels: version=gray
```

### 2.3 Kubernetes Gateway API and Weighted Traffic Splitting

Kubernetes Gateway API HTTPRoute supports specifying multiple backends through `backendRefs` and defining traffic splitting between backends through weights. Official documentation states that HTTPRoute can use weights to shift traffic between backends, which is suitable for rollout, canary, and emergency scenarios.

This capability is suitable for entry-layer percentage canary, for example:

```yaml
rules:
  - backendRefs:
      - name: order-service-stable
        port: 8080
        weight: 95
      - name: order-service-gray
        port: 8080
        weight: 5
```

However, weighted traffic splitting only describes the percentage allocation of entry requests. It cannot automatically guarantee that more than one hundred downstream services, message queues, and configuration centers also keep the same gray identity. Therefore, entry weighted splitting must be combined with a gray context propagation mechanism.

### 2.4 Argo Rollouts and Progressive Delivery

Argo Rollouts is a set of Kubernetes controllers and CRDs. Official documentation describes it as providing blue-green, canary, canary analysis, experimentation, and progressive delivery capabilities. Its Canary strategy supports steps such as `setWeight` and `pause`. Official documentation also states that when traffic routing is enabled, Argo Rollouts can manage additional routes, including header-based routes and traffic mirror routes, and requires route priority order to be defined through `managedRoutes`.

This shows that Argo Rollouts is suitable for managing the release process, but it does not naturally solve full-link context consistency. It can work with Istio, Gateway API, or other traffic routing implementations to orchestrate canary releases at the entry and service layers.

### 2.5 Feature Flags and Evaluation Context

In the OpenFeature specification, Evaluation Context is contextual information used for feature flag evaluation. Rule evaluation, targeting, and fractional evaluation can all use context data. Evaluation Context can contain end users, applications, hosts, or other data useful for flag evaluation, and custom fields must be supported.

This means that at the business feature layer, gray identity can also participate in feature switches, parameter switches, experiment switches, and policy switch calculations as part of the feature flag evaluation context. But Feature Flag only solves business feature switching. It is not equivalent to network routing, message isolation, database isolation, or configuration-center gray selection.

---

## 3. Basic Definition of Full-Link Canary

This article defines full-link canary as:

```text
During the complete execution of one request or task,
entry, service calls, asynchronous messages, configuration reads, governance rules,
authorization rules, data access, and observability logs
all make consistent decisions based on the same gray context.
```

This definition includes four factual boundaries:

First, full-link canary is not single-application canary. Single-application canary only controls the traffic ratio between old and new versions of one service. Full-link canary controls the entire call chain.

Second, full-link canary is not simple header forwarding. Headers are only propagation carriers. The actual behavior depends on whether each infrastructure component performs routing, isolation, and rule selection based on gray context.

Third, full-link canary is not a test environment. Gray traffic usually occurs in production or production-equivalent environments, and must support rollback, auditing, access control, and observability.

Fourth, full-link canary must not access baseline resources by default. If a gray chain must access baseline resources, the boundary of shareable resources must be explicitly declared.

---

## 4. Overall Full-Link Canary Architecture

### 4.1 Control Plane and Data Plane

Full-link canary should be divided into control plane and data plane.

The control plane is responsible for:

```text
Gray lane definition
Gray rule configuration
Gray instance binding
Gray header specification
Service routing rule generation
Configuration-center gray rule generation
Rate-limit / circuit-breaker / authorization rule generation
Message queue isolation policy generation
Database isolation policy generation
Observability dimensions and alert rule generation
Release, rollback, full rollout
```

The data plane is responsible for:

```text
Identifying gray traffic at the entry
Propagating gray context between services
Selecting target instances based on gray context
Reading gray configuration based on gray context
Selecting rate-limit, circuit-breaker, and authorization policies based on gray context
Writing gray attributes when producing messages
Isolating gray and baseline traffic when consuming messages
Selecting gray databases, gray tables, gray tenants, or gray fields during data access
Recording gray attributes in traces, metrics, and logs
```

### 4.2 Gray Context Model

Full-link canary must have a unified context model. A recommended model is:

```json
{
  "grayEnabled": true,
  "grayLane": "lane-a",
  "grayTag": "gray-a",
  "grayRuleId": "rule-1001",
  "graySource": "gateway",
  "grayPriority": 100,
  "grayExpireAt": "2026-06-30T00:00:00Z",
  "traceId": "..."
}
```

Corresponding HTTP headers:

```text
x-gray-enabled: true
x-gray-lane: lane-a
x-gray-tag: gray-a
x-gray-rule-id: rule-1001
baggage: gray-lane=lane-a,gray-tag=gray-a,gray-rule-id=rule-1001
```

Field meanings:

| Field | Purpose |
| --- | --- |
| `grayEnabled` | Whether the request enters the gray chain |
| `grayLane` | Gray lane, such as lane-a or lane-b |
| `grayTag` | Gray tag, such as gray-a |
| `grayRuleId` | Entry gray rule that matched |
| `graySource` | Source of gray identity, such as gateway, manual, job, or mq |
| `grayPriority` | Priority when multiple rules match |
| `grayExpireAt` | Expiration time of gray identity |
| `traceId` | Trace identifier, not used as gray routing basis |

### 4.3 Gray Lane Model

For scenarios involving hundreds of applications, expressing gray release only through a version number is not enough. A more controllable model is the lane:

```text
baseline lane: production baseline lane
gray lane-a: gray lane A
gray lane-b: gray lane B
```

Each service instance joins a lane through labels:

```yaml
metadata:
  labels:
    app: order-service
    lane: gray-a
    version: v2
```

Kubernetes official documentation defines Labels as key/value pairs attached to objects such as Pods, used to express identifying attributes meaningful to users and to organize and select subsets of objects. Therefore, whether a service instance belongs to a gray lane can be expressed through labels.

---

## 5. Full-Link Canary Traffic Path Design

### 5.1 Entry Layer

The entry layer can include API Gateway, Ingress Gateway, Edge Proxy, BFF, or a unified access layer. Its responsibility is to identify gray traffic and write unified gray context.

Entry gray matching conditions include:

```text
User ID
Tenant ID
Cookie
HTTP Header
Client IP
Device ID
Region
App version
Test account
Percentage bucket
```

The entry layer must perform the following actions:

```text
1. Determine whether the request enters gray based on entry gray rules.
2. Write unified gray headers.
3. Write gray fields into W3C Baggage.
4. Write logs, metrics, and trace attributes.
5. Pass gray context to downstream services.
```

The entry layer must not perform only one-time routing. If it only sends the request to a gray entry service without injecting gray context, downstream services cannot determine whether the request belongs to a gray chain.

### 5.2 Service Call Layer

The service call layer includes HTTP, gRPC, Dubbo, Thrift, message RPC, or custom protocols. Every protocol must be able to propagate gray context.

HTTP example:

```text
GET /api/order/1001
x-gray-lane: lane-a
baggage: gray-lane=lane-a,gray-rule-id=rule-1001
```

gRPC example:

```text
metadata:
  x-gray-lane: lane-a
  baggage: gray-lane=lane-a
```

When initiating downstream calls, service frameworks or sidecars must copy gray context. If an intermediate service recreates requests without copying headers, the gray chain breaks at that node.

### 5.3 Service Routing Layer

Each downstream service should have a stable subset and a gray subset:

```text
order-service
  |-- stable subset: lane=baseline
  `-- gray subset: lane=gray-a

payment-service
  |-- stable subset: lane=baseline
  `-- gray subset: lane=gray-a

stock-service
  |-- stable subset: lane=baseline
  `-- gray subset: lane=gray-a
```

When a request carries `x-gray-lane=gray-a`, the routing rule first tries to find the target service's `gray-a` subset. If the target service has no `gray-a` instance, there must be an explicit fallback policy:

```text
STRICT: fail if no gray instance exists; do not fall back to baseline
FALLBACK: fall back to baseline if no gray instance exists
BASELINE_ONLY: this service does not participate in gray and always accesses baseline
```

In production chains, the safer strategy is explicit per-service configuration. Do not fall back to baseline by default, otherwise gray traffic and baseline traffic will silently mix.

### 5.4 Configuration Center Layer

The configuration center should return different configurations based on gray context. The configuration dimension can remain:

```text
tenant + group + data_id
```

Then add gray rules on top:

```text
tenant + group + data_id + gray_lane
```

When clients request configuration, they carry gray context:

```text
dataId=order-service.properties
group=DEFAULT_GROUP
tenant=prod
x-gray-lane=gray-a
```

Configuration center return logic:

```text
if gray config exists for gray-a:
    return gray config
else:
    return base config or reject according to fallback policy
```

Apollo official user guides already include gray configuration, gray rules, gray release, full release, and abandoning gray flow, and support identifying gray instances through IP and Label. Nacos official OpenAPI and SDK provide configuration listening, fetching, publishing, history, MD5, and other configuration management capabilities. For full-link canary, the configuration center needs to extend these capabilities to the gray context dimension.

### 5.5 Service Governance Rule Layer

Service governance rules include:

```text
Routing rules
Circuit-breaker rules
Rate-limit rules
Retry rules
Timeout rules
Load-balancing rules
Authorization rules
Degradation rules
```

Istio DestinationRule official documentation states that it defines policies applied to traffic for a target service after routing, including load balancing, connection pool size, and outlier detection. Istio AuthorizationPolicy official documentation states that it supports access control actions such as CUSTOM, DENY, and ALLOW, and that workload selectors can limit the scope of policies. Envoy and Istio also provide local rate-limit configuration capabilities.

Therefore, in full-link canary, governance rules must include a gray dimension:

```text
rule_scope = service + api + gray_lane
```

Example:

```json
{
  "service": "payment-service",
  "path": "/pay",
  "grayLane": "gray-a",
  "timeoutMs": 3000,
  "retry": 0,
  "rateLimit": {
    "qps": 100
  },
  "circuitBreaker": {
    "consecutive5xx": 5
  }
}
```

Governance rules cannot take effect only by service name or API name. If gray services and baseline services share the same rate-limit bucket, circuit-breaker window, or authorization policy, gray abnormalities may contaminate the governance state of the baseline chain.

### 5.6 Message Queue Layer

Message queues are where full-link canary most easily breaks. In synchronous calls, headers are usually propagated by RPC frameworks. In asynchronous messages, gray context must be explicitly written into message attributes.

In the official Kafka API, Headers are key/value collections on messages, supporting adding headers, fetching headers by key, and removing headers. RocketMQ official documentation states that in message filtering, producers can attach properties and tags before message initialization, consumers register subscription topics and filter conditions with the broker, and the broker dynamically filters messages according to the filtering expression submitted by consumers. RocketMQ supports tag-based filtering and property-based SQL filtering.

Therefore, message canary has three implementation modes:

First, header/property propagation:

```text
topic: order_event
headers:
  x-gray-lane=gray-a
  x-gray-rule-id=rule-1001
```

Second, topic isolation:

```text
order_event_baseline
order_event_gray_a
```

Third, tag/property filtering:

```text
topic: order_event
tag: gray-a
property: gray_lane=gray-a
```

When gray messages have side effects, such as payment, inventory, shipment, or accounting, Topic/ConsumerGroup-level isolation should be preferred. Relying only on application-level header checks in consumers means gray messages have already entered the baseline consumer queue, creating a risk of accidental consumption.

### 5.7 Database Layer

The database layer has no unified "gray header" standard. Data isolation must be implemented together by applications, data access layers, database accounts, schemas, table structures, or tenant fields.

Common patterns include:

```text
Independent gray database: gray_order_db
Independent gray schema: gray.order_table
Independent gray table: order_table_gray
Tenant field isolation: tenant_id / gray_lane
Shadow table: order_table_shadow
Read-only baseline database + gray writes to gray database
```

Database isolation strategy depends on data side effects:

| Data type | Isolation strategy |
| --- | --- |
| Stateless query data | Can read baseline with read-only access |
| Replayable test data | Can enter gray database or shadow table |
| Real transaction data | Should not enter test gray chains unless explicit production gray authorization exists |
| Accounting, inventory, payment | Requires strong isolation or explicit allowlist |
| Cache data | Cache key must include gray dimension |

Database access rules in full-link canary must be explicit:

```text
Whether gray-a requests can read baseline data
Whether gray-a requests can write baseline data
Whether data written by gray-a requests can be read by baseline requests
How gray-a data is cleaned up
Whether gray-a data enters reporting, search, risk-control, and audit chains
```

If there are no explicit rules, gray write traffic should not enter the baseline data domain by default.

### 5.8 Cache Layer

Cache isolation should add the gray dimension to cache keys:

```text
baseline: order:1001
gray-a:   gray-a:order:1001
```

If the gray chain and baseline chain share cache keys, gray services may write new structures, new fields, or test values into baseline cache, causing baseline reads to fail.

Cache isolation principles:

```text
Read cache: decide whether baseline reads are allowed according to policy
Write cache: write to gray namespace by default
Delete cache: must be limited to gray namespace
Warmup cache: must distinguish gray and baseline
```

### 5.9 Observability Layer

Traces, metrics, and logs must include gray dimensions:

```text
gray.lane=gray-a
gray.rule_id=rule-1001
gray.source=gateway
gray.fallback=false
```

Observability systems need to support:

```text
Query call chains by gray lane
Calculate error rate by gray lane
Calculate latency by gray lane
Calculate rate-limit / circuit-breaker count by gray lane
Calculate message backlog by gray lane
Calculate database write volume by gray lane
```

If observability data has no gray dimension, it is impossible to determine whether an error comes from the gray chain or baseline chain, and reliable rollback cannot be performed.

---

## 6. Control Points for Preventing Gray and Baseline Traffic Confusion

### 6.1 Entry Control Points

The entry layer must ensure:

```text
Unauthorized clients cannot forge gray headers
Externally incoming x-gray-* headers must be cleaned or re-signed
Gray identity must be generated by a trusted entry
After generating gray identity, the entry records audit logs
```

If external clients are allowed to pass `x-gray-lane` arbitrarily, ordinary users may enter test chains, or test traffic may affect production resources.

### 6.2 Header Propagation Control Points

All service frameworks must uniformly intercept inbound and outbound requests:

```text
Inbound: parse gray context
Business: put gray context into ThreadLocal / Context
Outbound: automatically inject gray headers / gRPC metadata
Async: copy context into thread pool tasks
MQ Producer: write message headers
MQ Consumer: restore gray context
```

In Java systems, thread pools, CompletableFuture, Reactor, message listeners, and scheduled tasks need special handling. If gray context is stored only in ordinary ThreadLocal, it will be lost after asynchronous thread switching.

### 6.3 Routing Control Points

Service calls must have explicit routing policies:

```text
gray-a instance exists -> route to gray-a
no gray-a instance and service allows fallback -> route to baseline
no gray-a instance and service is strict -> return error
service declares baseline-only -> always route baseline
```

Routing policies must be configured in the control plane and must not be hard-coded by individual services. Otherwise, hundreds of applications will form inconsistent behavior.

### 6.4 Message Control Points

When producing messages, gray attributes must be written:

```text
headers["x-gray-lane"] = "gray-a"
headers["x-gray-rule-id"] = "rule-1001"
```

When consuming messages, isolation must be enforced:

```text
baseline consumer does not consume gray messages
gray consumer does not consume baseline messages
when sharing a topic, broker-side filtering or consumer-side strict validation is required
messages with side effects should prefer independent topics
```

If topics must be shared, consumers must explicitly declare filtering expressions at startup, and consumption logic must perform secondary header validation. RocketMQ Tag/SQL filtering and Kafka message headers provide different degrees of attribute expression. However, Kafka brokers do not natively filter delivery by header, so Kafka scenarios more commonly use independent topics, independent consumer groups, or strict consumer-side validation.

### 6.5 Data Control Points

The data access layer must prevent gray writes from entering the baseline data domain:

```text
gray write request -> gray datasource
baseline write request -> baseline datasource
gray read request -> gray datasource or baseline-readonly path if allowed
```

Data control points should be implemented by a unified DataSource Router, ORM plugin, SQL interceptor, or DAO framework. Business developers should not be required to manually determine gray state in every SQL statement.

### 6.6 Configuration Control Points

Configuration clients must carry gray context when requesting configuration. The configuration center must return the corresponding version according to gray context:

```text
gray-a instance -> gray-a config
baseline instance -> baseline config
```

When gray configuration is deleted, ended, or fully rolled out, the configuration center must generate a version change that clients can perceive. Otherwise, clients may continue using stale gray configuration because local cache did not change.

### 6.7 Governance Rule Control Points

Rate limiting, circuit breaking, and authorization cannot be bucketed only by API dimension. At minimum, they should support:

```text
service + api + gray_lane
```

Otherwise, the following problems may occur:

```text
gray traffic triggers circuit breaking -> baseline traffic is also circuit-broken
gray traffic exhausts rate-limit quota -> baseline traffic is mistakenly limited
gray authorization rule is loosened -> baseline chain accidentally uses loose rules
baseline authorization rule is tightened -> gray verification fails without clear cause
```

---

## 7. Best-Practice Architecture for Hundred-Service Call Chains

### 7.1 Unified Gray Control Plane

When a test chain covers hundreds of applications, each application must not maintain gray rules separately. A unified gray control plane should be established:

```text
Gray Control Plane
  |-- Gray lane management
  |-- Application participation management
  |-- Entry rule management
  |-- Service routing rule management
  |-- Configuration-center gray rule management
  |-- MQ isolation policy management
  |-- DB isolation policy management
  |-- Rate-limit / circuit-breaker / authorization rule management
  |-- Release orchestration
  |-- Rollback orchestration
  `-- Observability and audit
```

Data-plane configuration generated by the control plane includes:

```text
Gateway Route
Istio VirtualService
Istio DestinationRule
AuthorizationPolicy
EnvoyFilter / RateLimit Policy
Config Center Gray Rule
MQ Topic / Tag / Header Policy
DataSource Route Policy
Feature Flag Context Rule
Observability Attribute Rule
```

### 7.2 Unified Gray Registration Model

Each application needs to declare its gray support status:

```yaml
app: payment-service
gray:
  supported: true
  mode: strict
  lanes:
    - gray-a
  fallback:
    enabled: false
  resources:
    mq:
      producer: isolated
      consumer: isolated
    db:
      write: gray-datasource
      read: baseline-readonly
    cache:
      namespace: gray-a
```

Applications not integrated into the gray system must be explicitly marked:

```yaml
gray:
  supported: false
  mode: baseline-only
```

This prevents the control plane from mistakenly assuming that every service has gray instances.

### 7.3 Unified Routing Matrix

Hundred-service call chains need a routing matrix:

| Caller | Callee | Gray lane | Callee has gray instance | Strategy |
| --- | --- | --- | ---: | --- |
| gateway | order-service | gray-a | yes | route-gray |
| order-service | payment-service | gray-a | yes | route-gray |
| order-service | stock-service | gray-a | no | strict-fail |
| order-service | user-service | gray-a | no | fallback-baseline |
| payment-service | risk-service | gray-a | yes | route-gray |

This matrix must be generated by the control plane and delivered to gateways, sidecars, SDKs, or service governance platforms. It cannot rely on each application making its own judgment.

### 7.4 Unified Release Process

The full-link canary release process is:

```text
1. Create a gray lane
2. Select entry rules
3. Select participating applications
4. Deploy gray instances
5. Generate service routing rules
6. Generate configuration-center gray configuration
7. Generate MQ isolation rules
8. Generate DB/cache isolation rules
9. Generate rate-limit, circuit-breaker, and authorization rules
10. Enable observability labels and alerts
11. Release small traffic
12. Verify metrics
13. Increase percentage or expand user set
14. Fully roll out or one-click rollback
15. Clean up gray rules and isolated resources
```

---

## 8. Rule Priority Design

Full-link canary must define deterministic priority. The recommended order is:

```text
Test account / specified user > specified machine/IP > specified tag > specified tenant > percentage canary > baseline traffic
```

If multiple gray lanes are matched at the same time, the system must return one unique lane by priority:

```text
if user in gray-a whitelist:
    lane = gray-a
else if header signed lane exists:
    lane = header lane
else if tenant in gray-b:
    lane = gray-b
else if percentage hit:
    lane = gray-c
else:
    lane = baseline
```

Clients, gateways, service frameworks, and configuration centers must not calculate different priorities independently. The entry layer should produce the final gray identity. Downstream components should only verify and propagate it, not randomly recalculate it.

---

## 9. Header Design Recommendations

### 9.1 Header Naming

Internal gray headers should use a unified prefix:

```text
x-gray-enabled
x-gray-lane
x-gray-tag
x-gray-rule-id
x-gray-signature
x-gray-expire-at
```

Also write into Baggage:

```text
baggage: gray-lane=gray-a,gray-rule-id=rule-1001
```

### 9.2 Header Signature

To prevent external forgery, the entry should generate a signature:

```text
x-gray-lane: gray-a
x-gray-rule-id: rule-1001
x-gray-expire-at: 2026-06-30T00:00:00Z
x-gray-signature: HMAC(...)
```

Internal services or sidecars verify the signature before executing gray routing. Unsigned gray headers carried by external requests should be cleaned.

### 9.3 Header Propagation Allowlist

Only the following fields should be propagated:

```text
traceparent
tracestate
baggage
x-gray-enabled
x-gray-lane
x-gray-tag
x-gray-rule-id
x-gray-expire-at
x-gray-signature
```

Do not transparently propagate arbitrary `x-*` headers into internal chains, to avoid introducing externally uncontrolled fields into authorization, routing, or configuration logic.

---

## 10. Data Consistency and Side-Effect Control

In full-link canary, side effects are the core risk. Side effects include:

```text
Database writes
Cache writes
Message publishing
External payments
Inventory deduction
SMS sending
Email sending
Search index writes
Report writes
Audit log writes
```

Different side effects should use different isolation levels:

| Side-effect type | Recommended strategy |
| --- | --- |
| Read-only query | Can share baseline data |
| Cache write | Gray namespace isolation |
| Ordinary business write | Gray database, gray table, or tenant field isolation |
| MQ event | Independent Topic or Header/Tag isolation |
| Payment/accounting/inventory | Test gray traffic is forbidden from writing production resources by default |
| External notification | Mock or shadow channel by default |
| Search/reporting | Gray index or gray tag isolation |

Full-link canary cannot focus only on service versions. As soon as shared resources are written, there is a risk of contaminating baseline traffic.

---

## 11. Rollback and Cleanup

Full-link canary rollback is not simply rolling a Deployment back to an old version. It must also revoke:

```text
Entry gray rules
Service routing rules
Gray instance traffic
Configuration-center gray configuration
MQ gray consumption rules
DB/cache gray routing
Rate-limit / circuit-breaker / authorization gray rules
Feature Flag gray rules
Temporary observability alert rules
```

Recommended rollback order:

```text
1. Disable new entry traffic
2. Stop gray routing from spreading further
3. Wait for or handle in-flight gray requests
4. Pause gray consumers or switch consumption strategy
5. Restore configuration-center baseline configuration
6. Restore governance rules
7. Preserve gray data for troubleshooting
8. Complete audit records
```

Rollback must preserve traces, logs, metrics, and operation audit. Otherwise, the cause of gray failure cannot be determined.

---

## 12. Conclusion

The core of full-link canary is not a single traffic percentage, but consistent context propagation across entry, services, configuration, governance, messaging, data, and observability. The industry already has several standards and implementations that support different parts of full-link canary: W3C Trace Context provides a standard for trace-context propagation, W3C Baggage provides an application-defined attribute propagation format, Istio provides service mesh routing through VirtualService and DestinationRule, Gateway API provides HTTPRoute weighted traffic splitting, Argo Rollouts provides progressive delivery orchestration, OpenFeature provides feature evaluation based on Evaluation Context, and Kafka and RocketMQ provide message attributes, headers, tags, or filtering mechanisms.

However, these standards and frameworks each cover only part of tracing, context propagation, service routing, release orchestration, feature flags, and message filtering. They do not constitute a single full-link canary standard. Enterprise systems with hundreds of applications need to build a unified gray control plane on top of these capabilities, defining unified gray context, unified header specifications, unified routing matrices, unified MQ/DB/cache isolation strategies, unified governance rule dimensions, and a unified observability model. Only when every synchronous call, asynchronous message, configuration read, governance decision, and data access point makes decisions based on the same gray context can gray traffic and baseline traffic be prevented from mixing.
