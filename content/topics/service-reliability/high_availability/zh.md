# 局部性能优化导致系统可用性下降的典型案例分析

## 摘要

在软件系统设计中，高并发、高性能和高可用通常被同时作为核心目标。三者之间存在协同关系，也存在约束关系。部分系统在优化高并发或高性能时，会过度关注局部指标，例如单接口响应时间、单服务吞吐量、单次调用成功率、资源利用率等，从而忽略故障隔离、超时控制、容量边界、降级策略和恢复能力。该类设计在正常流量下可能表现良好，但在依赖抖动、缓存失效、流量突增、发布变更或下游故障时，容易引发请求堆积、重试放大、资源耗尽和级联故障。

本文围绕研发过程中常见的工程错误，分析局部性能优化对全局可用性的影响，并总结相应的治理原则与检查清单。

---

## 1. 问题背景

三高设计通常包括：

```text
高并发：系统在大量请求同时到达时保持处理能力
高性能：系统以较低延迟、较高吞吐完成业务处理
高可用：系统在故障、抖动、发布、扩容等场景下持续提供服务
```

在实际工程中，三者并不总是同向增强。某些局部优化会提升短期性能指标，但同时增加系统风险。例如：

```text
扩大线程池可以短期提升并发接入能力，但可能增加请求堆积和故障恢复时间
延长超时时间可以提升单次调用成功概率，但可能造成资源长期占用
增加缓存可以降低数据库压力，但缓存失效时可能形成集中回源
增加重试可以降低偶发失败，但可能放大下游流量
```

因此，三高设计不能只关注“更快”和“更多”，还需要关注：

```text
故障是否可隔离
流量是否可控制
资源是否有上限
失败是否可恢复
异常是否可观测
系统是否可降级
```

---

## 2. 典型错误一：无边界扩大线程池

### 2.1 现象

在接口响应变慢或并发能力不足时，研发人员可能直接扩大线程池参数：

```java
new ThreadPoolExecutor(
    500,
    1000,
    60,
    TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(100000)
);
```

该方式在短时间内可能提升服务接收请求的能力，但也会增加请求排队、上下文切换和内存占用。

### 2.2 风险过程

典型故障链路如下：

```text
下游服务响应变慢
  ↓
业务线程池开始排队
  ↓
上游请求等待时间增加
  ↓
网关或客户端触发超时重试
  ↓
请求量被放大
  ↓
线程池队列继续增长
  ↓
CPU、内存、GC 压力上升
  ↓
服务实例健康检查失败
  ↓
流量转移到剩余实例
  ↓
集群整体压力继续升高
```

### 2.3 问题本质

线程池的作用不仅是提高并发处理能力，也是系统资源的边界控制手段。过大的线程池和过长的队列会隐藏下游故障，使失败延迟暴露，导致故障恢复时间变长。

### 2.4 治理方式

线程池设计应包含以下约束：

```text
按业务场景隔离线程池
按下游依赖隔离线程池
限制最大线程数
限制队列长度
设置拒绝策略
监控队列长度、活跃线程数、拒绝次数和任务等待时间
```

示例：

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

## 3. 典型错误二：为了提高成功率延长超时时间

### 3.1 现象

当远程调用出现失败时，常见处理方式是延长超时时间：

```java
OkHttpClient client = new OkHttpClient.Builder()
    .connectTimeout(Duration.ofSeconds(30))
    .readTimeout(Duration.ofSeconds(60))
    .writeTimeout(Duration.ofSeconds(60))
    .build();
```

该方式可能降低短期失败率，但会增加线程、连接和内存占用时间。

### 3.2 风险过程

```text
下游服务响应变慢
  ↓
上游请求长时间等待
  ↓
业务线程无法释放
  ↓
连接池资源被占用
  ↓
新请求无法及时处理
  ↓
队列堆积
  ↓
上游继续重试
  ↓
服务进入慢性不可用状态
```

### 3.3 问题本质

超时不是单纯的失败控制参数，而是系统资源保护机制。过长的超时时间会降低系统快速失败和快速恢复能力。

### 3.4 治理方式

远程调用应设置完整的超时预算：

```text
连接超时
读超时
写超时
整体调用超时
业务请求总超时
```

