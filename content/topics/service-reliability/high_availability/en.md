## Abstract

In software system design, high concurrency, high performance, and high availability are often treated as core goals at the same time. These goals reinforce each other in some areas, but they also constrain each other. When optimizing for high concurrency or high performance, some systems pay too much attention to local metrics such as a single API's response time, a single service's throughput, a single call's success rate, or resource utilization. They then overlook fault isolation, timeout control, capacity boundaries, degradation strategies, and recovery capability. This kind of design can perform well under normal traffic, but during dependency jitter, cache expiration, traffic spikes, release changes, or downstream failures, it can easily cause request accumulation, retry amplification, resource exhaustion, and cascading failures.

This article analyzes common engineering mistakes in development, explains how local performance optimization affects global availability, and summarizes corresponding governance principles and checklists.

---

## 1. Problem Background

"Three-high" design usually means:

```text
High concurrency: the system keeps processing ability when many requests arrive at the same time.
High performance: the system completes business processing with lower latency and higher throughput.
High availability: the system continues to provide service during failures, jitter, releases, scaling, and similar scenarios.
```

In real engineering, the three goals do not always improve in the same direction. Some local optimizations improve short-term performance metrics while increasing system risk. For example:

```text
Expanding a thread pool can temporarily improve concurrent intake, but may increase request backlog and failure recovery time.
Extending timeout values can improve the success probability of a single call, but may occupy resources for a long time.
Adding a cache can reduce database pressure, but cache expiration may cause concentrated fallback to the database.
Adding retries can reduce occasional failures, but may amplify downstream traffic.
```

Therefore, three-high design cannot focus only on "faster" and "more." It must also ask:

```text
Can failures be isolated?
Can traffic be controlled?
Are resources bounded?
Can failures recover?
Are exceptions observable?
Can the system degrade gracefully?
```

---

## 2. Typical Mistake 1: Expanding Thread Pools Without Boundaries

### 2.1 Symptom

When an API becomes slower or concurrency capacity is insufficient, developers may directly expand thread-pool parameters:

```java
new ThreadPoolExecutor(
    500,
    1000,
    60,
    TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(100000)
);
```

This approach may improve a service's ability to accept requests in the short term, but it also increases request queuing, context switching, and memory consumption.

### 2.2 Risk Process

A typical failure chain is:

```text
Downstream service slows down
  ↓
Business thread pool starts queuing
  ↓
Upstream request waiting time increases
  ↓
Gateway or client triggers timeout retries
  ↓
Request volume is amplified
  ↓
Thread-pool queue continues to grow
  ↓
CPU, memory, and GC pressure rise
  ↓
Service instance health check fails
  ↓
Traffic shifts to remaining instances
  ↓
Overall cluster pressure continues to rise
```

### 2.3 Essence

A thread pool is not only a tool for improving concurrent processing capacity. It is also a boundary-control mechanism for system resources. Oversized thread pools and overly long queues hide downstream failures, delay failure exposure, and increase recovery time.

### 2.4 Governance

Thread-pool design should include the following constraints:

```text
Isolate thread pools by business scenario.
Isolate thread pools by downstream dependency.
Limit maximum thread count.
Limit queue length.
Set a rejection policy.
Monitor queue length, active thread count, rejection count, and task waiting time.
```

Example:

```java
new ThreadPoolExecutor(
    32,
    64,
    60,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

---

## 3. Typical Mistake 2: Extending Timeout Values to Improve Success Rate

### 3.1 Symptom

When remote calls fail, a common response is to extend timeout values:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .connectTimeout(Duration.ofSeconds(30))
    .readTimeout(Duration.ofSeconds(60))
    .writeTimeout(Duration.ofSeconds(60))
    .build();
```

This may reduce the short-term failure rate, but it also increases the time for which threads, connections, and memory are occupied.

### 3.2 Risk Process

```text
Downstream service slows down
  ↓
Upstream requests wait for a long time
  ↓
Business threads cannot be released
  ↓
Connection-pool resources are occupied
  ↓
New requests cannot be processed in time
  ↓
Queues accumulate
  ↓
Upstream continues retrying
  ↓
The service enters a chronically unavailable state
```

### 3.3 Essence

