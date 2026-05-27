---
title: "从 JDK 8 / 11 / 17 迁移至 JDK 21 及以上版本的技术指南"
category: "Java 工程"
summary: "系统分析从 JDK 8、JDK 11、JDK 17 迁移到 JDK 21 及以上版本的路径、收益来源、升级成本、ROI、风险控制、观测手段与回归测试策略。"
tags:
  - "JDK"
  - "Java"
  - "虚拟线程"
  - "ZGC"
  - "性能回归"
readingDirection: "适合在规划企业 Java 运行时升级、评估 JDK 21/JDK 25、验证虚拟线程或 Generational ZGC 收益，以及设计灰度和回归策略时阅读。"
outline: deep
---

# 从 JDK 8 / 11 / 17 迁移至 JDK 21 及以上版本的技术指南

## 概览

系统分析从 JDK 8、JDK 11、JDK 17 迁移到 JDK 21 及以上版本的路径、收益来源、升级成本、ROI、风险控制、观测手段与回归测试策略。

## 摘要

JDK 21 是 Java 平台的重要长期支持版本之一，其主要变化包括虚拟线程正式发布、Generational ZGC 引入、语言与类库能力增强、JDK 内部 API 强封装规则延续、部分旧 API 与工具移除等。本文围绕 JDK 8、JDK 11、JDK 17 到 JDK 21 及以上版本的迁移路径，分析当前 Java 版本使用现状、迁移步骤、适用应用类型、性能收益来源、升级成本、投资回报、风险控制、观测手段与回归测试策略。本文结论不以单一性能数据作为普适判断，而以官方文档、JEP 规范、迁移指南和可复现实验方法作为依据。

**关键词**：JDK 21；JDK 25；Java 迁移；虚拟线程；Generational ZGC；G1 GC；ZGC；JVM 观测；性能回归；ROI

---

## 1. 引言

Java 平台采用稳定的版本演进节奏，长期支持版本通常被企业作为生产环境基线。JDK 21 是继 JDK 17 之后的重要 LTS 版本，OpenJDK 官方列出了从 JDK 17 到 JDK 21 集成的一系列 JEP，包括虚拟线程、Generational ZGC、Record Patterns、Pattern Matching for switch、Sequenced Collections 等能力。JDK 25 已在 2025 年发布，并被多数发行商作为后续 LTS 版本；OpenJDK 项目页说明 JDK 25 将是多数厂商的长期支持版本。([OpenJDK][1])

JDK 升级不应仅被视为语言版本变更，而应被视为运行时、依赖生态、构建工具、GC 策略、并发模型、观测体系和测试体系的综合迁移。Oracle JDK 21 迁移指南明确说明，该指南用于帮助识别迁移到 JDK 21 过程中可能出现的问题，并给出迁移建议。([docs.oracle.com][2])

---

## 2. 当前 JDK 各版本使用现状

从公开行业调查和发行商路线看，Java 生产环境仍存在 JDK 8、JDK 11、JDK 17 与 JDK 21 并存的状态。Eclipse Foundation 2025 Jakarta EE 调研显示，Java 21 使用率从 2024 年的 30% 上升至 2025 年的 43%，Java 17、Java 11 和 Java 8 仍然保持一定存量。该数据反映了企业 Java 应用常见的 LTS 滞后迁移现象。([Adoptium][3])

New Relic 2024 Java 生态报告基于生产应用遥测数据，显示 JDK 17 在生产环境中的使用比例显著增长，同时 JDK 21 的早期采用速度快于 JDK 17 早期阶段。该类数据可作为行业采用趋势的补充参考，但具体企业是否升级仍应基于自身应用类型、依赖状态、性能目标和支持周期进行评估。([Adoptium][3])

从发行支持角度看，Eclipse Temurin 支持页面列出 JDK 8、11、17、21、25 等版本，并标识 JDK 21 与 JDK 25 为 LTS；Oracle Java 下载页面也说明 JDK 25 是当前最新 LTS，JDK 21 是上一代 LTS。([Adoptium][3])

