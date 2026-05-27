---
title: "Load-Balancing Architecture Choices for Internal Microservice Calls"
category: "Service Governance"
summary: "A practical guide to choosing client-side or sidecar load balancing for east-west traffic while keeping gateways and ingress layers for north-south traffic."
tags:
  - "Load Balancing"
  - "Microservices"
  - "Service Discovery"
  - "gRPC"
readingDirection: "Read this when deciding how internal service calls should select instances and which load-balancing strategy fits modern microservice traffic."
outline: deep
---

# Load-Balancing Architecture Choices for Internal Microservice Calls

## Overview

A practical guide to choosing client-side or sidecar load balancing for east-west traffic while keeping gateways and ingress layers for north-south traffic.

## Abstract

In modern microservice systems, load balancing is no longer just a networking problem about "spreading requests evenly across multiple instances." It is now a combined problem involving service discovery, fault isolation, traffic governance, elastic scaling, observability, and call-path stability. The central conclusion of this article is: **for internal service-to-service calls, or east-west traffic, client-side load balancing or sidecar-proxy load balancing should be the default choice; for external entry traffic, or north-south traffic, centralized layers such as gateways, ingress controllers, ALBs, NLBs, and API gateways should still be retained.** Routing all internal calls through a gateway is an outdated and risky centralized design that introduces extra hops, bottlenecks, and a larger blast radius.

The Kubernetes documentation explains that a Service exists to expose a set of backends as a network service even while workloads change dynamically and Pods are created or destroyed at any time. If an application can use the Kubernetes API for cloud-native service discovery, it can query EndpointSlices directly; otherwise, a network port or load balancer may sit between the application and backend Pods. This directly shows that the essence of modern load balancing has shifted from a "fixed backend list" to "dynamic endpoint discovery plus policy-driven routing." ([Kubernetes][1])

**Keywords:** client-side load balancing, gateway load balancing, service discovery, gRPC, Envoy, Istio, Kubernetes, Round Robin, Least Request, Consistent Hash

---

## 1. Background: Why Load Balancing Became More Complex

Load balancing originally existed to improve resource utilization, throughput, latency, and fault tolerance in multi-instance systems. The NGINX documentation gives a classic description: balancing load across multiple application instances is a common technique for optimizing resource use, maximizing throughput, reducing latency, and enabling fault-tolerant deployments. ([NGINX Documentation][2])

In a microservice architecture, however, the complexity of load balancing expands significantly for four main reasons.

First, **service instances are dynamic**. In Kubernetes, a Deployment can create or destroy Pods at any time, so the available backend set is constantly changing. Kubernetes Services maintain endpoint sets through selectors and EndpointSlices. ([Kubernetes][1])

Second, **traffic is no longer limited to a small amount of entry traffic; it becomes a large volume of internal service-to-service calls**. Once a user request enters the system, it may trigger dozens of internal RPCs. If every internal call is routed through a centralized gateway, the system gains extra network hops and queueing points by design.

Third, **protocols have changed**. HTTP/2, gRPC, long-lived connections, connection pools, and bidirectional streaming often make "connection-level load balancing" ineffective. The gRPC load-balancing design notes explicitly state that gRPC internal load balancing happens at the per-call level rather than the per-connection level. Even if all requests come from the same client, the calls should still be distributed across all servers. ([GitHub][3])

Fourth, **fault governance has become part of load balancing itself**. A good load balancer does not only choose an instance. It also works with timeouts, retries, circuit breaking, connection pools, unhealthy-instance ejection, warmup, canaries, locality routing, and metrics feedback. The Envoy documentation treats load-balancing strategy, outlier detection, and circuit breaking as part of upstream management. Envoy outlier detection marks abnormal hosts as unhealthy and temporarily removes them from load-balancing selection. ([Envoy Proxy][4])

---

## 2. Gateway Load Balancing vs. Client-Side Load Balancing

In this article, "gateway load balancing" refers to centralized proxies or entry load-balancing layers such as NGINX, HAProxy, AWS ALB/NLB, Kubernetes Ingress, API gateways, and Service LoadBalancers. "Client-side load balancing" refers to caller-side SDKs, gRPC channels, Spring Cloud LoadBalancer, or sidecar proxies such as Envoy/Istio running on the same node or in the same Pod as the service process, choosing target instances directly from service-discovery results.

