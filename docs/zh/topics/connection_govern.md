---
title: "如何做连接治理：面向高并发服务的连接生命周期、故障定位与运维 SOP 研究"
category: "网络可靠性"
summary: "系统说明高并发服务中的 TCP、HTTP/gRPC、数据库、连接池、代理层、conntrack 和文件描述符治理方法，覆盖连接生命周期、容量模型、超时分类、CLOSE_WAIT、TIME_WAIT 以及标准化排障 SOP。"
tags:
  - "连接治理"
  - "TCP"
  - "连接池"
  - "CLOSE_WAIT"
  - "TIME_WAIT"
  - "SOP"
readingDirection: "适合在治理连接数过多、连接超时、连接池耗尽、CLOSE_WAIT/TIME_WAIT 堆积、数据库 Too many connections、conntrack 表满或 fd 耗尽问题时阅读。"
outline: deep
---

# 如何做连接治理：面向高并发服务的连接生命周期、故障定位与运维 SOP 研究

## 概览

系统说明高并发服务中的 TCP、HTTP/gRPC、数据库、连接池、代理层、conntrack 和文件描述符治理方法，覆盖连接生命周期、容量模型、超时分类、CLOSE_WAIT、TIME_WAIT 以及标准化排障 SOP。

## 摘要

连接治理是分布式系统稳定性治理中的基础环节，其对象包括 TCP 连接、HTTP/gRPC 连接、数据库连接、连接池、代理层连接、内核连接跟踪表以及应用侧资源句柄。连接问题通常表现为连接数过多、连接超时、`CLOSE_WAIT` 堆积、`TIME_WAIT` 堆积、连接池耗尽、文件描述符耗尽、监听队列溢出、NAT/conntrack 表满等现象。根据 TCP 标准，`CLOSE-WAIT` 表示本端正在等待本地用户发起连接终止动作，`TIME-WAIT` 表示本端等待足够时间以确保远端收到连接终止确认；这些状态本身不是异常，异常在于数量、持续时间和业务影响超出系统容量边界。([IETF Datatracker][1])

本文从连接生命周期、容量模型、超时模型、状态机异常和标准化处置流程五个方面，系统说明如何进行连接治理，并给出面向研发和 SRE 的故障定位 SOP。

**关键词**：连接治理；TCP；连接池；CLOSE_WAIT；TIME_WAIT；超时；连接泄漏；容量治理；SOP

---

## 1. 引言

在微服务系统中，一次业务请求通常会跨越客户端连接池、网关、反向代理、服务端监听队列、应用线程池、数据库连接池、缓存连接池、消息队列连接以及内核网络栈。连接治理的目标不是单纯增加连接上限，而是使连接的创建、复用、空闲、超时、关闭和回收行为具备可观测、可限制、可降级、可恢复的工程属性。

错误的治理方式是看到连接数高就直接调大 `max_connections`、`ulimit -n` 或 `somaxconn`。这类动作只能扩大故障半径，不能解释连接为什么增长、是否复用、是否泄漏、是否被慢下游拖住、是否存在短连接风暴。正确的连接治理应从四个维度展开：应用层连接池、协议层 keep-alive、操作系统 TCP 状态、下游服务容量边界。

---

## 2. 连接治理的理论基础

### 2.1 TCP 连接状态是连接治理的基础观测对象

TCP 连接不是单一状态，而是有限状态机。RFC 9293 定义了 `ESTABLISHED`、`FIN-WAIT-1`、`FIN-WAIT-2`、`CLOSE-WAIT`、`TIME-WAIT` 等状态，其中 `ESTABLISHED` 表示连接已经打开并可传输数据，`CLOSE-WAIT` 表示等待本地用户发起关闭，`TIME-WAIT` 表示等待足够时间以确保远端收到连接终止确认。([IETF Datatracker][1])

Linux 上可以用 `ss` 查看 socket 统计信息。`ss` 的官方手册说明其用于 dump socket statistics，并且相比传统 `netstat` 可以展示更多 TCP 和状态信息。([man7.org][2])

