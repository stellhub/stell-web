---
title: "如何将系统吞吐量提升 10 倍？网络通信全链路优化指南"
category: "性能工程"
summary: "从批量化、少拷贝、顺序 I/O、zero-copy、pipeline 与减少重复编解码六个方向，系统梳理网络通信链路的高吞吐优化方法。"
tags:
  - "吞吐量"
  - "性能优化"
  - "Zero-Copy"
  - "Pipeline"
  - "Kafka"
  - "Redis"
readingDirection: "适合在排查系统吞吐瓶颈、设计高吞吐数据链路或规划网络与存储联合优化方案时阅读。"
outline: deep
---

# 如何将系统吞吐量提升 10 倍？网络通信全链路优化指南

## 概览

从批量化、少拷贝、顺序 I/O、zero-copy、pipeline 与减少重复编解码六个方向，系统梳理网络通信链路的高吞吐优化方法。

## 摘要

系统吞吐量提升 10 倍，通常不是靠某一个神奇参数，而是靠**全链路减少固定开销**：减少请求次数、减少系统调用、减少内存拷贝、减少随机 I/O、减少等待 RTT、减少重复序列化/反序列化。这个判断并不是经验主义。Redis 官方文档在解释 pipelining 时明确指出，pipeline 可以减少 RTT 等待，并通过一次 `read()`/`write()` 处理多个命令来降低系统调用开销，吞吐量最终可达到无 pipeline 基线的 10 倍；Apache Kafka 官方设计文档也把高吞吐设计的关键归纳为批量化、顺序 I/O、page cache、标准二进制消息格式和 zero-copy。([Redis][1]) ([Apache Kafka][2])

本文围绕 **批量化、少拷贝、顺序 I/O、zero-copy、pipeline、少序列化/反序列化** 六个方向，系统讨论网络通信全链路如何提升吞吐量，并给出工程最佳实践。本文的核心结论是：**吞吐量优化的本质，是把“逐条处理、逐次等待、逐次拷贝、逐次落盘、逐次编解码”的系统，改造成“批量传输、异步流水、连续内存、顺序写入、零拷贝转发、边界编解码”的系统。**

**关键词**：吞吐量优化；批量化；zero-copy；顺序 I/O；pipeline；序列化；网络通信；Kafka；Redis；gRPC；Linux

---

## 一、问题定义：吞吐量为什么上不去？

一个典型低吞吐系统通常长这样：

```text
for each request:
    JSON serialize
    write socket
    wait response
    read response
    JSON deserialize
    random write disk
    flush
```

这种模型的性能瓶颈不一定在业务逻辑，而是在大量固定成本上：

```text
单请求 RTT
单请求系统调用
用户态/内核态切换
用户态与内核态内存拷贝
小包网络发送
随机磁盘 I/O
重复序列化/反序列化
频繁对象分配与 GC
```

所以吞吐量优化的第一原则是：

```text
不要先优化算法，先消灭每条消息上的固定开销。
```

Kafka 官方设计文档对这一点讲得非常直接：一旦磁盘访问模式被优化，系统中两个主要低效点就是**太多小 I/O 操作**和**过多字节拷贝**；Kafka 通过 message set 批量格式，把网络请求、磁盘追加、消费拉取都设计成大块顺序数据处理，从而获得数量级提升。([Apache Kafka][2])

本文讨论的优化路径可以概括为：

```text
小请求 → 大批量
同步等待 → 异步 pipeline
随机写 → 顺序追加
多次 copy → 少 copy / zero-copy
文本协议 → 二进制协议
逐跳编解码 → 边界编解码
```

---

## 二、总体优化模型：从“单条消息系统”变成“数据流系统”

吞吐量优化不能只看某一层。一次请求通常会经过：

```text
业务对象
  ↓ 序列化
用户态 buffer
  ↓ write/send
内核 socket buffer
  ↓ TCP/IP
网卡
  ↓ 网络
服务端内核 buffer
  ↓ read/recv
服务端用户态 buffer
  ↓ 反序列化
业务处理
  ↓ 存储 / 转发 / 下游调用
```

