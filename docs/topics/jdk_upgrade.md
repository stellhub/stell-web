---
title: Technical Guide for Migrating from JDK 8, 11, and 17 to JDK 21 and Later
category: Java Engineering
summary: A systematic guide to migrating from JDK 8, JDK 11, and JDK 17 to JDK 21 and later, covering migration paths, benefit sources, upgrade cost, ROI, risk control, observability, and regression testing.
tags:
  - JDK
  - Java
  - Virtual Threads
  - ZGC
  - Performance Regression
readingDirection: Read this when planning enterprise Java runtime upgrades, evaluating JDK 21 or JDK 25, validating virtual threads or Generational ZGC, or designing canary and regression strategies.
outline: deep
---

# Technical Guide for Migrating from JDK 8, 11, and 17 to JDK 21 and Later

## Overview

A systematic guide to migrating from JDK 8, JDK 11, and JDK 17 to JDK 21 and later, covering migration paths, benefit sources, upgrade cost, ROI, risk control, observability, and regression testing.

## Abstract

JDK 21 is one of the important long-term support releases of the Java platform. Its major changes include the final release of virtual threads, the introduction of Generational ZGC, enhancements to the language and class libraries, continued strong encapsulation rules for JDK internal APIs, and the removal of some old APIs and tools. This article focuses on the migration path from JDK 8, JDK 11, and JDK 17 to JDK 21 and later versions. It analyzes current Java version adoption, migration steps, suitable application types, sources of performance gain, upgrade cost, return on investment, risk control, observability, and regression testing strategies. Its conclusions are not based on a single performance number as a universal judgment, but on official documentation, JEP specifications, migration guides, and reproducible experimental methods.

**Keywords:** JDK 21; JDK 25; Java migration; virtual threads; Generational ZGC; G1 GC; ZGC; JVM observability; performance regression; ROI

---

## 1. Introduction

The Java platform evolves with a stable release cadence, and long-term support releases are usually used by enterprises as production baselines. JDK 21 is an important LTS release after JDK 17. OpenJDK lists a series of JEPs integrated from JDK 17 to JDK 21, including virtual threads, Generational ZGC, Record Patterns, Pattern Matching for switch, Sequenced Collections, and other capabilities. JDK 25 was released in 2025 and is treated by most vendors as the next LTS release. The OpenJDK project page states that JDK 25 will be a long-term support release for most vendors. ([OpenJDK][1])

A JDK upgrade should not be regarded only as a language-version change. It should be treated as a comprehensive migration of runtime, dependency ecosystem, build tools, GC strategy, concurrency model, observability, and testing system. The Oracle JDK 21 Migration Guide states that it is intended to help identify possible issues when migrating to JDK 21 and to provide migration recommendations. ([docs.oracle.com][2])

---

## 2. Current Adoption of JDK Versions

Public industry surveys and vendor roadmaps show that Java production environments still contain JDK 8, JDK 11, JDK 17, and JDK 21 at the same time. The Eclipse Foundation 2025 Jakarta EE survey shows that Java 21 usage increased from 30% in 2024 to 43% in 2025, while Java 17, Java 11, and Java 8 still retain a certain installed base. This reflects the common LTS migration lag in enterprise Java applications. ([Adoptium][3])

New Relic's 2024 Java ecosystem report, based on production application telemetry, shows that JDK 17 usage in production grew significantly, and that early adoption of JDK 21 was faster than early adoption of JDK 17. This type of data can be used as supplementary evidence of industry adoption trends, but whether a specific enterprise should upgrade still depends on its application type, dependency state, performance goals, and support-cycle requirements. ([Adoptium][3])

From a support perspective, the Eclipse Temurin support page lists JDK 8, 11, 17, 21, 25, and other versions, and marks JDK 21 and JDK 25 as LTS. Oracle's Java download page also states that JDK 25 is the current latest LTS, while JDK 21 is the previous LTS. ([Adoptium][3])