```bash
# Overall socket summary
ss -s

# Count TCP states
ss -ant | awk 'NR > 1 {count[$1]++} END {for (s in count) print s, count[s]}'

# Established connections by peer
ss -tan state established | awk 'NR > 1 {print $5}' | sort | uniq -c | sort -nr | head

# CLOSE-WAIT connections
ss -tanp state close-wait

# TIME-WAIT connections
ss -tan state time-wait
```

`lsof` 可用于查看进程打开的文件信息；在 Linux 中 socket 也属于文件描述符的一类，因此它适合辅助定位“哪个进程持有大量连接”。([man7.org][3])

```bash
# Show network files opened by a process
lsof -nP -p <PID> -i

# Count opened file descriptors
ls /proc/<PID>/fd | wc -l
```

### 2.2 连接容量由多层共同决定

连接容量不是单点配置，而是以下边界的最小值：

1. 应用连接池上限，例如 HTTP 客户端连接池、JDBC 连接池、Redis 连接池。
2. 服务端连接上限，例如 MySQL `max_connections`、PostgreSQL `max_connections`。
3. 操作系统文件描述符上限，例如进程 `ulimit -n`。
4. TCP 监听队列容量，例如 `listen(backlog)` 与 `somaxconn`。
5. NAT/conntrack 表容量，例如 `nf_conntrack_max`。
6. 代理层连接复用策略，例如 NGINX upstream keepalive。
7. 下游服务的线程池、worker、I/O 模型和资源隔离能力。

Linux `listen(2)` 文档说明，`backlog` 定义 pending connections 队列的最大长度；当队列满时，客户端可能收到错误，或者在支持重传的协议上表现为请求被忽略并等待后续重试。([man7.org][4])

MySQL 官方文档说明，`Too many connections` 表示所有可用连接都被其他客户端占用，允许连接数量由 `max_connections` 控制。([MySQL开发者专区][5]) PostgreSQL 官方文档也说明，`max_connections` 决定数据库服务端最大并发连接数，默认通常为 100，并且需要在服务启动时生效。([PostgreSQL][6])

---

## 3. 连接数过多的治理方法

### 3.1 问题定义

连接数过多不是根因，而是结果。它通常由以下原因导致：

| 类型      | 典型现象                              | 根因方向                      |
| ------- | --------------------------------- | ------------------------- |
| 正常高并发   | `ESTABLISHED` 高，但 RT、错误率稳定        | 容量规划问题                    |
| 连接泄漏    | `ESTABLISHED` 或 `CLOSE_WAIT` 单调增长 | 应用未关闭连接                   |
| 短连接风暴   | `TIME_WAIT` 高                     | 未开启连接复用或主动关闭频繁            |
| 连接池耗尽   | 业务报 pool timeout                  | 下游慢、池太小、未释放连接             |
| 数据库连接打满 | MySQL `Too many connections`      | 应用实例数 × 连接池上限超过 DB 容量     |
| NAT 表满  | 丢包、连接随机失败                         | conntrack 容量不足或短连接过多      |
| 监听队列溢出  | connect timeout / reset           | accept 慢、backlog 小、服务端负载高 |

### 3.2 治理原则

连接数过多时，第一动作不是加大上限，而是先做连接归因。一个合理的归因顺序如下：

```bash
# 1. Observe total socket states
ss -s

# 2. Count TCP states
ss -ant | awk 'NR > 1 {count[$1]++} END {for (s in count) print s, count[s]}'

# 3. Find hot remote peers
ss -tan state established | awk 'NR > 1 {print $5}' | sort | uniq -c | sort -nr | head -20

# 4. Find process owners
ss -tanp | head -100

# 5. Check process file descriptors
ls /proc/<PID>/fd | wc -l
```

如果连接集中在数据库，应检查应用实例数、每个实例连接池上限、数据库 `max_connections`。例如 20 个应用实例，每个实例 HikariCP `maximumPoolSize=50`，理论上可打出 1000 条数据库连接；如果数据库 `max_connections=500`，系统不是“偶发连接失败”，而是容量模型本身错误。

HikariCP 官方配置说明中，`maximumPoolSize` 控制连接池最大大小，`connectionTimeout` 控制应用从连接池获取连接的最长等待时间；Oracle 的 HikariCP 最佳实践也说明 `connection-timeout` 到达后会抛出 “connection acquisition timed out” 类错误，默认值为 30 秒。([GitHub][7])