Timeout is not merely a failure-control parameter. It is a resource-protection mechanism. Excessively long timeouts reduce the system's ability to fail fast and recover quickly.

### 3.4 Governance

Remote calls should define a complete timeout budget:

```text
Connection timeout
Read timeout
Write timeout
Overall call timeout
Business request total timeout
```

Example:

```java
OkHttpClient client = new OkHttpClient.Builder()
    .connectTimeout(Duration.ofMillis(200))
    .readTimeout(Duration.ofMillis(800))
    .writeTimeout(Duration.ofMillis(300))
    .callTimeout(Duration.ofMillis(1000))
    .build();
```

This should be combined with:

```text
Circuit breaking
Rate limiting
Degradation
Retry budget
Dependency isolation
```

---

## 4. Typical Mistake 3: Retrying Without a Budget

### 4.1 Symptom

To reduce occasional failures, a system may retry immediately after a remote call fails:

```java
for (int i = 0; i < 3; i++) {
    try {
        return remoteClient.call(request);
    } catch (Exception e) {
        // Retry immediately
    }
}
```

### 4.2 Risk Process

If the original upstream traffic is 10,000 QPS and each request can retry up to three times, the downstream's maximum traffic may become:

```text
10,000 QPS × 3 = 30,000 QPS
```

If multiple layers in a call chain all retry, the request volume may be amplified further:

```text
A -> B -> C -> D

Each layer retries 3 times
The final amplification factor may reach 3 × 3 × 3 = 27 times
```

### 4.3 Essence

Retries can improve the success probability during occasional failures. But when the downstream is already abnormal, retries increase downstream pressure and may accelerate failure propagation.

### 4.4 Governance

Retries should satisfy the following conditions:

```text
Retry only idempotent requests.
Limit maximum retry count.
Use exponential backoff.
Add random jitter.
Set a retry budget.
Respect the request's total timeout.
Forbid unordered retries across multiple layers.
```

Example:

```java
public Response callWithRetry(Request request) {
    long deadline = System.currentTimeMillis() + 1000;
    int maxRetries = request.isIdempotent() ? 1 : 0;

    for (int attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return remoteClient.call(request, remainingTime(deadline));
        } catch (TimeoutException e) {
            if (attempt == maxRetries || remainingTime(deadline) <= 0) {
                throw e;
            }

            sleepWithJitter(50, 150);
        }
    }

    throw new IllegalStateException("unreachable");
}
```

---

## 5. Typical Mistake 4: Introducing Caches Without Protection

### 5.1 Symptom

When database queries are slow, a common optimization is to add Redis or local cache:

```java
public User getUser(Long userId) {
    User user = redis.get("user:" + userId);
    if (user != null) {
        return user;
    }

    user = userMapper.selectById(userId);
    redis.set("user:" + userId, user, 10, TimeUnit.MINUTES);
    return user;
}
```

This design can reduce database access frequency, but it lacks cache-miss protection.

### 5.2 Risk Scenarios

| Scenario | Consequence |
| --- | --- |
| Hot key expires | Many requests fall back to the database at the same time |
| Many keys expire together | Cache avalanche |
| Empty data is not cached | Cache penetration |
| No mutex rebuild | Cache breakdown |
| Redis fails | Requests go directly to the database |

### 5.3 Essence

A cache is not only a performance optimization component. It is also a database-protection layer. Without fallback protection, a cache can transfer concentrated traffic to the database during expiration or failure.

### 5.4 Governance

Cache design should include:

```text
Null-value caching
Randomized TTL
Hot-key prewarming
Mutex rebuild
Logical expiration
Local-cache fallback
Database rate limiting
Return old values during degradation
```

Example:

```java
public User getUser(Long userId) {
    String key = "user:" + userId;

    User cached = localCache.getIfPresent(key);
    if (cached != null) {
        return cached;
    }

    User redisValue = redis.get(key);
    if (redisValue != null) {
        localCache.put(key, redisValue);
        return redisValue;
    }

    if (redis.exists("empty:" + key)) {
        return null;
    }

    boolean locked = redis.tryLock("lock:" + key, 3, TimeUnit.SECONDS);
    if (!locked) {
        return fallbackUser(userId);
    }

    try {
        User user = userMapper.selectById(userId);
        if (user == null) {
            redis.set("empty:" + key, "1", randomTtl(30, 60), TimeUnit.SECONDS);
            return null;
        }

        redis.set(key, user, randomTtl(600, 900), TimeUnit.SECONDS);
        localCache.put(key, user);
        return user;
    } finally {
        redis.unlock("lock:" + key);
    }
}
```

