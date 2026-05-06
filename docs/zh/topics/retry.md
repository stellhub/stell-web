---
title: 软件开发中的重试策略最佳实践
category: 服务可靠性
summary: 从线程池、消息队列、HTTP 和 gRPC 四类典型场景出发，系统总结生产环境中的重试边界、策略选择、幂等要求与落地规范。
tags:
  - 重试
  - 分布式系统
  - 幂等性
  - gRPC
readingDirection: 适合在设计服务容错机制、治理下游瞬时故障或统一企业级重试规范时阅读。
outline: deep
---

# 软件开发中的重试策略最佳实践

## 摘要

重试是分布式系统中最常见、也最容易被滥用的容错手段。它的价值在于用有限的重复尝试屏蔽瞬时故障，例如短暂网络抖动、服务临时不可用、限流、连接重建、主从切换、消费者异常退出等。但重试不是“失败了再试几次”这么简单。设计不当的重试会造成重复写入、重复扣款、消息风暴、线程池耗尽、下游雪崩和级联故障。AWS Builders Library 明确指出，重试是“自私的”：客户端通过重试消耗更多服务端资源来提高自己的成功率；当失败来自过载时，重试会让过载更严重，甚至拖慢恢复。([Amazon Web Services, Inc.][1])

本文的核心结论是：**生产系统中的默认重试策略应该是“有限次数 + 单次超时 + 指数退避 + 抖动 + 幂等保护 + 重试预算 + 死信兜底”。** 立即重试只能用于极短暂的瞬时错误，且最多一次；高并发分布式系统不要使用固定间隔裸重试；涉及写操作、扣费、下单、发券、发消息等副作用操作，必须先解决幂等性，再谈重试。

**关键词：** 重试策略、瞬时故障、指数退避、抖动、幂等性、线程池、消息队列、HTTP、gRPC、死信队列、重试风暴

---

## 1. 什么是重试？为什么要重试？不重试会怎么样？

### 1.1 重试的定义

重试是指一次操作失败后，在满足特定条件的前提下，由调用方、执行框架、消息中间件、RPC 框架或任务调度器再次发起同一操作，试图让原本失败的业务流程最终成功。

Microsoft Azure Retry Pattern 对重试的定义很直接：当应用连接服务或网络资源时，透明地重新尝试失败操作，以处理瞬时故障并提升应用稳定性。云环境中的瞬时故障包括短暂网络中断、服务临时不可用、服务繁忙导致的超时等。([微软学习][2])

更工程化地说，重试由四个要素组成：

| 要素 | 含义 |
| --- | --- |
| 可重试条件 | 哪些异常、错误码、状态码允许重试 |
| 重试边界 | 最多重试几次，总耗时不能超过多少 |
| 重试间隔 | 立即重试、固定间隔、递增间隔、指数退避、带抖动退避 |
| 失败归宿 | 重试耗尽后是返回失败、降级、熔断、进入死信队列，还是人工介入 |

**判断：没有这四个要素的“重试”，都不是可靠性设计，而是碰运气。**

### 1.2 为什么要重试？

重试的根本原因是：现代软件系统中的很多失败不是永久失败，而是瞬时失败。AWS Builders Library 指出，系统并不总是作为一个整体失败，而是经常出现部分失败或短暂失败；对这类随机性、短时性的故障，再尝试一次往往能成功。([Amazon Web Services, Inc.][1])

典型瞬时故障包括：

| 场景 | 示例 |
| --- | --- |
| 网络抖动 | TCP reset、连接超时、DNS 短暂失败 |
| 服务繁忙 | HTTP 503、线程池满、连接池满 |
| 限流 | HTTP 429、API quota 超限 |
| 分布式切换 | 主从切换、leader election、broker failover |
| 最终一致性 | 刚创建的资源短时间内读取不到 |
| 消费失败 | 消费者进程崩溃、数据库短暂不可用 |

Azure 官方文档也明确说，很多瞬时故障通常会自行恢复；如果应用在合适的延迟后重试，操作很可能成功。([微软学习][3])

### 1.3 不重试会怎么样？

完全不重试的系统通常会把短暂波动直接暴露给用户或上游系统，导致明明可以自动恢复的请求变成失败。具体表现包括：