### 3.3 标准治理动作

连接数过多的治理动作应按优先级执行：

**第一，减少不必要连接。** HTTP、gRPC、数据库、Redis、Kafka 客户端应优先复用长连接，而不是每次请求创建新连接。NGINX 官方文档说明，`keepalive_timeout` 用于控制空闲 keepalive 连接可保持打开的时间；upstream 模块也提供对上游空闲 keepalive 连接的控制。([Nginx][8])

**第二，控制每层连接池上限。** 应用侧连接池上限必须小于下游容量上限，并预留管理连接、运维连接和突发空间。数据库连接池不是越大越好；过大的连接池会把请求排队从应用层转移到数据库层，使数据库 CPU、内存、锁等待和上下文切换恶化。

**第三，建立连接预算。** 建议按如下公式建立连接预算：

```text
下游最大可承载连接数 >= 应用实例数 × 单实例连接池上限 + 预留连接数
```

如果公式不成立，应优先降低单实例连接池、增加中间代理池化层，或者对调用方做限流，而不是盲目调大数据库连接数。

**第四，修复连接泄漏。** 对 Java 服务，应重点检查 HTTP response body、JDBC ResultSet/Statement/Connection、Redis connection、gRPC channel、文件流是否被正确关闭。连接泄漏的特征通常是连接数单调增长，且增长与 QPS 不完全同步。

**第五，最后才调整系统上限。** 只有在确认连接是有效业务连接、下游可承载、应用无泄漏、连接池配置合理之后，才考虑调整 `ulimit -n`、`somaxconn`、`nf_conntrack_max`、数据库 `max_connections` 等系统参数。Linux kernel 文档说明 `nf_conntrack_max` 是连接跟踪表大小，默认值与 `nf_conntrack_buckets` 相关。([Linux Kernel][9])

---

## 4. 连接经常超时的定位与治理

### 4.1 超时分类

连接超时必须先分类。混淆超时类型会导致错误处置。

| 超时类型                    | 发生阶段      | 常见异常方向                         | 主要排查对象               |
| ----------------------- | --------- | ------------------------------ | -------------------- |
| 连接池获取超时                 | 从连接池借连接   | pool timeout                   | 池耗尽、连接未归还、下游慢        |
| DNS 超时                  | 域名解析阶段    | UnknownHost / DNS timeout      | DNS、CoreDNS、缓存       |
| TCP connect timeout     | 三次握手阶段    | connect timeout                | 网络、防火墙、监听队列、服务未监听    |
| TLS handshake timeout   | TLS 协商阶段  | SSL handshake timeout          | 证书、CPU、代理、网络         |
| read / response timeout | 请求已发出等待响应 | socket timeout / read timeout  | 下游慢、线程池满、SQL 慢       |
| idle timeout            | 空闲连接被关闭   | connection reset / broken pipe | keepalive 不一致、中间代理回收 |
| request deadline 超时     | 端到端预算超时   | deadline exceeded              | 链路整体耗时超预算            |

Java `HttpClient` 官方 API 提供 `connectTimeout()`，其含义是返回客户端 builder 中设置的连接超时时间；未设置时返回 empty。([Oracle 文档][10]) Apache HttpClient 5 官方 API 中，`connectionRequestTimeout` 表示从连接管理器请求连接的等待超时，`connectTimeout` 表示新连接完全建立前的超时，且可能包括 SSL/TLS 协商，`responseTimeout` 表示等待对端响应到达的超时。([hc.apache.org][11])

### 4.2 定位流程

连接超时的定位应分为客户端、网络路径、服务端、下游依赖四段。

**第一步，确认超时类型。**
如果日志中出现 “connection acquisition timed out”，通常是连接池获取连接超时；如果是 “connect timed out”，通常是 TCP 连接建立阶段失败；如果是 “Read timed out” 或 “response timeout”，说明连接可能已经建立，但对端未及时返回数据。

**第二步，确认超时对象。**
统计超时的目标域名、IP、端口、接口、调用方、错误码、耗时分布。不能只看总错误率，必须按 peer 维度聚合。

