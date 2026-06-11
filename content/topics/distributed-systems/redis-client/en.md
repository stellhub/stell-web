# Java Redis Client Selection Research: Comparative Analysis of Jedis, Lettuce, Redisson, and Spring Data Redis

## Abstract

Java applications access Redis mainly through three kinds of approaches: low-level Redis clients, higher-level Redis clients, and Spring access abstractions. Jedis and Lettuce are officially supported Java clients for Redis. Redisson is a high-level Java client for Redis and Valkey that provides distributed objects, distributed collections, distributed locks, and many synchronizers. Spring Data Redis is not an independent Redis protocol client; it is Spring's unified abstraction for Redis access and can use Lettuce or Jedis underneath to provide `RedisTemplate`, `StringRedisTemplate`, `ReactiveRedisTemplate`, Cache Abstraction, and related capabilities. Based on official documentation from Redis, Spring Data Redis, Spring Boot, Jedis, Lettuce, and Redisson, this article studies the positioning, capability boundaries, Spring Boot integration paths, ordinary business selection strategies, and production usage notes for mainstream Java Redis clients. The conclusion is that ordinary Spring Boot business applications should prefer Spring Data Redis + Lettuce by default; Jedis can be used when only synchronous command access is needed and Spring abstractions are not used; Redisson should be used when distributed locks, distributed collections, rate limiters, semaphores, Bloom filters, and other advanced distributed objects are needed; Lettuce or Redisson's asynchronous/reactive APIs should be used when an asynchronous or reactive model is required.

**Keywords:** Java; Redis; Jedis; Lettuce; Redisson; Spring Data Redis; Spring Boot; RedisTemplate; distributed lock

## 1. Introduction

Redis is a common component in Java backend systems for caching, counters, leaderboards, distributed locks, sessions, rate limiting, messaging, and real-time data access. Java programs usually do not implement the Redis protocol directly. Instead, they rely on client libraries or framework abstractions for connection management, command encoding, response decoding, connection pooling, cluster routing, serialization, exception translation, and resource closing.

There is a common confusion in Java Redis client selection: Jedis, Lettuce, Redisson, and Spring Data Redis are not at exactly the same abstraction layer. Jedis and Lettuce are Redis command access clients. Redisson is a high-level distributed object and service client built on Redis. Spring Data Redis is Spring's unified wrapper for Redis access and can integrate Lettuce or Jedis underneath. Therefore, selection should first clarify whether the application needs to "execute Redis commands directly," "access Redis through Spring templates," "use reactive Redis access," or "build distributed concurrency objects with Redis."

## 2. Research Scope and Sources

This article mainly studies the following Java Redis access approaches.

First, Jedis. Jedis is one of the Java clients listed in the official Redis documentation, which defines it as a synchronous Java Redis client. [1]

Second, Lettuce. Lettuce has joined the Redis official client family. The official Redis documentation defines it as an advanced Java Redis client that supports synchronous, asynchronous, and reactive connections. [2]

Third, Redisson. The official Redisson documentation defines it as a Netty-based Java client for Redis and Valkey. It provides thread-safe implementations and distributed objects, distributed collections, distributed locks, synchronizers, caches, transactions, pipelines, scripts, Spring integration, and other capabilities. [3]

Fourth, Spring Data Redis. Spring Data Redis provides Spring-style Redis access abstractions, with Lettuce or Jedis selectable underneath. Spring Boot provides automatic Redis configuration, and `spring-boot-starter-data-redis` uses Lettuce by default. [4]

Fifth, Redis OM Spring. Redis OM Spring is built on top of Spring Data Redis. It maps Java objects to Redis Hashes and Redis JSON documents and provides search indexes and dynamic query capabilities. This kind of tool is suitable for object mapping and search scenarios, but it is not the default starting point for ordinary cache access. [5]

This article focuses on ordinary backend business development, so the main comparison covers Jedis, Lettuce, Redisson, and Spring Data Redis.

## 3. Current Mainstream Java Redis Clients

### 3.1 Jedis