示例：

```java
OkHttpClient client = new OkHttpClient.Builder()
    .connectTimeout(Duration.ofMillis(200))
    .readTimeout(Duration.ofMillis(800))
    .writeTimeout(Duration.ofMillis(300))
    .callTimeout(Duration.ofMillis(1000))
    .build();
```

同时需要配合：

```text
熔断
限流
降级
重试预算
依赖隔离
```

---

## 4. 典型错误三：无预算重试

### 4.1 现象

为了降低偶发失败，系统可能在远程调用失败后立即重试：

```java
for (int i = 0; i < 3; i++) {
    try {
        return remoteClient.call(request);
    } catch (Exception e) {
        // Retry immediately
    }
}
```

### 4.2 风险过程

假设上游原始流量为 10,000 QPS，每个请求最多重试 3 次，则下游最大承受流量可能变为：

```text
10,000 QPS × 3 = 30,000 QPS
```

如果调用链中多层服务都设置重试，请求量可能进一步放大：

```text
A -> B -> C -> D

每层重试 3 次
最终请求放大倍数可能达到 3 × 3 × 3 = 27 倍
```

### 4.3 问题本质

重试可以提升偶发失败场景下的成功概率，但在下游已经异常时，重试会增加下游压力，并可能加速故障扩散。

### 4.4 治理方式

重试需要满足以下条件：

```text
仅对幂等请求重试
限制最大重试次数
设置指数退避
增加随机抖动
设置重试预算
遵守请求总超时
禁止多层无序重试
```

示例：

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

## 5. 典型错误四：无保护地引入缓存

### 5.1 现象

数据库查询慢时，常见优化方式是增加 Redis 或本地缓存：

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

该方案可以降低数据库访问频率，但缺少缓存失效保护。

### 5.2 风险场景

| 场景          | 后果          |
| ----------- | ----------- |
| 热点 key 过期   | 大量请求同时回源数据库 |
| 大批 key 同时过期 | 缓存雪崩        |
| 空数据不缓存      | 缓存穿透        |
| 无互斥重建       | 缓存击穿        |
| Redis 故障    | 请求直接压向数据库   |

### 5.3 问题本质

缓存不是单纯的性能优化组件，也是数据库保护层。缺少回源保护的缓存，在失效场景下可能将流量集中转移到数据库。

### 5.4 治理方式

缓存设计需要包含：

```text
空值缓存
TTL 随机化
热点 key 预热
互斥重建
逻辑过期
本地缓存兜底
限流保护数据库
降级返回旧值
```

示例：

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

## 6. 典型错误五：数据库连接池配置过大

### 6.1 现象

在数据库访问慢或并发不足时，可能直接增大连接池：

```properties
spring.datasource.hikari.maximum-pool-size=200
spring.datasource.hikari.connection-timeout=30000
```

如果服务部署 20 个实例，则理论最大连接数为：

```text
200 × 20 = 4000
```

### 6.2 风险过程

```text
应用连接池扩大
  ↓
数据库并发连接数升高
  ↓
数据库 CPU、内存、锁竞争增加
  ↓
SQL 响应变慢
  ↓
连接占用时间进一步变长
  ↓
应用侧请求继续等待
  ↓
数据库成为全局瓶颈
```

### 6.3 问题本质

数据库连接池不是简单的性能加速器，而是数据库访问压力的控制边界。过大的连接池会把应用层并发压力传导到数据库。

### 6.4 治理方式

连接池设计应结合数据库承载能力、实例数量和 SQL 耗时评估：

```properties
spring.datasource.hikari.maximum-pool-size=30
spring.datasource.hikari.minimum-idle=10
spring.datasource.hikari.connection-timeout=300
spring.datasource.hikari.validation-timeout=200
spring.datasource.hikari.max-lifetime=1800000
```

同时需要配合：

```text
慢 SQL 监控
SQL 执行超时
读写分离
核心查询和非核心查询隔离
批处理限速
数据库访问限流
```

---

## 7. 典型错误六：超级聚合接口引入弱依赖故障

### 7.1 现象

为了减少远程调用次数，系统可能设计一个聚合接口：

```text
GET /user/home
```

该接口内部调用多个服务：

