---
title: "Retry Strategy Best Practices in Software Development"
category: "Service Reliability"
summary: "A practical guide to retry boundaries, strategy selection, idempotency, and production rollout across thread pools, message queues, HTTP, and gRPC."
tags:
  - "Retry"
  - "Distributed Systems"
  - "Idempotency"
  - "gRPC"
readingDirection: "Read this when standardizing fault-tolerance policy, handling transient downstream failures, or defining an enterprise-wide retry baseline."
outline: deep
---

# Retry Strategy Best Practices in Software Development

## Overview

A practical guide to retry boundaries, strategy selection, idempotency, and production rollout across thread pools, message queues, HTTP, and gRPC.

## Abstract

Retry is one of the most common and most frequently abused fault-tolerance mechanisms in distributed systems. Its value lies in using a limited number of repeated attempts to mask transient failures such as short-lived network jitter, temporary service unavailability, rate limiting, connection re-establishment, leader or primary failover, and consumer crashes. But retry is not just "try again a few times after failure." Poorly designed retry behavior can cause duplicate writes, duplicate charges, message storms, thread-pool exhaustion, downstream avalanches, and cascading failures. The AWS Builders Library explicitly points out that retries are "selfish": clients spend more server resources through retries to improve their own success rate; when the root cause is overload, retries make overload worse and can slow recovery. ([Amazon Web Services, Inc.][1])

The central conclusion of this article is: **the default production retry policy should be "bounded attempts + per-attempt timeout + exponential backoff + jitter + idempotency protection + retry budget + dead-letter fallback."** Immediate retry should be reserved only for extremely short-lived transient failures, and at most once. High-concurrency distributed systems should not use naked fixed-interval retries. Any operation with side effects, including writes, payments, order creation, coupon issuance, or message publication, must solve idempotency before retry is even discussed.

**Keywords:** retry strategy, transient failure, exponential backoff, jitter, idempotency, thread pool, message queue, HTTP, gRPC, dead-letter queue, retry storm

---

## 1. What Is Retry, Why Retry, and What Happens Without It?

### 1.1 Definition of Retry

Retry means that after an operation fails, the caller, execution framework, messaging middleware, RPC framework, or scheduler issues the same operation again under specific conditions, attempting to make the failed business flow eventually succeed.

The Microsoft Azure Retry Pattern defines it directly: transparently retry a failed operation when connecting to a service or network resource in order to handle transient faults and improve application stability. In cloud environments, transient faults include brief network interruptions, temporary service unavailability, and timeouts caused by a busy service. ([Microsoft Learn][2])

In more operational terms, retry consists of four elements:

| Element | Meaning |
| --- | --- |
| Retryable condition | Which exceptions, error codes, or status codes are allowed to retry |
| Retry boundary | Maximum attempts and maximum total time |
| Retry interval | Immediate retry, fixed interval, increasing interval, exponential backoff, or backoff with jitter |
| Failure destination | After retries are exhausted, should the system fail, degrade, trip a circuit breaker, enter a dead-letter queue, or require manual handling |

**Judgment: any "retry" design without these four elements is not reliability engineering. It is luck-based behavior.**

### 1.2 Why Retry?

The fundamental reason for retry is that many failures in modern software systems are not permanent failures. They are transient failures. The AWS Builders Library notes that systems often fail partially or briefly rather than failing as a whole, and a second attempt can often succeed when the fault is short-lived and random. ([Amazon Web Services, Inc.][1])

Typical transient failures include:

| Scenario | Example |
| --- | --- |
| Network jitter | TCP reset, connection timeout, temporary DNS failure |
| Busy service | HTTP 503, full thread pool, full connection pool |
| Rate limiting | HTTP 429, API quota exceeded |
| Distributed switchover | Primary-replica failover, leader election, broker failover |
| Eventual consistency | A newly created resource is temporarily unreadable |
| Consumer failure | Consumer process crash, temporary database outage |

The Azure documentation also states that many transient faults recover on their own, and that an operation will often succeed if the application retries after an appropriate delay. ([Microsoft Learn][3])

### 1.3 What Happens If There Is No Retry?

A system with no retry at all will often expose brief fluctuations directly to users or upstream systems, turning requests that could have recovered automatically into visible failures. Typical consequences include:

| Consequence of no retry | Explanation |
| --- | --- |
| Lower availability | Network jitter, temporary throttling, and brief 503s become user-visible failures immediately |
| Higher compensation cost | Orders, jobs, and sync flows that could have succeeded automatically need manual or asynchronous repair |
| Less stable call paths | Upstream services see more failures and may trigger alerts, degradation, or manual intervention |
| Higher message-loss risk | If MQ consumption fails and the message is acked or the offset is committed anyway, the message can be skipped |
| Worse user experience | Users need to refresh, click again, or submit repeatedly |

