---
title: Site Reliability Engineering for Middleware Platforms
category: Service Reliability
summary: A systematic study of how middleware and microservice teams should define SLI, SLO, and SLA, and how observability and service governance should form a closed reliability loop.
tags:
  - SRE
  - SLI
  - SLO
  - SLA
  - Service Governance
  - Observability
readingDirection: Read this when designing reliability contracts, error-budget policies, or observability-driven governance for middleware and microservice platforms.
outline: deep
---

# Site Reliability Engineering for Middleware Platforms

## Overview

A systematic study of how middleware and microservice teams should define SLI, SLO, and SLA, and how observability and service governance should form a closed reliability loop.

## Abstract

Site Reliability Engineering, or SRE, is an engineering discipline for managing reliability. Its core idea is not "add more dashboards" or "put more people on call," but to turn reliability into something measurable, negotiable, governable, and reviewable through **SLI, SLO, and SLA**. In Google's SRE model, an SLI is a quantitative measure of some aspect of service level, an SLO is the target value or target range built on top of an SLI, and an SLA is a formal commitment made to service consumers, often with consequences when the commitment is missed. Google SRE documentation explicitly describes SLI as a quantitatively defined measure of some aspect of service level, and SLO as a target value or range of values for that measure. Google Cloud also emphasizes that an SLA is usually a commitment made to users and may trigger compensation, service credits, or other penalties when not achieved. ([Google SRE][1])

This article argues that **the hard part of middleware SRE is not copying availability metrics from application services. It is that middleware is usually a shared dependency and a combined system of control plane and data plane**. Therefore, middleware reliability indicators must cover request success on the data plane, configuration propagation latency on the control plane, rule consistency, persistence durability, client-perceived availability, fault isolation, and recovery capability at the same time. For microservices, SLI, SLO, and SLA should be designed around user journeys, interface contracts, call paths, and business correctness. Observability is not just a downstream support system for governance. It is the factual source of governance. Service governance is not merely an executor downstream from observability either. It feeds topology, labels, change events, and governance context back into the observability system. The two should form a closed loop of "observe, judge, govern, validate, and review."

**Keywords:** SRE, SLI, SLO, SLA, middleware, microservices, service governance, observability, error budget, site reliability engineering

---

## 1. Introduction

In traditional operations models, reliability is often described with vague phrases such as "stable," "mostly fine," "fewer incidents recently," or "machine load looks acceptable." The biggest problem with such language is simple: **it does not support engineering decisions**. When development teams want to ship faster, operations teams want to reduce risk, and business teams want fewer incidents, the absence of a shared reliability language leaves people with only debate, intuition, and blame after the fact.

SRE tries to solve that problem. The Google SRE model proposes the "four golden signals" of latency, traffic, errors, and saturation as the most fundamental dimensions for monitoring user-facing systems. Google SRE explicitly recommends that if you can monitor only four kinds of metrics, focus on latency, traffic, errors, and saturation first. ([Google SRE][2]) But in modern enterprise architecture, especially in middleware and microservice ecosystems, those four dimensions alone are not enough. The reasons are straightforward:

First, middleware is not a single business endpoint. It is shared infrastructure depended on by many systems. Registry centers, configuration centers, rate-limiting systems, gateways, message queues, caches, database proxies, and tracing platforms all have amplified blast radius when they fail.

Second, a microservice is not an isolated process. It is a dynamic system composed of service calls, asynchronous messaging, cache access, database access, configuration changes, and traffic-control rules such as rate limiting and circuit breaking. A service process being alive does not mean users are having a healthy experience.

Third, if observability is only able to "see the problem" but cannot drive rate limiting, circuit breaking, degradation, routing, scaling, or rollback, it degenerates into an evidence system for after the incident instead of a control system for before and during the incident.

Therefore, this article argues that **the core of middleware site reliability engineering is to use SLI, SLO, and SLA as reliability contracts, observability as the factual foundation, and service governance as the execution mechanism, in order to build a continuous closed-loop reliability system**.

---

## 2. What SLI, SLO, and SLA Mean and Why We Need Them

### 2.1 SLI: Service Level Indicator

SLI stands for Service Level Indicator. It answers one question: **how is the system actually performing right now?**

An SLI must be quantitative, not vague. For example:

| Reliability Dimension | Poor Expression | Proper SLI Expression |
| --- | --- | --- |
| Availability | The service is pretty stable | Successful requests over the last 30 days / total valid requests |
| Latency | The API feels slow | p95 latency, p99 latency |
| Correctness | The data is mostly fine | Correct results / total requests |
| Freshness | Config sync is fast | p99 latency from config release to client effective time |
| Durability | Messages are not lost | Successfully persisted messages / acknowledged messages |

A qualified SLI should satisfy four conditions:

1. **Measurable**: it must be computable from metrics, logs, traces, probes, or business validation.
2. **User-relevant**: it should reflect caller, business, or end-user experience rather than only machine health.
3. **Boundary-defined**: numerator, denominator, time window, and filters must be explicit.
4. **Attributable**: when the metric degrades, it should be possible to break the issue down by service, API, caller, region, version, dependency, or governance rule.