### 2.1 Strengths of Gateway Load Balancing

The biggest strength of gateway load balancing is **centralized governance**. TLS termination, authentication, authorization, WAF, rate limiting, access logs, allow/deny lists, path routing, and host routing are all naturally suited to an entry gateway. The AWS Application Load Balancer documentation explains that an ALB operates at OSI Layer 7, receives requests, evaluates listener rules, and routes traffic to different target groups based on application-level content. ([AWS Documentation][5])

The second strength is **client simplicity**. Callers only need a stable domain name or virtual IP and do not need to track backend instance lists themselves. Kubernetes Services embody the same abstraction: a Service exposes a group of Pods as a stable network service so clients do not need to follow changes in the backend Pod set. ([Kubernetes][1])

The third strength is **a clear entry security boundary**. Internet traffic, cross-network traffic, third-party access, and BFF/API aggregation layers are all appropriate to enter through a gateway first, then proceed into the internal service mesh or service cluster.

### 2.2 Weaknesses of Gateway Load Balancing

Gateway load balancing is correct for entry traffic, but it is clearly unsuitable when used for all internal service-to-service calls.

First, **the gateway easily becomes a central bottleneck and failure amplifier**. If all internal RPCs detour through the gateway, the gateway carries east-west traffic that it should not own. Any jitter at the gateway can affect a large number of inter-service calls.

Second, **it adds one more network hop, one more queue, and one more failure point**. An internal call that could have been `client -> backend` becomes `client -> gateway -> backend`. That extra hop is an expensive design choice for high-QPS, low-latency systems.

Third, **the gateway has difficulty understanding fine-grained caller context**. Different callers may have different timeout budgets, retry budgets, priorities, weights, and canary rules. A centralized gateway can implement some of this, but over time the rules collapse into a large and complicated configuration surface that becomes operational and governance debt.

Fourth, **traditional gateway load balancing may become uneven under long-lived connections, HTTP/2, and gRPC**. The gRPC documentation explains that the default `pick_first` policy does not actually balance load. It connects to the first reachable address returned by the name resolver. After switching to `round_robin`, the client connects to all addresses and rotates RPCs across backends. ([gRPC][6]) That means for protocols like gRPC, effective balancing must happen at the client channel or proxy request-selection layer, not only at the entry connection layer.

### 2.3 Strengths of Client-Side Load Balancing

The biggest strength of client-side load balancing is **that the decision is made close to the caller**. gRPC load-balancing policies receive updated server address lists from the resolver, create subchannels for those addresses, and decide which subchannel to use when each RPC is sent. ([GitHub][3])

The second strength is **natural horizontal scaling**. The load-balancing decision is distributed across each client or sidecar rather than handled by one centralized gateway.

The third strength is **a better fit for service discovery and dynamic endpoints**. The Spring Cloud documentation explicitly describes Spring Cloud LoadBalancer as a client-side load-balancer abstraction and implementation that obtains available instances from service discovery through `ServiceInstanceListSupplier`. ([Home][7])

The fourth strength is **support for more granular traffic governance**. The Istio documentation explains that Istio traffic management relies on Envoy proxies deployed with services, and all traffic sent and received within the mesh goes through Envoy. That makes it possible to control traffic without changing application code. ([Istio][8])

### 2.4 Weaknesses of Client-Side Load Balancing

Client-side load balancing is not free of cost.

First, **client complexity increases**. If the logic is embedded in business SDKs, different languages, versions, or services may implement inconsistent strategies.

Second, **it requires reliable service discovery and configuration distribution**. The client must receive timely, correct, and usable endpoint lists. Otherwise, it may route to terminated instances, use stale endpoint lists, or skew traffic distribution.

Third, **observability and governance must be standardized**. If each business team implements its own client-side load balancer, metrics, logs, retries, and circuit breaking will become fragmented.

So the best practice is not "every business team writes its own client-side load balancer." It is: **use mature frameworks or a unified sidecar data plane whenever possible, such as built-in gRPC policies, Spring Cloud LoadBalancer, or Envoy/Istio. Do not rebuild this wheel inside business code.**

---

## 3. Why Client-Side Load Balancing Should Be Preferred Over Gateway Load Balancing

