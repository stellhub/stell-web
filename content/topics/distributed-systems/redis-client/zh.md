# Java Redis 客户端选型调研：Jedis、Lettuce、Redisson 与 Spring Data Redis 的比较分析

## 摘要

Java 生态中访问 Redis 的方式主要包括底层 Redis 客户端、高级 Redis 客户端以及 Spring 访问抽象三类。Jedis 和 Lettuce 属于 Redis 官方支持的 Java 客户端；Redisson 属于面向 Redis 与 Valkey 的高层 Java 客户端，提供分布式对象、分布式集合、分布式锁和多种同步器；Spring Data Redis 并不是独立 Redis 协议客户端，而是 Spring 对 Redis 访问的统一抽象层，可基于 Lettuce 或 Jedis 提供 `RedisTemplate`、`StringRedisTemplate`、`ReactiveRedisTemplate` 和 Cache Abstraction 等能力。本文基于 Redis、Spring Data Redis、Spring Boot、Jedis、Lettuce 与 Redisson 官方文档，对当前主流 Java Redis 客户端的使用定位、能力边界、Spring Boot 集成方式、普通业务选型策略与生产使用注意事项进行调研。结论表明，普通 Spring Boot 业务默认应优先使用 Spring Data Redis + Lettuce；仅需要同步命令访问且不使用 Spring 抽象时可使用 Jedis；需要分布式锁、分布式集合、限流器、信号量、布隆过滤器等高级分布式对象时应使用 Redisson；需要响应式或异步模型时应使用 Lettuce 或 Redisson 的异步/响应式 API。

**关键词：** Java；Redis；Jedis；Lettuce；Redisson；Spring Data Redis；Spring Boot；RedisTemplate；分布式锁

## 1. 引言

Redis 是 Java 后端系统中常见的缓存、计数器、排行榜、分布式锁、会话、限流、消息和实时数据访问组件。Java 程序访问 Redis 时通常不会直接实现 Redis 协议，而是通过客户端库或框架抽象完成连接管理、命令编码、响应解码、连接池、集群路由、序列化、异常转换与资源关闭。

Java Redis 客户端选型中存在一个常见混淆：Jedis、Lettuce、Redisson 和 Spring Data Redis 并不处于完全相同的抽象层级。Jedis 与 Lettuce 是 Redis 命令访问客户端；Redisson 是基于 Redis 的高层分布式对象与服务客户端；Spring Data Redis 是 Spring 对 Redis 访问的统一封装，可以在底层接入 Lettuce 或 Jedis。因此，选型应先明确应用需要的是“直接执行 Redis 命令”“通过 Spring 模板访问 Redis”“使用响应式 Redis 访问”还是“使用 Redis 构建分布式并发对象”。

## 2. 研究范围与资料来源

本文主要研究以下 Java Redis 访问方式：

第一，Jedis。Jedis 是 Redis 官方文档中的 Java 客户端之一，官方文档将其定义为同步 Java Redis 客户端。[1]

第二，Lettuce。Lettuce 已加入 Redis 官方客户端体系，Redis 官方文档将其定义为支持同步、异步和响应式连接的高级 Java Redis 客户端。[2]

第三，Redisson。Redisson 官方文档将其定义为基于 Netty 的 Redis 与 Valkey Java 客户端，提供线程安全实现，并提供分布式对象、分布式集合、分布式锁、同步器、缓存、事务、管道、脚本、Spring 集成等能力。[3]

第四，Spring Data Redis。Spring Data Redis 提供 Spring 风格的 Redis 访问抽象，底层可选择 Lettuce 或 Jedis。Spring Boot 对 Redis 提供自动配置，并且 `spring-boot-starter-data-redis` 默认使用 Lettuce。[4]

第五，Redis OM Spring。Redis OM Spring 构建在 Spring Data Redis 之上，面向 Java 对象到 Redis Hash 与 Redis JSON 文档的映射，并提供搜索索引和动态查询能力。该类工具适合对象映射与搜索场景，不是普通缓存访问的默认起点。[5]