Enterprise Java version status can therefore be summarized as:

| Version | Typical status | Migration judgment |
| --- | --- | --- |
| JDK 8 | Many legacy systems, large technical gap | Carefully evaluate dependencies, internal APIs, framework versions, and old JVM parameters |
| JDK 11 | Still present in production | A major target for direct migration to JDK 21 |
| JDK 17 | Relatively modern enterprise baseline | Smaller technical gap when migrating to JDK 21 |
| JDK 21 | Modern LTS baseline | Suitable as the current enterprise-standard runtime baseline |
| JDK 25 | New-generation LTS | Suitable as a future evolution baseline and evaluation target for new projects |

---

## 3. Key Technical Changes in JDK 21 and Later Versions

### 3.1 Virtual Threads

JEP 444 finalized virtual threads in JDK 21. OpenJDK defines virtual threads as lightweight threads that dramatically reduce the effort of writing, maintaining, and observing high-throughput concurrent applications. Oracle JDK 21 documentation also explains that Java has two kinds of threads: platform threads and virtual threads. ([OpenJDK][4])

The core impact of virtual threads is not making a single CPU-bound task execute faster. It is reducing thread-resource occupation in blocking-wait scenarios. JEP 444 targets high-throughput concurrent applications, so the main applicable scenarios are services with large amounts of blocking I/O, such as HTTP calls, RPC calls, JDBC access, Redis access, message processing, and aggregation-style API services. ([OpenJDK][4])

### 3.2 Generational ZGC

JEP 439 introduced Generational ZGC in JDK 21. OpenJDK documentation explains that Generational ZGC splits the heap into a young generation and an old generation and allows the two generations to be collected independently, letting ZGC focus on the young-object collections that usually produce higher returns. ([OpenJDK][5])

This feature combines with ZGC's low-latency goal and is suitable for large-heap, low-latency services that need to control GC pause times. Inside Java's introduction to Generational ZGC also explains that ZGC is a scalable low-latency garbage collector and was updated in JDK 21 through JEP 439 to become a generational garbage collector. ([inside.java][6])

### 3.3 Strong Encapsulation of JDK Internal APIs and Migration Constraints

The Oracle JDK 21 Migration Guide states that if old tools or libraries need to access strongly encapsulated internal APIs, `--add-exports` can be used. If reflection needs to access non-public fields or methods of `java.*` APIs, `--add-opens` can be used. This means internal JDK API access is an important compatibility issue when migrating JDK 8 and older applications to newer JDKs. ([docs.oracle.com][7])

The Oracle Migration Guide also recommends reviewing removed APIs, tools, and components before migration. Oracle's JDK 21 removed APIs documentation states that some Java SE APIs were removed between JDK 11 and JDK 21 and recommends using `jdeprscan --release 21 -l --for-removal` to get the list of APIs marked for removal. ([docs.oracle.com][8])

---

## 4. How to Migrate from JDK 8 / JDK 11 / JDK 17 to JDK 21

### 4.1 General Migration Process

For any migration from a lower version to JDK 21, the following general process is recommended:

```text
Asset inventory
  -> build tool upgrade
  -> dependency compatibility check
  -> static analysis
  -> compilation and unit tests
  -> startup and integration tests
  -> performance baseline tests
  -> pre-production canary
  -> phased production rollout
  -> observability and rollback
```

Before migration, complete the following asset inventory:

| Inventory item | Description |
| --- | --- |
| Current JDK version | Distinguish compile-time JDK from runtime JDK |
| Build tools | Maven, Gradle, plugin versions |
| Application frameworks | Spring Boot, Spring Framework, Netty, Tomcat, Dubbo, gRPC, etc. |
| Bytecode tools | ASM, ByteBuddy, CGLIB, Javassist, Mockito, Jacoco, Lombok |
| JVM parameters | GC parameters, memory parameters, module-open parameters |
| APM agents | SkyWalking, Pinpoint, New Relic, Datadog, Arthas, etc. |
| Runtime environment | Docker, Kubernetes, systemd, CI/CD images |
| Performance baseline | QPS, latency, error rate, GC, CPU, memory, thread count |