```bash
# Connections to a target
ss -tanp | grep ':<PORT>'

# SYN-SENT often indicates connection establishment is blocked or slow
ss -tan state syn-sent

# Established connections to a peer
ss -tan state established | grep '<TARGET_IP>'
```

**第三步，确认服务端是否可接受连接。**
若服务端 `LISTEN` 正常但客户端 connect timeout，应检查服务端 CPU、accept 速度、listen backlog、负载均衡、iptables/security group。Linux `listen(2)` 文档说明，当 pending connection 队列满时，客户端可能收到错误或等待重传，这会在客户端表现为连接慢或超时。([man7.org][4])

**第四步，确认是否连接池耗尽。**
连接池耗尽一般不是“池太小”这么简单，常见根因是下游响应慢导致连接长时间占用，或者业务代码未释放连接。HikariCP 的 `connectionTimeout` 是应用等待池中连接的最长时间；到达该时间后会抛出连接获取超时。([Oracle 博客][12])

**第五步，检查空闲连接失效。**
如果大量错误表现为 `connection reset by peer`、`broken pipe`、第一次请求失败第二次成功，通常是客户端连接池保留的空闲连接已经被中间代理或服务端关闭。Linux TCP keepalive 默认在连接空闲 7200 秒后才开始探测，且 keepalive 只有在 socket 启用 `SO_KEEPALIVE` 时才发送。([man7.org][13]) 因此，业务层连接池的 idle timeout、max lifetime、keepalive time 应小于或匹配代理层、LB、NAT、服务端的空闲回收时间。

### 4.3 解决方法

连接超时治理应遵循“分层设置超时、端到端设置 deadline、失败快速释放资源”的原则。

推荐最小配置模型：

```yaml
http-client:
  poolAcquireTimeout: 100ms-500ms
  connectTimeout: 300ms-1000ms
  tlsHandshakeTimeout: 1000ms-3000ms
  readTimeout: 1000ms-5000ms
  requestDeadline: 1500ms-6000ms
  maxConnections: bounded
  maxIdleTime: less-than-lb-idle-time
```

对于核心链路，必须区分连接池等待时间、连接建立时间、响应等待时间和端到端总耗时。只设置 read timeout 不合格；只设置 connect timeout 也不合格。没有连接池获取超时，线程会在池上排队；没有端到端 deadline，自动重试、DNS 多 IP 轮询、代理重试可能使真实耗时超过业务 SLA。

---

## 5. CLOSE_WAIT 过多的原因与治理

### 5.1 状态含义

`CLOSE_WAIT` 是 TCP 被动关闭路径中的状态。RFC 9293 定义 `CLOSE-WAIT` 为等待本地用户发起连接终止请求。([IETF Datatracker][1]) 换成工程语言，就是远端已经发送 FIN，本端内核已经收到关闭信号，但本端应用还没有调用 close 释放 socket。

因此，`CLOSE_WAIT` 过多通常不是内核参数问题，而是应用问题。调大内核参数不能解决 `CLOSE_WAIT` 堆积；它只能让泄漏持续更久。

### 5.2 常见原因

`CLOSE_WAIT` 过多通常来自以下场景：

1. HTTP 客户端未关闭 response body。
2. JDBC Connection / Statement / ResultSet 未关闭。
3. Netty channel 未在异常路径关闭。
4. gRPC channel 或 stream 生命周期管理错误。
5. 异常分支提前 return，跳过 finally close。
6. 连接池驱逐配置不合理，失效连接长期滞留。
7. 线程阻塞导致 close 逻辑无法执行。
8. 使用长连接协议时，只处理读写异常，未处理 peer close 事件。

### 5.3 定位方法

```bash
# Find CLOSE-WAIT sockets with process info
ss -tanp state close-wait

# Inspect process descriptors
lsof -nP -p <PID> -iTCP

# Count CLOSE-WAIT by process
ss -tanp state close-wait | awk -F'pid=' '/pid=/ {split($2,a,","); print a[1]}' | sort | uniq -c | sort -nr
```

定位到进程后，应继续做三件事：

1. 查看该进程连接的远端地址，确认是哪个下游。
2. 查看应用日志，确认是否存在 read timeout、EOF、connection reset 后未释放连接。
3. 对 Java 进程采集线程栈，确认是否有线程阻塞在 I/O、锁、连接池、数据库驱动或业务 finally 前。