My judgment is that **many teams fail at monitoring not because they have too few metrics, but because they defined the wrong SLI**. If a team watches only CPU, memory, process liveness, and open port state, but does not watch user request success, config propagation latency, message backlog latency, or rule-hit correctness, the monitoring system has very limited value for reliability governance.

### 2.2 SLO: Service Level Objective

SLO stands for Service Level Objective. It answers another question: **what level of reliability should the system achieve?**

An SLO usually contains three parts:

```text
SLO = SLI + target threshold + time window
```

For example:

```text
Within the last 30 days, 99.9% of valid order-creation requests should return successfully within 300 ms.
```

Here:

| Part | Example |
| --- | --- |
| SLI | Success rate and latency of valid order-creation requests |
| Target threshold | success rate >= 99.9%, p95 latency <= 300 ms |
| Time window | last 30 days |

The major value of SLO is that it introduces the **error budget**. If the SLO is 99.9%, then the allowed unavailable portion is 0.1%. That 0.1% is the error budget. The Google SRE Workbook points out that once you have an SLO, you can derive an error budget and define policies for how teams should act when that budget is exhausted. ([Google SRE][3])

At its core, the error budget is an engineering management tool:

```text
Error budget = 1 - SLO
```

For example:

| SLO | 30-Day Error Budget |
| --- | --- |
| 99% | about 7.2 hours of unavailability |
| 99.9% | about 43.2 minutes of unavailability |
| 99.99% | about 4.32 minutes of unavailability |

The purpose of SLO is not to pursue "never fail." It is to define how much failure the system can tolerate. If error budget is still abundant, teams can ship faster and experiment more aggressively. If the budget is burning quickly, teams should reduce change frequency and prioritize reliability work.

### 2.3 SLA: Service Level Agreement

SLA stands for Service Level Agreement. It answers a different question: **what is the provider committing to the consumer, and what happens if the commitment is not met?**

The distinction between SLA and SLO is critical:

| Dimension | SLO | SLA |
| --- | --- | --- |
| Nature | Internal reliability target | Formal external or cross-team commitment |
| Purpose | Guide engineering governance | Clarify accountability and breach consequences |
| Penalty | Usually no direct penalty | Usually compensation, downgrade, credits, or assessment |
| Setting principle | Should be stricter than SLA | Should not exceed real system capability |
| Audience | Engineering, SRE, platform teams | Customers, business teams, upstream and downstream consumers |

One especially important principle is: **SLO should be stricter than SLA**.

For example, if the external SLA promise is 99.9%, the internal SLO may be 99.95%. That leaves a safety buffer. If the internal SLO and external SLA are identical, then any slight SLO miss can immediately become an SLA breach, which is operationally dangerous.

### 2.4 Why Design SLI, SLO, and SLA

The reason to design SLI, SLO, and SLA is not to generate reports. It is to establish order in reliability governance.

First, **turn reliability from intuition into quantified judgment**.  
Without SLI, no one can say whether a service is actually good or bad. A live process is not the same as a reliable service, and a high request success rate is not the same as business correctness. Reliability must be defined precisely.

Second, **turn team disputes into target negotiation**.  
Developers want to release, business wants stability, and platform teams want lower operational risk. Without SLO, there is no common decision standard. With SLO, the discussion becomes: "Does the current error budget allow continued release?"

Third, **turn alerts from noise into decision signals**.  
The Google SRE Workbook emphasizes that alerts based on SLI and error budget should notify teams only about events that truly matter, especially those that are consuming significant error budget. ([Google SRE][4]) That is much more mature than alerting every time CPU exceeds 80%.

Fourth, **turn incident review into system improvement**.  
After an incident, the question should not only be "who caused it?" It should be: which SLI degraded, which SLO was violated, why did error budget burn, were governance actions timely, and did observability provide enough data?

Fifth, **turn platform capability into a service contract**.  
A middleware platform should not merely say "we provide a registry center, a configuration center, and a rate-limiting system." It should say: "we guarantee config release reaches clients within p99 3 seconds, service discovery availability is 99.95%, and rule-hit correctness is 99.99%."

---

## 3. How Middleware Should Define SLI, SLO, and SLA

Middleware SLI, SLO, and SLA cannot simply copy business API indicators. Middleware usually has these characteristics:

1. **Shared dependency**: many businesses rely on it, so one failure affects many systems.
2. **Control plane and data plane separation**: config publishing is control plane, request forwarding is data plane.
3. **A mix of strong consistency and eventual consistency**: common in registry centers, config centers, and rule distribution.
4. **Deep client SDK participation**: reliability depends not only on the server but also on client caching, retry, and degradation behavior.
5. **Amplified failure impact**: a middleware wobble can trigger business-wide avalanches.

Therefore, middleware metrics should be designed by capability domain, not just by machine resource.

### 3.1 Core Categories of Middleware SLI