But the opposite also matters: **blind retry is more dangerous than no retry**. AWS warns explicitly that if the failure is caused by downstream overload, retries add more downstream load and make the situation significantly worse. In a five-layer call stack where every layer retries three times, request load on the bottom-layer database can be amplified by up to 243 times. ([Amazon Web Services, Inc.][1])

So the real conclusion is not "always retry." It is:

> **Retry only transient failures; retry only operations that are idempotent or deduplicable; retry only within bounded attempts, bounded time, and bounded budget.**

---

## 2. Core Principles of Retry Design

### 2.1 Set Timeouts Before Retries

Retry without timeout is a broken design. AWS notes that while a client waits for a request to finish, it continues to consume resources such as memory, threads, connections, and ephemeral ports. Large numbers of long-waiting requests can exhaust service resources, so clients must set timeouts. ([Amazon Web Services, Inc.][1])

Azure also emphasizes that retry policy must be designed together with timeout. If timeout is too long, threads and connections pile up during failure; if timeout is too short, operations that would have succeeded may fail prematurely. ([Microsoft Learn][3])

The correct model is:

```text
per-attempt timeout < acceptable wait time for a single business attempt
total retry duration <= upstream deadline / SLO
retry attempts * per-attempt timeout + retry intervals <= total budget
```

### 2.2 Retry Only Transient Failures, Not Deterministic Ones

Azure recommends retrying only when the fault is transient and the operation may succeed after another attempt. HTTP 429 and 5xx responses are common retry candidates, while most 4xx responses such as 400, 401, 403, and 404 are usually not problems that retry can solve. ([Microsoft Learn][3])

My engineering judgment is:

| Error type | Retry? | Reason |
| --- | ---: | --- |
| Network timeout, connection reset | Yes | It may be a transient network issue |
| HTTP 429 | Yes | But `Retry-After` or rate-limit policy must be respected |
| HTTP 500/502/503/504 | Yes | These are typical transient server-side failures |
| HTTP 400 | No | The request is wrong and retrying keeps it wrong |
| HTTP 401/403 | No direct retry | Authentication or authorization must be refreshed or rejected |
| HTTP 404 | No by default | Unless it is explicitly an eventual-consistency read delay |
| Business validation failure | No | Insufficient inventory, insufficient balance, or illegal state is not transient |
| Non-idempotent write timeout | No by default | Unless there is an idempotency key or proof the original operation never took effect |

### 2.3 Idempotency Is a Prerequisite for Retry

RFC 9110 defines an idempotent method as one where the intended effect of multiple identical requests is the same as a single request. PUT, DELETE, and all safe methods are idempotent. It also explicitly states that if a method is not idempotent, a client should not automatically retry unless it knows the actual request semantics are idempotent or can confirm the original request was never applied. ([RFC Editor][4])

This principle is critical in business systems. The following operations should not be retried automatically without idempotency protection:

| Operation | Risk |
| --- | --- |
| Create order | Duplicate orders |
| Charge payment | Duplicate charges |
| Issue coupon | Duplicate issuance |
| Publish MQ message | Duplicate messages |
| Insert inventory ledger record | Duplicate records |
| Invoke external system | Local failure even though the external side already succeeded |

The correct approach is to introduce one or more of the following for write operations:

```text
idempotencyKey / requestId / businessNo / unique constraint / dedup table / state machine
```

AWS also makes it clear that APIs with side effects are unsafe without idempotency, and that good API design should avoid duplicate side effects. ([Amazon Web Services, Inc.][1])

### 2.4 Retry Must Be Bounded, Never Infinite

The Azure documentation explicitly requires avoiding infinite retries because they usually prevent overloaded resources from recovering and cause throttling and connection refusal to last even longer. Bounded retries should be used instead, often with a circuit breaker. ([Microsoft Learn][5])

Retry boundaries should include at least three layers:

```text
maxAttempts: maximum number of attempts
maxBackoff: maximum backoff interval
deadline / totalTimeout: maximum total time
```

My judgment is: **a retry configuration without a total time limit is not acceptable. Configuring only `maxAttempts` is not enough because each individual request may still block for a long time.**

---

## 3. Retry Inside Thread Pools

### 3.1 A Thread Pool Is Not a Retry Mechanism

The responsibility of Java `ExecutorService` and `ThreadPoolExecutor` is to execute tasks, not to guarantee business success. The Oracle documentation explains that `ExecutorService.submit` returns a `Future`, and the caller can wait for completion or cancel the task; `Future.get()` throws `ExecutionException` if the task failed with an exception. ([Oracle Documentation][6])

That means: **a thread pool does not automatically retry a business task just because your `Runnable` or `Callable` throws.** If you submit a task with `submit()` but never call `Future.get()`, or if the task never catches its own exceptions, failures may be silently ignored with only logs or no business compensation at all.