```bash
# Capture Java thread dump
jcmd <PID> Thread.print > thread-dump.txt

# Or use jstack
jstack <PID> > thread-dump.txt
```

### 5.4 解决方法

解决 `CLOSE_WAIT` 的核心是修复应用关闭语义。

Java HTTP 客户端代码必须保证 response body 关闭：

```java
try (CloseableHttpResponse response = client.execute(request)) {
    // Consume response body here
}
```

JDBC 代码必须使用 try-with-resources：

```java
try (Connection conn = dataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    // Handle result set here
}
```

Netty 代码必须在异常、对端关闭和业务超时路径关闭 channel：

```java
@Override
public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
    ctx.close();
}
```

结论非常明确：`CLOSE_WAIT` 多，优先查代码和连接池释放路径，不应优先调系统参数。

---

## 6. TIME_WAIT 过多的原因与治理

### 6.1 状态含义

`TIME_WAIT` 是主动关闭方进入的状态。RFC 9293 中 `TIME-WAIT` 表示等待足够时间，以确保远端收到连接终止请求的确认。([IETF Datatracker][1]) 因此，`TIME_WAIT` 的存在是 TCP 正常关闭语义的一部分，不应简单视为错误。

### 6.2 常见原因

`TIME_WAIT` 过多通常说明本机正在大量主动关闭连接，常见原因包括：

1. 客户端未使用连接池或 keep-alive，每次请求创建短连接。
2. HTTP 代理到 upstream 未启用连接复用。
3. 服务端主动关闭大量短连接。
4. 健康检查频率过高。
5. 爬虫、探测、压测导致短连接风暴。
6. NAT、LB、Sidecar、网关层连接复用策略不一致。
7. 应用异常后快速重试，形成连接创建与关闭循环。

### 6.3 定位方法

```bash
# Count TIME-WAIT
ss -tan state time-wait | wc -l

# Find hot remote peers in TIME-WAIT
ss -tan state time-wait | awk 'NR > 1 {print $5}' | sort | uniq -c | sort -nr | head -20

# Compare established and time-wait
ss -s
```

如果 `TIME_WAIT` 集中指向某一个下游 IP:PORT，应重点检查调用方是否开启连接池、是否开启 HTTP keep-alive、是否有异常重试风暴。如果集中在 NGINX 到 upstream，应检查 upstream keepalive 配置。NGINX 官方 upstream 文档提供 `keepalive_timeout`，用于设置空闲 keepalive 连接到 upstream server 的保持时间。([Nginx][14])

### 6.4 解决方法

`TIME_WAIT` 治理的优先级如下：

**第一，启用连接复用。**
HTTP 客户端、gRPC 客户端、数据库客户端都应复用连接。短连接不是高并发系统的默认选项。

**第二，使主动关闭方后移。**
如果客户端出现大量 `TIME_WAIT`，通常是客户端主动关闭。可通过连接池、keep-alive、代理复用降低客户端主动关闭频率。

**第三，治理重试风暴。**
重试必须有退避、抖动和总预算。无退避重试会制造连接风暴，并放大 `TIME_WAIT`。

**第四，谨慎调整内核参数。**
Linux TCP keepalive、TIME_WAIT、FIN_WAIT 等参数属于系统级影响面，不能作为首选方案。Linux `tcp(7)` 文档说明 TCP keepalive 的默认 idle 时间为 7200 秒，并且仅在启用 `SO_KEEPALIVE` 时发送探测。([man7.org][13]) 这说明系统默认值并不是为每个业务连接池自动兜底，应用仍需正确配置自身连接生命周期。

---

## 7. 其他典型连接问题与 SOP

### 7.1 连接池耗尽 SOP

**现象**：应用日志出现 connection acquisition timeout、pool exhausted、get connection timeout。

**定位流程**：

```bash
# Check app connections to downstream
ss -tanp | grep '<DOWNSTREAM_PORT>'

# Check process fd count
ls /proc/<PID>/fd | wc -l

# Check CLOSE-WAIT leakage
ss -tanp state close-wait | grep '<PID>'
```