---

## 6. Typical Mistake 5: Oversizing Database Connection Pools

### 6.1 Symptom

When database access is slow or concurrency is insufficient, a system may directly enlarge the connection pool:

```properties
spring.datasource.hikari.maximum-pool-size=200
spring.datasource.hikari.connection-timeout=30000
```

If the service has 20 deployed instances, the theoretical maximum connection count is:

```text
200 × 20 = 4000
```

### 6.2 Risk Process

```text
Application connection pool expands
  ↓
Database concurrent connection count rises
  ↓
Database CPU, memory, and lock contention increase
  ↓
SQL responses become slower
  ↓
Connection occupancy time becomes longer
  ↓
Application requests keep waiting
  ↓
The database becomes a global bottleneck
```

### 6.3 Essence

A database connection pool is not a simple performance accelerator. It is a control boundary for database access pressure. An oversized pool transfers application-layer concurrency pressure to the database.

### 6.4 Governance

Connection-pool design should consider database capacity, instance count, and SQL latency:

```properties
spring.datasource.hikari.maximum-pool-size=30
spring.datasource.hikari.minimum-idle=10
spring.datasource.hikari.connection-timeout=300
spring.datasource.hikari.validation-timeout=200
spring.datasource.hikari.max-lifetime=1800000
```

It should also be combined with:

```text
Slow SQL monitoring
SQL execution timeout
Read/write splitting
Isolation between core and non-core queries
Batch throttling
Database access rate limiting
```

---

## 7. Typical Mistake 6: Super-Aggregation APIs Introduce Weak-Dependency Failures

### 7.1 Symptom

To reduce the number of remote calls, a system may design an aggregation API:

```text
GET /user/home
```

The API internally calls multiple services:

```text
User service
Follow service
Recommendation service
Advertising service
Membership service
Campaign service
Risk-control service
```

### 7.2 Risk Process

```text
Aggregation API dependency count increases
  ↓
Any weak dependency slows down
  ↓
Overall API response time rises
  ↓
Thread resources are occupied for longer
  ↓
Core page API times out
  ↓
User core path is affected
```

### 7.3 Essence

Reducing network calls does not necessarily improve global availability. If an aggregation API lacks strong/weak dependency classification, non-core dependencies can affect the core path.

### 7.4 Governance

Aggregation APIs should classify dependency levels:

| Dependency Type | Handling |
| --- | --- |
| Strong dependency | The API may fail if it fails |
| Weak dependency | Degrade when it fails |
| Optional dependency | Return a default value after timeout |
| High-risk dependency | Use an independent thread pool or bulkhead |

Example:

```java
UserProfile profile = userService.getProfile(userId);

CompletableFuture<Stats> statsFuture = async(() -> statsService.getStats(userId));
CompletableFuture<Recommend> recommendFuture = async(() -> recommendService.getRecommend(userId));
CompletableFuture<Ad> adFuture = async(() -> adService.getAd(userId));

return HomePage.builder()
    .profile(profile)
    .stats(getOrDefault(statsFuture, Stats.empty(), 100))
    .recommend(getOrDefault(recommendFuture, Recommend.empty(), 80))
    .ad(getOrDefault(adFuture, Ad.empty(), 50))
    .build();
```

---

## 8. Typical Mistake 7: Misusing Asynchronous Thread Pools

### 8.1 Symptom

To shorten API response time, some logic is directly submitted to an async thread pool:

```java
CompletableFuture.runAsync(() -> {
    sendMessage(order);
    updatePoints(order);
    notifyUser(order);
});
```

The API response time decreases, but the reliability of async tasks may be insufficient.

### 8.2 Risk Scenarios

| Problem | Consequence |
| --- | --- |
| Async task fails | Business result is incomplete |
| Thread-pool queue is full | Task is rejected |
| Process restarts | In-memory task is lost |
| No idempotency | Retry causes duplicate processing |
| No monitoring | Failure is invisible |

### 8.3 Essence