Jedis is a synchronous Redis Java client. The official Redis documentation explains that if only synchronous connections are needed, Jedis is easier to use; if asynchronous or reactive connections are needed, Lettuce should be used. [1] The official Jedis README also describes it as a Java Redis client focused on performance and ease of use. [6]

Jedis 7.2.0 introduced a new client connection API, including `RedisClient`, `RedisClusterClient`, and `RedisSentinelClient`, which are used for single connections or connection pools, Redis Cluster, and Redis Sentinel respectively. Older classes such as `UnifiedJedis`, `JedisPool`, `JedisPooled`, `JedisCluster`, and `JedisSentinelPool` are marked as legacy client classes in the official Redis documentation. [1]

The core positioning of Jedis is simple, synchronous, direct Redis command execution. Its suitable scenarios include non-Spring projects, small tools, synchronous command calls, and cases where code is intentionally written around Redis commands.

### 3.2 Lettuce

Lettuce is an advanced Java Redis client that supports synchronous, asynchronous, and reactive connections. The official Redis documentation explicitly states that Lettuce supports synchronous, asynchronous, and reactive connections; if only synchronous connections are needed, Jedis can be used. [2]

The official Lettuce project describes it as a scalable, thread-safe Redis client based on Netty and Reactor. It provides synchronous, asynchronous, and reactive APIs and supports Redis Standalone, Pub/Sub, Sentinel, Cluster, Pipelining, automatic reconnect, SSL, Unix Domain Socket, Streaming API, Codec, and Native Transports. [7]

The core positioning of Lettuce is asynchronous, non-blocking, reactive, and integrated with the Spring ecosystem. When Lettuce joined the Redis official client family, the official Redis blog explained that Jedis is suitable for applications that need a quick synchronous client, while Lettuce is suitable for applications that need real-time, asynchronous, reactive capabilities or tight integration with Spring Framework. [8]

### 3.3 Redisson

Redisson is a Netty-based Java client for Redis and Valkey. The official Redisson documentation states that it is a high-performance asynchronous and lock-free Java client with thread-safe implementations. It supports Redis 3.0 through the latest version, Valkey 7.2.5 through the latest version, and deployment modes including Single, Cluster, Sentinel, Replicated, Master/Slave, Proxy, Multi-Cluster, and Multi-Sentinel. [3]

The core difference of Redisson is that it is not simply a Redis command wrapper. It provides distributed Java objects and services on top of Redis. The objects and services listed in official Redisson material include Set, Map, List, Queue, Deque, Semaphore, Lock, AtomicLong, Bloom filter, Scheduler, JCache, Hibernate, RPC, local cache, and more. [9]

The core positioning of Redisson is distributed objects, distributed locks, distributed synchronizers, distributed collections, and advanced caching capabilities. When the business needs to use Redis to implement cross-JVM locks, semaphores, latches, rate limiters, blocking queues, delayed queues, local caches, MapCache, Bloom filters, and similar capabilities, Redisson is closer to the business abstraction than directly writing Redis commands with Jedis.

### 3.4 Spring Data Redis

Spring Data Redis provides a unified abstraction for Spring applications to access Redis. The official Spring documentation explains that regardless of the underlying library selected, applications can use the same Spring Data Redis API. `RedisConnection` and `RedisConnectionFactory` are responsible for obtaining connections and communicating with Redis, and they translate underlying connection-library exceptions into Spring's consistent DAO exception hierarchy. [10]

Spring Data Redis supports two connector families: Lettuce and Jedis. Official documentation explains that Lettuce is an open-source connector based on Netty and is supported through the `org.springframework.data.redis.connection.lettuce` package; Jedis is a community-driven connector supported through the `org.springframework.data.redis.connection.jedis` package. [10]

The core Spring Data Redis objects are `RedisTemplate`, `StringRedisTemplate`, and `ReactiveRedisTemplate`. Official documentation explains that `RedisTemplate` is the central class of the Redis module. It provides a high-level abstraction, handles serialization and connection management, and can access Redis data structures such as String, Hash, List, Set, ZSet, Geo, and HyperLogLog through operation views. [11]

### 3.5 Redis OM Spring