```text
用户服务
关注服务
推荐服务
广告服务
会员服务
活动服务
风控服务
```

### 7.2 风险过程

```text
聚合接口依赖数量增加
  ↓
任意一个弱依赖变慢
  ↓
整体接口响应时间上升
  ↓
线程资源占用增加
  ↓
核心页面接口超时
  ↓
用户核心路径受影响
```

### 7.3 问题本质

减少网络调用并不一定提升全局可用性。聚合接口如果缺少强弱依赖划分，会让非核心依赖影响核心链路。

### 7.4 治理方式

聚合接口应区分依赖等级：

| 依赖类型  | 处理方式      |
| ----- | --------- |
| 强依赖   | 失败时接口可失败  |
| 弱依赖   | 失败时降级     |
| 可选依赖  | 超时后返回默认值  |
| 高风险依赖 | 独立线程池或隔离舱 |

示例：

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

## 8. 典型错误七：错误使用异步线程池

### 8.1 现象

为了缩短接口响应时间，部分逻辑被直接提交到异步线程池：

```java
CompletableFuture.runAsync(() -> {
    sendMessage(order);
    updatePoints(order);
    notifyUser(order);
});
```

接口响应时间下降，但异步任务的可靠性可能不足。

### 8.2 风险场景

| 问题       | 后果       |
| -------- | -------- |
| 异步任务执行失败 | 业务结果不完整  |
| 线程池队列满   | 任务被拒绝    |
| 进程重启     | 内存任务丢失   |
| 没有幂等     | 重试导致重复处理 |
| 没有监控     | 故障不可见    |

### 8.3 问题本质

异步化可以缩短主链路响应时间，但不能替代可靠消息机制。影响业务结果的异步任务需要可持久化、可重试、可追踪。

### 8.4 治理方式

不同任务应采用不同机制：

| 任务类型         | 建议方式          |
| ------------ | ------------- |
| 可丢弃任务        | 本地线程池         |
| 需要最终一致的任务    | MQ            |
| 需要和本地事务绑定的任务 | Outbox / 事务消息 |
| 定时补偿任务       | Job + 幂等处理    |

可靠异步链路示例：

```text
订单写入数据库
  ↓
写入 outbox_event 表
  ↓
后台任务投递 MQ
  ↓
消费者处理
  ↓
幂等校验
  ↓
失败重试或进入死信队列
```

---

## 9. 典型错误八：为提升读性能直接读从库

### 9.1 现象

读写分离可以降低主库压力，但如果所有读请求都直接路由到从库，可能读到旧数据。

```text
写入主库成功
  ↓
立即查询数据
  ↓
请求路由到从库
  ↓
主从复制存在延迟
  ↓
返回旧数据
```

### 9.2 高风险场景

```text
支付状态
订单状态
权限变更
库存扣减
优惠券领取
风控结果
```

### 9.3 问题本质

读写分离不是简单的 SQL 路由策略，而是一致性策略。不同业务场景对一致性要求不同。

### 9.4 治理方式

```text
写后读主
关键读走主库
从库延迟超过阈值后摘除
业务允许最终一致时才读从库
基于数据版本判断是否可读从库
```

示例：

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

## 10. 典型错误九：批处理过大导致失败成本上升

### 10.1 现象

为了提高吞吐，消费者或批任务可能一次处理大量数据：

```java
List<Event> events = queue.poll(10000);
eventRepository.batchInsert(events);
```

### 10.2 风险场景

| 问题       | 后果       |
| -------- | -------- |
| 单批耗时过长   | 消费延迟增加   |
| 失败回滚范围大  | 重试成本升高   |
| 内存占用增加   | OOM 风险增加 |
| 数据库锁时间变长 | 影响其他请求   |
| 热点集中写入   | 数据库抖动    |

### 10.3 问题本质

批处理优化的是吞吐，但会影响延迟、内存、锁竞争和失败恢复成本。

### 10.4 治理方式

批处理应同时受数量和时间窗口约束：

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

需要监控：

```text
单批大小
单批耗时
消费延迟
失败次数
重试次数
积压量
```

---

## 11. 典型错误十：本地缓存缺少一致性机制

### 11.1 现象

为了降低远程读取开销，系统可能将规则、权限、配置缓存在本地内存中。