### 4.2 Static Check Commands

Oracle JDK tool documentation states that `jdeprscan` is a static analysis tool that reports an application's use of deprecated JDK API elements. If the application is not recompiled on every JDK version, or if it depends on third-party binary packages, the tool should be run to identify potential issues. ([docs.oracle.com][9])

Example migration check commands:

```bash
# Check use of internal JDK APIs
jdeps --jdk-internals -recursive target/*.jar

# Check APIs deprecated for removal in JDK 21
jdeprscan --release 21 --for-removal target/*.jar

# Print JVM version and runtime flags
java -version
java -XshowSettings:vm -version
```

### 4.3 JDK 8 to JDK 21

The gap from JDK 8 to JDK 21 is the largest. Common issues include module-system impact, strong encapsulation restrictions, ecosystem changes from `javax.*` to Jakarta, removal of JAXB/JAX-WS and related components, invalid CMS/PermGen parameters, incompatibility of old frameworks, and old bytecode enhancement tools not supporting Java 21 class files.

Recommended migration path:

```text
JDK 8
  -> upgrade build tools
  -> upgrade frameworks and foundational dependencies
  -> adapt to JDK 11
  -> adapt to JDK 17 strong encapsulation rules
  -> migrate to JDK 21
```

Main checks for JDK 8 applications:

| Check item | Risk |
| --- | --- |
| `sun.misc.*`, `com.sun.*` | May depend on internal JDK APIs |
| Reflective access to non-public `java.*` members | May need temporary compatibility through `--add-opens` |
| JAXB / JAX-WS / Activation | May require explicit dependencies |
| Old Spring / Hibernate / MyBatis versions | May not support JDK 21 |
| Old ASM / ByteBuddy / CGLIB versions | May not parse Java 21 bytecode |
| CMS / PermGen parameters | Cannot continue as valid tuning baselines in JDK 21 |

### 4.4 JDK 11 to JDK 21

The migration from JDK 11 to JDK 21 focuses on strong encapsulation after JDK 17, framework compatibility, build tool compatibility, and resetting GC parameters.

Recommended migration path:

```text
JDK 11
  -> JDK 17 compatibility validation
  -> JDK 21 compilation and runtime validation
  -> dedicated GC and concurrency-model tests
```

JDK 11 applications usually need to check:

| Category | Check content |
| --- | --- |
| Build tools | Whether Maven and Gradle support JDK 21 |
| Compiler/test plugins | maven-compiler-plugin, surefire, failsafe, spotless |
| Frameworks | Spring Boot, Spring Framework, Tomcat, Netty, gRPC |
| Agents | APM, diagnostic tools, coverage tools |
| Runtime parameters | GC, logging, module-open parameters |

### 4.5 JDK 17 to JDK 21

The migration gap from JDK 17 to JDK 21 is smaller, but JDK 21 bytecode, dependency versions, agent compatibility, and runtime parameters still need validation. OpenJDK lists the JEPs integrated from JDK 17 to JDK 21, so this migration mainly focuses on validating new capabilities and confirming runtime behavior. ([OpenJDK][1])

Recommended migration path:

```text
JDK 17
  -> add JDK 21 CI build matrix
  -> update dependencies and agents
  -> run full tests on JDK 21
  -> compare G1, ZGC, and Generational ZGC
  -> validate virtual threads for blocking I/O scenarios
```

---

## 5. Application Types and Sources of Benefit

### 5.1 High-Benefit Application Types

Based on the official goals of virtual threads and Generational ZGC, high-benefit applications mainly fall into two categories: blocking-I/O high-concurrency applications, and large-heap low-latency applications. JEP 444 aims to reduce the cost of developing, maintaining, and observing high-throughput concurrent applications. JEP 439 aims to improve application performance through Generational ZGC. ([OpenJDK][4])