Redis OM Spring is an object mapping extension library in the official Redis ecosystem. Its goal is to use familiar Spring Data annotations to map Java objects to Redis Hashes and Redis JSON documents, and to provide indexes and dynamic query capabilities through Redis Search. [5]

This tool is suitable for business scenarios that need object documents, search indexes, complex queries, and Redis JSON. If the business only needs ordinary caching, counters, distributed locks, or simple Hash/List/Set operations, it should not be the default starting point for Redis clients.

## 4. Comparison of Mainstream Clients

| Dimension | Jedis | Lettuce | Redisson | Spring Data Redis |
| --- | --- | --- | --- | --- |
| Abstraction level | Low-level Redis Java client | Low-level Redis Java client | High-level Redis/Valkey Java client | Spring Redis access abstraction |
| Official positioning | Synchronous Java Redis client | Advanced Java client supporting sync, async, and reactive models | Java object and service client based on Redis/Valkey | Unified API for Spring applications to access Redis |
| Programming model | Mainly synchronous blocking | Synchronous, asynchronous, reactive | Synchronous, asynchronous, RxJava, reactive | Template, reactive template, Repository, Cache |
| Spring Boot default integration | Requires replacing Lettuce dependency or configuring client type | Default used by `spring-boot-starter-data-redis` | Integrated through `redisson-spring-boot-starter` | Default Redis access entry in Spring Boot |
| Typical capabilities | Basic commands, connection pool, Cluster, Sentinel, Pipeline, Pub/Sub | Basic commands, async, reactive, Cluster, Sentinel, Pipeline, connection reuse | Distributed locks, synchronizers, collections, queues, caches, Bloom filters, atomic objects | RedisTemplate, StringRedisTemplate, ReactiveRedisTemplate, Cache |
| Ordinary cache development | Usable, but templates and serialization must be handled manually | Commonly used as the default underlying client for Spring Data Redis | Usable, but not the minimal dependency for ordinary key-value usage | Recommended entry point |
| Distributed locks | Need to implement Redis lock patterns manually or introduce another library | Need to implement manually or introduce another library | Directly provides RLock, Fair Lock, MultiLock, and more | Can be implemented through underlying commands, but it is not a lock framework |
| Reactive development | Not suitable | Suitable | Provides Reactive API | Supports ReactiveRedisTemplate |
| Main risks | Connection pool and multithreaded usage must be clear | Timeout, topology refresh, blocking commands, and multiplexing relationships need configuration | Many abstractions; lock renewal, leaseTime, and deployment mode must be understood | Serialization, TTL, cache clearing strategy, and underlying client differences |

## 5. Choosing Between Redisson and Jedis

The comparison between Redisson and Jedis should not start from "which Redis client is better," because they are at different abstraction layers. Jedis is a synchronous client centered on Redis commands. Redisson is a high-level client centered on distributed Java objects and services.

### 5.1 Redis-Command-Centered Scenarios

If the business only needs to execute basic Redis commands such as `GET`, `SET`, `HGET`, `HSET`, `INCR`, `EXPIRE`, `ZADD`, `ZRANGE`, and `SADD`, and the project is not a Spring Boot project or does not want to introduce Spring Data Redis, Jedis is the more direct choice. The basis is that Jedis is officially positioned as a synchronous Java Redis client, and Redis official documentation states that Jedis is easier to use when only synchronous connections are needed. [1]

In this kind of scenario, the client's responsibilities are mainly connecting to Redis, sending commands, and reading responses. Business code needs to handle key design, serialization, connection pools, timeouts, exceptions, retries, Pipeline, cluster routing, and related concerns by itself.

### 5.2 Distributed-Concurrency-Object-Centered Scenarios

If the business needs distributed locks, reentrant locks, fair locks, read-write locks, semaphores, latches, atomic variables, blocking queues, delayed queues, distributed maps, local caches, Bloom filters, and similar capabilities, Redisson is the more direct choice. The basis is that official Redisson documentation and project material explicitly list distributed Java objects and services and provide more than 50 Redis/Valkey Java objects and services. [3][9]