| 不重试的后果 | 说明 |
| --- | --- |
| 可用性下降 | 网络抖动、临时限流、短暂 503 都会直接变成用户失败 |
| 业务补偿成本上升 | 本可自动成功的订单、任务、同步流程，需要人工或异步修复 |
| 链路稳定性变差 | 上游看到更多失败，可能触发更多告警、降级、人工介入 |
| 消息处理丢失风险增加 | MQ 消费失败后如果直接 ack 或提交 offset，消息可能被跳过 |
| 用户体验变差 | 用户需要手动刷新、重复点击、重复提交 |

但是反过来，**盲目重试比不重试更危险**。AWS 明确提醒，如果失败原因是下游过载，重试会增加下游负载，使问题显著恶化；在一个五层调用栈中，如果每层都重试 3 次，底层数据库的请求量可能被放大到 243 倍。([Amazon Web Services, Inc.][1])

所以结论不是“必须重试”，而是：

> **只对瞬时故障重试；只对可幂等或可去重的操作重试；只在有限次数、有限时间、有限预算内重试。**

---

## 2. 重试设计的基本原则

### 2.1 先设置超时，再设置重试

没有超时的重试是错误设计。AWS 指出，客户端等待请求完成期间会持续占用资源，包括内存、线程、连接、临时端口等；大量请求长时间等待会耗尽服务资源，因此客户端应该设置超时。([Amazon Web Services, Inc.][1])

Azure 也强调，重试策略必须和 timeout 一起设计；过长的 timeout 会在故障时堆积线程和连接，过短的 timeout 又会导致本可成功的操作过早失败。([微软学习][3])

正确模型是：

```text
单次尝试 timeout < 单次业务可接受等待时间
总重试耗时 <= 上游调用 deadline / SLO
重试次数 * 单次 timeout + 重试间隔 <= 总预算
```

### 2.2 只重试瞬时故障，不重试确定性失败

Azure 官方建议：只有当故障是瞬时的，并且操作在重试后可能成功时才应该重试；HTTP 429 和 5xx 通常是可重试候选，而 400、401、403、404 等大多数 4xx 通常不是重试能解决的问题。([微软学习][3])

我的工程判断是：

| 错误类型 | 是否重试 | 原因 |
| --- | ---: | --- |
| 网络超时、连接 reset | 可以 | 可能是瞬时网络问题 |
| HTTP 429 | 可以 | 但必须尊重 `Retry-After` 或限流策略 |
| HTTP 500/502/503/504 | 可以 | 典型服务端瞬时异常 |
| HTTP 400 | 不应重试 | 请求参数错，重试还是错 |
| HTTP 401/403 | 不应直接重试 | 鉴权失败，应刷新 token 或拒绝 |
| HTTP 404 | 默认不重试 | 除非明确是最终一致性读延迟 |
| 业务校验失败 | 不重试 | 库存不足、余额不足、状态非法不是瞬时故障 |
| 非幂等写入超时 | 默认不重试 | 除非有幂等键或可确认原操作未生效 |

### 2.3 幂等性是重试的前置条件

HTTP RFC 9110 定义：如果多个相同请求对服务端产生的预期效果与单个请求相同，则该方法是幂等的；规范中 PUT、DELETE 以及安全方法是幂等的。RFC 9110 还明确说，如果方法不是幂等的，客户端不应该自动重试，除非它有办法知道请求语义实际是幂等的，或者能确认原请求从未被应用。([RFC 编辑器][4])

这条原则在业务系统中非常关键。下面这些操作如果没有幂等保护，不应该简单自动重试：

| 操作 | 风险 |
| --- | --- |
| 创建订单 | 重复订单 |
| 支付扣款 | 重复扣款 |
| 发券 | 重复发券 |
| 发 MQ 消息 | 重复消息 |
| 新增库存流水 | 重复流水 |
| 外部系统调用 | 本地失败但外部已成功 |

正确做法是给写操作引入：

```text
idempotencyKey / requestId / businessNo / unique constraint / dedup table / state machine
```

AWS 也明确指出，带副作用的 API 如果没有幂等性就不安全；良好的 API 设计应该避免重复副作用。([Amazon Web Services, Inc.][1])

### 2.4 重试必须有上限，不能无限重试

Azure 官方文档明确要求不要实现无限重试，因为它通常会阻止过载资源恢复，并导致限流和拒绝连接持续更久；应该使用有限重试，或结合熔断器让服务恢复。([微软学习][5])