每经过一层，都可能产生拷贝、系统调用、等待、对象分配、协议解析和上下文切换。真正有效的 10 倍吞吐提升，必须贯穿整条链路：

| 优化方向      | 目标                          |
| --------- | --------------------------- |
| 批量化       | 减少请求次数、系统调用次数、网络包数量         |
| 少拷贝       | 减少用户态内存复制、buffer 拼接、对象复制    |
| 顺序 I/O    | 把随机读写改成 append-only 或大块顺序读写 |
| zero-copy | 避免数据在用户态和内核态之间反复复制          |
| pipeline  | 减少 RTT 等待，让连接持续有在途请求        |
| 少序列化/反序列化 | 避免每一跳都把 bytes 还原成对象再重新编码    |

下面逐项展开。

---

## 三、第一步：批量化，把“小请求”变成“大数据块”

### 3.1 为什么批量化能显著提升吞吐量？

批量化是最应该优先做的吞吐量优化。原因很简单：系统处理 1 条消息和处理 100 条消息时，很多成本不是线性增加的。

一次网络请求通常包含：

```text
系统调用成本
TCP/IP 协议栈处理成本
网络 RTT
请求头成本
服务端调度成本
日志写入成本
响应处理成本
```

如果每条消息都单独发送，这些固定开销会被重复 100 次。如果把 100 条消息放进一个 batch，这些成本大部分只发生 1 次。

Kafka 官方文档明确指出，批量化可以把网络往返开销摊销到多条消息上，并把小的随机写转化成大块线性写；这种优化会带来更大的网络包、更大的顺序磁盘操作和连续内存块，从而获得数量级提升。([Apache Kafka][2])

Redis 官方文档也给出类似结论：pipeline 允许客户端一次发送多个命令而不等待每个命令的响应，从而减少 RTT；同时服务端可以通过一次 `read()` 系统调用读取多个命令、一次 `write()` 系统调用写出多个响应，吞吐量会随着 pipeline 长度接近线性提升，并最终达到基线的 10 倍。([Redis][1])

### 3.2 批量化的最佳实践

批量化不要只按“条数”设计，而要按以下四个边界共同控制：

```text
max.batch.records   最大消息条数
max.batch.bytes     最大批量字节数
max.linger.ms       最大等待时间
max.buffer.memory   最大缓冲内存
```

Kafka Producer 的配置就是典型范例。Kafka 官方配置文档说明，`batch.size` 控制 producer 尝试把同一分区的 records 组合成更少请求，较小的 batch 会降低吞吐；`linger.ms` 则允许 producer 等待更多 records 到来，以便组成更大的 batch；`buffer.memory` 控制 producer 可用于缓冲待发送记录的总内存。([Apache Kafka][3])

合理的工程策略是：

```text
低延迟业务：
    linger.ms = 1ms ~ 5ms
    batch.size = 中等
    严格控制 p99 latency

高吞吐日志/埋点/MQ：
    linger.ms = 5ms ~ 50ms
    batch.size = 较大
    优先提高压缩率和网络利用率

离线同步/文件传输：
    batch.size = 大
    以 max.request.size 和内存水位为边界
```

Kafka 官方文档还指出，压缩发生在完整 batch 上，更多 batching 通常有助于提升压缩率；Kafka 支持 gzip、snappy、lz4、zstd 等压缩类型。([Apache Kafka][3])

### 3.3 批量化的反模式

批量化不是越大越好。错误做法包括：

```text
只增大 batch.size，不控制 linger.ms
只追求吞吐，不看 p99/p999 延迟
没有内存上限，导致堆积后 OOM
失败后整个大 batch 重试，扩大故障影响
不同租户/优先级混在一个 batch 中
```

我的判断是：**批量化是吞吐量优化的第一优先级，但必须受延迟预算和错误预算约束。** 如果你的系统现在是单条消息同步发送，优先做 batch 和 pipeline，通常收益最大。

---

## 四、第二步：少拷贝，减少内存搬运和 buffer 拼接

### 4.1 拷贝为什么会吞掉吞吐量？

网络系统中常见的低效写法是：