### 3.2 Three Different Retry Scenarios in a Thread Pool

What people call "retry in a thread pool" actually covers three very different cases:

| Type | Trigger | Nature | Recommended approach |
| --- | --- | --- | --- |
| Retry after execution failure | `Runnable`/`Callable` throws during execution | Business execution failure | Catch the exception and reschedule according to policy |
| Retry after submission failure | The thread-pool queue is full or the executor is shut down | Resource rejection | Do not retry blindly; apply rate limiting, degradation, or reroute to another queue |
| Timed or delayed retry | Retry after some delay following the first failure | Task scheduling | Use `ScheduledExecutorService` or MQ |

The Oracle `RejectedExecutionHandler` documentation explains that the rejection handler is invoked when `ThreadPoolExecutor.execute` cannot accept a task, either because thread or queue bounds were exceeded, or because the executor has been shut down. ([Oracle Documentation][7])

So **`RejectedExecutionHandler` is not a business retry hook. It is a rejection hook for overload or shutdown.** Calling `executor.execute(r)` in an endless loop inside the rejection handler is a terrible design and can easily cause CPU spinning, blocked caller threads, and cascading collapse.

### 3.3 The Correct Way to Retry Thread-Pool Tasks

If a task must be retried after failure, prefer delayed rescheduling rather than making a worker thread `sleep`. The Oracle documentation explains that `ScheduledExecutorService` can schedule commands after a delay and can also run tasks periodically. ([Oracle Documentation][8])

A recommended model is:

```java
public final class RetriableTask implements Runnable {
    private final ScheduledExecutorService scheduler;
    private final int attempt;

    public RetriableTask(ScheduledExecutorService scheduler, int attempt) {
        this.scheduler = scheduler;
        this.attempt = attempt;
    }

    @Override
    public void run() {
        try {
            // Execute business logic.
            doBusiness();
        } catch (TransientException ex) {
            if (attempt >= 3) {
                // Send to failure handling path.
                sendToDeadLetter(ex);
                return;
            }

            long delayMs = calculateBackoffWithJitter(attempt);
            // Re-schedule instead of blocking the worker thread.
            scheduler.schedule(
                new RetriableTask(scheduler, attempt + 1),
                delayMs,
                TimeUnit.MILLISECONDS
            );
        } catch (Exception ex) {
            // Non-transient failures should fail fast.
            sendToDeadLetter(ex);
        }
    }

    private void doBusiness() {
        // Business operation.
    }

    private long calculateBackoffWithJitter(int attempt) {
        long base = 100L;
        long max = 3000L;
        long exponential = Math.min(max, base * (1L << attempt));
        return ThreadLocalRandom.current().nextLong(0, exponential + 1);
    }

    private void sendToDeadLetter(Exception ex) {
        // Persist failed task for later diagnosis or compensation.
    }
}
```

### 3.4 Best-Practice Conclusions for Thread-Pool Retry

| Scenario | Recommended strategy | Not recommended |
| --- | --- | --- |
| Short-lived network call failure | Limited retries inside the task, or reschedule after failure | Sleeping for a long time inside a worker thread |
| Submission failure because the queue is full | Rate limit, fail fast, degrade, or smooth bursts through an async queue | Infinite resubmission inside `RejectedExecutionHandler` |
| Batch job failure | Record attempt count, retry with delay, and eventually persist into a failure table | Infinite in-process loops |
| Async task in a user request chain | Short retry + fail fast + observability | Making the request thread wait synchronously through multiple retry rounds |
| Long-duration retry | Hand off to MQ, a scheduler, or a workflow engine | Keeping state in an in-memory thread-pool queue |

---

## 4. Retry in Message Queues

Retry in message queues is more complex than in HTTP or RPC because it involves acknowledgements, offset commit, redelivery, ordering, dead-letter queues, and consumer idempotency.

### 4.1 Retry in RabbitMQ

RabbitMQ relies on ack/nack/requeue. Its documentation warns that if all consumers keep requeueing messages because of transient conditions, the system can fall into a requeue or redelivery loop that consumes large amounts of network bandwidth and CPU. ([RabbitMQ][9])

So when consumption fails, RabbitMQ should not be handled naively like this:

```text
basic.nack(requeue = true)
```

Otherwise, when the database is down, a downstream service is unavailable, or all consumers fail, messages will be redelivered repeatedly and a consumption storm will appear.

The correct RabbitMQ model is:

```text
consumption fails
  -> determine whether the exception is transient
  -> record retry count
  -> perform delayed retry
  -> move to DLX / DLQ after the retry limit is exceeded
```

The RabbitMQ Dead Letter Exchange documentation explains that messages can be dead-lettered, meaning republished to another exchange. One trigger is when a consumer uses `basic.reject` or `basic.nack` with `requeue=false`. ([RabbitMQ][10])

### 4.2 Retry in Kafka