重试上限至少包含三层：

```text
maxAttempts：最多尝试次数
maxBackoff：最大退避间隔
deadline / totalTimeout：总耗时上限
```

我的判断：**没有总耗时上限的重试配置是不合格的。只配置 maxAttempts 不够，因为每次请求自身可能卡很久。**

---

## 3. 线程池中的重试

### 3.1 线程池本身不等于重试机制

Java `ExecutorService` / `ThreadPoolExecutor` 的职责是执行任务，不是保证任务成功。Oracle 官方文档说明，`ExecutorService.submit` 会返回 `Future`，调用方可以用它等待完成或取消任务；`Future.get()` 在任务抛异常时会抛出 `ExecutionException`。([Oracle 文档][6])

这意味着：**线程池不会因为你的 Runnable/Callable 抛异常就自动重试业务任务。** 如果你用 `submit()` 提交任务，但从不调用 `Future.get()` 或不在任务内部捕获异常，失败甚至可能被悄悄吞掉，只留下日志或没有任何业务补偿。

### 3.2 线程池重试的三类场景

线程池里的“重试”其实分三种，不能混为一谈。

| 类型 | 触发点 | 本质 | 推荐做法 |
| --- | --- | --- | --- |
| 执行失败重试 | Runnable/Callable 执行时抛异常 | 业务执行失败 | 捕获异常后按策略重新调度 |
| 提交失败重试 | 线程池队列满或已 shutdown | 资源拒绝 | 不应盲目重试，应限流、降级或换队列 |
| 定时/延迟重试 | 第一次失败后延迟再执行 | 任务调度 | 使用 `ScheduledExecutorService` 或 MQ |

Oracle `RejectedExecutionHandler` 文档说明，当 `ThreadPoolExecutor.execute` 无法接受任务时会调用拒绝处理器，原因可能是线程数或队列槽位超过边界，也可能是 executor 已关闭。([Oracle 文档][7])

所以，**RejectedExecutionHandler 不是业务重试钩子，而是线程池过载或关闭时的拒绝处理钩子。** 在拒绝处理器里无限 `executor.execute(r)` 是非常糟糕的设计，容易形成 CPU 空转、调用线程阻塞和级联雪崩。

### 3.3 线程池重试的正确做法

如果任务失败后需要重试，优先使用延迟调度，而不是让工作线程 `sleep`。Oracle 文档说明，`ScheduledExecutorService` 可以把命令安排在指定延迟后运行，也可以周期性执行任务。([Oracle 文档][8])

推荐模型：

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

### 3.4 线程池重试的最佳实践结论

| 场景 | 推荐策略 | 不推荐策略 |
| --- | --- | --- |
| 短暂网络调用失败 | 任务内部有限重试，或失败后重新调度 | 在线程池工作线程里长时间 sleep |
| 队列满导致提交失败 | 限流、快速失败、降级、异步队列削峰 | RejectedExecutionHandler 里无限重提 |
| 批处理任务失败 | 记录 attempt，延迟重试，最终进入失败表 | 进程内无限循环 |
| 用户请求链路中的异步任务 | 短 retry + 快速失败 + 可观测 | 让请求线程同步等待多轮重试 |
| 长时间重试 | 交给 MQ、调度系统、工作流引擎 | 放在线程池内存队列里 |

---

## 4. 消息队列中的重试

消息队列中的重试比 HTTP/RPC 更复杂，因为它涉及消息确认、offset 提交、重复投递、顺序性、死信队列和消费者幂等。

### 4.1 RabbitMQ 中的重试

RabbitMQ 的基础机制是 ack/nack/requeue。RabbitMQ 官方文档提醒，如果所有消费者因为瞬时条件无法处理消息而不断 requeue，会形成 requeue/redelivery loop，这种循环会消耗大量网络带宽和 CPU。([RabbitMQ][9])

因此，RabbitMQ 消费失败时不应该简单粗暴地：

```text
basic.nack(requeue = true)
```

否则在数据库宕机、下游服务不可用、消费者全部失败时，消息会被疯狂重新投递，形成消费风暴。

RabbitMQ 的正确模型应该是：

```text
消费失败
  → 判断是否瞬时异常
  → 记录重试次数
  → 延迟重试
  → 超过次数进入 DLX / DLQ
```