```text
headerBytes = encodeHeader()
bodyBytes = encodeBody()
packet = new byte[headerBytes.length + bodyBytes.length]
copy headerBytes to packet
copy bodyBytes to packet
socket.write(packet)
```

这类代码看似简单，但会产生：

```text
额外内存分配
额外数组复制
GC 压力
CPU cache miss
用户态到内核态复制
```

Kafka 官方设计文档指出，过多字节拷贝是高吞吐系统中的核心低效点之一。Kafka 的做法是让 producer、broker、consumer 共享标准二进制消息格式，broker 不需要重新解析和改写消息，而是可以按 chunk 直接处理和转发。([Apache Kafka][2])

### 4.2 使用直接内存和长期 buffer

Java 官方 `ByteBuffer` 文档说明，direct buffer 会尽最大努力让 JVM 直接执行 native I/O，避免在调用操作系统 native I/O 之前或之后，把内容复制到中间 buffer；但 direct buffer 的分配和释放成本更高，因此官方建议主要把它用于大型、长期存在、需要 native I/O 的 buffer，并且只有在能带来可测量收益时才使用。([Oracle Docs][4])

所以最佳实践是：

```text
小对象、短生命周期：
    不要盲目使用 direct buffer

大块网络读写：
    使用 direct buffer
    使用 buffer pool
    避免频繁 allocate/free

高吞吐服务：
    复用 buffer
    复用 encoder/decoder
    避免 byte[] 反复拼接
```

### 4.3 使用 scatter/gather I/O

Linux `readv`/`writev` 提供 scatter/gather I/O 能力：`readv` 可以把数据读入多个 buffer，`writev` 可以从多个 buffer 组合写出。也就是说，应用可以把 header、metadata、body 分别放在不同 buffer 中，然后一次 `writev` 写出，而不是先拼接成一个大数组。([man7.org][5])

推荐模型：

```text
header buffer
metadata buffer
payload buffer
        ↓
writev(fd, [header, metadata, payload])
```

不推荐模型：

```text
copy header + metadata + payload into new byte[]
        ↓
write(fd, mergedBytes)
```

### 4.4 少拷贝最佳实践清单

| 场景          | 推荐做法                           |
| ----------- | ------------------------------ |
| Java 网络 I/O | 大块 I/O 使用 direct buffer，配合池化   |
| 协议编码        | header/body 分离，使用 gather write |
| 网关转发        | 不解析不关心的 body                   |
| MQ broker   | 保持消息二进制格式，避免中间层反序列化            |
| 日志采集        | 多条日志批量编码，避免每条日志单独分配            |
| 文件传输        | 使用 `sendfile` / `transferTo`   |
| 压缩          | batch 级压缩，避免单条压缩               |

NGINX 官方文档中也有类似思路。例如 `client_body_in_single_buffer on` 的说明中明确提到，当使用 `$request_body` 变量时，建议启用该选项以节省复制操作。([Nginx][6])

---

## 五、第三步：顺序 I/O，把随机读写改成 append-only

### 5.1 顺序 I/O 为什么关键？

磁盘性能最怕随机读写。Kafka 官方设计文档明确强调不要害怕文件系统，现代操作系统的 page cache、read-ahead 和 write-behind 对顺序 I/O 非常友好；文档中还引用了一个经典对比：线性写可以达到约 600MB/s，而随机写只有约 100KB/s，两者相差约 6000 倍。([Apache Kafka][2])

Kafka 的核心设计就是 append-only log。producer 把消息追加到 log，consumer 以较大的线性 chunk 拉取数据；这种方式能充分利用文件系统 page cache 和顺序 I/O。([Apache Kafka][2])

### 5.2 顺序 I/O 的最佳实践

高吞吐系统应该尽量使用：

```text
append-only log
分区顺序写
批量 flush
segment 文件
顺序扫描
page cache
后台 compaction
```

避免：

```text
每条消息随机更新
每条消息 fsync
小文件频繁创建
同步随机读写
大量索引散点写
```

一个典型优化前后的模型如下。

优化前：

```text
insert message
update status
update index
fsync
```

优化后：

```text
append message to log
append index entry
batch flush
background compact / checkpoint
```

### 5.3 顺序 I/O 与 page cache