Asynchronization can shorten the main-path response time, but it cannot replace a reliable messaging mechanism. Async tasks that affect business results must be persistable, retryable, and traceable.

### 8.4 Governance

Different tasks should use different mechanisms:

| Task Type | Recommended Approach |
| --- | --- |
| Discardable task | Local thread pool |
| Task requiring eventual consistency | MQ |
| Task bound to local transaction | Outbox / transactional message |
| Scheduled compensation task | Job + idempotent processing |

Reliable async path example:

```text
Write order to database
  ↓
Write outbox_event table
  ↓
Background task delivers to MQ
  ↓
Consumer processes
  ↓
Idempotency check
  ↓
Failure retry or dead-letter queue
```

---

## 9. Typical Mistake 8: Reading Replicas Directly to Improve Read Performance

### 9.1 Symptom

Read/write splitting can reduce primary database pressure. But if all read requests are routed directly to replicas, stale data may be read.

```text
Write to primary succeeds
  ↓
Immediately query data
  ↓
Request is routed to replica
  ↓
Primary-replica replication has lag
  ↓
Old data is returned
```

### 9.2 High-Risk Scenarios

```text
Payment status
Order status
Permission changes
Inventory deduction
Coupon claiming
Risk-control results
```

### 9.3 Essence

Read/write splitting is not a simple SQL routing strategy. It is a consistency strategy. Different business scenarios have different consistency requirements.

### 9.4 Governance

```text
Read from primary after write.
Route critical reads to primary.
Remove replicas when lag exceeds a threshold.
Read from replicas only when eventual consistency is acceptable.
Use data version to decide whether a replica can be read.
```

Example:

```java
public Order getOrderAfterWrite(Long orderId, boolean justWritten) {
    if (justWritten) {
        return orderMasterRepository.findById(orderId);
    }

    if (replicaLagMonitor.lagMillis() > 500) {
        return orderMasterRepository.findById(orderId);
    }

    return orderReplicaRepository.findById(orderId);
}
```

---

## 10. Typical Mistake 9: Oversized Batches Increase Failure Cost

### 10.1 Symptom

To improve throughput, consumers or batch jobs may process a large amount of data at once:

```java
List<Event> events = queue.poll(10000);
eventRepository.batchInsert(events);
```

### 10.2 Risk Scenarios

| Problem | Consequence |
| --- | --- |
| Single batch takes too long | Consumption latency increases |
| Rollback scope is large | Retry cost increases |
| Memory usage increases | OOM risk increases |
| Database locks are held longer | Other requests are affected |
| Hotspot writes concentrate | Database jitter |

### 10.3 Essence

Batch processing optimizes throughput, but it affects latency, memory, lock contention, and failure recovery cost.

### 10.4 Governance

Batch processing should be constrained by both count and time window:

```java
List<Event> batch = new ArrayList<>();
long deadline = System.currentTimeMillis() + 100;

while (batch.size() < 500 && System.currentTimeMillis() < deadline) {
    Event event = queue.poll(10, TimeUnit.MILLISECONDS);
    if (event == null) {
        break;
    }
    batch.add(event);
}

eventRepository.batchInsert(batch);
```

Metrics to monitor:

```text
Single-batch size
Single-batch duration
Consumption latency
Failure count
Retry count
Backlog
```

---

## 11. Typical Mistake 10: Local Caches Lack Consistency Mechanisms

### 11.1 Symptom

To reduce remote read overhead, a system may cache rules, permissions, or configuration in local memory.

```text
Instance A cache version v1
Instance B cache version v2
Instance C update failed and remains v1
```

### 11.2 Risk Scenarios

| Cached Object | Risk |
| --- | --- |
| Permission rules | Unauthorized access or false rejection |
| Rate-limit rules | Rules do not take effect on some instances |
| Routing rules | Traffic enters the wrong node |
| Canary rules | Canary ratio becomes abnormal |
| Blocklist | Risk control is bypassed |
| Price configuration | Wrong amount |

### 11.3 Essence

Local cache improves single-instance access performance, but a multi-instance environment must handle consistency and invalidation propagation.

### 11.4 Governance

Governance rules, rate-limit rules, routing rules, and similar configuration data should have:

```text
Version
Active push
Local snapshot
TTL fallback
Change audit
Failure rollback
Instance-level load-state observability
```

Example:

```java
public Rule getRule(String ruleId) {
    Rule rule = localCache.getIfPresent(ruleId);
    long currentVersion = versionService.currentVersion(ruleId);

    if (rule != null && rule.getVersion() >= currentVersion) {
        return rule;
    }

    Rule latest = ruleRepository.findById(ruleId);
    localCache.put(ruleId, latest);
    return latest;
}
```

---

## 12. Typical Mistake 11: Missing Rate Limiting Causes Full-Path Avalanche

### 12.1 Symptom

When pursuing maximum throughput, a system may omit entry rate limiting, API rate limiting, or resource rate limiting.

### 12.2 Risk Process

```text
Burst traffic enters the system
  ↓
Application threads are saturated
  ↓
Database connection pool is saturated
  ↓
Redis, MQ, and DB are all under pressure
  ↓
Request response time rises
  ↓
Upstream triggers retries
  ↓
System pressure is further amplified
  ↓
Health checks fail
  ↓
Instances are removed
  ↓
Remaining instances continue under pressure
```

### 12.3 Essence

Rate limiting is not simply reducing request volume. It protects core paths and key resources when traffic exceeds system capacity.

### 12.4 Governance

Rate limiting should be implemented in layers:

```text
Gateway rate limiting
Service rate limiting
API rate limiting
User-level rate limiting
Tenant-level rate limiting
Resource-level rate limiting
Downstream-dependency rate limiting
```

Example:

```yaml
rules:
  - resource: /api/orders/create
    qps: 500
    burst: 100
    fallback: "QUEUE_OR_REJECT"

  - resource: /api/users/profile
    qps: 3000
    burst: 500
    fallback: "CACHE_OR_DEFAULT"
```

---

## 13. Typical Mistake 12: Only Watching Average Response Time

### 13.1 Symptom

Load-test reports often show only average response time:

```text
Average RT = 20ms
```

But the average cannot reflect tail latency.

### 13.2 Example

| Metric | Value |
| --- | --- |
| Average RT | 20ms |
| P95 | 80ms |
| P99 | 2s |
| P999 | 8s |

In this case, many requests are still fast, but tail requests occupy threads and connections for a long time.

### 13.3 Essence

High-availability systems must care about tail latency. High tail latency causes request accumulation, timeout retries, and resource exhaustion.

### 13.4 Governance

Performance evaluation should include:

```text
Average RT
P50
P95
P99
P999
Maximum duration
Error rate
Timeout rate
Queue waiting time
Downstream call duration
```

---

## 14. Typical Mistake 13: Full Release Without Canary or Rollback

### 14.1 Symptom

To shorten release cycles, a system may use a full release:

```text
Build
  ↓
Full deployment
  ↓
All instances restart
```

### 14.2 Risk Scenarios

| Problem | Consequence |
| --- | --- |
| New-version defect | All traffic is affected |
| Insufficient health checks | Abnormal instances receive traffic |
| Configuration changes at the same time | Diagnosis becomes harder |
| Database schema is incompatible | Rollback is complex |
| No rollback process | Recovery time increases |

### 14.3 Essence

The release process is part of high-availability design. Full release expands the blast radius of failures.

### 14.4 Governance

The release process should include:

```text
Small-traffic canary
Batch release
Health checks
Core-metric observation
Automatic rollback
Separate code and configuration releases
Compatible database-change design
```

Typical flow:

```text
1% canary
  ↓
Observe error rate, P99, CPU, memory, GC, and business metrics
  ↓
10% canary
  ↓
Continue observing
  ↓
50% canary
  ↓
Full release
```

---

## 15. Typical Mistake 14: Mixed Resource Deployment Without Isolation

### 15.1 Symptom

To improve resource utilization, a system may deploy core online business, background tasks, log consumers, and report tasks in the same resource pool.

```text
Core transaction service
Report task
Log consumer task
Message push task
Background export task
```

### 15.2 Risk Process

```text
Report task scans a large amount of data
  ↓
Database CPU rises
  ↓
Core API queries become slower
  ↓
Order API times out
  ↓
User requests fail
```

Or:

```text
Log consumption backlog appears
  ↓
Consumer accelerates catch-up
  ↓
Kafka, ES, and network resources are saturated
  ↓
Core services are affected
```