The core of Kafka retry is not that the broker automatically retries your consumer logic forever. The real core is offset management and delivery semantics. The `KafkaConsumer` documentation explains that the committed position is the last offset safely stored. After the process fails and restarts, the consumer resumes from that offset. Applications may commit offsets periodically automatically, or manually control when a record is considered consumed. ([Apache Kafka][11])

That leads to a critical engineering fact:

| Offset commit timing | Result |
| --- | --- |
| Commit before processing | Message loss is possible after failure, resulting in at-most-once |
| Commit after processing | Duplicate consumption is possible after failure, resulting in at-least-once |
| Transactional processing plus commit | Can approach exactly-once, but depends on system boundaries |

The Kafka design documentation also explains that Kafka effectively provides at-least-once by default. Users can simulate at-most-once by disabling producer retries and committing offsets before processing, but that introduces message-loss risk. ([Apache Kafka][12])

For producer retry, the `KafkaProducer` documentation states that enabling the idempotent producer prevents producer retries from introducing duplicate messages. It also warns that if idempotent producer mode is enabled, applications should avoid doing their own resends because application-level resends cannot be deduplicated by producer idempotency. ([Apache Kafka][13])

### 4.3 Categories of MQ Retry

| Strategy | Mechanism | Suitable scenarios | Risk |
| --- | --- | --- | --- |
| Immediate redelivery | nack/requeue or no offset commit | Extremely short-lived failures | Can easily create redelivery loops |
| Blocking retry | Sleep inside the consumer thread and then retry | Low-frequency, short-duration errors | Blocks partition or queue consumption |
| Delayed-queue retry | Send failed messages to delayed topics or queues | Downstream is temporarily unavailable | Adds topic or queue complexity |
| Tiered retry | Retry topics such as 1 min, 5 min, 30 min | Recovery time of external systems is uncertain | Operational complexity increases |
| Dead-letter queue | Enter DLQ after retry limit | Poison messages or permanent failures | Requires manual handling or compensation |
| Stop consumption | Pause the consumer or trip a circuit breaker | Whole downstream is unavailable | Delay accumulates, but the downstream is protected |

The Spring Kafka documentation explains that Kafka non-blocking retry and DLT commonly require extra topics and listener configuration. Since Spring Kafka 2.7, `@RetryableTopic` and `RetryTopicConfiguration` simplify this infrastructure. ([Home][14]) Its configuration documentation also says that the recommended and simplest way to enable non-blocking retries is to add `@RetryableTopic` to the `@KafkaListener` method, letting the framework automatically configure the retry topics and DLT topics. ([Home][15])

### 4.4 Best-Practice Conclusions for MQ Retry

My judgment is:

```text
For short-lived and low-cost failures, 1 or 2 short blocking retries inside the consumer are acceptable.
When a downstream service is unavailable, do not block the consumer thread. Hand the message to a delayed retry queue.
Poison messages must not be retried forever. They must enter a DLQ.
For Kafka partitions that are sensitive to ordering, use non-blocking retry topics cautiously because they may break local ordering.
All message consumption must be idempotent by messageId or businessId.
```

In MQ scenarios, the most important questions are not "how many retries?" but:

```text
failed messages must not be lost
duplicate messages must not create duplicate business effects
poison messages must not block the whole queue
downstream outages must not trigger a consumption storm
```

---

## 5. Retry in HTTP Requests

### 5.1 The Core of HTTP Retry: Status Codes, Idempotency, and Retry-After

HTTP retry must respect HTTP semantics first. RFC 9110 states explicitly that GET, HEAD, OPTIONS, and TRACE are safe methods, while PUT, DELETE, and all safe methods are idempotent methods. Idempotent methods can be retried automatically after communication failure because the expected effect of repeated requests is the same as a single request. ([RFC Editor][4])

RFC 9110 also requires that clients must not automatically retry non-idempotent methods unless they can confirm that the request semantics are actually idempotent or that the original request was never applied. ([RFC Editor][4])

That means:

| HTTP method | Default retry recommendation |
| --- | --- |
| GET | Retry is acceptable, but cache behavior, throttling, and request cost still matter |
| HEAD | Retry is acceptable |
| OPTIONS | Retry is acceptable |
| PUT | Retry is acceptable, but server semantics must really be idempotent |
| DELETE | Retry is acceptable, but deletion behavior must truly be idempotent |
| POST | Do not retry automatically by default unless there is an idempotency key or explicit business guarantee |
| PATCH | Do not retry automatically by default unless there is an idempotency key or explicit business guarantee |

### 5.2 Which HTTP Status Codes Are Suitable for Retry?