Kafka 官方文档强调，操作系统 page cache 可以把空闲内存自动用于缓存，并通过 write-behind 合并小的逻辑写入；使用 JVM 堆内缓存反而可能带来对象内存膨胀和 GC 压力。([Apache Kafka][2])

所以我的判断是：**对于日志型、消息型、事件型系统，不应该优先设计复杂的进程内大缓存，而应该优先设计顺序日志 + page cache 友好的文件布局。**

### 5.4 大文件发送场景

NGINX 官方文档说明，在 Linux 上可以组合使用 AIO、directio、sendfile 和线程池进行文件发送；当启用 AIO 与 sendfile 时，大于等于 directio 阈值的文件可以使用 AIO，小于阈值或未启用 directio 的文件可以使用 sendfile。([Nginx][6])

这给出的工程启发是：

```text
小文件 / 热文件：
    page cache + sendfile

大文件 / 冷文件：
    AIO / directio / 线程池
    避免阻塞 worker

日志流 / MQ：
    append-only + page cache + sequential fetch
```

---

## 六、第四步：zero-copy，绕开用户态重复搬运

### 6.1 zero-copy 解决什么问题？

传统文件转网络的路径通常是：

```text
disk → kernel page cache → user buffer → kernel socket buffer → NIC
```

这会产生多次 copy 和多次系统调用。Linux `sendfile()` 的官方 man page 说明，`sendfile()` 在两个文件描述符之间复制数据，并且由于复制发生在内核中，因此比需要用户态数据传输的 `read()` + `write()` 更高效。([man7.org][7])

Java `FileChannel.transferTo` 官方文档也说明，该方法可能比从源 channel 读取再写入目标 channel 的循环更高效，很多操作系统可以直接从文件系统缓存向目标 channel 传输字节，而无需实际复制。([Oracle Docs][8])

### 6.2 Kafka 的 zero-copy 模型

Kafka 官方文档把传统路径描述为：从文件到 socket 的传输如果用 `read()` + `write()`，会经历多次复制和系统调用；使用 `sendfile` 可以让操作系统直接把 page cache 中的数据发送到网络，从而避免重复复制。Kafka 还说明，当消费者重放数据时，数据可能已经在 page cache 中，此时 zero-copy 路径可以让消费速度接近网络限制。([Apache Kafka][2])

这也是 Kafka 能在消息持久化之后仍保持高吞吐的重要原因：

```text
producer append log
        ↓
page cache
        ↓
consumer fetch via sendfile
        ↓
network
```

### 6.3 MSG_ZEROCOPY：不是所有场景都适合

Linux Kernel 官方文档说明，`MSG_ZEROCOPY` 可以为 socket send 调用提供 copy avoidance，当前实现支持 TCP、UDP 和 VSOCK；但文档也强调，zero-copy 并非免费，它用 page pinning、page accounting 和 completion notification 替代了字节拷贝成本，通常只有在写入大小超过约 10KB 时才有效。([Linux Kernel文档][9])

因此，`MSG_ZEROCOPY` 的正确使用条件是：

```text
大 buffer
高吞吐
应用能管理 buffer 生命周期
能处理 completion notification
能接受实现复杂度
```

不适合：

```text
小包 RPC
短生命周期 buffer
业务代码无法保证发送完成前不修改 buffer
追求简单稳定的普通微服务
```

### 6.4 zero-copy 的类型区分

| 类型                 | 典型技术                                | 适用场景            |
| ------------------ | ----------------------------------- | --------------- |
| 文件到 socket         | `sendfile`、`FileChannel.transferTo` | 静态文件、日志段、消息重放   |
| 用户 buffer 到 socket | `MSG_ZEROCOPY`                      | 大块 TCP/UDP 发送   |
| 接收侧 zero-copy      | io_uring zero-copy receive          | 高性能网络接收         |
| 序列化 zero-copy      | FlatBuffers                         | 直接访问序列化后的 bytes |

io_uring 的 Linux man page 描述它是 Linux 专用的异步 I/O 接口，通过用户态和内核态共享 ring buffer 提交和完成请求，以减少传统异步接口的开销。Linux Kernel 文档还说明，io_uring zero-copy receive 能够移除网络接收路径中的 kernel-to-user copy，让包数据直接接收到用户空间内存中。([man7.org][10]) ([Linux Kernel文档][11])