因此，企业 Java 版本现状可概括为：

| 版本     | 典型状态         | 迁移判断                          |
| ------ | ------------ | ----------------------------- |
| JDK 8  | 存量系统较多，技术跨度大 | 需要重点评估依赖、内部 API、框架版本和旧 JVM 参数 |
| JDK 11 | 仍有一定生产占比     | 可作为直接迁移至 JDK 21 的主要对象         |
| JDK 17 | 当前较新的企业基线    | 迁移至 JDK 21 的技术跨度较小            |
| JDK 21 | 现代 LTS 基线    | 适合作为当前企业标准运行时基线               |
| JDK 25 | 新一代 LTS      | 适合作为后续演进基线和新项目评估目标            |

---

## 3. JDK 21 及以上版本的关键技术变化

### 3.1 虚拟线程

JEP 444 在 JDK 21 中正式引入虚拟线程。OpenJDK 对虚拟线程的定义是：虚拟线程是轻量级线程，用于显著降低编写、维护和观测高吞吐并发应用的工作量。Oracle JDK 21 文档也说明，Java 中存在平台线程和虚拟线程两类线程。([OpenJDK][4])

虚拟线程的核心影响不在于提升单个 CPU 计算任务的执行速度，而在于降低阻塞等待场景下的线程资源占用。JEP 444 的目标指向高吞吐并发应用，因此其适用场景主要是存在大量阻塞 I/O 的服务，例如 HTTP 调用、RPC 调用、JDBC 访问、Redis 访问、消息处理和聚合型 API 服务。([OpenJDK][4])

### 3.2 Generational ZGC

JEP 439 在 JDK 21 中引入 Generational ZGC。OpenJDK 文档说明，Generational ZGC 将堆划分为 young generation 和 old generation，并允许两个代独立收集，使 ZGC 可以集中处理收益更高的年轻对象回收。([OpenJDK][5])

该特性与传统 ZGC 的低延迟目标结合，适合需要控制 GC 暂停时间的大堆、低延迟服务。Inside Java 对 Generational ZGC 的介绍也说明，ZGC 是可扩展的低延迟垃圾收集器，并在 JDK 21 中通过 JEP 439 更新为分代垃圾收集器。([inside.java][6])

### 3.3 JDK 内部 API 强封装与迁移约束

Oracle JDK 21 迁移指南指出，如果旧工具或库需要访问被强封装的内部 API，可使用 `--add-exports`；如果需要通过反射访问 `java.*` API 的非 public 字段或方法，可使用 `--add-opens`。这表明 JDK 内部 API 访问问题是 JDK 8 及旧版本应用迁移到较新 JDK 时的重要兼容性问题。([docs.oracle.com][7])

Oracle 迁移指南还建议迁移前查看被移除的 API、工具和组件；Oracle JDK 21 removed APIs 文档说明，JDK 11 到 JDK 21 之间存在被移除的 Java SE API，并建议使用 `jdeprscan --release 21 -l --for-removal` 获取被标记为将移除的 API 列表。([docs.oracle.com][8])

---

## 4. 从 JDK 8 / JDK 11 / JDK 17 迁移到 JDK 21 的方法

### 4.1 通用迁移流程

从任意低版本迁移至 JDK 21，建议采用以下通用流程：

```text
资产盘点
  -> 构建工具升级
  -> 依赖兼容性检查
  -> 静态分析
  -> 编译与单元测试
  -> 启动与集成测试
  -> 性能基线测试
  -> 预发灰度
  -> 生产分批发布
  -> 观测与回滚
```

迁移前需要完成以下资产盘点：