#### 3.1.1 Availability SLI

This applies to registry centers, configuration centers, gateways, rate-limiting services, message queues, cache proxies, and similar systems.

```text
Availability SLI = successful requests / total valid requests
```

But "successful" must be defined in middleware semantics:

| Middleware Type | Definition of Success |
| --- | --- |
| Registry center | service registration succeeds, heartbeat renewal succeeds, service discovery returns valid instances |
| Configuration center | config read succeeds, config publish succeeds, client watch succeeds |
| API gateway | request is routed correctly and does not fail because of gateway-side errors |
| Rate-limiting system | rule lookup succeeds, rate-limit judgment succeeds, quota deduction succeeds |
| MQ | send acknowledgment succeeds, message persistence succeeds, consumption acknowledgment succeeds |
| Cache proxy | get, set, and delete succeed, excluding invalid client requests |

Here, caller-originated errors must be excluded. HTTP 400, auth failure, or illegal arguments should not all count as middleware failure. Otherwise the SLI is polluted by consumer misuse.

#### 3.1.2 Latency SLI

Middleware latency cannot be represented by averages alone. It must use percentiles, especially p95, p99, and p999.

| Middleware Type | Example Latency SLI |
| --- | --- |
| Registry center | p99 service-discovery latency |
| Configuration center | p99 latency from config publish to client effective time |
| Gateway | gateway internal p99 latency, excluding backend business latency |
| MQ | p99 produce ack, p99 end-to-end delivery |
| Cache proxy | p99 command execution latency |
| Rate-limiting system | p99 latency of a single rate-limit judgment |

One key point is that **middleware latency must separate self time from downstream time**. For example, a slow gateway request may come from a slow backend rather than from the gateway itself. Therefore, gateway SLI should at least break down into:

```text
gateway_total_latency
gateway_internal_latency
upstream_service_latency
```

Otherwise governance decisions will be misguided.

#### 3.1.3 Correctness SLI

This is the most frequently ignored and also one of the most important middleware indicators.

| Middleware Capability | Correctness SLI |
| --- | --- |
| Registry center | whether discovery results include healthy instances and remove unhealthy ones |
| Configuration center | whether client config version matches the server-intended version |
| Rate-limiting system | whether rule matching and quota deduction are correct |
| Routing system | whether gray traffic enters the intended version |
| Circuit-breaking system | whether breaker state follows error-rate and window rules |
| MQ | whether messages are duplicated, reordered, or lost, and whether promised semantics are respected |
| Cache | whether data is expired, penetrated, or polluted |

My view is that **middleware SRE is incomplete if it defines only availability and latency but not correctness**. The scariest middleware failures are often not "it is down," but "it is still alive and returning the wrong result."

#### 3.1.4 Consistency and Propagation SLI

Control-plane middleware must define propagation metrics.

For a configuration center:

```text
config propagation latency = time client observes target config version - time server marks publish successful
```

For a registry center:

```text
instance-removal propagation latency = time client no longer discovers an unhealthy instance - time server judges the instance unhealthy
```

For a governance rule center:

```text
rule effective latency = time traffic actually follows the new rule - time rule publish succeeds
```

These indicators are often closer to real middleware value than plain API availability. A configuration center API can be 100% available while config takes 5 minutes to become effective, which is still a serious business problem.

#### 3.1.5 Durability and Recovery SLI

This category applies to MQ, registry/config storage, rule centers, and metadata centers.

| Indicator | Meaning |
| --- | --- |
| RPO | maximum data loss tolerated after a failure |
| RTO | how quickly service must recover after a failure |
| Data loss rate | lost data / data that should have been persisted |
| Replica sync delay | replication lag between follower and leader |
| Snapshot recovery success rate | successful snapshot recoveries / total recoveries |

If a middleware system stores core configuration, governance rules, or message data but has no RPO or RTO indicators, its reliability model is incomplete.

#### 3.1.6 Saturation SLI

Saturation is not ordinary resource monitoring. It should reflect whether the system is approaching its processing limit.

| Middleware | Saturation Indicators |
| --- | --- |
| Gateway | connection count, active requests, thread-pool queue, upstream pending requests |
| MQ | topic backlog, consumer lag, broker disk waterline |
| Registry center | watch count, push-queue backlog, heartbeat handling queue |
| Configuration center | long-connection count, change push queue, client watch count |
| Rate-limiting system | hot-rule QPS, quota-store conflicts, remote-judgment latency |
| Cache | memory waterline, eviction rate, hot-key traffic |

The value of saturation metrics is to predict failure instead of waiting for it to happen and only then alerting.

### 3.2 Example Middleware SLOs