### 6.5 zero-copy 的反模式

zero-copy 不能被神化。典型反模式包括：

```text
小包也强行 MSG_ZEROCOPY
TLS 场景误以为 sendfile 一定有效
业务还要解析修改 payload，却强行追求 zero-copy
buffer 生命周期管理错误，发送完成前复用内存
没有压测就把普通 write 全部替换为复杂 zero-copy
```

Kafka 官方文档也明确指出，Kafka 在 SSL 场景下不使用 `sendfile`，原因是大多数 SSL 库仍然在用户空间操作，并且 Kafka 不支持内核态 SSL sendfile。([Apache Kafka][2])

所以判断标准很简单：

```text
如果数据只是转发，不需要业务解析：
    优先 zero-copy

如果数据必须解析、修改、鉴权、脱敏：
    优先少拷贝，不要执着 zero-copy
```

---

## 七、第五步：pipeline，让连接一直有在途请求

### 7.1 pipeline 解决 RTT 等待

Redis 官方文档用一个极端例子说明 RTT 的影响：如果客户端到服务器 RTT 是 250ms，即使服务器每秒能处理 100k 请求，客户端如果每次都等待响应后再发下一个请求，也最多只能做到每秒 4 个请求。Redis pipelining 允许客户端连续发送多个命令，然后再读取响应，从而显著提升吞吐。([Redis][1])

这说明一个重要事实：

```text
高吞吐不是每个请求更快，而是连接上不要空等。
```

### 7.2 pipeline 与批量化的区别

批量化是：

```text
多个业务消息 → 一个请求
```

pipeline 是：

```text
多个请求 → 连续发送，不逐个等待响应
```

两者可以叠加：

```text
batch request 1
batch request 2
batch request 3
全部在途
异步接收 response
```

### 7.3 HTTP/2 与 gRPC 的 pipeline / multiplexing

HTTP/2 官方 RFC 说明，HTTP/2 的 frame 和 stream 层允许在一个连接中存在多个并发打开的 stream，并交错传输不同 stream 的 frame。([IETF Datatracker][12])

gRPC 官方性能最佳实践建议复用 stub 和 channel；对于长生命周期数据流，可以使用 streaming RPC，以避免持续创建 RPC、HTTP/2 request 和 handler 调用。gRPC 文档也提醒，每个 HTTP/2 connection 通常有并发 stream 限制，超过限制的 RPC 会在客户端排队；高负载或长生命周期 stream 场景下，可以为高负载区域创建独立 channel 或使用 channel pool。([gRPC][13])

所以 gRPC 高吞吐实践应该是：

```text
复用 channel
复用 stub
使用 async / non-blocking stub
必要时使用 streaming RPC
监控并发 stream 限制
高负载场景使用 channel pool
不要每个请求创建 channel
```

### 7.4 pipeline 的最佳实践

| 场景             | 最佳实践                                        |
| -------------- | ------------------------------------------- |
| Redis          | 使用 pipeline，控制每批命令数量，避免服务端回复队列过大            |
| Kafka Producer | 使用异步发送、batch、linger、in-flight requests      |
| gRPC           | 复用 channel，使用 async stub，必要时 streaming      |
| HTTP/2         | 利用 multiplexing，但监控 stream 队列和 flow control |
| 数据库写入          | 批量写、异步写、prepared statement 复用               |
| 日志上报           | 本地 buffer + 异步 flush + backpressure         |

Kafka Producer 官方配置中，`max.in.flight.requests.per.connection` 控制客户端在单个连接上未收到响应的最大请求数；文档也说明，如果没有启用幂等且该值大于 1，重试可能导致消息重排序。([Apache Kafka][3])

因此 pipeline 的核心不是“无限并发”，而是：

```text
有上限的在途请求
有 backpressure
有超时控制
有顺序语义约束
有失败重试边界
```

---

## 八、第六步：少序列化/反序列化，避免每一跳都还原对象