| 盘点对象      | 说明                                                     |
| --------- | ------------------------------------------------------ |
| 当前 JDK 版本 | 区分编译 JDK 与运行 JDK                                       |
| 构建工具      | Maven、Gradle、插件版本                                      |
| 应用框架      | Spring Boot、Spring Framework、Netty、Tomcat、Dubbo、gRPC 等 |
| 字节码工具     | ASM、ByteBuddy、CGLIB、Javassist、Mockito、Jacoco、Lombok    |
| JVM 参数    | GC 参数、内存参数、模块开放参数                                      |
| APM Agent | SkyWalking、Pinpoint、New Relic、Datadog、Arthas 等         |
| 运行环境      | Docker、Kubernetes、systemd、CI/CD 镜像                     |
| 性能基线      | QPS、延迟、错误率、GC、CPU、内存、线程数                               |

### 4.2 静态检查命令

Oracle JDK 工具文档说明，`jdeprscan` 是静态分析工具，用于报告应用对已废弃 JDK API 元素的使用情况；如果没有在每个 JDK 版本上重新编译，或者依赖第三方二进制包，则应运行该工具识别潜在问题。([docs.oracle.com][9])

迁移检查命令示例：

```bash
# Check use of internal JDK APIs
jdeps --jdk-internals -recursive target/*.jar

# Check APIs deprecated for removal in JDK 21
jdeprscan --release 21 --for-removal target/*.jar

# Print JVM version and runtime flags
java -version
java -XshowSettings:vm -version
```

### 4.3 JDK 8 到 JDK 21

JDK 8 到 JDK 21 的跨度最大，常见问题包括模块系统影响、强封装限制、`javax.*` 到 Jakarta 生态变化、JAXB/JAX-WS 等组件移除、CMS/PermGen 参数失效、旧框架不兼容、旧字节码增强工具不支持 Java 21 class file。

建议迁移路径为：

```text
JDK 8
  -> 升级构建工具
  -> 升级框架与基础依赖
  -> 适配 JDK 11
  -> 适配 JDK 17 强封装规则
  -> 迁移至 JDK 21
```

JDK 8 应用迁移的主要检查项如下：

| 检查项                              | 风险                      |
| -------------------------------- | ----------------------- |
| `sun.misc.*`、`com.sun.*`         | 可能依赖 JDK 内部 API         |
| 反射访问 `java.*` 非 public 成员        | 可能需要 `--add-opens` 临时兼容 |
| JAXB / JAX-WS / Activation       | 可能需要显式引入依赖              |
| Spring / Hibernate / MyBatis 旧版本 | 可能不支持 JDK 21            |
| ASM / ByteBuddy / CGLIB 旧版本      | 可能无法解析 Java 21 字节码      |
| CMS / PermGen 参数                 | JDK 21 中不可继续作为有效调优基线    |

### 4.4 JDK 11 到 JDK 21

JDK 11 到 JDK 21 的迁移重点是 JDK 17 之后的强封装、框架兼容性、构建工具兼容性和 GC 参数重设。

建议迁移路径为：

```text
JDK 11
  -> JDK 17 兼容性验证
  -> JDK 21 编译与运行验证
  -> GC 与并发模型专项测试
```

JDK 11 应用通常需要关注：

| 类别    | 检查内容                                             |
| ----- | ------------------------------------------------ |
| 构建工具  | Maven、Gradle 是否支持 JDK 21                         |
| 编译插件  | maven-compiler-plugin、surefire、failsafe、spotless |
| 框架    | Spring Boot、Spring Framework、Tomcat、Netty、gRPC   |
| Agent | APM、诊断工具、覆盖率工具                                   |
| 运行参数  | GC、日志、模块开放参数                                     |

### 4.5 JDK 17 到 JDK 21

JDK 17 到 JDK 21 的迁移跨度较小，但仍需验证 JDK 21 的字节码、依赖版本、Agent 兼容性和运行参数。OpenJDK 官方列出了从 JDK 17 到 JDK 21 集成的 JEP，因此该迁移主要围绕新能力验证和运行时行为确认展开。([OpenJDK][1])