**处置步骤**：

1. 确认连接池获取超时，而不是 TCP connect timeout。
2. 查看池指标：active、idle、pending、max。
3. 如果 active 接近 max 且 pending 增长，说明池被占满。
4. 查看下游 RT、慢 SQL、慢接口、锁等待。
5. 检查连接是否未释放。
6. 临时降级非核心调用，减少池占用。
7. 长期修复：设置合理 `maximumPoolSize`、`connectionTimeout`、`idleTimeout`、`maxLifetime`、泄漏检测和调用隔离。

### 7.2 数据库 Too many connections SOP

**现象**：MySQL 报 `Too many connections`。MySQL 官方文档说明，该错误表示所有可用连接都被其他客户端占用，连接数量由 `max_connections` 控制。([MySQL开发者专区][5])

**定位流程**：

```sql
SHOW VARIABLES LIKE 'max_connections';
SHOW STATUS LIKE 'Threads_connected';
SHOW STATUS LIKE 'Max_used_connections';
SHOW PROCESSLIST;
```

**处置步骤**：

1. 统计应用实例数与单实例连接池上限。
2. 计算理论最大连接数。
3. 找出连接最多的应用。
4. 杀掉异常空闲长事务或异常会话。
5. 临时降低调用流量或扩展只读实例。
6. 长期引入连接池治理、读写隔离、SQL 慢查询治理和数据库连接预算。

错误做法是只调大 `max_connections`。如果数据库 CPU、内存、锁等待已经达到瓶颈，调大连接数只会使排队从应用层转移到数据库内部。

### 7.3 Listen backlog 溢出 SOP

**现象**：客户端 connect timeout、connection refused、偶发连接失败，服务端端口处于 LISTEN。

Linux `listen(2)` 说明，当 pending connection 队列满时，客户端可能收到错误，或请求被忽略并依赖后续重试。([man7.org][4])

**定位流程**：

```bash
# Check listening sockets
ss -ltnp

# Check SYN-SENT on client
ss -tan state syn-sent

# Check system backlog setting
sysctl net.core.somaxconn
sysctl net.ipv4.tcp_max_syn_backlog
```

**处置步骤**：

1. 检查服务端 CPU 是否过高。
2. 检查 accept 线程是否阻塞。
3. 检查应用 worker 是否满。
4. 检查 backlog 与 `somaxconn`。
5. 检查 LB 到后端是否存在突发连接。
6. 临时扩容服务实例。
7. 长期优化 accept 模型、线程池隔离、连接复用和限流。

### 7.4 conntrack 表满 SOP

**现象**：Kubernetes、NAT 网关或高并发节点上出现随机丢包、连接失败、DNS 失败、日志中出现 conntrack table full。

Linux kernel 文档说明，`nf_conntrack_max` 是连接跟踪表大小，默认值为 `nf_conntrack_buckets * 4`。([Linux Kernel][9]) Kubernetes 官方文档说明，集群中可以通过 sysctl 接口配置内核参数。([Kubernetes][15])

**定位流程**：

```bash
# Current conntrack entries
cat /proc/sys/net/netfilter/nf_conntrack_count

# Conntrack limit
cat /proc/sys/net/netfilter/nf_conntrack_max

# Kernel logs
dmesg | grep -i conntrack
```

**处置步骤**：

1. 确认是否接近 `nf_conntrack_max`。
2. 找出短连接来源。
3. 检查是否 DNS、HTTP、探活、日志上报造成短连接风暴。
4. 临时提高 `nf_conntrack_max`。
5. 长期减少短连接、启用连接复用、降低重试风暴、拆分节点流量。

### 7.5 空闲连接被中间层关闭 SOP

**现象**：低频请求第一次失败，第二次成功；日志出现 `connection reset by peer`、`broken pipe`。

**定位流程**：

1. 确认客户端连接池 idle time。
2. 确认 NGINX/LB/NAT/服务端 idle timeout。
3. 确认客户端是否启用 keepalive 探活。
4. 抓取失败连接的空闲时长。
5. 对比失败时间是否接近某个中间层 timeout。