### 8.1 JSON 不是高吞吐链路的理想格式

在内部高吞吐链路中，如果每一跳都执行：

```text
bytes → JSON object → business object → JSON bytes
```

吞吐量一定会被拖垮。高吞吐系统应该尽量做到：

```text
入口解析一次
内部传输二进制
中间层不关心 payload 就不要解析
出口按需要解析
```

Protocol Buffers 官方文档把 protobuf 定义为语言无关、平台无关的结构化数据序列化机制，并指出它类似 JSON，但更小、更快，还可以通过生成代码跨语言读写结构化数据。官方文档列出的优势包括紧凑存储、快速解析、多语言支持以及通过生成类优化功能。([protobuf.dev][14])

### 8.2 Protobuf 的正确使用边界

Protobuf 非常适合常规 RPC 和服务间通信，但官方文档也明确说明，它不适合超过几 MB 的大消息；protobuf 假设整个消息可以一次性加载到内存中，大数据可能导致多个副本和内存峰值，而且 protobuf 消息本身不压缩。([protobuf.dev][14])

所以最佳实践是：

```text
普通 RPC：
    使用 Protobuf

大文件 / 大 payload：
    使用对象存储、文件传输、分块传输或 streaming

高吞吐日志：
    使用批量 Protobuf / Avro / 二进制格式
    配合 batch 压缩

超大消息：
    不要塞进单个 protobuf message
```

### 8.3 FlatBuffers：读多写少场景的 zero-copy 序列化

FlatBuffers 官方文档说明，它是 Google 创建的高性能跨平台序列化库，面向游戏和性能关键应用；它允许访问序列化数据而无需先解析或 unpack 到中间对象，并且内存效率高，只需要持有一个 buffer，不需要额外堆分配。([flatbuffers.dev][15])

FlatBuffers 适合：

```text
读多写少
大对象频繁读取
需要低 GC
需要跨语言
中间层只读取少数字段
```

不一定适合：

```text
频繁修改对象
复杂业务对象建模
团队更熟悉 Protobuf 生态
需要广泛 RPC 框架集成
```

### 8.4 gRPC 中减少重复序列化

gRPC 官方 Java 性能文档提到，`GenericStub` 可以直接发送原始 gRPC `ByteBuffer`，如果同一数据需要发送多次，可以先序列化一次为 `ByteBuffer`，然后多次发送，避免重复序列化。([gRPC][13])

这给网关、代理、广播、fan-out 系统一个很重要的启发：

```text
同一 payload 发给多个下游：
    serialize once
    retain bytes
    fan-out bytes

不要：
    每个下游重新对象化
    每个下游重新序列化
```

### 8.5 少序列化最佳实践

| 场景         | 推荐做法                               |
| ---------- | ---------------------------------- |
| 内部 RPC     | Protobuf / gRPC                    |
| 高吞吐事件      | 批量二进制编码 + batch 压缩                 |
| 中间代理       | 不解析不关心的 payload                    |
| fan-out    | serialize once，多次发送 bytes          |
| 读多写少大对象    | FlatBuffers                        |
| 超大 payload | 分块、streaming、对象存储、zero-copy 文件路径   |
| 跨语言协议      | 使用 schema-first，避免 Map/String 动态协议 |

我的判断是：**微服务内部大量使用 JSON，是吞吐量上不去的常见根因之一。** JSON 适合开放接口和调试，不适合作为高吞吐内部数据平面的默认协议。

---

## 九、六种优化手段如何组合

真正的 10 倍提升，通常来自组合拳，而不是单点优化。

### 9.1 优化前链路

```text
业务对象
  ↓ JSON serialize
小请求 write
  ↓ 等待 RTT
服务端 read
  ↓ JSON deserialize
随机写 DB / 文件
  ↓ 同步 flush
响应
```

### 9.2 优化后链路

```text
业务对象
  ↓ Protobuf / FlatBuffers
批量聚合
  ↓ writev / async send
pipeline 多请求在途
  ↓ 服务端批量 read
append-only 顺序 log
  ↓ page cache
sendfile / transferTo fan-out
  ↓ batch compressed response
客户端批量处理
```

对应关系如下：