RabbitMQ 官方 Dead Letter Exchange 文档说明，消息可以被 dead-lettered，即重新发布到另一个 exchange；其中一种触发条件就是消费者使用 `basic.reject` 或 `basic.nack` 且 `requeue=false`。([RabbitMQ][10])

### 4.2 Kafka 中的重试

Kafka 的重试核心不在 broker 自动帮你无限重试消费逻辑，而在 offset 管理和消费语义。KafkaConsumer 官方文档说明，committed position 是已经安全存储的最后 offset；进程失败并重启后，consumer 会从该 offset 恢复。应用可以自动周期提交 offset，也可以手动调用 commit API 控制何时认为记录已消费。([Apache Kafka][11])

这带来一个非常关键的工程事实：

| offset 提交时机 | 结果 |
| --- | --- |
| 处理前提交 | 失败后可能丢消息，at-most-once |
| 处理后提交 | 失败后可能重复消费，at-least-once |
| 处理和提交事务化 | 才可能接近 exactly-once，但依赖系统边界 |

Kafka 官方设计文档也说明，Kafka 默认有效保证 at-least-once；用户可以通过禁用生产者重试并在处理前提交 offset 实现 at-most-once，但这会带来丢消息风险。([Apache Kafka][12])

对于生产者重试，KafkaProducer 官方文档指出，启用幂等生产者后，producer retry 不会再引入重复消息；同时也提醒，如果启用了幂等生产者，应避免应用层重复发送，因为应用层重发无法被 producer 幂等机制去重。([Apache Kafka][13])

### 4.3 MQ 重试的分类

| 策略 | 机制 | 适用场景 | 风险 |
| --- | --- | --- | --- |
| 立即重投 | nack/requeue 或不提交 offset | 极短暂失败 | 容易形成 redelivery loop |
| 阻塞重试 | consumer 当前线程内 sleep 后重试 | 低频、短时间错误 | 阻塞分区/队列消费 |
| 延迟队列重试 | 失败消息投到延迟 topic/queue | 下游短暂不可用 | 增加 topic/queue 复杂度 |
| 分级重试 | 1min、5min、30min 多级 retry topic | 外部系统恢复时间不确定 | 运维复杂 |
| 死信队列 | 超过次数进入 DLQ | 毒丸消息、永久失败 | 需要人工或补偿系统处理 |
| 停止消费 | 暂停 consumer / 熔断 | 下游整体不可用 | 延迟积压，但保护下游 |

Spring Kafka 官方文档说明，Kafka 的非阻塞重试和 DLT 通常需要设置额外 topic 并配置对应 listener；Spring Kafka 从 2.7 开始提供 `@RetryableTopic` 和 `RetryTopicConfiguration` 来简化这类基础设施。([Home][14]) 其配置文档还说，默认情况下启用非阻塞重试的推荐和最简单方式是在 `@KafkaListener` 方法上添加 `@RetryableTopic`，框架会自动配置所需 retry topic 和 DLT topic。([Home][15])

### 4.4 MQ 重试的最佳实践结论

我的判断是：

```text
短暂、低成本异常：可以在消费者内做 1~2 次短阻塞重试。
下游服务不可用：不要阻塞消费线程，应投递到延迟重试队列。
毒丸消息：不要无限重试，必须进入 DLQ。
Kafka 顺序敏感分区：谨慎使用非阻塞 retry topic，因为可能破坏局部顺序。
所有消息消费：必须按 messageId / businessId 做幂等。
```

MQ 场景里最重要的不是“重试几次”，而是：

```text
失败消息不能丢；
重复消息不能造成业务重复；
毒丸消息不能阻塞全队列；
下游故障不能引发消费风暴。
```

---

## 5. HTTP 请求中的重试

### 5.1 HTTP 重试的核心：状态码 + 幂等性 + Retry-After

HTTP 重试必须首先遵守 HTTP 语义。RFC 9110 明确规定，GET、HEAD、OPTIONS、TRACE 是安全方法；PUT、DELETE 和安全方法是幂等方法。幂等方法可以在通信失败后自动重复，因为重复请求的预期效果与单次请求相同。([RFC 编辑器][4])