My position is explicit: **for internal service-to-service calls, client-side load balancing should be preferred over gateway load balancing.** The reasons are as follows.

### 3.1 Client-Side Load Balancing Fits East-West Traffic Better

Internal service calls are high-frequency, latency-sensitive, long-chain, and dependency-heavy. Concentrating all of them at a gateway forces the gateway to act as an unnecessary traffic relay. Client-side load balancing lets the caller choose the backend directly, reducing intermediate hops and lowering queueing risk at central nodes.

The Istio description of the sidecar model is the key here: traffic inside the service mesh is handled by Envoy proxies deployed alongside services, and those proxies use the service registry to steer traffic to the relevant services. In essence, this is client-side proxy load balancing. ([Istio][8])

### 3.2 Client-Side Load Balancing Can Do Real Per-RPC Balancing

For gRPC, HTTP/2, and connection-pooled traffic, connection-level balancing often does not represent request-level balancing. The gRPC design documentation explicitly places the load-balancing policy between name resolution and server connection setup, with the policy choosing a subchannel for each RPC. ([GitHub][3])

So if a system uses gRPC heavily, continuing to depend on gateway-level connection balancing is not a professional design. The correct approach is to configure request-level balancing in the client or sidecar, such as `round_robin`, `least_request`, or xDS/Envoy strategies.

### 3.3 Client-Side Load Balancing Integrates Better with Real-Time Health Signals

Envoy supports outlier detection. When a host is judged abnormal, it is marked unhealthy and removed from load-balancing selection; it can later return to the pool if conditions recover. ([Envoy Proxy][4]) Envoy also supports distributed circuit breaking, and its documentation states that in distributed systems, failing fast and applying backpressure is often better than continuing to queue. ([Envoy Proxy][9])

These capabilities can also exist at a centralized gateway, but on east-west traffic they are more naturally placed on the client side or sidecar side, because the fault impact can be contained within a specific caller, target service, priority, and connection pool.

### 3.4 Client-Side Load Balancing Fits Canary, Version Routing, and Service-Level Policies Better

The Istio documentation explains that `DestinationRule` can customize Envoy traffic policies for a target service or service subset, including load-balancing mode, TLS mode, and circuit-breaking settings. ([Istio][8]) That means internal service calls can configure policies by service, version, port, and subset instead of piling every rule into one large gateway.

### 3.5 Gateways Should Remain, but They Should Not Own All Internal Calls

The correct architecture is not "client-side load balancing eliminates gateways." It is layered separation:

```text
External Client
    ↓
Gateway / Ingress / ALB / API Gateway
    ↓
Internal Service A
    ↓ client-side LB or sidecar LB
Internal Service B / C / D
```

**Conclusion: use gateways for entry traffic and client-side load balancing for internal traffic.**
This is not a compromise. It is the basic division of labor in mature microservice systems.

---

## 4. What Load-Balancing Algorithms Exist?

The table below lists mainstream load-balancing algorithms and their typical use cases.

| Algorithm | Core idea | Suitable scenarios | Unsuitable scenarios |
| --- | --- | --- | --- |
| Round Robin | Select backend instances in order | Similar backend capacity, similar request cost, short-lived connections, ordinary HTTP APIs | Large request-time variance, large capacity variance, long-lived connections |
| Weighted Round Robin | Rotate by configured weights so higher-weight instances receive more traffic | Different instance sizes, canary rollout, capacity tiers | Inaccurate weight maintenance, large real-time load fluctuations |
| Random | Pick a healthy backend randomly | Large backend pools, simple implementation, multiple load balancers in parallel | Small services, large request-time variance |
| Least Connections | Choose the instance with the fewest current connections | Long-lived connections, database connections, long TCP sessions | Short HTTP requests, HTTP/2 multiplexing where connections do not represent request load |
| Least Request / Least Outstanding Requests | Choose the instance with the fewest in-flight requests, or choose the lower-loaded one from random candidates | Microservice HTTP/RPC, uneven request duration, uneven instance performance | Limited benefit when metrics are unavailable or requests are extremely short and homogeneous |
| Power of Two Choices / P2C | Randomly sample two or N candidates, then choose the lighter-loaded one | Large backend pools, strong balance/performance tradeoff | Requires some real-time load information |
| IP Hash / Source Hash | Hash client IP or source attributes to a fixed instance | Session affinity, TCP scenarios | Skewed client IP distribution, many users sharing NAT IPs |
| Consistent Hash / Ring Hash | Map request keys and backends onto a hash ring to reduce remapping during backend changes | Caching, session affinity, stateful services | Not a good default for stateless services because it sacrifices balance |
| Maglev Hash | A consistency-oriented hash designed to minimize disruption during backend change | Large-scale consistent routing, service meshes, edge proxies | Usually unnecessary for ordinary stateless APIs |
| Locality / Zone-aware LB | Prefer same-zone, same-datacenter, or same-region instances | Multi-AZ, multi-region, multi-cloud deployment | Can overload local resources if failover is not prepared |
| Adaptive / Client-side Weighted RR | Dynamically adjust weights by backend load, error rate, or utilization | Large capability differences, visible load fluctuation | Unreliable metrics or excessive feedback delay |