| Application type | Main source of benefit |
| --- | --- |
| API gateway, BFF, aggregation layer | Virtual threads reduce platform-thread occupation during blocking waits |
| Spring MVC blocking services | Virtual threads improve blocking-I/O concurrency capacity |
| RPC servers and RPC aggregation services | Virtual threads reduce thread-pool resource constraints |
| Task scheduling and batch systems | Virtual threads lower the thread cost of many blocking tasks |
| Large-heap low-latency services | Generational ZGC reduces the impact of GC pauses |
| High-allocation-rate services | GC and generational collection strategy may improve pauses and throughput |
| CPU-intensive services | Mainly depend on JIT, algorithms, and parallelism; virtual-thread benefits are limited |

### 5.2 Defining GC Benefit Ratio and Virtual-Thread Benefit Ratio

Official documentation does not provide fixed universal ratios for "GC optimization benefit" or "virtual-thread throughput improvement." The reason is that performance gains depend on the application bottleneck and are affected by request model, allocation rate, heap size, connection pools, downstream latency, lock contention, CPU saturation, and other factors.

Therefore, the rigorous approach is to calculate benefit ratios through benchmarks rather than fixed empirical values. The definitions can be:

```text
Total throughput improvement =
  throughput after JDK 21 optimization - original throughput

GC benefit ratio =
  throughput or latency benefit obtained only by switching JDK/GC / total benefit

Virtual-thread benefit ratio =
  benefit obtained by switching from platform-thread model to virtual-thread model
  under the same JDK and same GC / total benefit
```

Test groups:

| Group | JDK | GC | Thread model | Purpose |
| --- | --- | --- | --- | --- |
| A | Original version | Original GC | Original thread model | Production baseline |
| B | JDK 21 | G1 | Original thread model | Evaluate JDK and modern default runtime benefit |
| C | JDK 21 | ZGC / Generational ZGC | Original thread model | Evaluate GC benefit |
| D | JDK 21 | Same as C | Virtual threads | Evaluate virtual-thread benefit |

Throughput can be measured as:

```text
Throughput = successful requests / test duration
```

Latency metrics should include at least:

```text
P50, P90, P99, P999, max, timeout rate, error rate
```

Resource metrics should include at least:

```text
CPU usage, RSS, Heap Used, GC Pause, Allocation Rate, Thread Count, Connection Pool Wait
```

### 5.3 Explaining Benefits in Different Scenarios

For blocking-I/O services, virtual-thread benefits mainly come from reducing platform-thread occupation under high concurrency. For large-heap low-latency services, Generational ZGC benefits mainly come from reducing GC pauses and improving collection efficiency. For CPU-intensive services, virtual threads do not increase CPU computing power, so benefits should be judged through actual benchmarks.

This conclusion aligns with the target scope of JEP 444 and JEP 439: virtual threads target high-throughput concurrent applications, while Generational ZGC targets garbage-collection performance and low-latency improvement. ([OpenJDK][4])

---

## 6. Upgrade Cost and ROI Analysis

### 6.1 Cost Composition

JDK upgrade cost consists of:

| Cost item | Content |
| --- | --- |
| Code adaptation | API removal, reflection access, internal APIs, syntax and compilation issues |
| Dependency upgrade | Frameworks, middleware clients, bytecode libraries, test libraries, agents |
| Build modification | Maven, Gradle, CI images, Dockerfile, build plugins |
| Testing | Unit tests, integration tests, performance tests, compatibility tests |
| Observability changes | JVM logs, JFR, Prometheus, APM metrics |
| Canary and rollback | Multi-version images, phased traffic rollout, abnormal rollback |
| Performance tuning | GC, thread model, connection pools, rate limiting, downstream protection |

### 6.2 Version Gap and Cost Level