```text
实例 A 缓存版本 v1
实例 B 缓存版本 v2
实例 C 更新失败仍为 v1
```

### 11.2 风险场景

| 缓存对象 | 风险        |
| ---- | --------- |
| 权限规则 | 越权或误拒绝    |
| 限流规则 | 部分实例规则不生效 |
| 路由规则 | 流量进入错误节点  |
| 灰度规则 | 灰度比例异常    |
| 黑名单  | 风控绕过      |
| 价格配置 | 金额错误      |

### 11.3 问题本质

本地缓存提升的是单实例访问性能，但多实例环境下需要处理一致性和失效传播。

### 11.4 治理方式

治理规则、限流规则、路由规则等配置类数据应具备：

```text
版本号
主动推送
本地快照
TTL 兜底
变更审计
失败回滚
实例级加载状态观测
```

示例：

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

## 12. 典型错误十一：缺少限流导致全链路雪崩

### 12.1 现象

系统在追求最大吞吐时，可能不设置入口限流、接口限流或资源限流。

### 12.2 风险过程

```text
突发流量进入系统
  ↓
应用线程被打满
  ↓
数据库连接池被打满
  ↓
Redis、MQ、DB 同时承压
  ↓
请求响应时间上升
  ↓
上游触发重试
  ↓
系统压力进一步放大
  ↓
健康检查失败
  ↓
实例被摘除
  ↓
剩余实例继续承压
```

### 12.3 问题本质

限流不是单纯减少请求量，而是在超过系统容量时保护核心链路和关键资源。

### 12.4 治理方式

限流应分层实施：

```text
网关限流
服务限流
接口限流
用户维度限流
租户维度限流
资源维度限流
下游依赖限流
```

示例：

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

## 13. 典型错误十二：只关注平均响应时间

### 13.1 现象

压测报告中经常只展示平均响应时间：

```text
平均 RT = 20ms
```

但平均值无法反映尾部请求延迟。

### 13.2 示例

| 指标    | 数值   |
| ----- | ---- |
| 平均 RT | 20ms |
| P95   | 80ms |
| P99   | 2s   |
| P999  | 8s   |

该情况下，大量请求仍然较快，但尾部请求会长期占用线程和连接资源。

### 13.3 问题本质

高可用系统需要关注尾延迟。尾延迟高会引起请求堆积、超时重试和资源耗尽。

### 13.4 治理方式

性能评估应同时包含：

```text
平均 RT
P50
P95
P99
P999
最大耗时
错误率
超时率
队列等待时间
下游调用耗时
```

---

## 14. 典型错误十三：全量发布缺少灰度和回滚

### 14.1 现象

为了缩短发布周期，系统可能采用全量发布：

```text
构建
  ↓
全量部署
  ↓
全部实例重启
```

### 14.2 风险场景

| 问题       | 后果       |
| -------- | -------- |
| 新版本缺陷    | 影响全部流量   |
| 健康检查不足   | 异常实例接收流量 |
| 配置同时变更   | 定位难度增加   |
| 数据库结构不兼容 | 回滚复杂     |
| 缺少回滚流程   | 故障恢复时间增加 |

### 14.3 问题本质

发布流程是高可用设计的一部分。全量发布会扩大故障影响面。

### 14.4 治理方式

发布过程应包含：

```text
小流量灰度
分批发布
健康检查
核心指标观测
自动回滚
配置和代码分离发布
数据库变更兼容设计
```

典型流程：

```text
1% 灰度
  ↓
观察错误率、P99、CPU、内存、GC、业务指标
  ↓
10% 灰度
  ↓
继续观察
  ↓
50% 灰度
  ↓
全量发布
```

---

## 15. 典型错误十四：资源混部缺少隔离

### 15.1 现象

为了提高资源利用率，系统可能将核心在线业务、后台任务、日志消费和报表任务部署在同一资源池。

```text
核心交易服务
报表任务
日志消费任务
消息推送任务
后台导出任务
```

### 15.2 风险过程

```text
报表任务扫描大量数据
  ↓
数据库 CPU 升高
  ↓
核心接口查询变慢
  ↓
订单接口超时
  ↓
用户请求失败
```

或者：