本文主要围绕普通后端业务开发，因此重点比较 Jedis、Lettuce、Redisson 和 Spring Data Redis。

## 3. 当前主流 Java Redis 客户端

### 3.1 Jedis

Jedis 是同步 Redis Java 客户端。Redis 官方文档说明，如果只需要同步连接，Jedis 更容易使用；如果需要异步或响应式连接，应使用 Lettuce。[1] Jedis 官方 README 也将其描述为面向性能和易用性的 Java Redis 客户端。[6]

Jedis 7.2.0 引入了新的客户端连接 API，包括 `RedisClient`、`RedisClusterClient` 和 `RedisSentinelClient`，分别用于单连接或连接池、Redis Cluster 和 Redis Sentinel；旧的 `UnifiedJedis`、`JedisPool`、`JedisPooled`、`JedisCluster`、`JedisSentinelPool` 等类在官方 Redis 文档中被标注为旧客户端类。[1]

Jedis 的核心定位是简单、同步、直接执行 Redis 命令。其适用场景包括非 Spring 项目、小型工具程序、同步命令调用、明确需要以 Redis 命令为中心编写代码的场景。

### 3.2 Lettuce

Lettuce 是支持同步、异步和响应式连接的高级 Java Redis 客户端。Redis 官方文档明确说明，Lettuce 支持 synchronous、asynchronous 和 reactive connections；如果只需要同步连接，可以使用 Jedis。[2]

Lettuce 官方项目说明其是基于 Netty 和 Reactor 的可扩展、线程安全 Redis 客户端，提供同步、异步和响应式 API，并支持 Redis Standalone、Pub/Sub、Sentinel、Cluster、Pipelining、自动重连、SSL、Unix Domain Socket、Streaming API、Codec 和 Native Transports。[7]

Lettuce 的核心定位是异步、非阻塞、响应式和 Spring 生态集成。Redis 官方博客在 Lettuce 加入官方客户端体系时说明，Jedis 适合需要快速同步客户端的应用，Lettuce 适合需要实时、异步、响应式能力或与 Spring Framework 紧密集成的应用。[8]

### 3.3 Redisson

Redisson 是基于 Netty 的 Redis 与 Valkey Java 客户端。Redisson 官方文档说明其是 high-performance async and lock-free Java client，具备线程安全实现，支持 Redis 3.0 到最新版本、Valkey 7.2.5 到最新版本，并支持 Single、Cluster、Sentinel、Replicated、Master/Slave、Proxy、Multi-Cluster、Multi-Sentinel 等部署形态。[3]

Redisson 的核心差异在于它不是单纯的 Redis 命令封装，而是在 Redis 之上提供分布式 Java 对象和服务。Redisson 官方资料列出的对象与服务包括 Set、Map、List、Queue、Deque、Semaphore、Lock、AtomicLong、Bloom filter、Scheduler、JCache、Hibernate、RPC、local cache 等。[9]

Redisson 的核心定位是分布式对象、分布式锁、分布式同步器、分布式集合与高级缓存能力。当业务需要使用 Redis 实现跨 JVM 锁、信号量、闭锁、限流器、阻塞队列、延迟队列、本地缓存、MapCache、布隆过滤器等能力时，Redisson 比直接使用 Jedis 手写 Redis 命令更贴近业务抽象。

### 3.4 Spring Data Redis

Spring Data Redis 提供 Spring 应用访问 Redis 的统一抽象。Spring 官方文档说明，无论选择哪一个底层库，应用都可以使用同一套 Spring Data Redis API；`RedisConnection` 和 `RedisConnectionFactory` 负责连接获取与 Redis 通信，并将底层连接库异常转换为 Spring 一致的 DAO 异常体系。[10]

Spring Data Redis 支持 Lettuce 与 Jedis 两类 connector。官方文档说明，Lettuce 是基于 Netty 的开源 connector，通过 `org.springframework.data.redis.connection.lettuce` 包被 Spring Data Redis 支持；Jedis 是 community-driven connector，通过 `org.springframework.data.redis.connection.jedis` 包被 Spring Data Redis 支持。[10]