建议迁移路径为：

```text
JDK 17
  -> 增加 JDK 21 CI 构建矩阵
  -> 更新依赖与 Agent
  -> 使用 JDK 21 运行完整测试
  -> 比较 G1、ZGC、Generational ZGC
  -> 对阻塞 I/O 场景验证虚拟线程
```

---

## 5. 应用类型与收益来源分析

### 5.1 高收益应用类型

基于虚拟线程和 Generational ZGC 的官方目标描述，高收益应用主要分为两类：阻塞 I/O 高并发应用，以及大堆低延迟应用。JEP 444 目标是降低高吞吐并发应用的开发、维护和观测成本；JEP 439 目标是通过分代 ZGC 改善应用性能。([OpenJDK][4])

| 应用类型              | 主要收益来源                      |
| ----------------- | --------------------------- |
| API 网关、BFF、聚合层    | 虚拟线程降低阻塞等待对平台线程的占用          |
| Spring MVC 阻塞式服务  | 虚拟线程提升阻塞 I/O 并发承载能力         |
| RPC 服务端与 RPC 聚合服务 | 虚拟线程缓解线程池资源约束               |
| 任务调度与批处理系统        | 虚拟线程降低大量阻塞任务的线程成本           |
| 大堆低延迟服务           | Generational ZGC 降低 GC 暂停影响 |
| 高分配率服务            | GC 与分代回收策略可能改善停顿与吞吐         |
| CPU 密集型服务         | 主要依赖 JIT、算法和并行度，虚拟线程收益有限    |

### 5.2 GC 收益占比与虚拟线程收益占比的定义

对于“GC 优化收益占比”和“虚拟线程吞吐量提升收益占比”，官方文档并未给出适用于所有应用的固定比例。原因是性能收益与应用瓶颈相关，且受请求模型、对象分配率、堆大小、连接池、下游延迟、锁竞争、CPU 饱和度等因素影响。

因此，较严谨的处理方式是用基准测试计算收益占比，而不是使用固定经验值。可采用如下定义：

```text
总吞吐提升 = JDK 21 优化后吞吐 - 原版本吞吐

GC 收益占比 =
  仅切换 JDK/GC 后获得的吞吐或延迟收益 / 总收益

虚拟线程收益占比 =
  在相同 JDK 与相同 GC 下，从平台线程模型切换到虚拟线程模型获得的收益 / 总收益
```

测试分组如下：

| 组别 | JDK    | GC                     | 线程模型  | 用途                |
| -- | ------ | ---------------------- | ----- | ----------------- |
| A  | 原版本    | 原 GC                   | 原线程模型 | 生产基线              |
| B  | JDK 21 | G1                     | 原线程模型 | 评估 JDK 与默认现代运行时收益 |
| C  | JDK 21 | ZGC / Generational ZGC | 原线程模型 | 评估 GC 收益          |
| D  | JDK 21 | 与 C 相同                 | 虚拟线程  | 评估虚拟线程收益          |

吞吐量指标可使用：

```text
Throughput = 成功请求数 / 测试时间
```

延迟指标应至少包含：

```text
P50、P90、P99、P999、最大值、超时率、错误率
```

资源指标应至少包含：

```text
CPU 使用率、RSS、Heap Used、GC Pause、Allocation Rate、Thread Count、Connection Pool Wait
```

### 5.3 不同场景下的收益解释

对于阻塞 I/O 型服务，虚拟线程的收益主要体现在高并发下减少平台线程占用；对于大堆低延迟服务，Generational ZGC 的收益主要体现在降低 GC 暂停和改善回收效率；对于 CPU 密集型服务，虚拟线程不会增加 CPU 算力，因此收益应通过实际 benchmark 判断。

该结论与 JEP 444 和 JEP 439 的目标范围一致：虚拟线程面向高吞吐并发应用，Generational ZGC 面向垃圾回收性能与低延迟改进。([OpenJDK][4])