```text
日志消费积压
  ↓
消费者加速追赶
  ↓
Kafka、ES、网络资源被打满
  ↓
核心服务受到影响
```

### 15.3 问题本质

资源利用率提升可能降低故障隔离能力。非核心任务如果和核心链路共享资源，可能在异常场景下影响核心业务。

### 15.4 治理方式

资源隔离可以从以下层面实施：

```text
在线业务和离线任务隔离
核心服务和非核心服务隔离
核心数据库和分析数据库隔离
核心 Redis 和缓存 Redis 隔离
核心 MQ Topic 和日志 Topic 隔离
线程池隔离
Kubernetes Namespace / Node Pool 隔离
```

---

## 16. 典型错误十五：缺少幂等设计

### 16.1 现象

为了减少一次查询或唯一性校验，写接口可能没有幂等保护：

```java
public void issueCoupon(Long userId, Long couponId) {
    couponRepository.insert(userId, couponId);
}
```

### 16.2 风险场景

```text
客户端重试
网关重试
RPC 重试
MQ 重投
服务端超时但实际执行成功
```

这些场景都可能导致重复发券、重复扣款、重复加积分或重复创建订单。

### 16.3 问题本质

幂等设计不是性能优化项，而是分布式系统中处理重试、超时和重复消息的基础能力。

### 16.4 治理方式

常见方式包括：

```text
请求唯一 ID
业务唯一键
数据库唯一索引
状态机校验
去重表
幂等记录表
```

示例：

```java
public void issueCoupon(Long userId, Long couponId, String requestId) {
    boolean inserted = idempotentRepository.tryInsert(requestId);
    if (!inserted) {
        return;
    }

    couponRepository.insert(userId, couponId);
}
```

数据库约束示例：

```sql
CREATE UNIQUE INDEX uk_user_coupon ON user_coupon(user_id, coupon_id);
```

---

## 17. 典型错误十六：减少观测数据导致故障不可定位

### 17.1 现象

为了降低存储成本，系统可能缩短日志和指标保留周期，或者降低 Trace 采样率。

```text
日志只保留 1 天
指标只保留 3 天
Trace 采样极低
错误日志未单独保留
```

### 17.2 风险过程

```text
线上事故发生
  ↓
需要回溯故障前后的指标
  ↓
发现指标已过期
  ↓
需要查询异常请求 Trace
  ↓
发现采样未命中
  ↓
需要检索错误日志
  ↓
发现日志已清理
  ↓
问题定位依赖推测
```

### 17.3 问题本质

可观测性属于高可用能力的一部分。缺少日志、指标和链路追踪，会影响故障定位、恢复和复盘。

### 17.4 治理方式

建议对观测数据分层保留：

| 数据类型       | 处理方式            |
| ---------- | --------------- |
| 错误日志       | 较长周期保留          |
| 普通 info 日志 | 短周期保留           |
| 指标         | 高精度短期保留，降采样长期保留 |
| Trace      | 普通请求采样，错误请求全采样  |
| 审计日志       | 独立存储，长期保留       |

---

## 18. 典型错误十七：共享状态处理不当

### 18.1 现象

为了提高访问速度，系统可能直接使用本地共享状态：

```java
private static final Map<String, Integer> COUNTER = new HashMap<>();
```

即使改为 `ConcurrentHashMap`，业务操作也不一定是线程安全的：

```java
Integer count = map.get(userId);
map.put(userId, count + 1);
```

### 18.2 风险场景

```text
并发写入导致计数错误
实例重启导致状态丢失
多实例之间状态不一致
内存持续增长导致泄漏
本地状态无法横向扩展
```

### 18.3 问题本质

本地共享状态适合临时、非关键、可丢弃的数据。对于库存、余额、限流计数、权限状态等关键数据，单机内存通常不能作为最终状态来源。

### 18.4 治理方式

```text
使用原子操作
限制本地状态生命周期
设置容量上限
关键状态外置存储
多实例状态通过一致性机制维护
```

示例：

```java
counterMap.computeIfAbsent(userId, key -> new AtomicInteger())
          .incrementAndGet();
```

---

## 19. 典型错误十八：为性能跳过安全和参数校验

### 19.1 现象

为了降低接口耗时，可能减少参数校验、权限校验、签名校验或风控校验。