| Status code / exception | Retry? | Explanation |
| --- | ---: | --- |
| 408 Request Timeout | Yes | A timeout may be transient |
| 429 Too Many Requests | Yes | Retry must respect throttling and `Retry-After` |
| 500 Internal Server Error | Yes | Typical transient server-side failure |
| 502 Bad Gateway | Yes | Temporary gateway or upstream failure |
| 503 Service Unavailable | Yes | Appropriate for backoff retry |
| 504 Gateway Timeout | Yes | Upstream timeout |
| 400 Bad Request | No | The request itself is wrong |
| 401 Unauthorized | No direct retry | Credentials should be refreshed first |
| 403 Forbidden | No | Permission issue |
| 404 Not Found | No by default | Unless eventual-consistency delay is known explicitly |
| 409 Conflict | Depends on business semantics | Optimistic-lock conflict may justify retrying the full read-modify-write flow |
| 422 Unprocessable Entity | No | Business-semantic error |

RFC 6585 defines 429 as the case where the user has sent too many requests in a given amount of time. The response may include `Retry-After` to indicate how long the client should wait before sending another request. ([datatracker.ietf.org][16]) RFC 9110 defines `Retry-After` as a server hint telling the user agent how long to wait before making a follow-up request. The value may be an HTTP date or a delay in seconds. ([RFC Editor][4])

So the priority order of an HTTP client should be:

```text
If the response contains Retry-After: honor Retry-After
Otherwise: use capped exponential backoff with jitter
```

### 5.3 Recommended HTTP Retry Configuration

For user-interaction request chains:

```text
maxAttempts = 2~3
perAttemptTimeout = 200ms~2s depending on the business
backoff = 50ms, 100ms, 200ms + jitter
totalTimeout must stay below the user-experience budget
```

For background tasks:

```text
maxAttempts = 3~6
backoff = capped exponential backoff with jitter
maxBackoff = 10s~60s
after failure, enter a task table, MQ, or DLQ
```

For writes such as payments, orders, or coupon issuance:

```text
idempotencyKey is mandatory
server-side dedup tables or unique indexes are mandatory
the client may retry, but must not bypass idempotency checks
after timeout, query the status first before deciding whether compensation is needed
```

The worst possible HTTP implementation is:

```text
while (true) {
    callHttp();
}
```

That is not availability engineering. It is incident generation.

---

## 6. Retry in gRPC Requests

### 6.1 gRPC Retry Is Not Just a Loop in an Interceptor

The gRPC documentation explains that built-in gRPC retry saves call history and, when retry conditions are met, replaces the failed call with a new call and replays the history. If the RPC has already received response headers, that RPC is considered committed and is no longer retried. ([gRPC][17])

This point matters. gRPC retry is a per-RPC mechanism inside the protocol stack. It should not be reduced to a coarse business interceptor loop. Business interceptors do not understand whether an RPC is already committed, nor do they understand transparent retry, server pushback, or retry throttling.

### 6.2 Default gRPC Behavior

The gRPC documentation explains that retry is enabled by default, but there is no default retry policy. Without an explicit retry policy, gRPC cannot safely retry most RPCs and only performs very limited transparent retries, such as low-level race failures where the RPC can be confirmed not to have been processed by server application logic. ([gRPC][17])

In other words:

```text
gRPC retry support being enabled != your business RPCs being retried according to your intended policy
```

If you want business RPCs to retry predictably, you must configure a service config.

### 6.3 Core Parameters of a gRPC Retry Policy

The retry policy shown in the gRPC documentation includes:

```json
{
  "retryPolicy": {
    "maxAttempts": 4,
    "initialBackoff": "0.1s",
    "maxBackoff": "1s",
    "backoffMultiplier": 2,
    "retryableStatusCodes": [
      "UNAVAILABLE"
    ]
  }
}
```

The gRPC documentation explains that retry can configure maximum attempts, exponential backoff, and retryable status codes, and that the backoff delay receives plus or minus 20 percent jitter to avoid large numbers of clients hammering the server at the same time. ([gRPC][17])

### 6.4 gRPC Retry Throttling

gRPC supports retry throttling: each client maintains a token count for each server. Failed RPCs reduce the token count, while successful RPCs increase it. When the token count falls below a threshold, retry pauses until the count recovers. ([gRPC][17])

That is exactly the kind of capability production systems need. Without retry throttling, gRPC retry can easily kill an already overloaded server more quickly.

### 6.5 Recommended gRPC Retry Behavior

| gRPC scenario | Recommended strategy |
| --- | --- |
| Read-only query | Retry `UNAVAILABLE` with short deadlines and exponential backoff |
| Idempotent write | Retry is acceptable, but requestId or idempotencyKey is mandatory |
| Non-idempotent write | Do not retry automatically by default; query state after timeout |
| Streaming RPC | Retry cautiously, especially bidirectional streams |
| User-facing request chain | Small retry count, short deadline |
| Background synchronization | More attempts and longer backoff are acceptable, but total deadline is still required |
| Server overload | Enable retry throttling and trip a circuit breaker when needed |