NGINX Open Source supports Round Robin, Least Connections, IP Hash, and Generic Hash. NGINX Plus also supports Least Time and Random, and its documentation explicitly states that Round Robin is the default method. ([NGINX Documentation][2])

Envoy supports Weighted Round Robin, Client-side Weighted Round Robin, Weighted Least Request, Ring Hash, Maglev, and Random. Under equal weights, Envoy Weighted Least Request uses a P2C-style approach by sampling a small number of healthy hosts and then choosing the one with fewer active requests. Envoy's documentation also makes it clear that Ring Hash and Maglev are mainly for scenarios requiring stable hash keys. ([Envoy Proxy][10])

AWS ALB supports Round Robin, Least Outstanding Requests, and Weighted Random. The documentation states that Round Robin is the default routing algorithm at the target-group level, and Least Outstanding Requests routes requests to the target with the fewest in-progress requests. ([AWS Documentation][11])

The HAProxy configuration manual also lists algorithms such as `roundrobin`, `leastconn`, `source`, `uri`, `url_param`, `hdr`, and `random`, and describes `roundrobin` as a smooth and fair weighted scheduling algorithm when server processing time is similar. ([HAProxy Technologies][12])

---

## 5. Which Algorithm Is the Most Standard and Widely Used?

**The most standard and most widely used baseline algorithm is Round Robin, and its production-strength variant is usually Weighted Round Robin.**

That conclusion is not because Round Robin is the smartest algorithm. It is because it is the simplest, the easiest to explain, the easiest to implement, and the most widely supported across products. NGINX uses Round Robin by default. AWS ALB also uses Round Robin as the default target-group algorithm. Envoy supports Weighted Round Robin. HAProxy includes `roundrobin` as one of its core scheduling algorithms. ([NGINX Documentation][2])

But one point must be emphasized: **"most widely used" is not the same as "best for production."** For modern microservice HTTP/RPC traffic, I recommend **Least Request / P2C** as the default production strategy, especially when request duration is uneven, instance load is uneven, and scaling or cold starts are common. The Istio documentation states this very directly: `ROUND_ROBIN` is often unsafe in many scenarios because it can overload endpoints, and `LEAST_REQUEST` is generally the safer default and is almost always superior to `ROUND_ROBIN`. ([Istio][13])

So this article gives a clear judgment:

```text
Industry-standard and most widely used: Round Robin / Weighted Round Robin
Recommended for modern microservices: Least Request / P2C
For session affinity or cache locality: Consistent Hash / Ring Hash / Maglev
For heterogeneous capacity or canary rollout: Weighted Round Robin / Adaptive Weighted
```

---

## 6. Current Best Practices for Client-Side Load Balancing

### 6.1 Architectural Principle: Centralize the Entry Layer, Push Internal Routing Downward

The most reasonable division of responsibility is:

```text
North-South Traffic:
User / Partner / Mobile / Web
    → Gateway / Ingress / ALB / API Gateway
    → Internal Service

East-West Traffic:
Service A
    → Client-side LB / Sidecar LB
    → Service B instances
```

Gateways handle entry governance, while client-side load balancing handles internal calls. Treating the gateway as the relay center for every internal service call is a design that should not be adopted.

### 6.2 Prefer Sidecars or Mature Client Frameworks