| Migration path | Cost level | Main reason |
| --- | --- | --- |
| JDK 17 -> JDK 21 | Low to medium | Small LTS gap, dependency ecosystem is usually newer |
| JDK 11 -> JDK 21 | Medium | Need to handle strong encapsulation, dependency upgrades, and runtime-parameter changes |
| JDK 8 -> JDK 21 | Medium to high | Crosses modularization, component removal, framework upgrades, and old-parameter cleanup |

### 6.3 ROI Model

JDK upgrade ROI should not be measured only by QPS improvement. A more complete model is:

```text
ROI =
  resource cost savings
+ latency stability improvement
+ security and compliance benefits
+ dependency ecosystem maintainability improvement
+ future framework-upgrade benefits
+ concurrency-model simplification benefits
- migration labor cost
- testing cost
- canary risk cost
- rollback and incident-handling cost
```

Resource cost savings can be calculated through load tests and production canary data:

```text
Resource saving rate =
  1 - JDK 21 unit-throughput resource cost / original unit-throughput resource cost
```

Unit-throughput resource cost can be defined as:

```text
Unit-throughput CPU cost = average CPU cores / QPS
Unit-throughput memory cost = average RSS / QPS
Unit-throughput instance cost = instance count / QPS
```

Effective ROI evaluation depends on A/B testing rather than one-off benchmark conclusions.

---

## 7. Main Migration Risks

### 7.1 JDK Internal APIs and Reflective Access

The Oracle JDK 21 Migration Guide states that if old libraries need to access strongly encapsulated internal APIs, `--add-exports` can be used. If reflection needs to access non-public fields and methods of `java.*`, `--add-opens` can be used. Therefore, `--add-opens` can be a compatibility measure, but it should be recorded as a migration risk item rather than treated as a long-term architectural solution. ([docs.oracle.com][7])

### 7.2 Removed APIs, Tools, and Components

Oracle's JDK 21 removed APIs documentation states that some Java SE APIs were removed between JDK 11 and JDK 21 and recommends checking with `jdeprscan`. This check should be included in CI before migration. ([docs.oracle.com][10])

### 7.3 Incompatible GC Parameters

Old JVM parameters may be invalid in JDK 21 or no longer suitable as a tuning baseline. During migration, historical parameters should not be copied directly. Instead, re-evaluate them using JDK 21 GC logs, JFR, and production metrics.

Recommended initial parameters should stay simple:

```bash
-Xms2g -Xmx2g
-XX:+UseG1GC
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags
```

For large-heap low-latency scenarios, add a ZGC comparison group:

```bash
-XX:+UseZGC
-Xlog:gc*,safepoint:file=/logs/gc-zgc.log:time,uptime,level,tags
```

### 7.4 Virtual Threads and Downstream Resources

Virtual threads reduce Java thread-resource cost, but they do not increase database connection pools, Redis connection pools, HTTP connection pools, or downstream service capacity. When migrating to virtual threads, also validate connection-pool wait time, downstream timeouts, circuit breaking, rate limiting, and isolation strategies.

### 7.5 ThreadLocal, Locks, and Blocking Points

The number of virtual threads can be much higher than the number of platform threads, so carefully check:

```text
MDC
TraceContext
SecurityContext
large-object ThreadLocal
synchronized critical sections
native method blocking
connection-pool wait
rate limiting and isolation strategies
```

### 7.6 APM Agents and Bytecode Enhancement Tools

JDK 21 class-file version requires bytecode-related tools to support the new version. Before migration, validate:

```text
ASM
ByteBuddy
CGLIB
Javassist
Mockito
Jacoco
Lombok
SkyWalking Agent
Pinpoint Agent
New Relic Agent
Datadog Agent
Arthas
```

---

## 8. Observability

### 8.1 JVM Observability

During JDK 21 migration, GC, safepoint, and JFR observability should be enabled. JFR is a runtime diagnostic capability provided by the JDK. Oracle API documentation states that the `FlightRecorder` class is used to access, control, and manage Flight Recorder. ([docs.oracle.com][11])