---

## 6. 升级成本与 ROI 分析

### 6.1 成本构成

JDK 升级成本由以下部分组成：

| 成本项     | 内容                                 |
| ------- | ---------------------------------- |
| 代码适配成本  | API 移除、反射访问、内部 API、语法和编译问题         |
| 依赖升级成本  | 框架、中间件客户端、字节码库、测试库、Agent           |
| 构建改造成本  | Maven、Gradle、CI 镜像、Dockerfile、构建插件 |
| 测试成本    | 单元测试、集成测试、性能测试、兼容性测试               |
| 观测改造成本  | JVM 日志、JFR、Prometheus、APM 指标       |
| 灰度与回滚成本 | 多版本镜像、流量分批、异常回滚                    |
| 性能调优成本  | GC、线程模型、连接池、限流、下游保护                |

### 6.2 版本跨度与成本等级

| 迁移路径             | 成本等级 | 主要原因                  |
| ---------------- | ---- | --------------------- |
| JDK 17 -> JDK 21 | 低到中  | LTS 跨度小，依赖生态通常较新      |
| JDK 11 -> JDK 21 | 中    | 需处理强封装、依赖升级和运行参数变更    |
| JDK 8 -> JDK 21  | 中到高  | 跨越模块化、组件移除、框架升级和旧参数清理 |

### 6.3 ROI 模型

JDK 升级 ROI 不应只由 QPS 提升衡量。更完整的模型如下：

```text
ROI =
  资源成本节省
+ 延迟稳定性提升
+ 安全与合规收益
+ 依赖生态可维护性提升
+ 后续框架升级收益
+ 并发模型简化收益
- 迁移人力成本
- 测试成本
- 灰度风险成本
- 回滚与故障处理成本
```

其中，资源成本节省可以通过压测和生产灰度数据计算：

```text
资源节省率 =
  1 - JDK 21 单位吞吐资源成本 / 原版本单位吞吐资源成本
```

单位吞吐资源成本可定义为：

```text
单位吞吐 CPU 成本 = 平均 CPU 核数 / QPS
单位吞吐内存成本 = 平均 RSS / QPS
单位吞吐实例成本 = 实例数量 / QPS
```

ROI 的有效评估依赖 A/B 测试，而非单次压测结论。

---

## 7. 迁移过程中的主要风险

### 7.1 JDK 内部 API 与反射访问

Oracle JDK 21 迁移指南说明，旧库如需访问强封装内部 API，可使用 `--add-exports`；如需通过反射访问 `java.*` 非 public 字段和方法，可使用 `--add-opens`。因此，`--add-opens` 可作为兼容手段，但应被记录为迁移风险项，而不是长期架构方案。([docs.oracle.com][7])

### 7.2 被移除 API、工具和组件

Oracle JDK 21 removed APIs 文档说明，JDK 11 到 JDK 21 之间存在被移除的 Java SE API，并建议使用 `jdeprscan` 检查。迁移前应将该检查纳入 CI。([docs.oracle.com][10])

### 7.3 GC 参数不兼容

旧版本 JVM 参数可能在 JDK 21 中失效或不再适合作为调优基线。迁移时不应直接复制历史参数，而应以 JDK 21 的 GC 日志、JFR 和生产指标重新评估。

建议初始参数保持简洁：

```bash
-Xms2g -Xmx2g
-XX:+UseG1GC
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags
```

对于大堆低延迟场景，可增加 ZGC 对照组：

```bash
-XX:+UseZGC
-Xlog:gc*,safepoint:file=/logs/gc-zgc.log:time,uptime,level,tags
```

### 7.4 虚拟线程与下游资源

虚拟线程降低的是 Java 线程资源成本，但不会扩大数据库连接池、Redis 连接池、HTTP 连接池和下游服务容量。因此迁移虚拟线程时，需要同步验证连接池等待、下游超时、熔断、限流和隔离策略。