Redisson's `RLock` behavior follows the Java `Lock` specification. Only the thread that owns the lock can release it; otherwise, an `IllegalMonitorStateException` is thrown. Redisson also provides a lock watchdog that extends the lock expiration time while the Redisson instance holding the lock is alive. The default watchdog timeout is 30 seconds. If `leaseTime` is specified when acquiring the lock, the lock is automatically released after the specified time. [12]

Therefore, when the problem is "how to execute Redis commands directly," Jedis is closer to the problem itself. When the problem is "how to build cross-JVM distributed concurrency control or distributed data structures," Redisson is closer to the problem itself.

### 5.3 Redisson Should Not Be Treated as a Simple Replacement for Jedis

Redisson can execute Redis commands and also provides a low-level client, but its primary value is not ordinary key-value command wrapping. Its primary value is the higher-level object model. If the business only needs simple cache access, using Redisson introduces additional configuration, dependencies, and concepts related to advanced abstractions. If the business needs distributed locks and synchronizers, directly using Jedis requires developers to ensure mutual exclusion, timeout release, accidental-delete protection, and failure handling by themselves.

The official Redis distributed lock documentation states that distributed locks must at least consider mutual exclusion, deadlock release, and fault tolerance. A simple lock implementation based on master-replica replication may violate mutual exclusion because Redis replication is asynchronous. [13] Therefore, ordinary business code should not handwrite locks with Jedis without understanding the boundaries of distributed locks.

## 6. Friendliness in Spring Boot Projects

### 6.1 Default Path: Spring Data Redis + Lettuce

The official Spring Boot documentation states that Spring Boot provides auto-configuration for Lettuce and Jedis client libraries and for the Spring Data Redis abstraction. `spring-boot-starter-data-redis` uses Lettuce by default and supports both traditional and reactive applications. [4]

Therefore, in Spring Boot projects, the friendliest default path is:

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

This path lets Spring Boot auto-configure the connection factory, template classes, and basic properties. Developers usually only need to configure properties such as `spring.data.redis.host`, `spring.data.redis.port`, `spring.data.redis.password`, and `spring.data.redis.timeout`.

### 6.2 How to Use Jedis

The official Spring Boot documentation explains that to use Jedis instead of Lettuce, `lettuce-core` must be excluded and the `jedis` dependency must be introduced. Spring Boot manages dependency versions for both, so switching to Jedis does not require explicitly specifying a version. [14]

The Maven structure is:

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

Jedis is not the default path in Spring Boot. It is only necessary to replace the default client when the business explicitly requires the Jedis API, has accumulated existing Jedis wrappers, or only needs the synchronous model and wants to stay consistent with legacy systems.

### 6.3 How to Use Redisson

The official Redisson documentation provides `redisson-spring-boot-starter` to integrate Redisson into Spring Boot, and it depends on the Spring Data Redis module. This starter supports Spring Boot 1.3.x through 4.0.x. Redisson documentation also provides mapping guidance for selecting different `redisson-spring-data-*` modules for different Spring Data Redis versions. [15]

Therefore, Redisson's friendliness in Spring Boot depends on the business goal. If the goal is ordinary Redis cache access, Spring Data Redis + Lettuce is lighter. If the goal is distributed locks, distributed objects, Spring Cache extensions, local cache, JCache, Session, or advanced Redis data structures, Redisson provides a more direct Spring Boot integration entry.

## 7. Selection Rules for Ordinary Business Development

### 7.1 Standard Spring Boot Business

Ordinary Spring Boot business includes verification codes, login sessions, hot caches, API caches, counters, simple leaderboards, user status, short-lived tokens, idempotency markers, and simple Hash/List/Set/ZSet operations. This kind of business should use Spring Data Redis + Lettuce by default.

The basis includes three points. First, the Spring Boot Redis starter uses Lettuce by default. Second, Spring Data Redis hides differences between underlying connection libraries and provides a unified API. Third, `RedisTemplate` and `StringRedisTemplate` handle serialization and connection management, and template objects are thread-safe once configured. [4][10][11]

### 7.2 Non-Spring Projects or Lightweight Tools