| 瓶颈             | 优化手段                                     |
| -------------- | ---------------------------------------- |
| 每条消息一次 RTT     | pipeline                                 |
| 每条消息一次 syscall | batch、writev                             |
| 每条消息一次网络包      | batch、压缩                                 |
| 用户态多次拷贝        | direct buffer、buffer pool、scatter/gather |
| 文件到网络多次复制      | sendfile、transferTo                      |
| 随机磁盘写          | append-only、顺序 I/O                       |
| 每一跳编解码         | 边界编解码、二进制透传                              |
| 大量 JSON 解析     | Protobuf / FlatBuffers                   |
| 小消息压缩率差        | batch-level compression                  |

Kafka 的设计正是这种组合：批量消息格式、顺序日志、page cache、zero-copy、端到端 batch compression、异步 producer 和 pull-based consumer 共同作用，才形成高吞吐架构。([Apache Kafka][2])

---

## 十、工程落地路线

### 10.1 第一步：先测量，不要猜

优化前必须建立基线：

```text
QPS / TPS
MB/s
p50 / p95 / p99 / p999 latency
CPU 使用率
CPU cycles/byte
GC allocation rate
系统调用次数
网络包大小
磁盘顺序/随机 I/O 比例
page cache 命中率
序列化耗时占比
copy 耗时占比
```

没有基线的优化，基本都是玄学。

### 10.2 第二步：优先做 batch + pipeline

如果系统目前是同步逐条发送，第一优先级应该是：

```text
增加 batch
增加 async pipeline
减少等待 RTT
减少请求数
减少 syscall
```

Redis 和 Kafka 官方文档都说明了这两个方向对吞吐量的巨大影响：Redis pipelining 可以减少 RTT 和系统调用并达到 10 倍基线吞吐；Kafka batching 可以把小 I/O 转成大块网络包、顺序磁盘操作和连续内存处理。([Redis][1]) ([Apache Kafka][2])

### 10.3 第三步：替换文本协议和重复编解码

如果 CPU 大量消耗在 JSON、反射、对象转换、字符串处理上，应优先改为：

```text
Protobuf
FlatBuffers
schema-first binary protocol
serialize once
pass-through bytes
```

Protocol Buffers 官方文档明确指出，相比 JSON，protobuf 更小、更快，并通过生成代码跨语言读写结构化数据；FlatBuffers 官方文档则强调可以不经过解析或 unpack 直接访问序列化数据。([protobuf.dev][14]) ([flatbuffers.dev][15])

### 10.4 第四步：把存储改成顺序 I/O

如果系统写入路径包含大量随机写、逐条 fsync、小文件写，应改造为：

```text
append-only log
批量刷盘
segment 文件
后台 compaction
顺序 scan
```

Kafka 官方文档已经证明，这类设计可以充分利用操作系统 page cache、read-ahead 和 write-behind，并避免随机 I/O 的极端性能损失。([Apache Kafka][2])

### 10.5 第五步：在转发路径使用 zero-copy

如果系统存在文件下载、日志重放、消息 fan-out、静态资源分发，应优先考虑：

```text
sendfile
FileChannel.transferTo
page cache
zero-copy fan-out
```

Linux `sendfile()` 和 Java `FileChannel.transferTo` 官方文档都明确说明，这类方式可以避免传统 read/write 方式中的用户态数据搬运。([man7.org][7]) ([Oracle Docs][8])

### 10.6 第六步：建立 backpressure

所有高吞吐系统都必须有反压，否则 batch 和 pipeline 会把系统推向崩溃。

必须设置：

```text
最大队列长度
最大 batch bytes
最大 in-flight requests
最大 buffer memory
请求超时
重试预算
丢弃策略
降级策略
限流策略
```

HTTP/2 官方 RFC 也提醒，接收端必须及时读取和处理 frame，否则在 flow control 下可能导致死锁；同时在多路复用协议中，优先级策略很关键，错误或低效的优先级方案会导致性能变差。([IETF Datatracker][12])

---

## 十一、一个可执行的优化模板

下面给出一个通用高吞吐链路模板：

