# The Role, Types, and Configurability of Circuit Breaking Rules in Distributed Systems

## Abstract

In microservice and service mesh environments, service calls usually depend on networks, remote services, connection pools, thread pools, database connections, and downstream resources. When remote calls experience timeouts, connection failures, consecutive errors, or increasing response latency, continuous retries and continued traffic admission expand resource consumption and may affect the caller itself as well as unrelated functional modules. The design goal of the circuit breaker pattern is to temporarily prevent subsequent requests from entering an abnormal path when calls are highly likely to fail, allowing the system to fail fast, release resources, form backpressure, and probe downstream recovery under certain conditions. Based on official documentation from Microsoft Azure Architecture Center, Istio, Envoy, and Resilience4j, this article summarizes the background of circuit breaking rules, common rule types, the significance of Istio allowing users to customize circuit breaking rules, reasonable implementation conditions for circuit breaker algorithms, and the relationship between generic rules and custom configuration.

**Keywords:** circuit breaking; microservices; service mesh; Istio; Envoy; Resilience4j; failure isolation; backpressure

## 1. Introduction

Remote calls in distributed systems may fail because of network latency, connection timeouts, temporary service unavailability, slow downstream resources, or local failures. Microsoft Azure Architecture Center notes in its Circuit Breaker Pattern documentation that if an application continuously waits for timeouts or repeatedly calls operations that are likely to fail, the related requests can occupy critical resources such as memory, threads, and database connections, and may cause other unrelated parts of the system to fail as well [1]. In microservice scenarios, Microsoft's .NET microservice architecture documentation further explains that if HTTP retries are executed carelessly when a service fails or responds slowly, multiple clients may repeatedly retry failed requests, creating a risk of exponential traffic growth toward the failed service [2].

The meaning of the circuit breaker pattern is that when the system detects that a remote operation is in a high-failure-probability state, it no longer allows all requests to continue waiting for downstream timeouts, but fails fast at the call entry point. Microsoft Azure Architecture Center describes a circuit breaker as a proxy that monitors the number of recent failures and uses that information to decide whether to continue allowing requests or immediately return an exception [1]. Istio documentation also defines circuit breaking as an important pattern for building resilient microservice applications, limiting the impact of failures, latency spikes, and network anomalies [3]. Envoy documentation explains from a data-plane perspective that circuit breaking is a critical component of distributed systems, and one of its goals is to fail as early as possible and apply backpressure downstream when downstream resources cannot sustain the load [4].

Therefore, circuit breaking is not merely exception handling logic. It is a protection mechanism for distributed call chains. Its core object is not whether a single request succeeds, but whether the call path has shown risk over a period of time that makes continued traffic admission unsafe.

## 2. Background and Purpose of Circuit Breaking Rules

Circuit breaking rules arise from two objective facts. First, failures of remote dependencies can be persistent and may not recover after one retry. Second, caller resources such as threads, connections, memory, and queues are finite. When a caller continues admitting requests while a downstream service is unavailable, the system expands from "downstream failure" into "caller resource exhaustion," eventually forming cascading failures.

Microsoft Azure Architecture Center states that the circuit breaker pattern is used to prevent an application from repeatedly executing operations that are likely to fail, allowing the application to continue running while a failure is being fixed and avoiding wasted CPU cycles while determining whether a failure is persistent [1]. This description shows that circuit breaking mainly has three purposes.

First, circuit breaking enables fast failure. Fast failure means that when the circuit breaker is open, requests no longer enter the downstream call path but fail locally. This reduces resource occupation caused by waiting for timeouts.

Second, circuit breaking provides failure isolation. Failure isolation does not mean eliminating failures. It limits the failure impact range. Microsoft documentation notes that the circuit breaker pattern can provide stability while a system recovers from failure, and can maintain system response time by quickly rejecting requests that are likely to fail [1].

Third, circuit breaking supports recovery probing. A circuit breaker does not permanently close access to the downstream service. The classic circuit breaker state machine includes three states: Closed, Open, and Half-Open. After an Open state waits for a configured duration, it enters Half-Open state and allows a limited number of requests to probe whether the backend has recovered. If probe results satisfy the threshold condition, it returns to Closed; otherwise, it re-enters Open [1][5].

## 3. Common Types of Circuit Breaking Rules

Although circuit breaking rules use different configuration names in different frameworks, official documentation shows that common rules can be grouped into resource-limit rules, consecutive-error rules, error-ratio rules, slow-call rules, exception-classification rules, instance-ejection rules, half-open probing rules, and retry-protection rules.

### 3.1 Resource-Limit Rules