### 19.2 风险场景

| 被跳过的校验 | 风险       |
| ------ | -------- |
| 参数校验   | 脏数据入库    |
| 权限校验   | 越权访问     |
| 签名校验   | 非法请求进入系统 |
| 风控校验   | 异常流量绕过   |
| 状态校验   | 业务状态错乱   |

### 19.3 问题本质

正确性和安全性是系统稳定运行的前置条件。降低校验成本应通过优化实现，而不是取消校验。

### 19.4 治理方式

```text
网关前置校验
本地权限缓存
规则预编译
批量鉴权
签名算法优化
热点权限数据缓存
风控结果短 TTL 缓存
```

---

## 20. 反模式归纳

| 反模式     | 表面收益      | 可用性风险       |
| ------- | --------- | ----------- |
| 扩大线程池   | 提升并发接入能力  | 请求堆积、恢复变慢   |
| 延长超时    | 提高单次调用成功率 | 资源长期占用      |
| 无预算重试   | 降低偶发失败    | 流量放大、下游过载   |
| 无保护缓存   | 降低数据库压力   | 雪崩、击穿、穿透    |
| 扩大连接池   | 增加数据库并发   | 数据库被压垮      |
| 超级聚合接口  | 减少网络调用    | 弱依赖拖垮核心链路   |
| 错误异步化   | 缩短接口响应时间  | 任务丢失、不可恢复   |
| 直接读从库   | 降低主库压力    | 读到旧数据       |
| 大批量处理   | 提高吞吐      | 延迟升高、失败成本增加 |
| 本地缓存规则  | 降低远程访问    | 多实例不一致      |
| 缺少限流    | 提升瞬时接入量   | 全链路雪崩       |
| 只看平均 RT | 指标展示较好    | 掩盖尾延迟       |
| 全量发布    | 缩短发布周期    | 故障影响面扩大     |
| 资源混部    | 提高资源利用率   | 非核心业务影响核心业务 |
| 缺少幂等    | 减少校验成本    | 重试导致重复处理    |
| 减少观测数据  | 降低存储成本    | 故障不可定位      |
| 共享状态不当  | 降低访问延迟    | 并发错误和状态不一致  |
| 跳过安全校验  | 降低接口耗时    | 安全和数据风险     |

---

## 21. 三高设计中的工程检查清单

在进行高并发和高性能优化前，应检查以下问题：

```text
1. 当前优化是否会增加下游压力？
2. 当前优化是否扩大了故障影响面？
3. 是否设置了超时、限流、熔断和降级？
4. 是否存在请求堆积和队列无限增长风险？
5. 是否存在重试放大风险？
6. 缓存失效时是否会集中回源？
7. 数据库连接池是否符合数据库真实承载能力？
8. 弱依赖是否与核心链路隔离？
9. 异步任务是否具备可靠投递和失败补偿能力？
10. 读写分离是否处理了写后读一致性？
11. 批处理是否存在过大批次和失败回滚风险？
12. 本地缓存是否具备版本、失效和兜底机制？
13. 限流策略是否覆盖入口、接口、用户、资源和下游？
14. 压测报告是否包含 P95、P99、P999 和错误率？
15. 发布流程是否支持灰度、观测和回滚？
16. 核心业务与非核心业务是否完成资源隔离？
17. 写接口是否具备幂等能力？
18. 日志、指标和 Trace 是否足够支撑故障定位？
19. 本地共享状态是否会造成多实例不一致？
20. 参数、权限和安全校验是否被正确保留？
```

---

## 22. 结论

高并发和高性能优化如果缺少可用性约束，可能导致局部指标改善而全局稳定性下降。工程实践中需要将性能优化置于容量边界、故障隔离、超时控制、限流降级、幂等处理、灰度发布和可观测体系之内。

面向生产系统的三高设计，应以以下原则作为基础：

```text
资源有上限
请求有超时
重试有预算
失败可降级
故障可隔离
数据可恢复
发布可回滚
问题可观测
```

在此基础上，高并发设计解决流量承载问题，高性能设计解决处理效率问题，高可用设计解决故障场景下的持续服务问题。局部优化只有在不破坏全局可用性的前提下，才具备工程价值。