If the system is multi-language, multi-team, and multi-service, the best choice is **a sidecar data plane such as Envoy/Istio**, because it avoids fragmentation across language-specific SDKs. The Envoy introduction explains that Envoy can act as both an edge proxy and a service proxy, run next to each application, and provide common network capabilities in a platform-agnostic way. ([Envoy Proxy][14])

If the system is primarily Java/Spring, Spring Cloud LoadBalancer is a suitable choice. The Spring documentation states that it provides a client-side load-balancer abstraction, with `RoundRobinLoadBalancer` as the default implementation and `RandomLoadBalancer` as an alternative. ([Home][7])

If the system relies heavily on gRPC, the gRPC client load-balancing policy should be configured explicitly. Do not rely on the default `pick_first`, because the gRPC documentation is clear that `pick_first` does not actually balance load. ([gRPC][6])

### 6.3 Algorithm Selection Guidance

**Default guidance:**

```text
Ordinary microservice HTTP/RPC: Least Request / P2C
Fully homogeneous short requests: Round Robin / Weighted Round Robin
gRPC multi-instance calls: round_robin or xDS/Envoy strategy
Caching or session affinity: Consistent Hash / Ring Hash / Maglev
Heterogeneous instance sizes: Weighted Round Robin or Adaptive Weighted
Multi-region / multi-AZ: Locality-aware routing + failover
```

For Istio, a reasonable default is:

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: order-service-lb
spec:
  host: order-service.default.svc.cluster.local
  trafficPolicy:
    loadBalancer:
      simple: LEAST_REQUEST
```

The Istio documentation explicitly states that `DestinationRule` can configure target-service load-balancing policy and lists options such as Random, Weighted, Round robin, Consistent hash, Ring hash, and Maglev. ([Istio][8])

### 6.4 Health Checking Must Include Both Active and Passive Mechanisms

Load balancing cannot rely only on whether an instance "exists." It must consider whether the instance can still serve correctly.

Active health checks are appropriate for periodically confirming whether an instance is alive. Passive outlier detection is appropriate for ejecting abnormal instances based on real traffic errors such as 5xx responses, timeouts, or resets. The Envoy documentation states that outlier detection can detect abnormal hosts through consecutive 5xx responses, gateway errors, local-origin failures, success rate, or failure percentage. ([Envoy Proxy][4])

Best practice:

```text
Must have:
1. Readiness / active health check
2. Passive outlier detection
3. Connection draining
4. Slow start / warmup
5. Endpoint ejection metrics
```

### 6.5 Circuit Breaking, Timeouts, and Retries Must Be Designed Together with Load Balancing

Doing load balancing without circuit breaking or retry budgeting is an incomplete solution. The Envoy documentation clearly states that circuit breaking is a key component of distributed systems, and that failing fast and applying backpressure is often better than allowing infinite queue growth. Envoy supports limits such as maximum cluster connections, pending requests, active requests, and retries. ([Envoy Proxy][9])

Recommended rules:

```text
1. Every service should have a default timeout.
2. Retries should be limited to idempotent APIs or explicitly retryable errors.
3. Retries must use a retry budget and must never be unbounded.
4. Circuit-breaking policies should be layered by target service, priority, and caller.
5. Under overload, fail fast rather than queue indefinitely.
```

### 6.6 Do Not Use the Default `pick_first` in gRPC Scenarios

The default gRPC `pick_first` policy is not load balancing. A minimal gRPC service-config example is:

```json
{
  "loadBalancingConfig": [
    {
      "round_robin": {}
    }
  ],
  "methodConfig": [
    {
      "name": [
        {
          "service": "com.example.OrderService"
        }
      ],
      "timeout": "2s"
    }
  ]
}
```

The gRPC documentation explains that `round_robin` connects to every address it receives and rotates each RPC across the connected backends. ([gRPC][6])

### 6.7 Avoid Implicit Lazy-Load Jitter in Spring Cloud Scenarios

By default, Spring Cloud LoadBalancer creates a child context for each service ID and lazily initializes it on the first request. In production systems, core dependency services should be eager-loaded to avoid first-call jitter. The Spring documentation explains that `spring.cloud.loadbalancer.eager-load.clients` can be used to configure which service IDs should be loaded in advance. ([Home][7])

```yaml
spring:
  cloud:
    loadbalancer:
      eager-load:
        clients:
          - order-service
          - payment-service