| Middleware | SLI | Example SLO |
| --- | --- | --- |
| Registry center | service-discovery success rate | >= 99.95% over the last 30 days |
| Registry center | unhealthy-instance removal propagation latency | p99 <= 5 seconds |
| Configuration center | config-read success rate | >= 99.99% over the last 30 days |
| Configuration center | config effective latency after publish | p99 <= 3 seconds |
| API gateway | gateway-side 5xx rate | <= 0.05% over the last 30 days |
| API gateway | gateway internal processing latency | p99 <= 20 ms |
| Rate-limiting system | judgment success rate | >= 99.99% over the last 30 days |
| Rate-limiting system | rule-hit correctness | >= 99.999% over the last 30 days |
| MQ | produce ack success rate | >= 99.95% over the last 30 days |
| MQ | end-to-end delivery latency | p99 <= 1 second |
| Rule center | rule publish success rate | >= 99.99% over the last 30 days |
| Rule center | rule effective latency | p99 <= 5 seconds |

One design principle matters here: **middleware SLO must be tiered**.

For example:

| Tier | Typical Scope | Availability Target |
| --- | --- | --- |
| P0 core path | payment, order creation, core gateway, core registry and config | 99.99% |
| P1 important path | primary business systems, core management platforms | 99.95% |
| P2 normal path | internal back-office systems, lower-frequency jobs | 99.9% |
| P3 non-core path | experimental services, low-priority tools | 99% |

Giving every middleware system the same 99.99% target without tiering is fake reliability engineering. Reliability has a cost, and the highest target should be reserved for truly critical business paths.

### 3.3 Example Middleware SLAs

Middleware SLA can target two kinds of consumers.

The first is internal business teams. For example, a platform team may commit:

```text
The registry center provides 99.95% monthly availability for P0 business namespaces.
The configuration center guarantees p99 publish-to-effective latency within 3 seconds for P0 configuration.
The rate-limiting system provides 99.99% judgment success for core traffic paths.
If SLA is missed, the platform team must provide root cause, repair plan, and recurrence-prevention measures in the incident review.
```

The second is external customers. For example, a cloud or SaaS platform may commit:

```text
The API gateway provides at least 99.9% monthly availability.
If availability falls below the SLA, service compensation is provided according to contract.
```

My suggestion is that **internal middleware should also have SLA, but it does not need to start as a financial compensation contract. It can begin as an engineering accountability agreement** covering incident severity, response time, escalation path, review deadline, remediation deadline, downgrade plans, and business onboarding requirements.

---

## 4. How Microservices Should Define SLI, SLO, and SLA

Microservice SLI, SLO, and SLA differ from middleware metrics. They are closer to business semantics and should be defined around whether **the user request was completed correctly**, not merely whether the service process is alive.

Spring Boot documentation defines observability as the ability to observe the internal state of a running system from the outside, and notes that it includes the three pillars of logs, metrics, and traces. For Spring Boot applications, metrics and traces are commonly based on Micrometer Observation. ([Spring Boot][5]) That means microservice reliability metrics should not stop at the machine layer. They must reach application framework, API, call path, and business-tag dimensions.

### 4.1 Core Categories of Microservice SLI

#### 4.1.1 Request Availability

```text
request availability = successful requests / total valid requests
```

But "successful request" must be defined in business semantics:

| Scenario | Is It a Success? |
| --- | --- |
| HTTP 200 and business code = 0 | success |
| HTTP 200 but business code = inventory deduction failed | not necessarily success, depends on business definition |
| HTTP 400 invalid arguments | usually not service failure |
| HTTP 401 unauthorized | usually not service failure |
| HTTP 500 | service failure |
| timeout | service failure |
| circuit-break fallback result | success depends on whether it still meets user expectation |

This is crucial. Systems that look only at HTTP status code will seriously underestimate business failure rate.

#### 4.1.2 Request Latency

Microservice latency SLI should at least include:

```text
p50 / p95 / p99 / p999
```

And should be broken down by dimensions such as:

| Dimension | Example |
| --- | --- |
| service | `order-service` |
| endpoint | `POST /orders` |
| caller | `checkout-service` |
| region | `cn-hz` / `sg` |
| zone | `az1` / `az2` |
| version | `v1.2.3` |
| status | `success` / `error` |
| dependency | `mysql` / `redis` / `mq` |

An overall p99 alone is not meaningful. A service may look fine globally while one major customer, one region, or one version is performing badly. That is still a reliability issue.

#### 4.1.3 Business Correctness

Business correctness is often more important than technical availability.

| Business Scenario | Correctness SLI Example |
| --- | --- |
| Order service | successful order creation / total order requests |
| Payment service | correct payment status transitions / total payment requests |
| Inventory service | successful and accurate stock deduction / total deduction requests |
| Coupon system | correctly issued coupons / total eligible requests |
| Search service | requests returning valid results / total search requests |

I strongly recommend that core business services define correctness indicators explicitly. A service returning HTTP 200 while generating wrong orders, wrong balances, or wrong route decisions is not healthy.

#### 4.1.4 Dependency SLI

Many microservice incidents are actually dependency incidents. Therefore microservice SLI should also include:

```text
dependency call success rate
dependency call p99 latency
dependency timeout rate
dependency retry rate
dependency circuit-break count
dependency degradation hit rate
```

Going one step further, teams can define:

```text
the contribution of critical dependency availability to this service's own SLO
```

That helps answer an important question: **when the service SLO is violated, is the root cause inside the service, in a dependency, in incoming traffic, or in governance rules?**

#### 4.1.5 Asynchronous Path SLI

Microservices rely heavily on MQ, events, and eventual consistency, so SLO cannot cover synchronous HTTP alone.

Asynchronous SLI includes:

| Indicator | Example |
| --- | --- |
| Message production success rate | success rate of publishing `order-created` events |
| Message consumption success rate | inventory service consumption success for order events |
| Consumption latency | p99 from production to consumption completion <= 5 seconds |
| Backlog | consumer lag |
| Dead-letter rate | dead letters / total messages |
| Eventual consistency latency | p99 from order creation to inventory deduction completion |

If the system depends heavily on MQ but its SLO covers only HTTP APIs, that SLO is incomplete.

### 4.2 Example Microservice SLOs

| Service | SLI | Example SLO |
| --- | --- | --- |
| User login | login success rate | >= 99.9% over the last 30 days |
| User login | login latency | p95 <= 300 ms, p99 <= 800 ms |
| Order creation | order-creation success rate | >= 99.95% over the last 30 days |
| Order creation | business correctness | >= 99.99% over the last 30 days |
| Payment service | payment request success rate | >= 99.99% over the last 30 days |
| Payment service | eventual consistency latency of payment state | p99 <= 10 seconds |
| Search service | query success rate | >= 99.9% over the last 30 days |
| Recommendation service | non-empty recommendation rate | >= 99.5% over the last 30 days |
| Message consumption | consumption success rate | >= 99.95% over the last 30 days |
| Message consumption | consumption latency | p99 <= 5 seconds |

Microservice SLO should also be tiered by interface criticality:

| Interface Tier | Example | SLO Strategy |
| --- | --- | --- |
| Core transaction API | order, payment, inventory deduction | high availability, high correctness, low latency |
| Core read API | homepage, product detail, search | high availability, medium-high latency requirement |
| Internal management API | admin config, operations platform | medium availability |
| Offline job API | reporting, data sync | focus on completion rate and timeliness |
| Experimental API | A/B testing, exploratory recommendation | more error budget allowed |

### 4.3 Example Microservice SLA

Microservice SLA can be split into external SLA and internal SLA.

External SLA example:

```text
Open APIs provide at least 99.9% availability in a calendar month.
If availability falls below 99.9%, service compensation is provided according to contract.
Planned maintenance windows are excluded from SLA.
Client-originated invalid requests are excluded from SLA.
```

Internal SLA example:

```text
The order service commits to the payment service:
POST /orders/create under P0 tier has monthly availability >= 99.95% and p99 latency <= 800 ms.
When error-budget burn exceeds threshold, the order team must freeze non-emergency release and provide a repair plan within 24 hours.
```

I believe internal microservice SLA is highly valuable because it turns "services blaming each other" into "dependencies governed by contract."

---

## 5. What These Indicators Are Actually For

### 5.1 Guiding Alerting

Alerts without SLO are usually noise.  
Alerts with SLO become reliability signals.

Traditional alerts:

```text
CPU > 80%
thread-pool queue > 1000
API error count > 100
```

SLO-based alerts:

```text
The order service is burning error budget too quickly in the last hour.
If this continues for 6 hours, it will consume the 30-day error budget.
```

SLO alerts are closer to business risk. Grafana documentation also points out that alerts can be based on error-budget burn rate instead of reacting immediately to every minor deviation, and that SLO helps teams align around shared reliability goals. ([Grafana Labs][6])

### 5.2 Guiding Release

When error budget is healthy:

```text
normal release is allowed
gray experiments are allowed
architecture adjustments are allowed
```

When error budget is burning fast:

```text
freeze non-essential releases
pause high-risk changes
prioritize stability fixes
extend gray observation windows
reduce release frequency
```

That is far more actionable than "things feel unstable lately, maybe do not release."

### 5.3 Guiding Capacity Planning

SLO helps answer whether capacity is sufficient:

```text
If traffic grows 30%, will p99 latency still meet SLO?
Will MQ backlog push consumption latency beyond SLO?
As registry watch count grows, can push latency still meet SLO?
```

Capacity planning should not look only at CPU waterline. It should ask whether the SLO can still be achieved.

### 5.4 Guiding Architecture Design

If a service has a 99.99% SLO, it may need:

```text
multi-replica deployment
cross-AZ disaster tolerance
rate limiting and circuit breaking
asynchronous traffic shaving
degradation plan
idempotency mechanisms
data backup
failure drills
```

If another service has only a 99% SLO, spending the same amount of reliability cost is unnecessary. **Reliability design must be tiered, otherwise it becomes waste.**

### 5.5 Guiding Incident Review

Incident review should revolve around SLI and SLO:

```text
Which SLI degraded?
Which SLO was violated?
How much error budget was consumed?
Which callers, endpoints, regions, or versions were affected?
Were governance actions timely?
Did observability provide enough evidence for localization?
How can future incidents of the same type consume less error budget?
```