### 15.3 Essence

Improving resource utilization may reduce fault-isolation capability. If non-core tasks share resources with the core path, they may affect core business during abnormal scenarios.

### 15.4 Governance

Resource isolation can be implemented at these layers:

```text
Separate online business and offline tasks.
Separate core and non-core services.
Separate core databases and analytics databases.
Separate core Redis and cache Redis.
Separate core MQ Topics and log Topics.
Use thread-pool isolation.
Use Kubernetes Namespace / Node Pool isolation.
```

---

## 16. Typical Mistake 15: Missing Idempotency Design

### 16.1 Symptom

To avoid one query or uniqueness check, a write API may have no idempotency protection:

```java
public void issueCoupon(Long userId, Long couponId) {
    couponRepository.insert(userId, couponId);
}
```

### 16.2 Risk Scenarios

```text
Client retry
Gateway retry
RPC retry
MQ redelivery
Server-side timeout but actual execution succeeded
```

These scenarios may cause duplicate coupon issuing, duplicate payment deduction, duplicate points, or duplicate order creation.

### 16.3 Essence

Idempotency is not a performance optimization. It is a basic capability for handling retries, timeouts, and duplicate messages in distributed systems.

### 16.4 Governance

Common approaches include:

```text
Request unique ID
Business unique key
Database unique index
State-machine validation
Deduplication table
Idempotency record table
```

Example:

```java
public void issueCoupon(Long userId, Long couponId, String requestId) {
    boolean inserted = idempotentRepository.tryInsert(requestId);
    if (!inserted) {
        return;
    }

    couponRepository.insert(userId, couponId);
}
```

Database constraint example:

```sql
CREATE UNIQUE INDEX uk_user_coupon ON user_coupon(user_id, coupon_id);
```

---

## 17. Typical Mistake 16: Reducing Observability Data Makes Incidents Untraceable

### 17.1 Symptom

To reduce storage cost, a system may shorten log and metric retention or reduce trace sampling:

```text
Logs retained for only 1 day
Metrics retained for only 3 days
Trace sampling is extremely low
Error logs are not retained separately
```

### 17.2 Risk Process

```text
Production incident occurs
  ↓
Need to trace metrics before and after the incident
  ↓
Metrics have expired
  ↓
Need to query abnormal request traces
  ↓
Sampling did not capture them
  ↓
Need to search error logs
  ↓
Logs have been cleaned
  ↓
Root-cause analysis depends on guesses
```

### 17.3 Essence

Observability is part of high availability. Without logs, metrics, and tracing, fault diagnosis, recovery, and postmortem analysis are affected.

### 17.4 Governance

Observability data should be retained in layers:

| Data Type | Handling |
| --- | --- |
| Error logs | Retain for a longer period |
| Normal info logs | Retain for a shorter period |
| Metrics | High-resolution short-term retention and downsampled long-term retention |
| Trace | Sample normal requests and fully sample error requests |
| Audit logs | Store independently and retain long term |

---

## 18. Typical Mistake 17: Improper Shared-State Handling

### 18.1 Symptom

To improve access speed, a system may directly use local shared state:

```java
private static final Map<String, Integer> COUNTER = new HashMap<>();
```

Even if this is changed to `ConcurrentHashMap`, business operations are not necessarily thread-safe:

```java
Integer count = map.get(userId);
map.put(userId, count + 1);
```

### 18.2 Risk Scenarios

```text
Concurrent writes cause incorrect counts.
Instance restart loses state.
State is inconsistent across instances.
Memory grows continuously and leaks.
Local state cannot scale horizontally.
```

### 18.3 Essence

Local shared state is suitable for temporary, non-critical, discardable data. For critical data such as inventory, balance, rate-limit counters, and permission state, single-machine memory usually cannot be the final source of truth.

### 18.4 Governance

```text
Use atomic operations.
Limit local-state lifecycle.
Set capacity limits.
Externalize critical state.
Maintain multi-instance state through consistency mechanisms.
```

Example:

```java
counterMap.computeIfAbsent(userId, key -> new AtomicInteger())
          .incrementAndGet();
```

---

## 19. Typical Mistake 18: Skipping Security and Parameter Validation for Performance