### 7.5 ThreadLocal、锁与阻塞点

虚拟线程数量可能远高于平台线程数量，因此需要重点检查：

```text
MDC
TraceContext
SecurityContext
大对象 ThreadLocal
synchronized 临界区
本地方法阻塞
连接池等待
限流与隔离策略
```

### 7.6 APM Agent 与字节码增强工具

JDK 21 class file 版本要求字节码相关工具支持新版本。迁移前应验证：

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

## 8. 观测手段

### 8.1 JVM 观测

JDK 21 迁移过程中应启用 GC、Safepoint 和 JFR 观测。JFR 是 JDK 提供的运行时诊断能力，Oracle API 文档说明 `FlightRecorder` 类用于访问、控制和管理 Flight Recorder。([docs.oracle.com][11])

推荐命令：

```bash
# GC and safepoint logs
-Xlog:gc*,safepoint:file=/logs/gc.log:time,uptime,level,tags

# Start JFR at JVM startup
-XX:StartFlightRecording=filename=/logs/app.jfr,dumponexit=true,settings=profile
```

运行期诊断命令：

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

### 8.2 应用层观测

应用层至少应观测：

```text
QPS
P50 / P90 / P99 / P999 延迟
错误率
超时率
请求排队时间
Tomcat / Jetty / Undertow worker 状态
HTTP Client 连接池
JDBC 连接池
Redis 连接池
RPC pending request
熔断和限流触发次数
```

### 8.3 虚拟线程专项观测

Oracle JDK 21 文档中包含虚拟线程调试与采用指南相关内容，说明虚拟线程需要纳入调试和观测流程。([docs.oracle.com][12])

虚拟线程场景应增加：

```text
虚拟线程创建速率
虚拟线程存活数量
平台线程数量
载体线程状态
阻塞点分布
ThreadLocal 使用情况
synchronized 竞争
连接池等待时间
下游服务超时率
```

### 8.4 容器层观测