Resource-limit rules restrict the number of connections, queued requests, concurrent requests, retry requests, or connection pools that callers establish toward upstream or downstream services. Envoy documentation lists multiple distributed circuit breaking limits, including maximum connections, maximum pending requests, maximum requests, maximum active retries, and maximum concurrent connection pools [4]. These rules are not essentially based on error rate to decide whether a path is abnormal. They decide whether to continue accepting requests based on whether resources have reached an upper bound.

Istio DestinationRule supports connection-pool-related configuration through `connectionPool`. For example, Istio official examples can configure TCP maximum connections, HTTP/2 maximum requests, and maximum requests per connection [6]. These rules are usually used to limit instantaneous concurrency, connection expansion, and queue accumulation.

### 3.2 Consecutive-Error Rules

Consecutive-error rules use consecutive failure counts as trigger conditions. Istio DestinationRule `outlierDetection` documentation states that the circuit breaking implementation tracks the status of each host in an upstream service. For HTTP services, hosts that continuously return 5xx errors are ejected from the connection pool for a predefined time. For TCP services, connection timeouts or connection failures are counted as consecutive error metrics [6].

The advantage of consecutive-error rules is that they are straightforward to implement and suitable for identifying instances that become continuously unavailable in a short period of time. Their target is usually a single instance or host, rather than the global failure rate of an entire service.

### 3.3 Error-Ratio Rules

Error-ratio rules make decisions based on failure rate in a sliding window. Resilience4j documentation states that when the failure rate is equal to or higher than the configured threshold, CircuitBreaker transitions from Closed to Open and starts short-circuiting calls [5]. At the same time, failure rate is calculated only after the minimum number of calls is reached. If the minimum number of calls is 10, the circuit breaker will not open before 10 calls have been recorded, even if all of them fail [5].

This rule avoids misjudgment caused by small samples. For low-traffic APIs, the minimum call count is a necessary parameter. For high-traffic APIs, sliding window size and statistical period determine how sensitive the circuit breaker is to failure changes.

### 3.4 Slow-Call Rules

Slow-call rules focus not only on failures, but also on response time. Resilience4j documentation states that when the percentage of slow calls is equal to or higher than the configured threshold, the circuit breaker also transitions from Closed to Open. Slow calls are defined by `slowCallDurationThreshold`; calls longer than this threshold are counted as slow calls [5].

The existence of slow-call rules shows that circuit breaking does not only handle explicit errors. Even if a call eventually succeeds, if it consistently exceeds the system's acceptable duration, it will occupy threads, connections, and queue resources. Therefore, using slow-call ratio for protection before downstream services become completely unavailable is an important part of circuit breaking rules.

### 3.5 Exception-Classification Rules

Exception-classification rules define which exceptions should count as failures and which exceptions should be ignored. Resilience4j documentation states that by default all exceptions are counted as failures, but users can define exception lists that should be recorded as failures, and exception lists that should be ignored so they count as neither success nor failure [5].

This rule reflects the distinction between business semantics and technical failures. For example, connection timeouts, connection refused errors, and HTTP 5xx responses are usually closer to system failures, while certain 4xx responses or business validation exceptions may not mean the downstream service is unavailable. Without distinguishing exception types, a circuit breaker may misjudge normal business rejection as a system failure.

### 3.6 Instance-Ejection Rules

Instance-ejection rules are common in service meshes and load-balancing layers. Envoy documentation describes Outlier Detection as a passive health checking mechanism that dynamically determines whether some hosts in an upstream cluster behave abnormally and removes them from the healthy load-balancing set [7]. Abnormal behavior can include consecutive failures, success rate within a time window, and latency within a time window [7].

Istio `outlierDetection` is implemented based on Envoy capabilities. It tracks the status of each upstream host and performs temporary ejection [6]. The focus of this type of rule is not blocking access to the entire service, but removing abnormal instances from the selectable instance set so traffic does not continue hitting abnormal nodes.

### 3.7 Half-Open Probing Rules

Half-open probing rules determine how a circuit breaker recovers after the Open state. In the state machine described by Microsoft Azure Architecture Center, the Open state enters Half-Open after a timeout timer. The Half-Open state allows a limited number of requests to pass through to verify whether the failure has been resolved [1]. Resilience4j also provides configurations such as `permittedNumberOfCallsInHalfOpenState` and `waitDurationInOpenState`, which control the number of probing requests allowed in Half-Open and the waiting duration from Open to Half-Open [5].

Half-open probing rules prevent a circuit breaker from restoring full traffic all at once while downstream has not yet recovered, and also avoid keeping downstream access closed for too long after it has recovered.

### 3.8 Retry-Protection Rules

Retry-protection rules limit amplification caused by retries themselves. Envoy documentation lists maximum active retries and notes that retry budgets are usually recommended. If static retry circuit breaking is used, retries should be aggressively limited to allow retries for occasional failures while preventing total retry volume from exploding and causing large-scale cascading failures [4]. Microsoft's .NET microservice documentation also notes that the Retry Pattern and Circuit Breaker Pattern have different purposes: retry is used when the operation is expected to eventually succeed, while circuit breaking is used to prevent operations that are likely to fail from continuing [2].