Recommended commands:

```bash
# GC and safepoint logs
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags

# Start JFR at JVM startup
-XX:StartFlightRecording=filename=/logs/app.jfr,dumponexit=true,settings=profile
```

Runtime diagnostic commands:

```bash
# Print JVM version
jcmd <pid> VM.version

# Print JVM flags
jcmd <pid> VM.flags

# Print heap information
jcmd <pid> GC.heap_info

# Print thread dump
jcmd <pid> Thread.print

# Start JFR recording
jcmd <pid> JFR.start name=profile settings=profile filename=/tmp/app.jfr

# Dump JFR recording
jcmd <pid> JFR.dump name=profile filename=/tmp/app.jfr
```

### 8.2 Application-Level Observability

At the application level, observe at least:

```text
QPS
P50 / P90 / P99 / P999 latency
error rate
timeout rate
request queueing time
Tomcat / Jetty / Undertow worker state
HTTP Client connection pool
JDBC connection pool
Redis connection pool
RPC pending request
circuit-breaker and rate-limit trigger count
```

### 8.3 Virtual-Thread-Specific Observability

Oracle JDK 21 documentation includes guidance on debugging and adopting virtual threads, which means virtual threads need to be included in debugging and observability workflows. ([docs.oracle.com][12])

Virtual-thread scenarios should additionally observe:

```text
virtual-thread creation rate
live virtual-thread count
platform-thread count
carrier-thread state
blocking-point distribution
ThreadLocal usage
synchronized contention
connection-pool wait time
downstream service timeout rate
```

### 8.4 Container-Level Observability

In container environments, observe:

```text
Container CPU Usage
CPU Throttling
RSS Memory
Heap Used
Non-Heap Memory
Metaspace
Direct Memory
OOMKilled
cgroup memory limit
available CPU core detection
```

---

## 9. Regression Testing Strategy

### 9.1 Compilation and Unit Tests

```text
Full compilation
Unit tests
Annotation Processor tests
Lombok compilation tests
MapStruct / QueryDSL generated-code tests
Protobuf / gRPC code-generation tests
```

### 9.2 Startup and Runtime Tests

```text
Local startup
Container startup
Kubernetes startup
Configuration-center loading
Registry-center registration
Log initialization
Health checks
Graceful shutdown
APM agent attachment
```

### 9.3 Interface Compatibility Tests

```text
HTTP API response structure
RPC protocol compatibility
error-code compatibility
JSON serialization compatibility
time-format compatibility
BigDecimal precision
enum compatibility
null semantics
pagination and sorting
```

### 9.4 Data Access Tests

```text
MySQL CRUD
transaction propagation
connection-pool exhaustion
slow SQL scenarios
Redis serialization compatibility
Redis Lua scripts
Kafka consumer offsets
Elasticsearch queries
cache key and value compatibility
```

### 9.5 Performance Regression Tests

Performance testing should include at least four groups:

```text
A. Original JDK + original JVM parameters + original thread model
B. JDK 21 + G1 + original thread model
C. JDK 21 + ZGC / Generational ZGC + original thread model
D. JDK 21 + same GC + virtual-thread model
```

Each group should record:

```text
maximum stable QPS
P50 / P90 / P99 / P999
CPU usage
RSS
Heap Used
GC Pause
Allocation Rate
Thread Count
Connection Pool Wait
Error Rate
Timeout Rate
```

### 9.6 Canary Regression

Production canary should include at least:

```text
1% traffic
5% traffic
20% traffic
50% traffic
100% traffic
```

Each phase should define rollback thresholds:

```text
P99 latency rises significantly
error rate rises
timeout rate rises
CPU usage is abnormal
RSS grows abnormally
GC Pause is abnormal
connection-pool wait is abnormal
downstream error rate rises
```

---

## 10. Conclusion