gRPC service config also supports timeout, retry policy, hedging policy, and other call-behavior configuration at the service or method level. ([gRPC][18])

---

## 7. Which Retry Strategies Exist, and When Should Each Be Used?

### 7.1 Immediate Retry

Immediate retry means making another attempt immediately after a failure with no delay.

| Suitable scenarios | Unsuitable scenarios |
| --- | --- |
| Extremely short-lived network glitches | Downstream overload |
| Single packet-collision type issues | High-concurrency systems |
| Mild local CAS or optimistic-lock conflicts | External service 5xx rates remain high |

Azure recommends using immediate retry only for very short-lived transient failures, and not more than once. If the immediate retry also fails, the client should switch to exponential backoff or fallback. ([Microsoft Learn][3])

**My judgment: in production, immediate retry should happen at most once. Beyond that it becomes self-destructive traffic amplification.**

### 7.2 Fixed-Interval Retry

Fixed-interval retry means retrying after the same delay each time, such as every 3 seconds.

| Suitable scenarios | Unsuitable scenarios |
| --- | --- |
| Low-concurrency background tasks | Large client populations |
| Operational scripts | High-QPS RPC |
| Manually triggered jobs | Rate-limited or overload scenarios |

The main problem with fixed intervals is synchronization. If a large batch of clients all fail at the same time and all retry every 3 seconds, they create periodic traffic spikes.

### 7.3 Increasing-Interval Retry

Increasing-interval retry uses linearly or stepwise increasing delays, such as 1 s, 3 s, 5 s, or 10 s.

| Suitable scenario | Explanation |
| --- | --- |
| Background jobs | Gentler than a fixed interval |
| Batch processing | Suitable when failure cost is low and real-time requirements are weak |
| Simple MQ consumer failure | Can work together with retry topics |

This is better than fixed intervals, but in large distributed systems it is still weaker than exponential backoff plus jitter.

### 7.4 Exponential Backoff

Exponential backoff increases the wait time exponentially after each failure, for example:

```text
100ms -> 200ms -> 400ms -> 800ms -> 1600ms
```

The Spring Batch documentation explains that after transient failure, waiting for some time before another attempt is often helpful. A common approach is exponentially increasing wait time, and Spring Batch provides `ExponentialBackoffPolicy` for that purpose. ([Home][19])

Exponential backoff fits:

| Scenario | Reason |
| --- | --- |
| HTTP 5xx | Gives the downstream time to recover |
| gRPC `UNAVAILABLE` | Service instances or connections may recover |
| Cloud API throttling | Reduces request frequency |
| Database failover | Waits for the new primary to become available |
| MQ delayed retry | Avoids immediately hammering the downstream again |

### 7.5 Truncated Exponential Backoff Plus Jitter

This is the strategy I consider **the best default for distributed systems**.

Google Cloud IAM recommends truncated exponential backoff with introduced jitter for safely retryable requests. Its documentation explains that retrying immediately after a failure can send a burst of requests in a short period and exceed quota, while jitter prevents synchronized retries and reduces thundering-herd behavior. ([Google Cloud Documentation][20])

AWS also emphasizes that if all failed calls wake up and retry at the same moment after backoff, they can create another overload wave. Jitter spreads those retries over time. ([Amazon Web Services, Inc.][1])

The recommended formula is:

```text
delay = random(0, min(base * 2^attempt, maxBackoff))
```

That is a Full Jitter style strategy, and it fits high-concurrency systems well.

### 7.6 Server-Directed Retry

Server-directed retry means the client gives priority to the wait time explicitly returned by the server.

The standard HTTP example is `Retry-After`. RFC 9110 defines it as either an HTTP date or a delay in seconds. ([RFC Editor][4]) Azure also recommends that when a response contains a `Retry-After` header, the client should wait at least that long and let the server hint take precedence over local backoff calculation. ([Microsoft Learn][3])

Suitable scenarios include:

```text
HTTP 429
HTTP 503
API gateway throttling
Cloud-service quota limitation
server-side protective throttling
```

### 7.7 Retry Budget

Retry budget is not just a per-request maximum attempt count. It limits the total amount of retry traffic a process, service, or dependency can generate over some time window.

Azure recommends implementing a retry budget in addition to per-request retry limits, because many concurrent requests that each retry a few times can still crush the downstream. ([Microsoft Learn][3])

Suitable scenarios include:

```text
high-QPS microservices
shared downstream dependencies
third-party API integrations
rate-limited cloud services
```

My judgment is: **a high-QPS service without a retry budget will eventually suffer a retry storm.**

### 7.8 Circuit Breaking Together with Retry

Circuit breaking is not a retry strategy, but it is the braking system of retry. Azure recommends using a circuit breaker for continuously failing operations. When the number of failures exceeds a threshold within a time window, requests should fail immediately instead of continuing to hit the broken dependency. ([Microsoft Learn][3])