If the project is not Spring Boot and only needs synchronous Redis command access, Jedis is the direct choice. Jedis is officially positioned as a synchronous Java Redis client, and Redis official documentation states that Jedis is easier to use when only synchronous connections are needed. [1]

In this scenario, the new Jedis client connection API should be used, and new projects should avoid building wrappers around older classes.

### 7.3 Asynchronous, Reactive, or High-Concurrency Connection Reuse Scenarios

If the business uses WebFlux, Reactive Streams, asynchronous call chains, real-time stream processing, or needs integration with the Spring Framework reactive model, Lettuce is the more appropriate underlying client. Redis official documentation states that Lettuce supports synchronous, asynchronous, and reactive connections. The official Redis blog also explains that Lettuce is suitable for Java applications that need real-time, asynchronous, reactive capabilities or tight Spring Framework integration. [2][8]

### 7.4 Distributed Locks and Distributed Concurrency Control

If the business needs cross-application-instance locks, reentrant locks, fair locks, read-write locks, semaphores, latches, rate limiters, delayed queues, and similar capabilities, Redisson should be used. The official Redisson documentation directly provides locks and synchronizers and explains the behavior of watchdog and `leaseTime`. [12]

In such scenarios, it is not recommended to assemble lock logic temporarily with Jedis or Lettuce unless the team can strictly implement the mutual exclusion, timeout release, random-value release validation, and failure model constraints required by the official Redis distributed lock documentation. [13]

### 7.5 Object Mapping and Search Scenarios

If the business needs to map Java objects to Redis Hashes or Redis JSON and use Redis Search for indexes and dynamic queries, Redis OM Spring can be used. It is built on Spring Data Redis and is suitable for object documents and query models. It is not suitable as a replacement for the base component of ordinary cache access. [5]

## 8. Production Usage Notes

### 8.1 Do Not Confuse Clients, Templates, and Business Wrappers

Jedis, Lettuce, and Redisson are clients. `RedisTemplate`, `StringRedisTemplate`, and `ReactiveRedisTemplate` are templates provided by Spring Data Redis. Business-side `CacheService`, `TokenService`, and `RateLimitService` are further wrappers. If the layers are unclear, serialization strategy, connection management, exception handling, and data modeling become scattered across business code.

Ordinary business should encapsulate Redis operations in domain services instead of scattering `opsForValue()`, `opsForHash()`, and Lua scripts through controllers or business flows.

### 8.2 Make the Serialization Strategy Explicit

The official Spring Data Redis documentation explains that `RedisTemplate` uses Java-based serializers by default for most operations; it can also be replaced with other serialization implementations from the `org.springframework.data.redis.serializer` package. `StringRedisTemplate` uses `StringRedisSerializer`, which is suitable for string-heavy operations and stores content in a more human-readable form. [11]

Spring Data Redis Cache uses `StringRedisSerializer` as the default key serializer and `JdkSerializationRedisSerializer` as the default value serializer. [16] Therefore, business code should explicitly define key/value serialization when using Redis Cache or RedisTemplate to avoid data that cannot be parsed across services, languages, or versions.

### 8.3 Make TTL and Cache Clearing Strategies Explicit

Spring Data Redis Cache prefixes keys with the cache name by default, and the default key expiration is none. TTL must be explicitly configured if needed. Official documentation also notes that the default cache clear uses `KEYS` and `DEL`; `KEYS` may cause performance issues in large keyspaces, and a `SCAN`-based batch strategy can be used instead. The `SCAN` strategy is fully supported under the Lettuce driver, while Jedis only supports it in non-cluster mode. [16]

Therefore, when using Redis as a cache, business systems should explicitly configure TTL, key prefixes, cache clearing strategy, and whether caching null values is allowed.

### 8.4 Configure Connection Pools, Multiplexing, and Blocking Commands Correctly

Redis official documentation explains that frequently opening and closing connections has overhead, so production code should minimize the number of separate connections. Redis clients usually manage connections through connection pools or multiplexing. Jedis supports connection pools; Lettuce supports both connection pools and multiplexing. Multiplexing cannot support blocking pop commands such as `BLPOP`, because a blocking command blocks all callers on that connection. [17]