RFC 9110 同时要求：客户端不应自动重试非幂等方法，除非能确认该请求语义实际幂等，或者能确认原请求没有被应用。([RFC 编辑器][4])

这意味着：

| HTTP 方法 | 默认重试建议 |
| --- | --- |
| GET | 可以重试，但要注意缓存、限流和请求成本 |
| HEAD | 可以重试 |
| OPTIONS | 可以重试 |
| PUT | 可以重试，但服务端实现必须符合幂等语义 |
| DELETE | 可以重试，但要确认删除语义幂等 |
| POST | 默认不自动重试，除非有幂等键或业务保证 |
| PATCH | 默认不自动重试，除非有幂等键或业务保证 |

### 5.2 哪些 HTTP 状态码适合重试？

| 状态码 / 异常 | 是否建议重试 | 说明 |
| --- | ---: | --- |
| 408 Request Timeout | 可以 | 请求超时，可能是瞬时问题 |
| 429 Too Many Requests | 可以 | 必须尊重限流和 `Retry-After` |
| 500 Internal Server Error | 可以 | 服务端瞬时错误 |
| 502 Bad Gateway | 可以 | 网关或上游临时异常 |
| 503 Service Unavailable | 可以 | 服务不可用，适合退避重试 |
| 504 Gateway Timeout | 可以 | 上游超时 |
| 400 Bad Request | 不建议 | 请求本身错误 |
| 401 Unauthorized | 不直接重试 | 应先刷新凭证 |
| 403 Forbidden | 不建议 | 权限问题 |
| 404 Not Found | 默认不建议 | 除非明确存在最终一致性延迟 |
| 409 Conflict | 视业务而定 | 乐观锁冲突可重试整个读改写流程 |
| 422 Unprocessable Entity | 不建议 | 业务语义错误 |

RFC 6585 对 429 的定义是：用户在给定时间内发送了太多请求；响应可以包含 `Retry-After`，指示等待多久后再发起新请求。([datatracker.ietf.org][16]) RFC 9110 对 `Retry-After` 的定义是：服务端用它指示用户代理在后续请求前应该等待多久；其值可以是 HTTP-date，也可以是延迟秒数。([RFC 编辑器][4])

所以 HTTP 客户端的优先级应该是：

```text
如果响应有 Retry-After：遵守 Retry-After
否则：使用 capped exponential backoff with jitter
```

### 5.3 HTTP 重试配置建议

用户交互链路：

```text
maxAttempts = 2~3
perAttemptTimeout = 200ms~2s，取决于业务
backoff = 50ms, 100ms, 200ms + jitter
totalTimeout 必须小于用户体验预算
```

后台任务链路：

```text
maxAttempts = 3~6
backoff = capped exponential backoff with jitter
maxBackoff = 10s~60s
失败后进入任务表 / MQ / DLQ
```

支付、订单、发券等写操作：

```text
必须有 idempotencyKey
必须有服务端去重表或唯一索引
客户端可以重试，但不能绕过幂等检查
超时后应先查状态，再决定是否补偿
```

HTTP 场景最错误的实现是：

```text
while (true) {
    callHttp();
}
```

这不是高可用，这是制造事故。

---

## 6. gRPC 请求中的重试

### 6.1 gRPC 重试不是简单拦截器循环调用

gRPC 官方文档说明，gRPC 的内建 retry 会保存调用历史，并在满足条件时用新的调用替换失败调用、重放调用历史；如果 RPC 收到 response header，该 RPC 就被视为 committed，之后不会再重试。([gRPC][17])

这点非常重要：gRPC retry 是协议栈内的 per-RPC retry，不应该简单用业务拦截器粗暴包一层循环。业务拦截器不了解 RPC 是否已 committed，也不了解底层 transparent retry、server pushback、retry throttling 等机制。

### 6.2 gRPC 默认行为

gRPC 官方文档说明，retry 默认是启用的，但没有默认 retry policy；没有配置 retry policy 时，gRPC 不能安全地重试大多数 RPC，只会做非常有限的 transparent retry，例如确认 RPC 尚未被服务端应用逻辑处理的低层竞态失败。([gRPC][17])

也就是说：

```text
gRPC 开启 retry 功能 ≠ 你的业务 RPC 会自动按策略重试
```

要让业务 RPC 按预期重试，需要配置 service config。

### 6.3 gRPC retry policy 的核心参数