That is far more useful than writing generic lessons such as "strengthen monitoring, strengthen testing, strengthen on-call awareness."

### 5.6 Guiding Platform Productization

For a middleware platform, SLI, SLO, and SLA can directly become product capabilities:

```text
SLO dashboards
error-budget dashboards
tenant reliability tiering
governance rule recommendations
capacity risk prediction
release admission checks
blast-radius analysis
service dependency scoring
```

In other words, SRE indicators are not just fields in a monitoring system. They are a product foundation for platform engineering.

---

## 6. How to Rely on Observability for Better Service Governance

The OpenTelemetry documentation states that the purpose of OpenTelemetry is to collect, process, and export signals, including measurable system state and events propagated across distributed system components. OpenTelemetry is also defined as a vendor-neutral open-source observability framework for generating, collecting, and exporting telemetry such as logs, metrics, and traces. ([OpenTelemetry][7]) The OpenTelemetry Collector provides a vendor-neutral implementation for receiving, processing, and exporting telemetry, reducing the burden of maintaining multiple agents or collectors. ([OpenTelemetry][8])

With those capabilities in mind, service governance should no longer rely on manual observation. It should rely on observability data to form a closed loop.

### 6.1 Foundational Architecture of an Observability System

A reasonable observability system can be designed like this:

```text
business services / middleware / gateways / service mesh
        ↓
metrics + logs + traces + events
        ↓
OpenTelemetry SDK / agent / collector
        ↓
Prometheus / Tempo / Elasticsearch / Loki / ClickHouse
        ↓
SLO calculation / error budget / topology analysis / root-cause analysis
        ↓
service governance platform
        ↓
rate limiting / circuit breaking / degradation / routing / gray release / scaling / rollback
```

Each kind of data has a different role:

| Data Type | Role |
| --- | --- |
| Metrics | compute SLI, SLO, error budget, and alerts |
| Traces | analyze call paths, bottlenecks, and dependencies |
| Logs | locate error detail, business context, and audit evidence |
| Events | record release, config change, governance rule change, and failure drill events |
| Topology | build service dependency graphs and blast-radius analysis |
| Profiles | analyze CPU, memory, lock contention, and other performance issues |

### 6.2 Closed-Loop Governance Model

I recommend the following loop:

```text
observe → judge → decide → execute → validate → review
```

#### Step 1: Observe

Collect data such as:

```text
service request success rate
endpoint p95 and p99 latency
error-code distribution
caller distribution
dependency latency
instance load
version information
gray traffic ratio
rate-limit and circuit-break hits
config change events
release events
```

#### Step 2: Judge

Judge whether the service is violating SLO:

```text
Is the current error rate above budget?
Is error-budget burn too fast?
Does the issue affect only one caller?
Does it affect only one version?
Does it affect only one zone or region?
Is it correlated with a recent release or config change?
```

#### Step 3: Decide

Choose a governance action according to the judgment:

| Observed Signal | Governance Action |
| --- | --- |
| One version has rising error rate | pause gray rollout, shift traffic back, auto rollback |
| One caller has abnormal traffic | caller-specific rate limiting, isolation, quota adjustment |
| Downstream dependency is timing out | circuit break, degrade, shorten timeout, reduce retry |
| p99 latency is rising | scale out, isolate hot spots, warm cache |
| MQ consumption backlog is growing | scale consumers, limit producers, prioritize consumption |
| Config release is abnormal | rollback config, pause release, client-side degrade |
| Service discovery is abnormal | enable local cache, protect last-known-good instances |

#### Step 4: Execute

Execute governance rules such as:

```text
dynamic routing
gray release
circuit breaking
rate limiting
degradation
isolation
retry-budget control
timeout control
load-balancer weight adjustment
scaling
config rollback
```

#### Step 5: Validate

After execution, observe again:

```text
Is error-budget burn slowing down?
Has p99 latency recovered?
Has error rate gone down?
Is the blast radius shrinking?
Did the action introduce new side effects?
```

#### Step 6: Review

Review should focus not only on the incident cause, but also on:

```text
Was the SLI defined correctly?
Was the SLO reasonable?
Was alerting timely?
Were governance actions effective?
Can the action be automated?
Should rate limiting, circuit breaking, or degradation strategies be adjusted?
Is architecture change required?
```

### 6.3 Governance Strategies Driven by Observability Data

#### 6.3.1 Rate-Limiting Governance

Rate limiting should not rely only on static QPS thresholds. It should adapt to SLO state.

For example:

```text
If error-budget burn is too high:
    reduce quota for low-priority callers
    reserve quota for critical callers
    enable queueing or rejection for non-core endpoints
```

That is more reasonable than applying the same cut to every flow.

#### 6.3.2 Circuit-Breaking Governance

Circuit breaking should combine:

```text
error rate
timeout rate
p99 latency
concurrency
downstream health
error-budget burn rate
```