NGINX 官方文档说明，`keepalive_timeout` 控制 keep-alive 客户端连接在服务端保持打开的时间。([Nginx][8]) Linux TCP keepalive 默认 7200 秒后才开始探测，不能替代应用侧连接池的生命周期治理。([man7.org][13])

**处置步骤**：

1. 客户端连接池 `maxIdleTime` 应小于 LB / NGINX / NAT idle timeout。
2. 对重要长连接开启 keepalive。
3. 对连接复用失败进行一次安全重试。
4. 对非幂等请求禁止盲目重试。
5. 将 idle close、reset、broken pipe 纳入指标统计。

### 7.6 文件描述符耗尽 SOP

**现象**：日志出现 `Too many open files`，新连接失败，应用无法打开文件、socket 或日志文件。

**定位流程**：

```bash
# Process fd usage
ls /proc/<PID>/fd | wc -l

# Process fd limit
cat /proc/<PID>/limits | grep "open files"

# Top opened network files
lsof -nP -p <PID> | wc -l
```

**处置步骤**：

1. 判断 fd 是 socket、文件、pipe 还是 eventfd。
2. 如果 socket 占比高，按 TCP 状态继续定位。
3. 如果文件占比高，检查文件流关闭。
4. 临时提高进程 `LimitNOFILE`。
5. 长期修复资源释放路径，并增加 fd 使用率告警。

---

## 8. 连接治理的工程化指标体系

连接治理必须指标化，否则只能靠故障时人工排查。建议至少建设以下指标：

| 指标类型   | 指标                                                                             |
| ------ | ------------------------------------------------------------------------------ |
| TCP 状态 | ESTABLISHED、SYN-SENT、SYN-RECV、CLOSE-WAIT、TIME-WAIT、FIN-WAIT                    |
| 连接池    | active、idle、pending、max、acquire timeout、creation count、eviction count          |
| 超时     | connect timeout、read timeout、response timeout、pool acquire timeout、TLS timeout |
| 下游维度   | peer IP、port、service、route、method、status、错误类型                                  |
| 系统资源   | fd 使用率、`somaxconn`、conntrack 使用率、CPU、load、网卡丢包                                 |
| 代理层    | NGINX active/reading/writing/waiting、upstream keepalive、upstream error         |
| 数据库    | 当前连接、最大连接、活跃会话、空闲事务、慢 SQL、锁等待                                                  |

连接治理的核心判断标准不是“连接数是否高”，而是“连接数是否与流量、延迟、错误率、池占用、下游容量相匹配”。

---

## 9. 标准化排障 SOP 总表

| 场景                   | 第一观察项                    | 首要判断            | 优先处置                           |
| -------------------- | ------------------------ | --------------- | ------------------------------ |
| 连接数过多                | `ss -s`、按状态统计            | 正常并发、泄漏、短连接风暴   | 归因后限流、复用、修泄漏                   |
| 连接池耗尽                | active/idle/pending      | 池小还是下游慢         | 查下游 RT 和连接释放                   |
| connect timeout      | `SYN-SENT`、服务端 LISTEN    | 网络阻塞还是 accept 慢 | 查网络、防火墙、backlog                |
| read timeout         | 下游 RT、线程池、SQL            | 连接已建但响应慢        | 查慢接口、慢 SQL、锁                   |
| CLOSE_WAIT 多         | `ss state close-wait -p` | 应用未 close       | 修 finally / try-with-resources |
| TIME_WAIT 多          | peer 聚合                  | 短连接或主动关闭频繁      | 启用连接复用和退避重试                    |
| Too many connections | DB 当前连接                  | 应用连接预算错误        | 限制池、查泄漏、再调上限                   |
| conntrack 满          | count/max                | NAT 表容量不足或短连接多  | 提高上限并减少短连接                     |
| fd 耗尽                | `/proc/<PID>/fd`         | socket 泄漏还是文件泄漏 | 修释放路径，调 NOFILE                 |

---

## 10. 结论

连接治理不是单一参数调优，而是跨应用、协议、代理、内核和下游依赖的生命周期治理。`CLOSE_WAIT` 多通常指向本端应用未关闭连接；`TIME_WAIT` 多通常指向短连接或主动关闭频繁；连接超时必须先区分连接池获取超时、TCP connect timeout、TLS handshake timeout、read/response timeout 和端到端 deadline 超时；连接数过多必须先做归因，再决定是复用、限流、修泄漏、扩容还是调整系统参数。