Suitable scenarios include:

```text
continuous downstream 5xx
connection-pool exhaustion
database outage
large-scale third-party API failure
```

The relationship between retry and circuit breaking is:

```text
small amount of transient failure: retry
continuous failure: circuit break
recovery probing: half-open probing
recovery succeeds: close the breaker
```

### 7.9 Dead-Letter Queue or Failure Table

Dead-letter handling is not retry itself. It is the destination after retry is exhausted. Azure recommends using a dead-letter queue once all retry attempts are consumed so request information is not lost and failure handling can be deferred. ([Microsoft Learn][3])

Suitable scenarios include:

```text
MQ consumption failure
asynchronous task failure
order-compensation failure
external-system synchronization failure
batch-processing failure
```

A dead-letter system should include:

```text
failure reason
original message
attempt count
last failure time
business key
traceId
manual replay tool
idempotency protection
```

---

## 8. Scenario Selection Matrix

| Scenario | Recommended retry strategy | Max attempts | Interval strategy | Idempotency requirement | Final destination |
| --- | --- | ---: | --- | --- | --- |
| User-facing HTTP query | Short retry | 2~3 | One immediate retry + short exponential backoff + jitter | Recommended | Failure or degraded response |
| User-facing HTTP write | Cautious retry | 0~2 | Exponential backoff + jitter | Mandatory | Query status or compensate |
| gRPC query | Built-in retry policy | 2~4 | initialBackoff + maxBackoff + multiplier + jitter | Recommended | Return status |
| gRPC write | Retry only idempotent writes | 0~3 | Exponential backoff + retry throttling | Mandatory | Query status or compensate |
| Thread-pool task | Reschedule | 3~5 | ScheduledExecutor delay + jitter | Depends on business | Failure table |
| RabbitMQ consumption | Delayed retry + DLQ | 3~10 | Multi-level delay | Consumption must be idempotent | DLQ |
| Kafka consumption | Retry topic + DLT | 3~10 | Non-blocking delayed topics | Consumption must be idempotent | DLT |
| Database optimistic-lock conflict | Short retry | 1~3 | Immediate retry or short backoff | Operation must be replayable | Return conflict |
| Third-party API rate limit | Prefer server hints | Depends on quota | Retry-After / exponential backoff | Depends on API | Delayed task |
| Scheduled batch job | Long backoff | Multiple | Capped exponential backoff | Task must be idempotent | Failure table or manual action |
| Payment charge | Do not retry blindly by default | 0~1 | Query state first | Strong idempotency required | Reconciliation or compensation |

---

## 9. Recommended Unified Retry Standard

A qualified enterprise retry standard should include the following.

### 9.1 Checklist Before Retrying

```text
1. Is this error transient?
2. Is this operation idempotent?
3. Is a per-attempt timeout already configured?
4. Is there a total deadline?
5. Will this duplicate retries already happening at another layer?
6. Is there a retry budget?
7. Where does the message or task go after retries are exhausted?
8. Are metrics and logs available?
```

### 9.2 Default Policy

```text
User-facing request chains:
  maxAttempts = 2~3
  backoff = 50ms / 100ms / 200ms + jitter
  totalTimeout <= user experience budget

Internal RPC:
  maxAttempts = 2~4
  explicit perAttemptTimeout
  capped exponential backoff with jitter
  combined with circuit breaking, rate limiting, and retry budget

MQ consumption:
  1~2 short local retries
  then delayed retry topic or queue
  after limit, move to DLQ or DLT

Background jobs:
  longer backoff is acceptable
  persist attempt count and state
  do not rely on process memory to track retry state
```

### 9.3 Observability Metrics

Azure recommends recording retry count, average retry count, and total retry time. Occasional transient failures and retries are expected, but a sustained increase in retry volume usually means a performance or availability problem. ([Microsoft Learn][3])

At minimum, a production system should monitor:

```text
retry_attempts_total
retry_success_total
retry_exhausted_total
retry_latency_seconds
retry_budget_exhausted_total
retry_by_exception
retry_by_status_code
dead_letter_total
message_redelivery_total
consumer_retry_lag
```

### 9.4 Most Dangerous Anti-Patterns

| Anti-pattern | Consequence |
| --- | --- |
| Infinite retry | Threads, connections, CPU, and the downstream all get dragged down |
| Retry without timeout | Every attempt may hang forever |
| Retrying at every layer | Retry multiplication explodes |
| Automatic retry of non-idempotent writes | Duplicate charges, orders, or coupon issuance |
| Immediate MQ requeue after failure | Redelivery loops |
| Large-scale fixed-interval retry | Synchronized traffic spikes |
| Sleeping in worker threads for retry | Thread pools get saturated |
| Tracking only per-request counts but not global budget | High concurrency can still crush the downstream |
| Dropping the request after retries are exhausted | Data loss and no compensation path |