It cannot simply say "trip after 50 failures." Otherwise low-traffic and high-traffic services get very different and often irrational results.

#### 6.3.3 Gray-Release Governance

Gray release must rely on observability data.

Its decision conditions should include:

```text
Is the new version's error rate worse than baseline?
Is the new version's p99 worse?
Are core endpoint SLOs affected?
Does the impact appear only for certain callers?
Are there new abnormal log patterns?
Did the call path introduce new slow dependencies?
```

If the gray system is not connected to SLO and error budget and expands traffic only by elapsed time, that is dangerous.

#### 6.3.4 Degradation Governance

Degradation strategies should be tiered:

| Level | Strategy |
| --- | --- |
| L1 | disable non-core functions |
| L2 | use cached result |
| L3 | return default result |
| L4 | reject low-priority requests |
| L5 | protect only core flows such as order and payment |

Whether degradation should trigger should be determined jointly by SLO state, dependency health, and error-budget burn rate.

#### 6.3.5 Routing Governance

Routing decisions can depend on:

```text
region
data center
version
caller
user segment
error rate
latency
instance health
cost
compliance requirement
```

For example, in a cross-region architecture, routing between mainland China and Singapore regions cannot be decided by latency alone. It must also consider data compliance, user residency, cross-border constraints, and fault-isolation boundaries.

---

## 7. Dependency and Feedback Relationship Between Service Governance and Observability

Service governance and observability are not a simple upstream-downstream chain. They depend on each other and continuously drive each other.

Istio documentation points out that a service mesh can provide zero-trust security, observability, and advanced traffic management without application code changes, and that Istio generates detailed telemetry for service-to-service communication in the mesh to help operators troubleshoot, maintain, and optimize systems. ([Istio][9]) Envoy also exposes observability capabilities across statistics, access logging, and tracing, and distributed tracing helps engineers understand call flows, parallelism, and latency sources in large service-oriented architectures. ([Envoy Proxy][10])

This means a modern governance platform should naturally be deeply integrated with observability.

### 7.1 Observability Depends on Service Governance

Observability data becomes valuable only when service governance provides context.

#### 7.1.1 Depend on Service Registration Metadata

Without service metadata, metrics show only IPs and ports:

```text
10.1.2.3:8080
10.1.2.4:8080
```

With governance metadata, you can understand:

```text
service=order-service
env=prod
region=cn-hz
zone=az1
version=v1.2.3
owner=trade-team
priority=P0
```

Without those tags, observability sees only "machine anomaly," not "business impact."

#### 7.1.2 Depend on Routing and Call Relationships

Governance systems know:

```text
checkout-service → order-service → inventory-service → payment-service
```

Only with those relationships can observability build a topology and analyze blast radius.

#### 7.1.3 Depend on Governance Rule Events

When failures happen, teams must know:

```text
Was a new version just released?
Was a rate-limit rule just changed?
Was a route weight just adjusted?
Was a timeout setting just modified?
Was a circuit breaker just enabled?
Was configuration just changed?
```

If observability is not connected to those governance events, root-cause analysis becomes much harder.

### 7.2 Service Governance Depends on Observability

Governance actions cannot be executed blindly. They must depend on observability data.

#### 7.2.1 Rate Limiting Depends on Traffic Observation

Without caller QPS, endpoint QPS, error rate, latency, and priority, fine-grained rate limiting is impossible.

#### 7.2.2 Circuit Breaking Depends on Error Observation

Without error rate, timeout rate, and dependency latency, there is no basis for deciding whether to trip the breaker.

#### 7.2.3 Gray Release Depends on Version Observation

Without version-level metrics and traces, there is no way to judge whether the new version is healthy.

#### 7.2.4 Scaling Depends on Saturation Observation

Without CPU, memory, thread pool, connection pool, queue depth, backlog, or consumer lag, there is no basis for deciding whether to scale.

#### 7.2.5 Degradation Depends on Business Impact Observation

Without business SLI, there is no way to know whether degradation truly protected the core path.

### 7.3 How the Two Drive Each Other

The two systems should form the following feedback relationship:

```text
Service governance provides:
    service catalog
    call relationships
    routing rules
    version information
    traffic policies
    rate-limit rules
    circuit-break rules
    change events

Observability provides:
    SLI
    SLO compliance state
    error budget
    latency distribution
    error distribution
    saturation
    trace bottlenecks
    blast radius
    root-cause clues

Together they drive:
    automatic rate limiting
    automatic circuit breaking
    automatic degradation
    automatic rollback
    intelligent scaling
    change admission
    incident review
    architecture optimization
```

In one sentence: **service governance decides how the system acts, while observability decides whether that action has evidence behind it**.

---

## 8. Practical Rollout Path for Middleware SRE

### 8.1 Step One: Establish Service Tiering

Start with business criticality:

| Tier | Example | Reliability Requirement |
| --- | --- | --- |
| P0 | payment, order creation, core registry cluster, core config cluster | extremely high |
| P1 | search, recommendation, core gateway, MQ primary path | high |
| P2 | admin console, common job services | medium |
| P3 | experimental systems, low-frequency internal tools | low |