Spring Data Redis 的核心使用对象是 `RedisTemplate`、`StringRedisTemplate` 和 `ReactiveRedisTemplate`。官方文档说明，`RedisTemplate` 是 Redis 模块的中心类，提供高层抽象，负责序列化和连接管理，并可通过 operation view 访问 String、Hash、List、Set、ZSet、Geo、HyperLogLog 等 Redis 数据结构。[11]

### 3.5 Redis OM Spring

Redis OM Spring 是 Redis 官方生态中的对象映射扩展库，目标是使用熟悉的 Spring Data 注解将 Java 对象映射到 Redis Hash 和 Redis JSON 文档，并利用 Redis Search 提供索引和动态查询能力。[5]

该工具适合需要对象文档、搜索索引、复杂查询和 Redis JSON 的业务；若业务只是普通缓存、计数器、分布式锁或简单 Hash/List/Set 操作，则不应作为默认 Redis 客户端起点。

## 4. 主流客户端对比

| 维度               | Jedis                                      | Lettuce                                    | Redisson                             | Spring Data Redis                                             |
| ---------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------- |
| 抽象层级             | 底层 Redis Java 客户端                          | 底层 Redis Java 客户端                          | 高级 Redis/Valkey Java 客户端             | Spring Redis 访问抽象                                             |
| 官方定位             | 同步 Java Redis 客户端                          | 高级 Java 客户端，支持同步、异步、响应式                    | 基于 Redis/Valkey 的 Java 对象与服务客户端      | Spring 应用访问 Redis 的统一 API                                     |
| 编程模型             | 同步阻塞为主                                     | 同步、异步、响应式                                  | 同步、异步、RxJava、响应式                     | 模板、响应式模板、Repository、Cache                                     |
| Spring Boot 默认集成 | 需要替换 Lettuce 依赖或配置 client-type             | `spring-boot-starter-data-redis` 默认使用      | 通过 `redisson-spring-boot-starter` 集成 | Spring Boot 默认 Redis 访问入口                                     |
| 典型能力             | 基础命令、连接池、Cluster、Sentinel、Pipeline、Pub/Sub | 基础命令、异步、响应式、Cluster、Sentinel、Pipeline、连接复用 | 分布式锁、同步器、集合、队列、缓存、布隆过滤器、原子对象         | RedisTemplate、StringRedisTemplate、ReactiveRedisTemplate、Cache |
| 普通缓存开发           | 可用，但需要自行处理模板封装与序列化                         | 常作为 Spring Data Redis 默认底层客户端              | 可用，但不是普通 KV 的最小依赖                    | 推荐入口                                                          |
| 分布式锁             | 需要按 Redis 锁模式自行实现或引入额外库                    | 需要自行实现或引入额外库                               | 官方直接提供 RLock、Fair Lock、MultiLock 等   | 可通过底层命令实现，但不是锁框架                                              |
| 响应式开发            | 不适合                                        | 适合                                         | 支持 Reactive API                      | 支持 ReactiveRedisTemplate                                      |
| 主要风险点            | 连接池与多线程使用方式需要明确                            | 超时、拓扑刷新、阻塞命令与多路复用关系需要配置                    | 抽象能力较多，需理解锁续期、leaseTime、部署模式         | 序列化、TTL、缓存清理策略、底层客户端差异                                        |

## 5. Redisson 与 Jedis 的抉择

Redisson 与 Jedis 的比较不能只从“哪个 Redis 客户端更好”展开，因为二者抽象层级不同。Jedis 是面向 Redis 命令的同步客户端；Redisson 是面向分布式 Java 对象和服务的高级客户端。

### 5.1 以 Redis 命令为中心的场景