Therefore, retries and circuit breaking should be configured together. Retries without circuit breaking protection can amplify failures. Retries without retry budget limits can make failed services bear even higher pressure.

## 4. The Significance of Istio Allowing Users to Customize Circuit Breaking Rules

Istio abstracts circuit breaking rules into DestinationRule and declares destination service traffic policies through fields such as `connectionPool` and `outlierDetection` [3][6]. Istio documentation states that DestinationRule can set default traffic policies at the service level and can also set specific policies for subsets. In addition, traffic policies can be customized for specific ports [8]. This shows that Istio's design goal is not to provide immutable uniform circuit breaking parameters, but to allow different services, versions, ports, and traffic subsets to have differentiated policies.

This design has clear engineering significance.

First, service capacities differ. Different services have different maximum connections, maximum concurrent requests, queue capacity, and response time distributions. Envoy documentation states that every circuit breaking limit is configurable and tracked by upstream cluster and priority, allowing different components in a distributed system to be tuned independently and have different limits [4]. Therefore, fixing circuit breaking thresholds as global constants does not match service capacity differences.

Second, protocol semantics differ. HTTP services can judge abnormality based on 5xx responses, slow calls, and request concurrency. TCP services rely more on connection timeouts or connection failures. Istio DestinationRule documentation explicitly distinguishes error metrics for HTTP and TCP services [6]. Therefore, circuit breaking rules need to be configured according to protocol type.

Third, deployment versions differ. Istio subsets can be used for A/B testing or routing to specific versions of a service, and subset-level policies can override service-level traffic policies [8]. This means different versions of the same service can use different circuit breaking parameters. For example, a new version in gray release can use more conservative connection counts, concurrency limits, or abnormal-instance ejection rules.

Fourth, ports have different responsibilities. A service may expose ordinary HTTP APIs, management ports, gRPC APIs, or internal communication ports at the same time. Istio documentation states that traffic policies can be customized for specific ports [8]. Different ports have different call models, latency distributions, and error meanings, so port-level configuration has practical necessity.

Fifth, rule change location differs. Envoy documentation notes that one major benefit of an Envoy mesh is enforcing circuit breaking limits at the network layer without requiring each application to independently code and configure them [4]. After Istio makes these capabilities declarative, users can control data-plane behavior through configuration objects instead of writing all circuit breaking logic into business code. This reduces coupling between policy changes and application releases.

## 5. Reasonable Conditions for Circuit Breaker Algorithm Implementation

Official documentation shows that circuit breaker algorithms cannot be defined as uniquely optimal without considering failure type, call traffic, resource model, and recovery strategy. A reasonable circuit breaker implementation should satisfy at least the following conditions.

First, the algorithm needs a clear state machine. Microsoft Azure Architecture Center and Resilience4j documentation both use Closed, Open, and Half-Open as the core states. Closed allows requests through and records results; Open rejects requests; Half-Open allows limited requests to probe recovery [1][5]. The state machine is the foundation for explainable and observable circuit breaker behavior.

Second, the algorithm needs sliding-window-based statistics. Resilience4j documentation states that CircuitBreaker uses a sliding window to store and aggregate call results, and supports count-based and time-based sliding windows [5]. A count-based window aggregates the most recent N calls, while a time-based window aggregates calls over the most recent N seconds. The two window types fit different traffic shapes: when request volume is stable, a count-based window reflects recent call results; when request volume fluctuates, a time-based window reflects service status over a recent time period.

Third, the algorithm needs a minimum sample count. Resilience4j documentation clearly states that failure rate and slow-call rate are not calculated before the minimum number of calls is reached [5]. This rule avoids triggering circuit breaking due to accidental failures under low sample counts.

Fourth, the algorithm needs to consider both failure rate and slow-call rate. Failure rate represents explicit errors, while slow-call rate represents performance degradation. Resilience4j documentation uses both as trigger conditions for the Open state [5]. This shows that a reasonable algorithm should not only treat exceptions as failure signals, but should also treat sustained latency increase as a risk signal.

Fifth, the algorithm needs low-overhead statistics. Resilience4j documentation states that its count-based sliding window uses a circular array and updates total aggregation through Subtract-on-Evict. Reading a snapshot has O(1) time complexity because the snapshot is pre-aggregated and independent of window size [5]. Its time-based sliding window also uses partial aggregation buckets and total aggregation to implement O(1) snapshot reads [5]. For high-concurrency services, the circuit breaker itself should not become a significant performance bottleneck.