一个合格的连接治理体系应满足四个条件：第一，所有连接池有上限；第二，所有外部调用有分层 timeout 和端到端 deadline；第三，所有连接状态可观测；第四，所有异常连接状态都有 SOP。缺少这四点，高并发系统会把局部连接问题放大成全链路雪崩。

---

## 参考资料

1. RFC 9293, Transmission Control Protocol (TCP). ([IETF Datatracker][1])
2. Linux man-pages, `tcp(7)`. ([man7.org][13])
3. Linux man-pages, `ss(8)`. ([man7.org][2])
4. Linux man-pages, `lsof(8)`. ([man7.org][3])
5. Linux man-pages, `listen(2)`. ([man7.org][4])
6. Linux Kernel Documentation, `nf_conntrack_max`. ([Linux Kernel][9])
7. MySQL Reference Manual, Too many connections. ([MySQL开发者专区][5])
8. PostgreSQL Documentation, Connections and Authentication. ([PostgreSQL][6])
9. HikariCP GitHub Documentation. ([GitHub][7])
10. Oracle Developers, HikariCP Best Practices for Oracle Database and Spring Boot. ([Oracle 博客][12])
11. Oracle Java SE 21 API, `java.net.http.HttpClient`. ([Oracle 文档][10])
12. Apache HttpClient 5 API, `RequestConfig.Builder`. ([hc.apache.org][11])
13. NGINX Documentation, `ngx_http_core_module` and `ngx_http_upstream_module`. ([Nginx][8])

[1]: https://datatracker.ietf.org/doc/html/rfc9293?utm_source=chatgpt.com "RFC 9293 - Transmission Control Protocol (TCP)"
[2]: https://man7.org/linux/man-pages/man8/ss.8.html?utm_source=chatgpt.com "ss(8) - Linux manual page"
[3]: https://man7.org/linux/man-pages/man8/lsof.8.html?utm_source=chatgpt.com "lsof(8) - Linux manual page"
[4]: https://man7.org/linux/man-pages/man2/listen.2.html?utm_source=chatgpt.com "listen(2) - Linux manual page"
[5]: https://dev.mysql.com/doc/en/too-many-connections.html?utm_source=chatgpt.com "B.3.2.5 Too many connections"
[6]: https://www.postgresql.org/docs/current/runtime-config-connection.html?utm_source=chatgpt.com "Documentation: 18: 19.3. Connections and Authentication"
[7]: https://github.com/brettwooldridge/hikaricp?utm_source=chatgpt.com "brettwooldridge/HikariCP: 光 HikariCP・A solid, high- ..."
[8]: https://nginx.org/en/docs/http/ngx_http_core_module.html?utm_source=chatgpt.com "Module ngx_http_core_module"
[9]: https://www.kernel.org/doc/Documentation/networking/nf_conntrack-sysctl.txt?utm_source=chatgpt.com "nf_conntrack-sysctl.txt"
[10]: https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/java/net/http/HttpClient.html?utm_source=chatgpt.com "HttpClient (Java SE 21 & JDK 21)"
[11]: https://hc.apache.org/httpcomponents-client-5.6.x/current/httpclient5/apidocs/org/apache/hc/client5/http/config/RequestConfig.Builder.html?utm_source=chatgpt.com "RequestConfig.Builder (Apache HttpClient 5.6.1 API)"
[12]: https://blogs.oracle.com/developers/hikaricp-best-practices-for-oracle-database-and-spring-boot?utm_source=chatgpt.com "HikariCP Best Practices for Oracle Database and Spring Boot"
[13]: https://man7.org/linux/man-pages/man7/tcp.7.html?utm_source=chatgpt.com "tcp(7) - Linux manual page"
[14]: https://nginx.org/en/docs/http/ngx_http_upstream_module.html?utm_source=chatgpt.com "Module ngx_http_upstream_module"
[15]: https://kubernetes.io/docs/tasks/administer-cluster/sysctl-cluster/?utm_source=chatgpt.com "Using sysctls in a Kubernetes Cluster"