如果业务只需要执行 Redis 基础命令，例如 `GET`、`SET`、`HGET`、`HSET`、`INCR`、`EXPIRE`、`ZADD`、`ZRANGE`、`SADD` 等，且工程不是 Spring Boot 或不希望引入 Spring Data Redis，Jedis 是更直接的选择。其依据是 Jedis 官方定位为同步 Java Redis 客户端，并且 Redis 官方说明仅需要同步连接时 Jedis 更容易使用。[1]

该类场景中，客户端职责主要是连接 Redis、发送命令、读取响应。业务代码需要自行处理 key 设计、序列化、连接池、超时、异常、重试、Pipeline 和集群路由等问题。

### 5.2 以分布式并发对象为中心的场景

如果业务需要分布式锁、可重入锁、公平锁、读写锁、信号量、闭锁、原子变量、阻塞队列、延迟队列、分布式 Map、本地缓存、布隆过滤器等能力，Redisson 是更直接的选择。其依据是 Redisson 官方文档和项目说明中明确列出分布式 Java 对象和服务能力，并提供超过 50 种 Redis/Valkey Java 对象和服务。[3][9]

Redisson 的 `RLock` 行为符合 Java `Lock` 规范，只有锁持有线程可以释放锁，否则会抛出 `IllegalMonitorStateException`。Redisson 还提供 lock watchdog，用于在持锁 Redisson 实例存活时延长锁过期时间；默认 watchdog 超时时间为 30 秒；如果获取锁时指定 `leaseTime`，锁会在指定时间后自动释放。[12]

因此，当问题是“如何直接执行 Redis 命令”时，Jedis 更接近问题本身；当问题是“如何构建跨 JVM 的分布式并发控制或分布式数据结构”时，Redisson 更接近问题本身。

### 5.3 不应把 Redisson 当作 Jedis 的简单替代

Redisson 能执行 Redis 命令，也提供 low-level client，但它的主要价值不在普通 KV 命令封装，而在高级对象模型。若业务只是简单缓存访问，使用 Redisson 会引入与高级抽象相关的额外配置、依赖和概念；若业务需要分布式锁和同步器，则直接使用 Jedis 需要开发者自行保证锁的互斥性、超时释放、误删保护和故障处理。

Redis 官方分布式锁文档指出，分布式锁至少需要考虑互斥性、死锁释放和容错性；简单使用主从复制的锁实现可能因 Redis 复制异步而违反互斥性。[13] 因此，普通业务不应在不了解分布式锁边界的情况下直接用 Jedis 手写锁。

## 6. Spring Boot 项目中的友好程度

### 6.1 默认路径：Spring Data Redis + Lettuce

Spring Boot 官方文档说明，Spring Boot 为 Lettuce 和 Jedis 客户端库以及 Spring Data Redis 抽象提供自动配置；`spring-boot-starter-data-redis` 默认使用 Lettuce，并同时支持传统和响应式应用。[4]

因此，在 Spring Boot 项目中，默认最友好的路径是：

```java
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class CacheService {

    private final StringRedisTemplate stringRedisTemplate;

    public CacheService(StringRedisTemplate stringRedisTemplate) {
        this.stringRedisTemplate = stringRedisTemplate;
    }

    public void setValue(String key, String value) {
        stringRedisTemplate.opsForValue().set(key, value);
    }

    public String getValue(String key) {
        return stringRedisTemplate.opsForValue().get(key);
    }
}
```

这一路径由 Spring Boot 自动配置连接工厂、模板类和基础属性；开发者通常只需要配置 `spring.data.redis.host`、`spring.data.redis.port`、`spring.data.redis.password`、`spring.data.redis.timeout` 等属性。

### 6.2 使用 Jedis 的方式

Spring Boot 官方文档说明，如果要使用 Jedis 替代 Lettuce，需要排除 `lettuce-core` 并引入 `jedis` 依赖；Spring Boot 会管理两者依赖版本，因此切换到 Jedis 时不需要显式指定版本。[14]

Maven 示例结构如下：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
    <exclusions>
        <exclusion>
            <groupId>io.lettuce</groupId>
            <artifactId>lettuce-core</artifactId>
        </exclusion>
    </exclusions>