```text
Client
  ├─ 本地队列
  ├─ batch by size/time
  ├─ Protobuf encode once
  ├─ optional batch compression
  ├─ async send
  └─ bounded in-flight

Network
  ├─ keepalive connection
  ├─ HTTP/2 multiplexing or custom TCP pipeline
  ├─ writev / direct buffer
  └─ backpressure

Server
  ├─ batch receive
  ├─ minimal decode
  ├─ append-only log
  ├─ page cache
  ├─ async processing
  └─ batch response

Fan-out / Replay
  ├─ transferTo / sendfile
  ├─ no reserialize
  └─ compressed batch passthrough
```

对应配置思路：

```text
batch.size:
    从 32KB / 64KB 起步压测

linger.ms:
    从 1ms ~ 5ms 起步，观察 p99

max.in.flight:
    从 2 ~ 5 起步，结合顺序语义调整

buffer.memory:
    必须限制，避免无限堆积

compression:
    日志、事件、MQ 优先 batch compression

serialization:
    内部链路优先 Protobuf
    读多写少大对象评估 FlatBuffers

I/O:
    日志型系统优先 append-only
    文件转发优先 sendfile / transferTo
```

---

## 十二、结论

“系统吞吐量提升 10 倍”并不神秘，但前提是瓶颈确实来自小请求、小 I/O、多拷贝、多 RTT、随机写和重复编解码。Redis 官方文档给出了 pipelining 达到 10 倍基线吞吐的例子，Kafka 官方设计文档也系统展示了批量化、顺序 I/O、page cache、zero-copy 和二进制消息格式如何共同构建高吞吐系统。([Redis][1]) ([Apache Kafka][2])

本文的最终判断是：

```text
第一优先级：批量化 + pipeline
第二优先级：减少序列化/反序列化
第三优先级：顺序 I/O
第四优先级：少拷贝
第五优先级：zero-copy
第六优先级：全链路 backpressure
```

其中最关键的一句话是：

```text
不要让系统按“请求”工作，要让系统按“数据流”工作。
```

当系统从逐条请求模型转向批量流式模型，从 JSON 对象模型转向二进制数据模型，从随机 I/O 转向顺序 I/O，从 read/write 拷贝模型转向 zero-copy 转发模型，吞吐量提升 10 倍才是现实目标，而不是口号。

[1]: https://redis.io/docs/latest/develop/using-commands/pipelining/ "Redis pipelining | Docs"
[2]: https://kafka.apache.org/42/design/design/ "Design | Apache Kafka"
[3]: https://kafka.apache.org/41/configuration/producer-configs/ "Producer Configs | Apache Kafka"
[4]: https://docs.oracle.com/en/java/javase/11/docs/api/java.base/java/nio/ByteBuffer.html "ByteBuffer (Java SE 11 & JDK 11 )"
[5]: https://man7.org/linux/man-pages/man2/readv.2.html?utm_source=chatgpt.com "readv(2) - Linux manual page"
[6]: https://nginx.org/en/docs/http/ngx_http_core_module.html "Module ngx_http_core_module"
[7]: https://man7.org/linux/man-pages/man2/sendfile.2.html?utm_source=chatgpt.com "sendfile(2) - Linux manual page"
[8]: https://docs.oracle.com/en/java/javase/24/docs/api/java.base/java/nio/channels/FileChannel.html "FileChannel (Java SE 24 & JDK 24)"
[9]: https://docs.kernel.org/networking/msg_zerocopy.html "MSG_ZEROCOPY — The Linux Kernel  documentation"
[10]: https://man7.org/linux/man-pages/man7/io_uring.7.html?utm_source=chatgpt.com "io_uring(7) - Linux manual page"
[11]: https://docs.kernel.org/networking/iou-zcrx.html?utm_source=chatgpt.com "io_uring zero copy Rx"
[12]: https://datatracker.ietf.org/doc/html/rfc9113 "RFC 9113 - HTTP/2"
[13]: https://grpc.io/docs/guides/performance/ "Performance Best Practices | gRPC"
[14]: https://protobuf.dev/overview/ "Overview | Protocol Buffers Documentation"
[15]: https://flatbuffers.dev/ "FlatBuffers Docs"