Therefore, when using Lettuce, ordinary non-blocking commands can use connection reuse. Operations involving blocking commands, transactions, or exclusive connection state should separately evaluate connection pools or dedicated connections.

### 8.5 Configure Timeouts, Exception Handling, and Cluster Topology Refresh

Lettuce production usage documentation lists items that require attention, including timeouts, cluster topology refresh, DNS cache, exception handling, connection and execution reliability, and smart client handoffs. Official documentation explains that Lettuce provides timeouts for command execution, SSL handshake, Sentinel discovery, and related operations. The default global timeout is 60 seconds and can be overridden per operation. [18]

Therefore, production systems should not only configure Redis address and password. They should also configure connection timeout, read/write timeout, command timeout, cluster topology refresh, exception handling, and shutdown behavior.

### 8.6 Distributed Locks Must Have Business Boundaries

The official Redis distributed lock documentation explains that distributed locks must satisfy mutual exclusion, deadlock release, and fault tolerance. A simple master-replica failover model may allow two clients to hold the same resource lock at the same time because replication is asynchronous. [13]

Redisson's `RLock` provides watchdog and `leaseTime`, but business code still needs explicit wait time, lease time, failure handling strategy, and `finally` release logic. For strongly consistent business such as payment, inventory, and settlement, using a Redis distributed lock alone does not mean consistency is completely guaranteed.

### 8.7 Enable Security Configuration in Production

The official Redis Jedis connection documentation states that production Redis should use TLS and follow Redis security guidelines. [19] Redis Cloud documentation also explains that TLS encrypts data communication between applications and databases and recommends enabling TLS for applications that transmit sensitive data. [20]

Therefore, production environments should configure authentication, ACLs, TLS, least privilege, network isolation, and connection timeouts. Redis connections without authentication or TLS should not be used on public networks or across network boundaries.

## 9. Conclusion

The core of Java Redis client selection is not ranking Jedis, Lettuce, and Redisson, but identifying the abstraction layer the business needs.

Ordinary Spring Boot business should use Spring Data Redis + Lettuce by default. This is the current official Spring Boot default path, with auto-configuration, unified API, reactive extension, and consistency with the Spring ecosystem.

Non-Spring, synchronous, lightweight Redis command access can use Jedis. It is suitable for scenarios with a simple command model, clear synchronous calls, and fewer dependencies.

Asynchronous, reactive, high-concurrency connection reuse, and Spring WebFlux scenarios should use Lettuce. It is an officially supported advanced Java client for Redis and is tightly integrated with Spring Framework.

Distributed locks, distributed collections, synchronizers, queues, local caches, Bloom filters, JCache, distributed objects, and similar scenarios should use Redisson. Redisson's value lies in high-level distributed objects and services on top of Redis, not ordinary key-value command access.

Object mapping, Redis JSON, search indexes, and dynamic query scenarios can use Redis OM Spring, but it should not replace the default component for ordinary Redis cache access.

Therefore, the recommended path for ordinary business development is: Spring Boot defaults to Spring Data Redis + Lettuce; introduce Redisson when distributed locks and advanced objects are needed; use Jedis for non-Spring synchronous command tools; use Lettuce or ReactiveRedisTemplate for reactive call chains; and do not handwrite Redis distributed locks without a complete failure model.

## References