Sixth, the algorithm needs to distinguish circuit breaking from concurrency isolation. Resilience4j documentation explains that sliding window size does not mean only a fixed number of calls are allowed to execute concurrently. If concurrent threads need to be limited, Bulkhead should be used, and Bulkhead can be combined with CircuitBreaker [5]. Therefore, failure-rate circuit breaking, slow-call circuit breaking, connection pool limits, and bulkhead isolation belong to different protection dimensions and should not be confused.

Seventh, the algorithm needs recovery probing. The Open state cannot reject requests forever. The Half-Open state needs limited traffic admission to verify downstream recovery. If the probe failure rate or slow-call rate still exceeds the threshold, the circuit breaker re-enters Open. If it is below the threshold, it returns to Closed [5].

Therefore, the so-called "best circuit breaker algorithm" should not be understood as one fixed threshold or one fixed formula. It should be understood as an implementation model with a clear state machine, reasonable statistical windows, explicit sample gates, complete failure signals, controllable resource overhead, limited recovery probing, and coordination with connection pool limits and retry budgets.

## 6. Relationship Between Generic Circuit Breaking Rules and Custom Configuration

Circuit breaking rules have high generality because similar structures repeatedly appear across frameworks: failure thresholds, slow-call thresholds, consecutive-error thresholds, Open wait duration, Half-Open probe count, maximum connections, maximum concurrent requests, maximum retries, and exception classification. These rules correspond to common risks in distributed calls: failure propagation, latency accumulation, resource exhaustion, retry amplification, and abnormal instances continuously receiving traffic.

However, generality only means that rule types are reusable. It does not mean that rule parameters can be reused across services. The value of custom configuration is mapping generic rules to concrete system boundaries.

The same failure-rate threshold has different meanings for different services. Low-traffic services may misjudge due to insufficient samples, while high-traffic services may need shorter windows to reflect failures quickly. Resilience4j configurations for minimum call count, sliding window type, and window size are designed to solve differences in statistical conditions [5].

The same connection threshold has different meanings for different downstreams. Database downstreams, cache downstreams, ordinary HTTP services, and long-connection services have different tolerance for connection counts, concurrency, and queued requests. Envoy models connections, pending requests, requests, and retries as different circuit breaking limits [4], showing that resource dimensions cannot be replaced by a single failure-rate rule.

The same exception can also have different meanings in different businesses. Resilience4j supports configuring recorded exceptions and ignored exceptions, showing that whether an exception should count as a failure depends on exception semantics [5]. For example, business validation failures and connection timeouts should not always be handled in the same way.

Different versions of the same service may also need different strategies. Istio subset-level policy override mechanisms allow different versions to have different traffic policies [8]. During gray release, A/B testing, or version migration, custom circuit breaking parameters can limit the impact of new-version abnormalities on overall traffic.

Therefore, the value of custom circuit breaking rules is not denying the generality of circuit breaking rules. It is acknowledging that generic rules must be applied to specific service capacity, protocol type, call semantics, version stage, and recovery goals. Generic rules provide the framework; custom parameters provide the boundaries.

## 7. Conclusion

Circuit breaking rules are foundational mechanisms in distributed systems for limiting failure propagation, reducing resource exhaustion, avoiding retry amplification, and supporting controlled recovery. Their background comes from the uncertainty of remote calls and the finite resources of callers. Common circuit breaking rules include resource limits, consecutive errors, failure rate, slow-call rate, exception classification, instance ejection, half-open probing, and retry protection. Istio makes circuit breaking capabilities declarative through DestinationRule and allows customization at the service, subset, and port dimensions. Envoy enforces data-plane limits on connections, requests, retries, and connection pools. Resilience4j demonstrates an application-side implementation centered on a finite state machine, sliding windows, minimum sample count, failure rate, slow-call rate, and half-open probing.

The implementations described in official documentation show that circuit breaker algorithms do not have a single optimal parameter independent of context. A reasonable implementation should have a clear state machine, low-overhead sliding windows, minimum sample gates, dual metrics for failures and slow calls, controlled half-open probing, and coordination with resource limits, retry budgets, and instance-ejection mechanisms. The generality of circuit breaking rules lies in rule types, while the meaning of custom configuration lies in matching concrete parameters to concrete service runtime boundaries.

## References

[1] Microsoft Azure Architecture Center. Circuit Breaker Pattern.
[2] Microsoft Learn. Implement the Circuit Breaker pattern in .NET microservices.
[3] Istio Documentation. Circuit Breaking.
[4] Envoy Documentation. Circuit breaking.
[5] Resilience4j Documentation. CircuitBreaker.
[6] Istio Documentation. DestinationRule: connectionPool and outlierDetection.
[7] Envoy Documentation. Outlier detection.
[8] Istio Documentation. Traffic Management and DestinationRule traffic policies.