### 19.1 Symptom

To reduce API latency, a system may reduce parameter validation, permission checks, signature checks, or risk-control checks.

### 19.2 Risk Scenarios

| Skipped Check | Risk |
| --- | --- |
| Parameter validation | Dirty data enters storage |
| Permission check | Unauthorized access |
| Signature check | Illegal requests enter the system |
| Risk-control check | Abnormal traffic bypasses controls |
| State check | Business state becomes inconsistent |

### 19.3 Essence

Correctness and security are prerequisites for stable system operation. Validation cost should be reduced by optimizing implementation, not by removing validation.

### 19.4 Governance

```text
Gateway pre-validation
Local permission cache
Rule precompilation
Batch authorization
Signature algorithm optimization
Hot permission-data cache
Short-TTL risk-control result cache
```

---

## 20. Anti-Pattern Summary

| Anti-Pattern | Surface Benefit | Availability Risk |
| --- | --- | --- |
| Expanding thread pools | Improves concurrent intake | Request accumulation and slower recovery |
| Extending timeouts | Improves single-call success rate | Long resource occupancy |
| Retrying without budget | Reduces occasional failures | Traffic amplification and downstream overload |
| Cache without protection | Reduces database pressure | Avalanche, breakdown, penetration |
| Expanding connection pools | Increases database concurrency | Overwhelms the database |
| Super-aggregation API | Reduces network calls | Weak dependencies drag down the core path |
| Wrong async usage | Shortens API response time | Tasks lost and unrecoverable |
| Direct replica reads | Reduces primary pressure | Reads stale data |
| Oversized batches | Improves throughput | Higher latency and failure cost |
| Local rule cache | Reduces remote access | Multi-instance inconsistency |
| Missing rate limiting | Improves burst intake | Full-path avalanche |
| Only watching average RT | Metrics look good | Tail latency is hidden |
| Full release | Shortens release cycle | Blast radius expands |
| Mixed resource deployment | Improves utilization | Non-core business affects core business |
| Missing idempotency | Reduces validation cost | Retries cause duplicate processing |
| Reducing observability data | Reduces storage cost | Failures cannot be located |
| Improper shared state | Reduces access latency | Concurrency errors and state inconsistency |
| Skipping security checks | Reduces API latency | Security and data risks |

---

## 21. Engineering Checklist for Three-High Design

Before high-concurrency and high-performance optimizations, check the following:

```text
1. Will this optimization increase downstream pressure?
2. Will this optimization expand the blast radius?
3. Are timeout, rate limiting, circuit breaking, and degradation set?
4. Is there a risk of request accumulation or unbounded queue growth?
5. Is there retry amplification risk?
6. Will cache expiration cause concentrated fallback?
7. Does the database connection pool match actual database capacity?
8. Are weak dependencies isolated from the core path?
9. Do async tasks have reliable delivery and failure compensation?
10. Does read/write splitting handle read-after-write consistency?
11. Does batch processing have oversized batch and rollback risk?
12. Does local cache have versioning, invalidation, and fallback?
13. Does rate limiting cover entry, API, user, resource, and downstream levels?
14. Does the load-test report include P95, P99, P999, and error rate?
15. Does the release process support canary, observation, and rollback?
16. Are core and non-core businesses isolated by resources?
17. Do write APIs have idempotency capability?
18. Are logs, metrics, and traces sufficient for incident diagnosis?
19. Can local shared state cause multi-instance inconsistency?
20. Are parameter, permission, and security checks correctly retained?
```

---

## 22. Conclusion

If high-concurrency and high-performance optimizations lack availability constraints, they may improve local metrics while reducing global stability. In engineering practice, performance optimization must be placed inside capacity boundaries, fault isolation, timeout control, rate limiting and degradation, idempotent processing, canary release, and observability systems.

Production-oriented three-high design should be based on these principles:

```text
Resources have limits.
Requests have timeouts.
Retries have budgets.
Failures can degrade.
Faults can be isolated.
Data can recover.
Releases can roll back.
Problems are observable.
```

On this basis, high-concurrency design solves traffic-bearing problems, high-performance design solves processing-efficiency problems, and high-availability design solves continued service during failure scenarios. Local optimization has engineering value only when it does not damage global availability.