容器环境中应观测：

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
可用 CPU 核数识别
```

---

## 9. 回归测试策略

### 9.1 编译与单元测试

```text
全量编译
单元测试
Annotation Processor 测试
Lombok 编译测试
MapStruct / QueryDSL 生成代码测试
Protobuf / gRPC 代码生成测试
```

### 9.2 启动与运行测试

```text
本地启动
容器启动
Kubernetes 启动
配置中心加载
注册中心注册
日志初始化
健康检查
优雅停机
APM Agent 挂载
```

### 9.3 接口兼容测试

```text
HTTP API 响应结构
RPC 协议兼容
错误码兼容
JSON 序列化兼容
时间格式兼容
BigDecimal 精度
枚举兼容
空值语义
分页与排序
```

### 9.4 数据访问测试

```text
MySQL CRUD
事务传播
连接池耗尽
慢 SQL 场景
Redis 序列化兼容
Redis Lua 脚本
Kafka 消费位点
Elasticsearch 查询
缓存 key 与 value 兼容
```

### 9.5 性能回归测试

性能测试应至少包含四组：

```text
A. 原版本 JDK + 原 JVM 参数 + 原线程模型
B. JDK 21 + G1 + 原线程模型
C. JDK 21 + ZGC / Generational ZGC + 原线程模型
D. JDK 21 + 相同 GC + 虚拟线程模型
```

每组应记录：

```text
最大稳定 QPS
P50 / P90 / P99 / P999
CPU 使用率
RSS
Heap Used
GC Pause
Allocation Rate
Thread Count
Connection Pool Wait
Error Rate
Timeout Rate
```

### 9.6 灰度回归

生产灰度应至少包含：

```text
1% 流量
5% 流量
20% 流量
50% 流量
100% 流量
```

每一阶段应设置回滚阈值：

```text
P99 延迟显著上升
错误率上升
超时率上升
CPU 使用率异常
RSS 异常增长
GC Pause 异常
连接池等待异常
下游错误率上升
```

---

## 10. 结论

JDK 21 是从 JDK 8、JDK 11、JDK 17 迁移至现代 Java 运行时的重要目标版本。JDK 21 的关键价值包括虚拟线程、Generational ZGC、语言和类库增强，以及与现代 Java 生态兼容的运行时基线。JDK 25 已成为后续 LTS 演进方向，但对于大量存量系统，JDK 21 仍是更稳妥的迁移目标。([Oracle][13])

从迁移难度看，JDK 17 到 JDK 21 成本较低，适合作为优先试点；JDK 11 到 JDK 21 成本中等，需要重点处理依赖、构建和强封装问题；JDK 8 到 JDK 21 成本最高，需要系统性治理旧框架、旧 API、旧 JVM 参数和历史技术债。

从收益来源看，阻塞 I/O 高并发服务更适合验证虚拟线程，大堆低延迟服务更适合验证 Generational ZGC，CPU 密集型服务需要以 JIT、算法和实际资源利用率为核心评估对象。GC 优化收益占比和虚拟线程收益占比不应使用固定经验值，应通过分组基准测试和生产灰度数据计算。

从工程实践看，JDK 升级必须同时覆盖静态分析、依赖升级、构建改造、JVM 参数重设、JFR 与 GC 日志观测、性能回归、下游保护、灰度发布和回滚策略。缺少观测和回归的版本升级，不具备可验证性。

---

## 11. 附录：虚拟线程测试仓库

本文涉及的虚拟线程收益评估，可以结合基准测试仓库进行验证：

```text
https://github.com/stellhub/jdk-virtual-thread-benchmark
```

该仓库是基于 JDK 25 的虚拟线程测试库，可用于对比平台线程与虚拟线程在阻塞任务、高并发任务下的行为差异。它适合作为 JDK 21 / JDK 25 虚拟线程评估、团队内部技术分享、并发模型教学和性能实验的辅助材料。

[1]: https://openjdk.org/projects/jdk/21/jeps-since-jdk-17?utm_source=chatgpt.com "JEPs in JDK 21 integrated since JDK 17"
[2]: https://docs.oracle.com/en/java/javase/21/migrate/index.html?utm_source=chatgpt.com "Oracle JDK Migration Guide - Java"
[3]: https://adoptium.net/support?utm_source=chatgpt.com "Temurin™ Support"
[4]: https://openjdk.org/jeps/444?utm_source=chatgpt.com "JEP 444: Virtual Threads"
[5]: https://openjdk.org/jeps/439?utm_source=chatgpt.com "JEP 439: Generational ZGC"
[6]: https://inside.java/2023/11/28/gen-zgc-explainer/?utm_source=chatgpt.com "Introducing Generational ZGC"
[7]: https://docs.oracle.com/en/java/javase/21/migrate/migrating-jdk-8-later-jdk-releases.html?utm_source=chatgpt.com "7 Migrating From JDK 8 to Later JDK Releases"
[8]: https://docs.oracle.com/en/java/javase/21/migrate/getting-started.html?utm_source=chatgpt.com "Oracle JDK Migration Guide"
[9]: https://docs.oracle.com/en/java/javase/21/core/running-jdeprscan.html?utm_source=chatgpt.com "Running jdeprscan"
[10]: https://docs.oracle.com/en/java/javase/21/migrate/removed-apis.html?utm_source=chatgpt.com "4 Removed APIs - Java SE"
[11]: https://docs.oracle.com/javase/jp/21/docs/api/jdk.jfr/jdk/jfr/FlightRecorder.html?utm_source=chatgpt.com "FlightRecorder (Java SE 21 & JDK 21)"
[12]: https://docs.oracle.com/javase/jp/21/core/virtual-threads.html?utm_source=chatgpt.com "仮想スレッド"
[13]: https://www.oracle.com/jp/java/technologies/downloads/?utm_source=chatgpt.com "Java Downloads | Oracle 日本"