### 8.2 Step Two: Build an SLI Catalog

Every service should define:

```text
availability SLI
latency SLI
error-rate SLI
saturation SLI
correctness SLI
dependency SLI
change events
```

Middleware should additionally define:

```text
control-plane SLI
data-plane SLI
config propagation SLI
rule consistency SLI
client-perceived SLI
RPO / RTO
```

### 8.3 Step Three: Build SLO Templates

For example:

```text
P0 HTTP API:
    availability >= 99.95%
    p99 latency <= 800 ms
    error budget window = 30 days

P0 configuration center:
    read availability >= 99.99%
    publish success >= 99.99%
    propagation p99 <= 3 s

P0 registry center:
    discovery availability >= 99.95%
    heartbeat success >= 99.99%
    unhealthy-instance removal p99 <= 5 s
```

### 8.4 Step Four: Establish Error-Budget Policy

For example:

| Error-Budget State | Policy |
| --- | --- |
| remaining > 50% | normal release |
| remaining 20% to 50% | high-risk release requires approval |
| remaining 5% to 20% | only low-risk changes are allowed |
| remaining < 5% | freeze non-emergency releases |
| exhausted | enter a stability-repair cycle |

### 8.5 Step Five: Connect Release and Config Changes

Every change should become an observable event:

```text
application release
config release
route adjustment
rate-limit rule adjustment
circuit-break rule adjustment
scaling action
database change
middleware upgrade
```

Without change events, root-cause analysis becomes extremely difficult.

### 8.6 Step Six: Automate Governance, but Add Guardrails

Automation must not run without guardrails. It should include:

```text
maximum rate-limit ratio
maximum rollback scope
minimum gray observation time
critical-caller protection list
manual confirmation threshold
automation cooldown period
governance action audit log
```

I do not recommend pursuing fully autonomous fault handling from day one. A more realistic path is:

```text
first achieve automatic detection
then automatic recommendation
then semi-automatic execution
finally limited closed-loop automation in controlled scope
```

---

## 9. Conclusion

This article discussed how SLI, SLO, and SLA should be defined in middleware and microservice systems, and what engineering value they bring to site reliability engineering. The core conclusions are:

First, **SLI, SLO, and SLA are the reliability language of SRE**. SLI measures reality, SLO defines the target, and SLA forms the commitment. Without them, reliability management remains trapped in subjective experience.

Second, **middleware SRE cannot simply copy microservice SRE**. Middleware must additionally focus on control plane, data plane, consistency, propagation latency, rule correctness, client perception, RPO/RTO, and failure amplification.

Third, **microservice SRE must define indicators around user journeys and business correctness**. HTTP 200 does not guarantee business success, and process liveness does not guarantee service reliability.

Fourth, **the greatest value of SLO is the error budget**. Error budget puts release velocity and system stability into the same engineering language, so teams can make decisions from data instead of intuition.

Fifth, **observability is the factual foundation of service governance**. Without metrics, logs, traces, events, and topology, rate limiting, circuit breaking, degradation, gray release, and rollback become blind operations.

Sixth, **service governance in turn drives the evolution of observability**. Governance systems provide service catalog, call relationships, versions, routes, rules, and change events, allowing observability data to carry real business context.

Ultimately, a mature middleware SRE system should not be only "monitoring + alerting + on-call." It should be:

```text
reliability target definition
        ↓
observability data collection
        ↓
error-budget calculation
        ↓
governance policy execution
        ↓
effect validation
        ↓
incident review and system improvement
```

That is what site reliability engineering should look like for modern microservice and middleware platforms.

[1]: https://sre.google/sre-book/service-level-objectives/?utm_source=chatgpt.com "Defining slo: service level objective meaning"
[2]: https://sre.google/sre-book/monitoring-distributed-systems/?utm_source=chatgpt.com "Chapter 6 - Monitoring Distributed Systems"
[3]: https://sre.google/workbook/implementing-slos/?utm_source=chatgpt.com "Chapter 2 - Implementing SLOs"
[4]: https://sre.google/workbook/alerting-on-slos/?utm_source=chatgpt.com "Chapter 5 - Alerting on SLOs"
[5]: https://docs.spring.io/spring-boot/reference/actuator/observability.html?utm_source=chatgpt.com "Observability :: Spring Boot"
[6]: https://grafana.com/docs/grafana/latest/alerting/guides/best-practices/?utm_source=chatgpt.com "Alerting best practices - Grafana documentation"
[7]: https://opentelemetry.io/docs/concepts/signals/?utm_source=chatgpt.com "Signals"
[8]: https://opentelemetry.io/docs/collector/?utm_source=chatgpt.com "Collector"
[9]: https://istio.io/latest/about/service-mesh/?utm_source=chatgpt.com "The Istio service mesh"
[10]: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/observability/observability?utm_source=chatgpt.com "Observability"