---

## 10. Conclusion

Retry strategy in software development is fundamentally about trading a limited number of extra attempts for greater tolerance of transient failure. It should be treated as part of reliability engineering, not as a few lines of loop logic in exception handling.

The final judgment of this article is:

1. **What is retry?**  
   Retry means re-executing an operation according to policy after failure in order to handle transient faults, partial failure, and brief unavailability.

2. **Why retry?**  
   Because networks, services, cloud resources, messaging systems, and distributed components all experience short-lived failures. Rational retry can significantly improve success rate and perceived availability.

3. **What if there is no retry?**  
   Many recoverable transient failures become visible business failures immediately, though that does not mean blind retry is acceptable.

4. **How should thread pools retry?**  
   Thread pools do not automatically retry business tasks. Execution failures should be caught and rescheduled through `ScheduledExecutorService` or another task system. Submission failures should be rate-limited, degraded, or rejected rather than endlessly resubmitted from a rejection handler.

5. **How should MQ retry work?**  
   MQ retry must handle duplicate consumption, offset or ack semantics, delayed retry, and dead-letter queues. RabbitMQ should not requeue forever, and Kafka consumers must control offset commit timing while ensuring consumer idempotency.

6. **How should HTTP retry work?**  
   HTTP retry must obey method idempotency, status-code semantics, and `Retry-After`. Idempotent semantics such as GET, PUT, and DELETE are much safer to retry. POST and PATCH should not be retried automatically by default unless the business provides an idempotency key.

7. **How should gRPC retry work?**  
   gRPC should prefer official retry policy through service config, using `maxAttempts`, `initialBackoff`, `maxBackoff`, `backoffMultiplier`, `retryableStatusCodes`, and retry throttling.

8. **Which retry strategy is most recommended?**  
   For modern distributed systems, the default should be **bounded truncated exponential backoff with jitter**. Immediate retry should happen at most once. Fixed-interval retry fits only simple low-concurrency tasks. Long-lived MQ failures should move into delayed retry and DLQ workflows. High-QPS RPC must add retry budget and circuit breaking.

The article can be closed with one sentence:

> **Retry is medicine, not food. Used in small doses, with timeout, idempotency, backoff, jitter, and circuit breaking, it can save a system. Used without limits, without idempotency, without budget, and without observability, it drags the system into collapse.**

[1]: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/ "Timeouts, retries and backoff with jitter"
[2]: https://learn.microsoft.com/en-us/azure/architecture/patterns/retry "Retry pattern - Azure Architecture Center | Microsoft Learn"
[3]: https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults "Transient Fault Handling - Azure Architecture Center | Microsoft Learn"
[4]: https://www.rfc-editor.org/rfc/rfc9110.html "RFC 9110: HTTP Semantics"
[5]: https://learn.microsoft.com/en-us/azure/well-architected/design-guides/handle-transient-faults "Recommendations for handling transient faults - Microsoft Azure Well-Architected Framework | Microsoft Learn"
[6]: https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ExecutorService.html "ExecutorService (Java Platform SE 8 )"
[7]: https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/RejectedExecutionHandler.html "RejectedExecutionHandler (Java Platform SE 8 )"
[8]: https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ScheduledExecutorService.html?utm_source=chatgpt.com "ScheduledExecutorService (Java Platform SE 8 )"
[9]: https://www.rabbitmq.com/docs/confirms "Consumer Acknowledgements and Publisher Confirms | RabbitMQ"
[10]: https://www.rabbitmq.com/docs/dlx "Dead Letter Exchanges | RabbitMQ"
[11]: https://kafka.apache.org/25/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html "KafkaConsumer (kafka 2.5.0 API)"
[12]: https://kafka.apache.org/0100/design/design/ "Design | Apache Kafka"
[13]: https://kafka.apache.org/10/javadoc/org/apache/kafka/clients/producer/KafkaProducer.html "KafkaProducer (kafka 1.0.1 API)"
[14]: https://docs.spring.io/spring-kafka/reference/retrytopic.html "Non-Blocking Retries :: Spring Kafka"
[15]: https://docs.spring.io/spring-kafka/reference/retrytopic/retry-config.html "Configuration :: Spring Kafka"
[16]: https://datatracker.ietf.org/doc/html/rfc6585 "RFC 6585 - Additional HTTP Status Codes"
[17]: https://grpc.io/docs/guides/retry/ "Retry | gRPC"
[18]: https://grpc.io/docs/guides/service-config/ "Service Config | gRPC"
[19]: https://docs.spring.io/spring-batch/docs/4.2.x/reference/html/retry.html "Retry"
[20]: https://docs.cloud.google.com/iam/docs/retry-strategy "Retry failed requests | Identity and Access Management (IAM) | Google Cloud Documentation"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/retry)