</dependency>

<dependency>
    <groupId>redis.clients</groupId>
    <artifactId>jedis</artifactId>
</dependency>
```

Jedis 在 Spring Boot 中不是默认路径，只有在业务明确要求 Jedis API、已有 Jedis 封装沉淀、或团队只需要同步模型并希望与历史系统保持一致时才需要替换默认客户端。

### 6.3 使用 Redisson 的方式

Redisson 官方文档提供 `redisson-spring-boot-starter`，用于将 Redisson 集成进 Spring Boot，并依赖 Spring Data Redis 模块。该 starter 支持 Spring Boot 1.3.x 到 4.0.x，并且 Redisson 文档给出了不同 Spring Data Redis 版本对应的 `redisson-spring-data-*` 模块选择方式。[15]

因此，在 Spring Boot 中使用 Redisson 的友好程度取决于业务目标。如果目标是普通 Redis 缓存访问，Spring Data Redis + Lettuce 更轻；如果目标是分布式锁、分布式对象、Spring Cache 扩展、本地缓存、JCache、Session 或高级 Redis 数据结构，Redisson 提供了更直接的 Spring Boot 集成入口。

## 7. 普通业务开发选型规则

### 7.1 标准 Spring Boot 业务

普通 Spring Boot 业务包括验证码、登录态、热点缓存、接口缓存、计数器、简单排行榜、用户状态、短期令牌、幂等标记、简单 Hash/List/Set/ZSet 操作。此类业务默认应使用 Spring Data Redis + Lettuce。

依据包括三点：第一，Spring Boot Redis starter 默认使用 Lettuce；第二，Spring Data Redis 屏蔽底层连接库差异，提供统一 API；第三，`RedisTemplate` 和 `StringRedisTemplate` 负责序列化和连接管理，并且模板对象配置后是线程安全的。[4][10][11]

### 7.2 非 Spring 项目或轻量工具

如果项目不是 Spring Boot，且只需要同步 Redis 命令访问，Jedis 是直接选择。Jedis 官方定位是同步 Java Redis 客户端，并且 Redis 官方说明只需要同步连接时 Jedis 更容易使用。[1]

该场景应使用新的 Jedis 客户端连接 API，并避免在新项目中继续围绕旧类建立封装。

### 7.3 异步、响应式或高并发连接复用场景

如果业务使用 WebFlux、Reactive Streams、异步链路、实时流处理或需要与 Spring Framework 响应式模型集成，Lettuce 是更合适的底层客户端。Redis 官方说明 Lettuce 支持同步、异步和响应式连接；Redis 官方博客也说明 Lettuce 适合需要实时、异步、响应式能力或 Spring Framework 紧密集成的 Java 应用。[2][8]

### 7.4 分布式锁和分布式并发控制场景

如果业务需要跨应用实例的锁、可重入锁、公平锁、读写锁、信号量、闭锁、限流器、延迟队列等能力，应使用 Redisson。Redisson 官方文档直接提供锁与同步器，并说明 watchdog 与 `leaseTime` 的行为。[12]

在此类场景中，不建议用 Jedis 或 Lettuce 临时拼装锁逻辑，除非团队能严格实现 Redis 分布式锁文档要求的互斥性、超时释放、随机值校验释放和故障模型约束。[13]

### 7.5 对象映射与搜索场景

如果业务需要将 Java 对象映射到 Redis Hash 或 Redis JSON，并使用 Redis Search 做索引和动态查询，可以使用 Redis OM Spring。它构建在 Spring Data Redis 之上，适合对象文档与查询模型，不适合替代普通缓存访问的基础组件。[5]

## 8. 生产使用注意事项

### 8.1 不要混淆客户端、模板和业务封装

Jedis、Lettuce 和 Redisson 是客户端；`RedisTemplate`、`StringRedisTemplate` 和 `ReactiveRedisTemplate` 是 Spring Data Redis 提供的模板；业务侧的 CacheService、TokenService、RateLimitService 是进一步封装。分层不清会导致序列化策略、连接管理、异常处理和数据模型被分散在业务代码中。

普通业务应将 Redis 操作封装在领域服务中，而不是在 Controller 或业务流程中散落 `opsForValue()`、`opsForHash()` 和 Lua 脚本。

### 8.2 明确序列化策略

Spring Data Redis 官方文档说明，`RedisTemplate` 默认对多数操作使用 Java-based serializer；也可以替换为 `org.springframework.data.redis.serializer` 包下的其他序列化实现。`StringRedisTemplate` 使用 `StringRedisSerializer`，适合 String 密集型操作，存储内容具备更好的人类可读性。[11]

Spring Data Redis Cache 默认 key serializer 为 `StringRedisSerializer`，value serializer 为 `JdkSerializationRedisSerializer`。[16] 因此，业务在使用 Redis Cache 或 RedisTemplate 时应明确 key/value 序列化方式，避免不同服务、不同语言或不同版本之间无法解析数据。

### 8.3 明确 TTL 和缓存清理策略

Spring Data Redis Cache 默认 key 会加 cache name 前缀，默认 key expiration 为 none；如果需要 TTL，需要显式配置。官方文档还指出，默认 cache clear 使用 `KEYS` 和 `DEL`，`KEYS` 在大 keyspace 中可能带来性能问题，可使用基于 `SCAN` 的 batch strategy；其中 `SCAN` strategy 在 Lettuce driver 下完整支持，Jedis 仅在非 cluster 模式下支持。[16]

因此，业务使用 Redis 作为缓存时，应显式配置 TTL、key 前缀、缓存清理策略和是否允许缓存 null。

### 8.4 正确配置连接池、多路复用和阻塞命令

Redis 官方文档说明，频繁打开和关闭连接存在开销，生产代码应尽量减少单独连接数量。Redis 客户端通常通过连接池或多路复用管理连接；Jedis 支持连接池，Lettuce 同时支持连接池和多路复用。多路复用不能支持 `BLPOP` 等阻塞 pop 命令，因为阻塞命令会阻塞该连接上的所有调用者。[17]

因此，在使用 Lettuce 时，普通非阻塞命令可以利用连接复用；涉及阻塞命令、事务或需要独占连接状态的操作时，应单独评估连接池或专用连接。

### 8.5 配置超时、异常处理和集群拓扑刷新

Lettuce 生产使用文档列出需要关注的项目包括 timeouts、cluster topology refresh、DNS cache、exception handling、connection and execution reliability 和 smart client handoffs。官方文档说明，Lettuce 对命令执行、SSL 握手和 Sentinel discovery 等操作提供超时，默认全局超时为 60 秒，可按操作覆盖。[18]

因此，生产系统不应只配置 Redis 地址和密码，还应配置连接超时、读写超时、命令超时、集群拓扑刷新、异常处理和关闭行为。

### 8.6 分布式锁必须设置业务边界

Redis 官方分布式锁文档说明，分布式锁需要满足互斥性、死锁释放和容错性；简单主从故障转移模型可能因为异步复制导致两个客户端同时持有同一资源锁。[13]

Redisson 的 `RLock` 提供 watchdog 和 `leaseTime`，但业务仍需设置明确的等待时间、租约时间、失败处理策略和 `finally` 释放逻辑。对于支付、库存、结算等强一致业务，不能只因为使用了 Redis 分布式锁就认为一致性已被完整保证。

### 8.7 生产环境启用安全配置

Redis 官方 Jedis 连接文档说明，生产 Redis 应使用 TLS 并遵循 Redis security guidelines。[19] Redis Cloud 文档也说明 TLS 用于加密应用与数据库之间的数据通信，并建议对传输敏感数据的应用启用 TLS。[20]

因此，生产环境应配置认证、ACL、TLS、最小权限、网络隔离和连接超时，不应在公网或跨网络场景使用无认证、无 TLS 的 Redis 连接。

## 9. 结论

Java Redis 客户端选型的核心不是在 Jedis、Lettuce、Redisson 之间做单一排名，而是确认业务需要的抽象层级。

普通 Spring Boot 业务默认使用 Spring Data Redis + Lettuce。这是当前 Spring Boot 官方默认路径，具备自动配置、统一 API、响应式扩展和 Spring 生态一致性。

非 Spring、同步、轻量 Redis 命令访问可以使用 Jedis。它适合命令模型简单、同步调用明确、依赖较少的场景。

异步、响应式、高并发连接复用和 Spring WebFlux 场景应使用 Lettuce。它是 Redis 官方支持的高级 Java 客户端，并且与 Spring Framework 集成紧密。

分布式锁、分布式集合、同步器、队列、本地缓存、布隆过滤器、JCache、分布式对象等场景应使用 Redisson。Redisson 的价值在于 Redis 之上的高级分布式对象与服务，而不是普通 KV 命令访问。

对象映射、Redis JSON、搜索索引和动态查询场景可以使用 Redis OM Spring，但它不应替代普通 Redis 缓存访问的默认组件。

因此，普通业务开发的建议路径是：Spring Boot 默认 Spring Data Redis + Lettuce；需要分布式锁和高级对象时额外引入 Redisson；非 Spring 同步命令工具使用 Jedis；响应式链路使用 Lettuce 或 ReactiveRedisTemplate；不要在没有完整故障模型的情况下手写 Redis 分布式锁。

## 参考文档

[1] Redis 官方 Jedis Guide：Jedis 是同步 Java Redis 客户端；需要高级异步/响应式连接时使用 Lettuce；Jedis 7.2.0 引入新的 `RedisClient`、`RedisClusterClient`、`RedisSentinelClient` API。([Redis][1])
[2] Redis 官方 Lettuce Guide：Lettuce 是支持同步、异步和响应式连接的高级 Java Redis 客户端。([Redis][2])
[3] Redisson Reference Guide：Redisson 是基于 Netty 的 Redis/Valkey Java 客户端，提供线程安全实现并支持多种 Redis/Valkey 部署形态。([Redisson][3])
[4] Spring Boot Redis 官方文档：Spring Boot 为 Lettuce/Jedis 与 Spring Data Redis 提供自动配置，`spring-boot-starter-data-redis` 默认使用 Lettuce。([Home][4])
[5] Redis OM Spring 官方教程：Redis OM Spring 基于 Spring Data Redis，支持 Java 对象到 Redis Hash/JSON 的映射、索引和动态查询。([Redis][5])
[6] Jedis 官方 README：Jedis 是面向性能和易用性的 Java Redis 客户端，并列出 Redis/JDK 版本兼容信息。([GitHub][6])
[7] Lettuce 官方项目说明：Lettuce 是基于 Netty/Reactor 的线程安全 Redis 客户端，支持同步、异步、响应式、Sentinel、Cluster、Pipeline、SSL、Unix Domain Socket 等。([Redis][7])
[8] Redis 官方博客：Lettuce 加入 Redis 官方客户端体系；Jedis 适合快速同步客户端，Lettuce 适合异步、响应式或 Spring Framework 集成场景。([Redis][8])
[9] Redisson 官方项目说明：Redisson 提供超过 50 种 Redis/Valkey Java 对象和服务，包括 Lock、Semaphore、AtomicLong、Bloom filter、Scheduler、JCache 等。([GitHub][9])
[10] Spring Data Redis Drivers 文档：Spring Data Redis 使用统一 API 屏蔽 connector 差异，支持 Lettuce 与 Jedis connector。([Home][10])
[11] Spring Data Redis `RedisTemplate` 文档：`RedisTemplate` 是中心类，负责序列化和连接管理，配置后线程安全；`StringRedisTemplate` 使用 `StringRedisSerializer`。([Home][11])
[12] Redisson Locks and Synchronizers：`RLock`、watchdog、`leaseTime`、owner thread 解锁约束等分布式锁语义。([Redisson][12])
[13] Redis 官方分布式锁文档：分布式锁的互斥性、死锁释放、容错性，以及异步复制下的安全问题。([Redis][13])
[14] Spring Boot How-to：使用 Jedis 替代 Lettuce 需要排除 `lettuce-core` 并引入 `jedis`。([Home][14])
[15] Redisson Spring Boot Starter 文档：`redisson-spring-boot-starter` 集成 Spring Boot，并依赖 Spring Data Redis 模块。([Redisson][15])
[16] Spring Data Redis Cache 文档：Redis Cache 默认序列化、TTL、KEYS/SCAN 清理策略和 Lettuce/Jedis 在 SCAN 支持上的差异。([Home][16])
[17] Redis 官方连接池与多路复用文档：Jedis 支持连接池，Lettuce 支持连接池和多路复用，多路复用不适合阻塞 pop 命令。([Redis][17])
[18] Redis 官方 Lettuce 生产使用文档：生产环境应关注超时、集群拓扑刷新、DNS 缓存、异常处理和连接可靠性；默认全局超时为 60 秒。([Redis][18])
[19] Redis 官方 Jedis 连接文档：生产 Redis 连接应使用 TLS 并遵循 Redis 安全指南。([Redis][19])
[20] Redis Cloud TLS 文档：TLS 用于加密应用与 Redis 数据库之间的通信，并建议传输敏感数据时启用 TLS。([Redis][20])

[1]: https://redis.io/docs/latest/develop/clients/jedis/ "Jedis guide (Java) | Docs"
[2]: https://redis.io/docs/latest/develop/clients/lettuce/ "Lettuce guide (Java) | Docs"
[3]: https://redisson.pro/docs/ "Redisson Reference Guide"
[4]: https://docs.spring.io/spring-boot/reference/data/nosql.html "Working with NoSQL Technologies :: Spring Boot"
[5]: https://redis.io/tutorials/redis-om-spring-getting-started/?utm_source=chatgpt.com "Redis OM Spring Tutorial: Java Object Mapping with JSON ..."
[6]: https://github.com/redis/jedis?utm_source=chatgpt.com "Jedis - Redis Java client"
[7]: https://redis.github.io/lettuce/overview/?utm_source=chatgpt.com "Overview - Lettuce Reference Guide"
[8]: https://redis.io/blog/lettuce-joins-redis-official-client-family/ "Lettuce Joins Redis’ Official Client Family | Redis"
[9]: https://github.com/redisson/redisson?utm_source=chatgpt.com "Redisson: Valkey & Redis Java Client and Real-Time Data ..."
[10]: https://docs.spring.io/spring-data/redis/reference/redis/drivers.html "Drivers :: Spring Data Redis"
[11]: https://docs.spring.io/spring-data/redis/reference/redis/template.html "Working with Objects through RedisTemplate :: Spring Data Redis"
[12]: https://redisson.pro/docs/data-and-services/locks-and-synchronizers/?utm_source=chatgpt.com "Locks and synchronizers - Redisson Reference Guide"
[13]: https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/ "Distributed Locks with Redis | Docs"
[14]: https://docs.spring.io/spring-boot/how-to/nosql.html "NoSQL :: Spring Boot"
[15]: https://redisson.pro/docs/integration-with-spring/ "Integration with Spring - Redisson Reference Guide"
[16]: https://docs.spring.io/spring-data/redis/reference/redis/redis-cache.html "Redis Cache :: Spring Data Redis"
[17]: https://redis.io/docs/latest/develop/clients/pools-and-muxing/ "Connection pools and multiplexing | Docs"
[18]: https://redis.io/docs/latest/develop/clients/lettuce/produsage/ "Production usage | Docs"
[19]: https://redis.io/docs/latest/develop/clients/jedis/connect/?utm_source=chatgpt.com "Connect to the server | Docs"
[20]: https://redis.io/docs/latest/operate/rc/security/database-security/?utm_source=chatgpt.com "Cloud database security | Docs"