[1] Official Redis Jedis Guide: Jedis is a synchronous Java Redis client; use Lettuce when advanced asynchronous/reactive connections are needed; Jedis 7.2.0 introduced the new `RedisClient`, `RedisClusterClient`, and `RedisSentinelClient` APIs. ([Redis][1])
[2] Official Redis Lettuce Guide: Lettuce is an advanced Java Redis client that supports synchronous, asynchronous, and reactive connections. ([Redis][2])
[3] Redisson Reference Guide: Redisson is a Netty-based Redis/Valkey Java client that provides thread-safe implementations and supports multiple Redis/Valkey deployment modes. ([Redisson][3])
[4] Official Spring Boot Redis documentation: Spring Boot provides auto-configuration for Lettuce/Jedis and Spring Data Redis, and `spring-boot-starter-data-redis` uses Lettuce by default. ([Home][4])
[5] Official Redis OM Spring tutorial: Redis OM Spring is based on Spring Data Redis and supports mapping Java objects to Redis Hash/JSON, indexes, and dynamic queries. ([Redis][5])
[6] Official Jedis README: Jedis is a Java Redis client focused on performance and ease of use, and it lists Redis/JDK version compatibility information. ([GitHub][6])
[7] Official Lettuce project overview: Lettuce is a thread-safe Redis client based on Netty/Reactor and supports synchronous, asynchronous, reactive, Sentinel, Cluster, Pipeline, SSL, Unix Domain Socket, and more. ([Redis][7])
[8] Official Redis blog: Lettuce joined the Redis official client family; Jedis is suitable for fast synchronous clients, while Lettuce is suitable for asynchronous, reactive, or Spring Framework integration scenarios. ([Redis][8])
[9] Official Redisson project description: Redisson provides more than 50 Redis/Valkey Java objects and services, including Lock, Semaphore, AtomicLong, Bloom filter, Scheduler, JCache, and more. ([GitHub][9])
[10] Spring Data Redis Drivers documentation: Spring Data Redis hides connector differences behind a unified API and supports Lettuce and Jedis connectors. ([Home][10])
[11] Spring Data Redis `RedisTemplate` documentation: `RedisTemplate` is the central class, handles serialization and connection management, and is thread-safe once configured; `StringRedisTemplate` uses `StringRedisSerializer`. ([Home][11])
[12] Redisson Locks and Synchronizers: distributed lock semantics for `RLock`, watchdog, `leaseTime`, and owner-thread unlock constraints. ([Redisson][12])
[13] Official Redis distributed lock documentation: mutual exclusion, deadlock release, fault tolerance, and safety issues under asynchronous replication. ([Redis][13])
[14] Spring Boot How-to: using Jedis instead of Lettuce requires excluding `lettuce-core` and adding `jedis`. ([Home][14])
[15] Redisson Spring Boot Starter documentation: `redisson-spring-boot-starter` integrates with Spring Boot and depends on Spring Data Redis modules. ([Redisson][15])
[16] Spring Data Redis Cache documentation: Redis Cache default serialization, TTL, KEYS/SCAN clearing strategies, and the difference between Lettuce and Jedis support for SCAN. ([Home][16])
[17] Official Redis connection pool and multiplexing documentation: Jedis supports connection pools, Lettuce supports connection pools and multiplexing, and multiplexing is not suitable for blocking pop commands. ([Redis][17])
[18] Official Redis Lettuce production usage documentation: production environments should consider timeouts, cluster topology refresh, DNS cache, exception handling, and connection reliability; the default global timeout is 60 seconds. ([Redis][18])
[19] Official Redis Jedis connection documentation: production Redis connections should use TLS and follow Redis security guidelines. ([Redis][19])
[20] Redis Cloud TLS documentation: TLS encrypts communication between applications and Redis databases and is recommended when sensitive data is transmitted. ([Redis][20])

[1]: https://redis.io/docs/latest/develop/clients/jedis/ "Jedis guide (Java) | Docs"
[2]: https://redis.io/docs/latest/develop/clients/lettuce/ "Lettuce guide (Java) | Docs"
[3]: https://redisson.pro/docs/ "Redisson Reference Guide"
[4]: https://docs.spring.io/spring-boot/reference/data/nosql.html "Working with NoSQL Technologies :: Spring Boot"
[5]: https://redis.io/tutorials/redis-om-spring-getting-started/?utm_source=chatgpt.com "Redis OM Spring Tutorial: Java Object Mapping with JSON"
[6]: https://github.com/redis/jedis?utm_source=chatgpt.com "Jedis - Redis Java client"
[7]: https://redis.github.io/lettuce/overview/?utm_source=chatgpt.com "Overview - Lettuce Reference Guide"
[8]: https://redis.io/blog/lettuce-joins-redis-official-client-family/ "Lettuce Joins Redis' Official Client Family | Redis"
[9]: https://github.com/redisson/redisson?utm_source=chatgpt.com "Redisson: Valkey & Redis Java Client and Real-Time Data"
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