JDK 21 is an important target version for migrating from JDK 8, JDK 11, and JDK 17 to a modern Java runtime. Its key value includes virtual threads, Generational ZGC, language and class-library enhancements, and a runtime baseline compatible with the modern Java ecosystem. JDK 25 has become the next LTS evolution direction, but for many existing systems, JDK 21 is still the more stable migration target. ([Oracle][13])

From a migration difficulty perspective, JDK 17 to JDK 21 has relatively low cost and is suitable as an early pilot; JDK 11 to JDK 21 has medium cost and needs focused handling of dependencies, build tools, and strong encapsulation; JDK 8 to JDK 21 has the highest cost and requires systematic governance of old frameworks, old APIs, old JVM parameters, and historical technical debt.

From a benefit-source perspective, blocking-I/O high-concurrency services are more suitable for validating virtual threads, large-heap low-latency services are more suitable for validating Generational ZGC, and CPU-intensive services should focus on JIT, algorithms, and actual resource utilization. GC optimization benefit ratio and virtual-thread benefit ratio should not use fixed empirical values; they should be calculated through grouped benchmarks and production canary data.

From an engineering practice perspective, a JDK upgrade must cover static analysis, dependency upgrades, build changes, JVM parameter reset, JFR and GC log observability, performance regression, downstream protection, canary rollout, and rollback strategy. A version upgrade without observability and regression testing is not verifiable.

---

## 11. Appendix: Virtual Thread Test Repository

The virtual-thread benefit evaluation discussed in this article can be validated with the benchmark repository:

```text
https://github.com/stellhub/jdk-virtual-thread-benchmark
```

This repository is a virtual-thread test library based on JDK 25. It can compare platform threads and virtual threads under blocking-task and high-concurrency workloads. It is suitable as supporting material for JDK 21 / JDK 25 virtual-thread evaluation, internal technical sharing, concurrency-model teaching, and performance experiments.

[1]: https://openjdk.org/projects/jdk/21/jeps-since-jdk-17?utm_source=chatgpt.com "JEPs in JDK 21 integrated since JDK 17"
[2]: https://docs.oracle.com/en/java/javase/21/migrate/index.html?utm_source=chatgpt.com "Oracle JDK Migration Guide - Java"
[3]: https://adoptium.net/support?utm_source=chatgpt.com "Temurin(TM) Support"
[4]: https://openjdk.org/jeps/444?utm_source=chatgpt.com "JEP 444: Virtual Threads"
[5]: https://openjdk.org/jeps/439?utm_source=chatgpt.com "JEP 439: Generational ZGC"
[6]: https://inside.java/2023/11/28/gen-zgc-explainer/?utm_source=chatgpt.com "Introducing Generational ZGC"
[7]: https://docs.oracle.com/en/java/javase/21/migrate/migrating-jdk-8-later-jdk-releases.html?utm_source=chatgpt.com "7 Migrating From JDK 8 to Later JDK Releases"
[8]: https://docs.oracle.com/en/java/javase/21/migrate/getting-started.html?utm_source=chatgpt.com "Oracle JDK Migration Guide"
[9]: https://docs.oracle.com/en/java/javase/21/core/running-jdeprscan.html?utm_source=chatgpt.com "Running jdeprscan"
[10]: https://docs.oracle.com/en/java/javase/21/migrate/removed-apis.html?utm_source=chatgpt.com "4 Removed APIs - Java SE"
[11]: https://docs.oracle.com/javase/jp/21/docs/api/jdk.jfr/jdk/jfr/FlightRecorder.html?utm_source=chatgpt.com "FlightRecorder (Java SE 21 & JDK 21)"
[12]: https://docs.oracle.com/javase/jp/21/core/virtual-threads.html?utm_source=chatgpt.com "Virtual Threads"
[13]: https://www.oracle.com/jp/java/technologies/downloads/?utm_source=chatgpt.com "Java Downloads | Oracle Japan"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/jdk_upgrade)