```

### 6.8 Observability Must Cover the Selection Process Itself

After client-side load balancing is rolled out, it is not enough to observe only total service QPS. At a minimum, the following signals should be visible:

```text
1. request count per endpoint
2. active requests per endpoint
3. p95 / p99 latency per endpoint
4. error rate per endpoint
5. endpoint ejection count
6. retry count and retry success rate
7. circuit-breaker overflow count
8. load-balancing policy distribution
9. locality / zone hit ratio
10. endpoint list freshness
```

Without these metrics, it is hard to diagnose traffic skew or policy mistakes once client-side load balancing starts behaving badly.

---

## 7. Recommended Rollout Steps

### Step 1: Distinguish Traffic Types

```text
External user → system: gateway load balancing
Service A → Service B: client-side load balancing or sidecar load balancing
Cross-cluster / cross-region: global traffic scheduling + local client-side load balancing
```

### Step 2: Choose the Implementation Style

```text
Multi-language microservices: Istio / Envoy sidecar
gRPC-heavy systems: gRPC round_robin / xDS / Envoy
Java Spring-heavy systems: Spring Cloud LoadBalancer
Simple Kubernetes-native systems: Service + EndpointSlice + client-side service discovery
```

### Step 3: Choose the Default Algorithm

```text
Production default: LEAST_REQUEST / P2C
Conservative baseline: Weighted Round Robin
Session affinity: Consistent Hash
Cache services: Ring Hash / Maglev
Heterogeneous capacity: Weighted / Adaptive Weighted
```

### Step 4: Configure Fault Governance

```text
1. timeout
2. retry budget
3. circuit breaker
4. passive outlier detection
5. active health check
6. slow start / warmup
7. connection draining
```

### Step 5: Migrate Gradually

```text
1. Enable client-side load balancing on low-risk services first.
2. Compare latency, error rate, and retry rate between the gateway path and the direct client path.
3. Shift a small percentage of traffic first.
4. Observe whether endpoint distribution is even.
5. Gradually replace internal gateway relay calls.
6. Keep the entry gateway. Do not remove north-south governance.
```

---

## 8. Conclusion

The current best practice for client-side load balancing can be summarized in one sentence:

**Use gateways for entry traffic and client-side load balancing for internal calls. At the algorithm level, use Round Robin / Weighted Round Robin as the industry baseline, Least Request / P2C as the preferred default for modern microservices, and Consistent Hash for state-affinity scenarios.**

For modern microservice systems, continuing to route all internal calls through a centralized gateway is architectural regression. The correct approach is to move the load-balancing decision down to the client or sidecar, letting each caller make faster, closer, and more fine-grained decisions based on service discovery, health state, connection pools, circuit breaking, retries, and call context. Gateways still matter, but they should guard the entry boundary rather than dominate all internal traffic.

[1]: https://kubernetes.io/docs/concepts/services-networking/service/ "Service | Kubernetes"
[2]: https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/ "HTTP Load Balancing | NGINX Documentation"
[3]: https://github.com/grpc/grpc/blob/master/doc/load-balancing.md "grpc/doc/load-balancing.md at master · grpc/grpc · GitHub"
[4]: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier "Outlier detection - Envoy documentation"
[5]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html "What is an Application Load Balancer? - Elastic Load Balancing"
[6]: https://grpc.io/docs/guides/custom-load-balancing/ "Custom Load Balancing Policies | gRPC"
[7]: https://docs.spring.io/spring-cloud-commons/reference/spring-cloud-commons/loadbalancer.html "Spring Cloud LoadBalancer :: Spring Cloud Commons"
[8]: https://istio.io/latest/docs/concepts/traffic-management/ "Istio / Traffic Management"
[9]: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking "Circuit breaking - Envoy documentation"
[10]: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/load_balancers "Supported load balancers - Envoy documentation"
[11]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html "Edit target group attributes for your Application Load Balancer - Elastic Load Balancing"
[12]: https://www.haproxy.com/documentation/haproxy-configuration-manual/latest/ "HAProxy Configuration Manual"
[13]: https://istio.io/latest/docs/reference/config/networking/destination-rule/ "Istio / Destination Rule"
[14]: https://www.envoyproxy.io/ "Envoy proxy - home"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/loadbalancer)