gRPC 官方文档给出的 retry policy 包含：

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

gRPC 官方说明，retry 可配置最大尝试次数、指数退避、可重试状态码，并且会对 backoff delay 应用 ±20% jitter，避免大量客户端同时冲击服务端。([gRPC][17])

### 6.4 gRPC 重试限流

gRPC 支持 retry throttling：客户端为每个 server 维护 token count，失败 RPC 会减少 token，成功 RPC 会增加 token；当 token count 低于阈值时暂停重试，直到恢复。([gRPC][17])

这正是生产系统需要的能力。没有 retry throttling 的 gRPC 重试，在服务端过载时很容易把服务端进一步打死。

### 6.5 gRPC 重试建议

| gRPC 场景 | 推荐策略 |
| --- | --- |
| 只读查询 | `UNAVAILABLE` 可重试，短 deadline，指数退避 |
| 幂等写入 | 可以重试，但必须带 requestId / idempotencyKey |
| 非幂等写入 | 默认不自动重试，超时后查状态 |
| 流式 RPC | 谨慎重试，尤其是双向流 |
| 用户链路 | 小次数、短 deadline |
| 后台同步 | 更多次数、更长 backoff，但必须有总 deadline |
| 服务端过载 | 启用 retry throttling，必要时熔断 |

gRPC service config 还支持 timeout、retry policy、hedging policy 等调用行为配置，并且这些配置可以限制到服务或方法粒度。([gRPC][18])

---

## 7. 有哪些重试策略？哪种场景应该使用哪种？

### 7.1 立即重试

立即重试指失败后不等待，马上再试一次。

| 适用场景 | 不适用场景 |
| --- | --- |
| 极短暂网络毛刺 | 下游过载 |
| 单次 packet collision 类问题 | 高并发系统 |
| 本地 CAS / 乐观锁轻微冲突 | 外部服务 5xx 持续升高 |

Azure 官方建议，立即重试只适合非常短暂的瞬时故障，而且不要超过一次；如果立即重试失败，应切换到指数退避或 fallback。([微软学习][3])

**我的判断：生产系统里立即重试最多一次，多了就是自杀式放大流量。**

### 7.2 固定间隔重试

固定间隔重试是每隔固定时间再试一次，例如每 3 秒一次。

| 适用场景 | 不适用场景 |
| --- | --- |
| 低并发后台任务 | 大规模客户端 |
| 运维脚本 | 高 QPS RPC |
| 人工触发任务 | 限流、过载场景 |

固定间隔最大问题是容易同步。如果一批客户端同时失败，又都每 3 秒重试一次，就会制造周期性流量峰值。

### 7.3 递增间隔重试

递增间隔是 1s、3s、5s、10s 这类线性或阶梯式增长。

| 适用场景 | 说明 |
| --- | --- |
| 后台任务 | 比固定间隔温和 |
| 批处理 | 适合失败成本低、实时性要求不高的任务 |
| 简单 MQ 消费失败 | 可以配合 retry topic |

递增间隔比固定间隔好，但在大规模分布式系统里仍不如指数退避加抖动。

### 7.4 指数退避

指数退避是每次失败后按指数增长等待时间，例如：

```text
100ms → 200ms → 400ms → 800ms → 1600ms
```

Spring Batch 官方文档说明，瞬时失败后等待一段时间再重试通常有帮助；常见做法是使用指数增长等待时间，Spring Batch 为此提供 `ExponentialBackoffPolicy`。([Home][19])

指数退避适合：

| 场景 | 原因 |
| --- | --- |
| HTTP 5xx | 给下游恢复时间 |
| gRPC UNAVAILABLE | 服务实例或连接可能恢复 |
| 云服务 API 限流 | 降低请求频率 |
| 数据库主从切换 | 等待新主可用 |
| MQ 延迟重试 | 避免马上重新打爆下游 |

### 7.5 截断指数退避 + 抖动

这是我认为**分布式系统默认最应该采用的重试策略**。

Google Cloud IAM 官方建议，对安全可重试请求使用 truncated exponential backoff with introduced jitter；文档解释说，如果失败后不等待就重试，会短时间发送大量请求，可能超出配额；抖动可以避免多个客户端同步重试形成 thundering herd。([Google Cloud Documentation][20])

AWS 也强调，如果所有失败调用在同一时间退避结束后一起重试，会再次造成过载；jitter 通过在退避中加入随机性，把重试分散到不同时间。([Amazon Web Services, Inc.][1])

推荐公式：

```text
delay = random(0, min(base * 2^attempt, maxBackoff))
```

这是 Full Jitter 风格，适合高并发系统。

### 7.6 服务端指示重试

服务端指示重试是指客户端优先服从服务端返回的等待时间。

HTTP 中典型是 `Retry-After`；RFC 9110 规定其值可以是 HTTP-date 或延迟秒数。([RFC 编辑器][4]) Azure 也建议，当响应包含 `Retry-After` header 时，应等待至少指定时长再重试，并让这个服务端信号优先于客户端本地 backoff 计算。([微软学习][3])

适用场景：

```text
HTTP 429
HTTP 503
API Gateway 限流
云服务配额限制
服务端主动保护
```

### 7.7 重试预算

重试预算不是单个请求最多重试几次，而是限制一个进程、服务或依赖在一段时间内的总重试量。

Azure 官方建议，除了每个请求的 retry limit，还要实现 retry budget 限制进程或服务内总重试数量；否则许多并发请求各自重试几次，仍然可能压垮下游。([微软学习][3])

适用场景：

```text
高 QPS 微服务
调用共享下游
调用第三方 API
调用限流型云服务
```

我的判断：**高 QPS 服务没有 retry budget，就是迟早要经历 retry storm。**

### 7.8 熔断配合重试

熔断不是重试策略，但它是重试的刹车系统。Azure 建议，对于持续失败的操作，应使用 Circuit Breaker；当某时间窗口内失败数超过阈值时，请求立即失败，而不是继续访问失败资源。([微软学习][3])

适用场景：

```text
下游持续 5xx
连接池耗尽
数据库不可用
第三方 API 大面积失败
```

重试和熔断的关系：

```text
少量瞬时失败：重试
持续失败：熔断
恢复探测：半开探测
恢复成功：关闭熔断
```

### 7.9 死信队列 / 失败表

死信不是重试本身，而是重试耗尽后的归宿。Azure 建议，在所有重试尝试耗尽后使用 dead-letter queue，避免请求信息丢失，将失败工作延后处理。([微软学习][3])

适用场景：

```text
MQ 消费失败
异步任务失败
订单补偿失败
外部系统同步失败
批处理失败
```

死信队列必须配套：

```text
失败原因
原始消息
attempt 次数
最后失败时间
业务 key
traceId
人工重放工具
幂等保护
```

---

## 8. 场景选择矩阵

| 场景 | 推荐重试策略 | 最大次数 | 间隔策略 | 幂等要求 | 最终归宿 |
| --- | --- | ---: | --- | --- | --- |
| 用户 HTTP 查询 | 短重试 | 2~3 | 立即一次 + 短指数退避 + jitter | 建议幂等 | 返回失败/降级 |
| 用户 HTTP 写入 | 谨慎重试 | 0~2 | 指数退避 + jitter | 必须幂等 | 查询状态/补偿 |
| gRPC 查询 | 内建 retry policy | 2~4 | initialBackoff + maxBackoff + multiplier + jitter | 建议幂等 | 返回 status |
| gRPC 写入 | 只重试幂等写 | 0~3 | 指数退避 + retry throttling | 必须幂等 | 查状态/补偿 |
| 线程池任务 | 重新调度 | 3~5 | ScheduledExecutor 延迟 + jitter | 视业务 | 失败表 |
| RabbitMQ 消费 | 延迟重试 + DLQ | 3~10 | 多级延迟 | 必须消费幂等 | DLQ |
| Kafka 消费 | retry topic + DLT | 3~10 | 非阻塞延迟 topic | 必须消费幂等 | DLT |
| 数据库乐观锁冲突 | 短重试 | 1~3 | 立即或短退避 | 操作需可重放 | 返回冲突 |
| 第三方 API 限流 | 服务端指示优先 | 视限额 | Retry-After / 指数退避 | 取决于 API | 延迟任务 |
| 定时批处理 | 长退避 | 多次 | capped exponential backoff | 任务幂等 | 失败表/人工 |
| 支付扣款 | 默认不盲重试 | 0~1 | 先查状态 | 强幂等 | 对账补偿 |

---

## 9. 推荐的统一重试规范

一套合格的企业级重试规范应该包含以下内容。

### 9.1 重试前检查

```text
1. 这个错误是瞬时错误吗？
2. 这个操作是否幂等？
3. 是否已经设置单次 timeout？
4. 是否有总 deadline？
5. 是否会和其他层重复重试？
6. 是否有 retry budget？
7. 重试耗尽后消息/任务去哪里？
8. 是否有指标和日志？
```

### 9.2 默认策略

```text
用户链路：
  maxAttempts = 2~3
  backoff = 50ms / 100ms / 200ms + jitter
  totalTimeout <= 用户体验预算

内部 RPC：
  maxAttempts = 2~4
  perAttemptTimeout 明确配置
  capped exponential backoff with jitter
  配合熔断、限流、重试预算

MQ 消费：
  本地短重试 1~2 次
  失败后进入延迟 retry topic/queue
  超过次数进入 DLQ/DLT

后台任务：
  允许更长退避
  必须持久化 attempt 和状态
  不要依赖进程内存保存重试状态
```

### 9.3 观测指标

Azure 官方建议记录重试次数、平均重试次数、总耗时等指标；偶发瞬时故障和重试是预期现象，但重试数持续上升通常意味着性能或可用性问题。([微软学习][3])

生产系统至少要监控：

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

### 9.4 最危险的反模式

| 反模式 | 后果 |
| --- | --- |
| 无限重试 | 线程、连接、CPU、下游全部被拖死 |
| 没有 timeout 的重试 | 每次尝试都可能无限挂起 |
| 每层都重试 | 重试倍数爆炸 |
| 非幂等写操作自动重试 | 重复扣款、重复下单、重复发券 |
| MQ 失败立即 requeue | redelivery loop |
| 固定间隔大规模重试 | 同步流量峰值 |
| 在工作线程 sleep 等待重试 | 线程池被占满 |
| 只看单请求次数，不看全局预算 | 高并发下仍会压垮下游 |
| 重试耗尽后直接丢弃 | 数据丢失、无法补偿 |

---

## 10. 结论

软件开发中的重试策略，本质是用有限的额外尝试换取更高的瞬时故障容忍度。它应该被视为可靠性工程的一部分，而不是异常处理里的几行循环代码。

本文的最终判断如下：

1. **什么是重试？**
   重试是在失败后按策略重新执行操作，用来处理瞬时故障、部分失败和短暂不可用。

2. **为什么要重试？**
   因为网络、服务、云资源、消息系统和分布式组件都会出现短暂失败；合理重试能显著提升成功率和用户感知可用性。

3. **不重试会怎么样？**
   不重试会把很多本可恢复的瞬时故障直接暴露为业务失败，但这不意味着应该盲目重试。

4. **线程池怎么重试？**
   线程池不自动重试业务任务；执行失败应捕获异常并用 `ScheduledExecutorService` 或任务系统重新调度，提交失败则应限流、降级或拒绝，而不是在拒绝处理器里无限重提。

5. **消息队列怎么重试？**
   MQ 重试必须处理重复消费、offset/ack、延迟重试和死信队列。RabbitMQ 不应无限 requeue，Kafka 消费应控制 offset 提交并保证消费者幂等。

6. **HTTP 怎么重试？**
   HTTP 重试必须遵守方法幂等性、状态码和 `Retry-After`。GET/PUT/DELETE 等幂等语义更适合重试，POST/PATCH 默认不应自动重试，除非业务提供幂等键。

7. **gRPC 怎么重试？**
   gRPC 应优先使用官方 retry policy，通过 service config 配置 `maxAttempts`、`initialBackoff`、`maxBackoff`、`backoffMultiplier`、`retryableStatusCodes` 和 retry throttling。

8. **哪种策略最推荐？**
   对现代分布式系统，默认应使用 **有限次数的截断指数退避 + jitter**。立即重试最多一次，固定间隔只适合低并发简单任务；MQ 长失败要走延迟重试和 DLQ；高 QPS RPC 必须加 retry budget 和熔断。

最终一句话：

> **重试是药，不是饭。小剂量、按处方、配合超时、幂等、退避、抖动和熔断，它能救系统；无限制、无幂等、无预算、无观测，它会把系统拖进雪崩。**

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
