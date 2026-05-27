---
title: "基于 TCP 的自定义应用层协议研究：以 Kafka、Redis、MySQL 为例"
category: "网络协议"
summary: "结合 Kafka、Redis 和 MySQL，分析基础设施系统为什么会在 TCP 之上设计自定义应用层协议，以及这种设计在性能、语义表达和协议演进上的价值。"
tags:
  - "TCP"
  - "自定义协议"
  - "Kafka"
  - "Redis"
  - "MySQL"
  - "gRPC"
readingDirection: "适合在评估基础设施通信协议、比较 HTTP 与自定义协议边界，或设计高性能中间件传输层时阅读。"
outline: deep
---

# 基于 TCP 的自定义应用层协议研究：以 Kafka、Redis、MySQL 为例

## 概览

结合 Kafka、Redis 和 MySQL，分析基础设施系统为什么会在 TCP 之上设计自定义应用层协议，以及这种设计在性能、语义表达和协议演进上的价值。

## 摘要

在高性能中间件、数据库、消息队列和缓存系统中，很多系统并没有直接采用 HTTP、REST 或 gRPC 作为内部通信协议，而是在 TCP 之上设计自己的应用层协议。严格来说，这不是“自定义 TCP 协议”，而是“基于 TCP 的自定义应用层协议”。TCP 负责可靠、有序、面向连接的字节流传输，而 Kafka、Redis、MySQL 等系统在 TCP 字节流之上定义自己的报文格式、请求响应模型、命令语义、版本协商、错误码、批量传输、认证流程和扩展机制。

本文认为：**自定义 TCP 应用层协议不是为了炫技，而是为了让网络协议与系统的核心数据模型、性能目标和演进机制深度绑定。** 对 Kafka、Redis、MySQL 这类基础设施软件而言，HTTP/gRPC 虽然成熟，但它们携带了通用 RPC 或 Web 语义；而消息队列、缓存、数据库需要的是更贴近自身领域模型的通信协议。因此，自定义协议的价值主要体现在：降低协议开销、提升解析效率、支持批量与流水线、表达领域语义、控制连接生命周期、实现精细版本兼容、便于多语言客户端长期演进。

**关键词**：TCP、自定义协议、Kafka Protocol、Redis RESP、MySQL Protocol、HTTP、gRPC、二进制协议、应用层协议

---

## 一、概念澄清：不是自定义 TCP，而是自定义 TCP 之上的应用层协议

工程中常说“自定义 TCP 协议”，这个说法并不严谨。TCP 是传输层协议，它只提供可靠字节流，不理解“请求”“响应”“命令”“SQL”“消息”“分区”“offset”这些业务概念。真正被自定义的是 TCP 之上的应用层协议。

也就是说，系统设计者通常不会修改 TCP 本身，而是设计如下内容：

```text
TCP 连接
  ↓
应用层报文边界
  ↓
协议头
  ↓
请求类型 / 命令类型
  ↓
序列号 / correlation id
  ↓
协议版本
  ↓
认证信息
  ↓
业务 payload
  ↓
错误码 / 响应结构
```

例如 Kafka 官方协议文档明确说明，Kafka 使用的是 **binary protocol over TCP**，所有 API 都被定义为请求-响应消息对，消息本身带有长度边界。Kafka 客户端建立 socket 连接后，会连续写入请求并读取对应响应；Kafka 还强调长期复用 TCP 连接，以摊销 TCP 握手成本。([Apache Kafka][1])

所以，本文讨论的“自定义 TCP 协议”，本质是：

> 在 TCP 可靠字节流之上，设计面向特定系统语义的应用层协议。

这个概念非常关键。因为一旦把它误解成“重新发明 TCP”，方向就错了；真正有价值的是**在 TCP 之上定义更贴合业务系统的数据交换格式和交互模型**。

---

## 二、为什么要自定义 TCP 应用层协议？

我的判断是：**只有当通用协议的抽象成本开始伤害系统核心目标时，自定义协议才是合理的。** 对大多数普通业务系统，HTTP/gRPC 足够好；但对 Kafka、Redis、MySQL 这类基础设施系统，自定义协议几乎是必然选择。

### 1. 为了获得更低的协议开销

HTTP 是为 Web 资源访问设计的协议，天然携带 method、path、header、status code、content-type、cookie、cache-control 等语义。gRPC 虽然比传统 REST 更适合服务间通信，但它本质上运行在 HTTP/2 之上。gRPC 官方协议说明中，请求头通过 HTTP/2 HEADERS 和 CONTINUATION frames 传递，并包含 `:method`、`:scheme`、`:path`、`content-type`、`grpc-timeout`、`grpc-encoding` 等字段。([grpc.github.io][2])

这些机制非常强大，但对 Kafka、Redis、MySQL 来说，其中很多字段不是核心需求。

例如 Kafka 生产消息时，真正关心的是：

```text
topic
partition
acks
timeout
record batch
compression
producer id
sequence number
transaction marker
```

Redis 执行命令时，真正关心的是：

```text
command
key
arguments
reply type
pipeline order
push message
```

MySQL 查询时，真正关心的是：

```text
handshake
capability flags
authentication
command type
SQL payload
result set
column metadata
row data
OK packet
ERR packet
```

这些领域语义用 HTTP 表达不是不可以，但会出现一层不必要的“语义转译”：

```text
Kafka ProduceRequest → HTTP POST /produce
Redis GET key       → HTTP GET /redis/key
MySQL query         → HTTP POST /query
```

这在业务网关中可以接受，但对底层基础设施来说是多余的。自定义协议可以直接表达领域对象，减少无关字段、无关解析、无关抽象。

---

### 2. 为了获得稳定、明确、低成本的报文边界

TCP 是字节流协议，不保留消息边界。应用层协议必须自己解决：

```text
一次 read() 读到半包怎么办？
一次 read() 读到多个包怎么办？
payload 多大？
怎么判断一条消息结束？
```

常见方案有三类：

```text
1. 固定长度头 + payload length
2. 分隔符，例如 CRLF
3. TLV / VarInt / frame-based encoding
```

Kafka 使用的是长度分隔的二进制协议。Kafka 文档说明，所有消息都是 size-delimited，并由一组基础类型组成；其中 `BYTES` 类型也是先给出长度，再跟随原始字节。([Apache Kafka][1])

Redis RESP 也非常典型。RESP 使用首字节标识数据类型，bulk string 使用 `$<length>\r\n<data>\r\n` 格式。官方文档明确指出，RESP 使用长度前缀传输 bulk data，因此不需要像 JSON 那样扫描 payload 中的特殊字符，也不需要引号转义；bulk data 可以通过一次读取处理。([Redis][3])

MySQL 协议同样采用明确的 packet 格式。MySQL 官方文档说明，客户端和服务端之间的数据以 packet 交换，packet header 中包含 3 字节 payload length、1 字节 sequence id，payload 最大 16MB。([MySQL开发者专区][4])

这就是自定义协议的第一个核心优势：**你可以把消息边界设计得非常适合自己的数据模型和 IO 模型。**

---

### 3. 为了让协议直接服务于系统核心语义

HTTP/gRPC 的优势是通用，但通用也意味着它们不天然理解某个中间件的领域模型。

Kafka 的核心不是“调用一个远程方法”，而是：

```text
主题 topic
分区 partition
副本 replica
leader broker
offset
record batch
consumer group
fetch position
事务
幂等生产
元数据发现
```

Kafka 协议直接把这些语义设计进请求和响应中。例如 Kafka 文档说明，客户端需要根据 topic partition 找到对应 leader broker；如果请求发错 broker，会收到 NotLeaderForPartition 错误；客户端通过 metadata request 获取当前集群、topic、partition、leader、broker host/port 等信息。([Apache Kafka][1])

这不是普通 RPC 语义，而是 Kafka 自身的分布式日志语义。

Redis 也是类似。Redis RESP 不是单纯传输 JSON，而是围绕 Redis 命令模型设计：客户端发送由 bulk strings 组成的数组，第一个 bulk string 通常是命令名，后续元素是参数；服务端根据命令返回 RESP 类型。([Redis][3])

MySQL 更明显。MySQL 协议不是“远程调用 executeSQL 方法”，而是围绕数据库连接生命周期设计：服务端握手、客户端响应、认证、能力协商、命令阶段、查询响应、结果集、错误包、OK 包。MySQL 官方 packet 文档展示了 packet header 和 sequence id；HandshakeV10 文档还描述了 SSL capability、SSLRequest、HandshakeResponse 等连接阶段行为。([MySQL开发者专区][4])

这说明一个关键事实：

> 自定义协议最大的价值不是“更快”，而是“协议本身就是系统模型的一部分”。

---

## 三、什么场景下应该自定义 TCP 应用层协议？

我认为，只有以下场景才值得自定义协议。否则，直接用 HTTP/gRPC 更稳妥。

### 1. 高吞吐、低延迟、长连接密集型系统

典型代表：

```text
消息队列：Kafka、Pulsar、RocketMQ
缓存系统：Redis、Memcached
数据库：MySQL、PostgreSQL
RPC 框架：Dubbo、Thrift、自研 RPC
服务网格内部数据面
实时推送系统
网关与边缘代理
游戏服务器
金融行情系统
```

这些系统通常具有几个特点：

```text
请求非常频繁
连接长期存在
payload 结构稳定
协议解析成本敏感
客户端数量多
服务端需要极致控制内存与 IO
需要批量、流水线、异步响应
```

如果一个系统每天只有几万次调用，HTTP/gRPC 的协议开销不是主要问题；但如果一个 broker、cache node 或 database node 每秒处理几十万、上百万请求，那么每个请求多解析几个 header、多做几次对象分配、多走几层通用抽象，都会变成真实成本。

---

### 2. 协议需要深度绑定领域语义

只要你的协议里天然存在这些概念，就适合自定义：

```text
分区
offset
cursor
sequence id
事务 marker
批量 records
流式 fetch
订阅推送
认证插件
能力协商
自定义错误码
压缩标记
幂等标识
重试语义
```

Kafka 就是典型。Kafka 协议不是普通 RPC，它需要表达 produce、fetch、metadata、offset、group、transaction、api version 等一整套消息队列语义。Kafka 文档还强调，其 API 鼓励把小消息批量化；produce 和 fetch API 都面向一组消息，而不是单条消息，并且允许一次 produce/fetch 跨多个 topic 和 partition。([Apache Kafka][1])

这个设计如果强行套 HTTP，也可以做，但会非常别扭：

```http
POST /topics/{topic}/partitions/{partition}/records
POST /consumer-groups/{group}/offsets
POST /metadata
POST /fetch
```

表面上符合 REST，实际已经不是资源建模，而是在 HTTP 里模拟 Kafka 协议。

我的判断是：**一旦你开始在 HTTP path 和 header 里模拟另一个协议，就说明你真正需要的是自定义协议。**

---

### 3. 需要长期兼容、多语言客户端和灰度升级

基础设施软件的协议一旦发布，就很难随意破坏兼容性。Kafka 在协议兼容性上做得非常典型：Kafka 文档说明，Kafka 使用 API key 和 API version 标识后续消息 schema；新客户端可以连接旧服务端，旧客户端也可以连接新服务端；客户端应使用双方都支持的最高 API version。([Apache Kafka][1])

这类版本协商非常适合放在自定义协议层，而不是依赖 HTTP 之外的约定。

自定义协议可以内建：

```text
magic number
protocol version
api version
feature flags
capability negotiation
extension fields
tagged fields
deprecated marker
client name/client version
server feature list
```

MySQL 也类似，它通过 capability flags 表示客户端和服务端支持或希望启用的功能，例如 SSL 能力、认证方式、连接属性等。MySQL HandshakeV10 文档说明，如果客户端支持 SSL 并设置了相关 capability，会发送 SSLRequest，使服务端建立 SSL 层并等待后续 packet。([MySQL开发者专区][5])

这种协议演进能力，对数据库和中间件非常重要。

---

### 4. 需要控制连接生命周期和 IO 模型

HTTP/1.1、HTTP/2、gRPC 都有自己的连接、流、多路复用、header、trailers、flow control 模型。对普通业务服务来说，这是好事；但对底层中间件来说，通用模型可能反而限制实现。

Kafka 文档建议维持持久连接，以摊销 TCP handshake 成本；同时，Kafka 客户端通常不需要对单个 broker 建立多个连接池连接。Kafka 服务端还保证在单个 TCP 连接上，请求按发送顺序处理，响应也按顺序返回；客户端可使用非阻塞 IO 做 request pipelining，提高吞吐。([Apache Kafka][1])

Redis 也有 pipeline 机制。Redis 官方文档说明，Redis requests 可以被 pipelined，客户端可以一次发送多个命令，然后稍后等待响应。([Redis][3])

这些能力都与连接模型高度相关。自定义协议可以让系统明确规定：

```text
一个连接上是否允许多个 in-flight 请求
响应是否必须按序返回
是否支持 pipeline
是否支持 server push
是否支持订阅模式
是否允许半双工 / 全双工
如何处理连接认证状态
如何处理协议切换
如何限流、踢连接、关闭连接
```

这类细节如果建立在 HTTP/gRPC 之上，很多时候要么受限于框架，要么要绕过框架。

---

## 四、自定义一个 TCP 应用层协议有什么好处？

### 1. 性能可控：更少字节、更少解析、更少对象分配

自定义协议可以做到：

```text
固定长度字段
长度前缀
二进制整数
紧凑枚举
批量 payload
零拷贝友好
直接映射内存结构
减少字符串解析
减少 header map 构造
```

Kafka 的 primitive types 使用明确的二进制编码，例如 INT16、INT32、INT64、UUID、BYTES 等字段都有确定编码方式。([Apache Kafka][1])

Redis RESP 虽然兼顾可读性，但官方文档仍然强调它可以达到接近二进制协议的性能，因为 bulk string 采用长度前缀，不需要扫描 payload 的特殊字符，也不需要 quoting/escaping。([Redis][3])

这就是为什么 Redis 没有选择 JSON over HTTP。JSON 可读性强，但会引入：

```text
字段名重复传输
字符串转义
数字解析
结构扫描
额外对象分配
无法天然表达二进制 blob
```

而 Redis 的命令天然就是：

```text
*2\r\n$3\r\nGET\r\n$3\r\nkey\r\n
```

这比：

```http
POST /redis
Content-Type: application/json

{"command":"GET","key":"key"}
```

更贴近 Redis 自己的模型，也更容易解析。

---

### 2. 协议可以天然支持批量传输

Kafka 的设计尤其说明问题。Kafka 不是把每条消息都当成一次 RPC，而是鼓励批量。Kafka 文档说明，produce 和 fetch API 都处理消息序列，并且允许一次请求跨多个 topic 和 partition。([Apache Kafka][1])

这对 Kafka 的性能是决定性的。因为消息队列的核心成本包括：

```text
系统调用
网络包
broker 请求调度
磁盘 append
page cache
副本复制
consumer fetch
压缩 / 解压
```

如果每条消息都走一次 HTTP/gRPC 调用，即使单次调用很快，整体吞吐也会被请求粒度拖垮。

Kafka 的协议设计可以直接表达：

```text
ProduceRequest
  topic A
    partition 0
      record batch
    partition 1
      record batch
  topic B
    partition 3
      record batch
```

这不是普通 RPC 的“调用方法”，而是消息系统特有的批量数据交换模型。

---

### 3. 可以精确表达错误码和状态机

HTTP 状态码只有一套通用语义：

```text
200 OK
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
500 Internal Server Error
503 Service Unavailable
```

但 Kafka 需要表达：

```text
NotLeaderForPartition
UnknownTopicOrPartition
OffsetOutOfRange
CoordinatorNotAvailable
RebalanceInProgress
UnsupportedVersion
TopicAuthorizationFailed
```

MySQL 需要表达：

```text
OK packet
ERR packet
EOF packet
ResultSet packet
AuthSwitchRequest
AuthMoreData
LocalInFileRequest
```

Redis 需要表达：

```text
simple string
bulk string
integer
array
map
push
simple error
bulk error
null
```

Redis RESP 直接把错误作为一种协议数据类型，simple error 以 `-` 开头；客户端收到 error reply 时应将其视为异常。([Redis][3])

这类设计比“HTTP 200 + JSON body 里放 errorCode”更加底层、直接、稳定。

---

### 4. 可以更好地做协议演进

自定义协议可以把演进机制作为第一等公民：

```text
version
feature flag
capability flag
extension field
reserved field
tagged field
optional field
deprecated field
```

Kafka 的 API version 机制非常典型。Kafka 文档说明，API key 和 API version 两个 16-bit 数字一起唯一标识后续消息 schema；服务端会按请求中的 version 返回客户端期望的协议格式。([Apache Kafka][1])

MySQL 则更偏 capability flags 风格。客户端和服务端通过能力位协商功能，例如是否支持 SSL、认证插件、连接属性等。([MySQL开发者专区][5])

这比在 HTTP header 里塞一堆私有字段更加系统化：

```http
X-Protocol-Version: 3
X-Feature-A: true
X-Client-Capabilities: ...
```

不是不能做，而是既然已经大规模自定义 header，说明你已经在 HTTP 之上发明了另一个协议。

---

### 5. 可以减少对通用框架的依赖

对于基础设施系统，协议是生态入口。Kafka、Redis、MySQL 都需要大量多语言客户端。如果协议依赖某个具体 RPC 框架，就会带来生态锁定。

例如如果 Kafka 内部协议一开始基于 gRPC，那么所有客户端都要依赖 gRPC runtime、HTTP/2 stack、Protobuf 生态。这对 Java、Go、C++ 还好，但对某些语言、嵌入式环境、代理系统、抓包分析、协议网关、兼容实现都会增加门槛。

Kafka 自定义协议后，任何语言只要能操作 TCP socket 并按协议编码/解码，就可以实现客户端。Redis RESP 更是如此，它被设计为简单、快速解析、可读，官方文档也说明 RESP 是 Redis 客户端应该实现的协议。([Redis][3])

这就是基础设施协议和业务 RPC 的不同：

```text
业务 RPC：优先开发效率
基础设施协议：优先生态稳定性、跨语言实现、长期兼容
```

---

## 五、为什么 Kafka 不直接使用 HTTP/gRPC？

这是本文最核心的问题。我的结论很明确：

> Kafka 不适合直接使用 HTTP/gRPC 作为核心 broker 协议，因为 Kafka 的协议本质是面向分区日志、批量消息、offset、元数据发现、broker 路由、版本协商和高吞吐 IO 的领域协议，而不是普通的服务方法调用协议。

### 1. Kafka 的核心单位不是 RPC 方法，而是分区日志操作

gRPC 的抽象是：

```text
Service.Method(Request) -> Response
```

Kafka 的抽象是：

```text
Produce(topic, partition, record batch)
Fetch(topic, partition, offset, max bytes)
Metadata(topic)
OffsetCommit(group, topic, partition, offset)
FindCoordinator(group/transactional id)
```

虽然这些也可以包装成 RPC 方法，但 Kafka 的性能关键在于：

```text
批量 records
跨 partition produce/fetch
压缩 record batch
长连接复用
非阻塞 IO
协议级错误码
metadata 驱动 broker 路由
api version 兼容
```

这些不是 gRPC 的默认优势，而是 Kafka 自己的协议优势。

---

### 2. Kafka 需要极强的批处理语义

Kafka 官方文档直接说明，其 API 鼓励 batching；produce 和 fetch 都不是面向单条消息，而是面向消息序列；甚至一次 produce/fetch 可以覆盖多个 topic 和 partition。([Apache Kafka][1])

如果用 HTTP/gRPC，当然也能传一个 batch：

```proto
rpc Produce(ProduceRequest) returns (ProduceResponse);
```

但问题是：此时 gRPC 只是一个外壳，真正的 Kafka 协议语义仍然要自己定义在 Protobuf message 里。于是会出现两层协议：

```text
HTTP/2 frame
  gRPC message
    Kafka ProduceRequest
      topic/partition/record batch
```

而 Kafka 现在是：

```text
TCP
  Kafka frame
    Kafka ProduceRequest
      topic/partition/record batch
```

少一层抽象，就少一层解析、约束和依赖。

---

### 3. Kafka 需要面向 broker/partition 的路由能力

Kafka 不是所有请求都可以发给任意 broker。客户端需要知道某个 topic partition 当前 leader 是哪个 broker，然后把 produce/fetch 请求发给正确 broker。Kafka 文档说明，客户端通过 metadata request 获取 broker、topic、partition、leader 等信息；如果 metadata 过期，会通过 socket error 或响应错误码触发刷新。([Apache Kafka][1])

这套模型和 HTTP 的负载均衡思想不同。

HTTP/gRPC 常见模型是：

```text
client → load balancer → any healthy backend
```

Kafka 模型是：

```text
client → metadata → partition leader broker
```

也就是说，Kafka 客户端本身就是协议级路由参与者。HTTP/gRPC 的通用负载均衡模型并不能天然表达这种分区 leader 路由。

---

### 4. Kafka 需要协议级版本兼容

Kafka 的升级场景非常复杂：

```text
老 client 连接新 broker
新 client 连接老 broker
broker 滚动升级
client SDK 分批升级
跨版本集群
新字段灰度引入
```

Kafka 通过 API version 协商解决这些问题。文档明确说明，新旧客户端和服务端双向兼容；客户端应选择双方支持的最高 API version。([Apache Kafka][1])

gRPC/Protobuf 也有兼容机制，但 Kafka 的兼容粒度是 Kafka API 本身，而不只是字段兼容。它需要知道某个 broker 支持哪些 Kafka API、哪些版本、哪些字段、哪些错误码。这套机制内建在 Kafka 协议里，比套在 HTTP/gRPC 上更直接。

---

## 六、Redis 为什么使用 RESP，而不是 HTTP/gRPC？

Redis 是另一个非常典型的例子。Redis 的协议目标不是“企业级 RPC”，而是：

```text
简单
快速
可读
容易实现客户端
支持 pipeline
支持不同返回类型
```

Redis 官方文档明确说 RESP 是 Redis 客户端与 Redis Server 通信的 wire protocol，并且它在设计上折中考虑了简单实现、快速解析和人类可读性。([Redis][3])

### 1. Redis 命令模型非常简单，不需要 HTTP

Redis 命令天然就是：

```text
COMMAND key arg1 arg2 ...
```

RESP 表达这个模型非常自然：

```text
*2\r\n$3\r\nGET\r\n$3\r\nfoo\r\n
```

如果用 HTTP，则可能变成：

```http
POST /redis
Content-Type: application/json

{
  "command": "GET",
  "args": ["foo"]
}
```

这对 Redis 来说是明显过度设计。

Redis 是内存数据库，很多命令的执行时间可能是微秒级。如果协议解析和对象构造比命令执行本身还重，那就是本末倒置。

---

### 2. RESP 兼顾可读性和高性能

RESP 不是纯二进制协议，但它非常聪明。它用首字节区分类型：

```text
+ simple string
- error
: integer
$ bulk string
* array
% map
> push
```

RESP bulk string 使用长度前缀，可以承载任意二进制数据。官方文档指出，这种方式不需要扫描 payload 中的特殊字符，也不需要转义；因此实现可以接近二进制协议性能，同时又比很多二进制协议更容易在高级语言中实现。([Redis][3])

这就是优秀协议设计的典型特征：

```text
不是盲目二进制化
而是在性能、可读性、实现复杂度之间取平衡
```

---

### 3. Redis pipeline 需要轻量协议

Redis 支持 pipeline：客户端可以一次发送多个命令，然后稍后读取响应。官方文档明确说明 Redis requests 可以 pipelined。([Redis][3])

pipeline 对 Redis 非常关键，因为 Redis 单命令通常很快，网络 RTT 反而可能成为瓶颈。RESP 的简单请求响应结构非常适合 pipeline：

```text
C: GET a
C: GET b
C: INCR c

S: value-of-a
S: value-of-b
S: integer-result
```

HTTP/1.1 pipeline 早期存在复杂问题；HTTP/2 虽然支持多路复用，但引入了更复杂的 frame、stream、flow control。Redis 的需求没有那么复杂，它需要的是**简单、顺序、低成本、容易实现**。

所以 Redis 使用 RESP 是非常正确的选择。

---

## 七、MySQL 为什么使用自己的协议，而不是 HTTP/gRPC？

数据库协议和普通 RPC 的差异更大。MySQL 不是简单地执行：

```text
execute(sql) -> result
```

它实际涉及：

```text
连接握手
协议版本
服务端 greeting
认证挑战
认证插件
SSL 切换
capability flags
默认数据库
字符集
prepared statement
query command
result set metadata
row data
OK/ERR packet
事务状态
session state
```

MySQL 官方文档说明，客户端与服务端之间的数据以 packet 交换，packet header 包含 payload length 和 sequence id。([MySQL开发者专区][4])

MySQL HandshakeV10 文档还说明，当客户端支持 SSL 且 capability flags 中开启相关能力时，会发送 SSLRequest，使服务端建立 SSL 层并等待后续客户端包。([MySQL开发者专区][5])

这说明 MySQL 协议本身就是数据库连接状态机。

### 1. 数据库连接是有状态的

HTTP 天然偏无状态请求响应。虽然可以通过 cookie、session、connection pool 维护状态，但这不是 HTTP 的底层设计目标。

MySQL 连接则天然有状态：

```text
当前用户
当前 database
当前 charset
当前 transaction
当前 prepared statement
当前 session variables
当前 connection attributes
当前 authentication state
```

如果用 HTTP/gRPC 表达这些状态，就需要额外维护 session id、token、上下文映射，反而复杂。

MySQL 自定义协议可以直接把连接状态绑定在 TCP connection 上：

```text
TCP connection = database session
```

这是非常自然的设计。

---

### 2. 数据库结果集需要专门协议表达

SQL 查询结果不是普通 JSON。它包含：

```text
column count
column metadata
column name
schema
table
type
flags
decimals
row data
EOF/OK
warning count
server status
```

如果全部用 JSON 表达，会有巨大冗余：

```json
[
  {"id": 1, "name": "a", "age": 18},
  {"id": 2, "name": "b", "age": 20}
]
```

每一行都重复字段名，类型信息也不紧凑。而数据库协议通常会先发送列元数据，再发送每行数据，这样更适合大量结果集传输。

因此，数据库协议使用自定义 packet 是合理的。

---

### 3. 数据库协议需要能力协商和认证扩展

MySQL 的 capability flags 是协议演进的重要机制。客户端和服务端可以通过能力位协商是否支持某些功能，例如 SSL、认证插件、连接属性等。([MySQL开发者专区][5])

这类机制如果强行放到 HTTP/gRPC 中，会变成一堆自定义 header 或 metadata，但底层状态机仍然要自己实现。那不如直接定义数据库协议。

---

## 八、自定义协议与 HTTP/gRPC 的关系：不是谁替代谁，而是边界不同

这里必须给出一个明确判断：

> 业务服务之间的普通调用，优先使用 HTTP/gRPC；基础设施内部高频协议，才考虑自定义 TCP 应用层协议。

### 适合 HTTP/REST 的场景

```text
开放 API
管理后台
低频业务接口
浏览器访问
调试友好优先
网关统一治理
第三方集成
CRUD 资源模型
```

### 适合 gRPC 的场景

```text
微服务内部调用
强 schema
多语言 SDK
双向流
服务治理
云原生生态
需要 HTTP/2 能力
团队不想维护底层协议
```

gRPC 官方说明其协议承载在 HTTP/2 framing 上，并定义了 request headers、length-prefixed message、trailers 等结构。([grpc.github.io][2]) 这意味着 gRPC 本身已经是一个成熟的高性能 RPC 方案，普通业务系统没必要重新造协议。

### 适合自定义 TCP 协议的场景

```text
数据库协议
缓存协议
消息队列协议
高性能 RPC 框架
实时推送协议
游戏协议
金融行情协议
服务网格数据面协议
边缘代理内部协议
```

判断标准不是“我会不会写 Netty”，而是：

```text
协议是否是系统核心竞争力？
通用协议是否引入明显额外成本？
是否需要表达复杂领域语义？
是否需要极致控制连接和 IO？
是否需要跨语言长期兼容？
是否需要大规模客户端生态？
是否能承担协议维护成本？
```

如果答案大部分是“是”，才值得自定义。

---

## 九、自定义协议的代价

自定义协议不是免费午餐。它至少带来以下成本：

```text
协议设计成本
编解码器实现成本
多语言 SDK 成本
兼容性测试成本
抓包调试成本
安全审计成本
文档维护成本
协议 fuzz testing 成本
灰度升级成本
生态适配成本
```

HTTP/gRPC 的优势在于：

```text
生态成熟
工具丰富
可观测性好
网关支持好
代理支持好
安全模型成熟
调试方便
团队学习成本低
```

所以我不建议普通业务系统随便自定义协议。很多团队所谓“自定义 TCP 协议”，最后会写成：

```text
length + JSON
```

然后又自己补：

```text
request id
timeout
retry
auth
tracing
compression
version
error code
schema
IDL
SDK
load balancing
health check
```

这其实是在低质量复刻 gRPC。这样的自定义协议没有意义。

真正值得自定义的是 Kafka、Redis、MySQL 这种情况：协议与系统内核强绑定，并且长期维护协议本身就是产品能力的一部分。

---

## 十、一个优秀自定义 TCP 协议应该怎么设计？

如果你要设计自己的协议，我建议至少考虑以下结构。

### 1. 基础帧格式

```text
+----------------+----------------+----------------+----------------+
| magic          | version        | header length  | body length    |
+----------------+----------------+----------------+----------------+
| request id / correlation id                                      |
+------------------------------------------------------------------+
| command / api key                                                |
+------------------------------------------------------------------+
| flags                                                            |
+------------------------------------------------------------------+
| header extensions                                                |
+------------------------------------------------------------------+
| body                                                             |
+------------------------------------------------------------------+
```

### 2. 必备字段

```text
magic number        // identify protocol
protocol version    // protocol evolution
request id          // match request and response
command/api key     // operation type
flags               // compression, encryption, tracing, etc.
body length         // solve TCP stream boundary
status/error code   // response status
```

### 3. 推荐能力

```text
version negotiation
capability negotiation
heartbeat
authentication
authorization
compression
batching
pipeline
backpressure
server push
graceful close
structured error code
tracing context
client name/version
extension fields
```

### 4. 必须避免的错误

```text
没有 length，靠 read() 次数判断一条消息
没有版本号
没有 request id
错误码只用字符串
协议文档缺失
服务端和客户端实现互相猜
没有 fuzz test
没有兼容性测试
没有抓包工具
没有最大包大小限制
没有慢客户端保护
没有认证状态机
```

尤其是第一条非常致命。TCP 是字节流，不能假设一次 read 就是一条完整消息。

---

## 十一、结论

自定义 TCP 应用层协议的本质，是让协议从“通用通信壳”变成“系统核心模型的一部分”。

Kafka 选择自定义二进制协议，是因为它需要服务于分区日志、broker 路由、metadata、batch、fetch、offset、API version 和高吞吐长连接。Redis 选择 RESP，是因为它需要简单、快速、可读、低成本解析，并天然支持命令模型和 pipeline。MySQL 选择自己的协议，是因为数据库连接是有状态的，需要握手、认证、能力协商、结果集元数据、行数据和会话状态。

HTTP/gRPC 是优秀的通用协议，但它们并不总是适合基础设施系统的内部核心协议。我的最终判断是：

> **普通业务系统不要轻易自定义协议；高性能基础设施系统应该认真考虑自定义协议。**
> 当协议只是通信工具时，用 HTTP/gRPC；当协议本身就是系统模型、性能路径和生态边界时，应该自定义基于 TCP 的应用层协议。

从 Kafka、Redis、MySQL 的经验看，自定义协议的真正收益不是单纯“更快”，而是：

```text
更贴近领域模型
更低协议开销
更强连接控制
更好批量能力
更清晰状态机
更稳定版本演进
更适合多语言客户端生态
更容易成为基础设施产品的长期边界
```

这也是为什么优秀的中间件和数据库系统，最终往往都会拥有自己的 wire protocol。

[1]: https://kafka.apache.org/42/design/protocol "Protocol | Apache Kafka"
[2]: https://grpc.github.io/grpc/core/md_doc__p_r_o_t_o_c_o_l-_h_t_t_p2.html "GRPC Core: gRPC over HTTP2"
[3]: https://redis.io/docs/latest/develop/reference/protocol-spec/ "Redis serialization protocol specification | Docs"
[4]: https://dev.mysql.com/doc/dev/mysql-server/8.0.46/page_protocol_basic_packets.html?utm_source=chatgpt.com "MySQL Packets"
[5]: https://dev.mysql.com/doc/dev/mysql-server/9.5.0/page_protocol_connection_phase_packets_protocol_handshake_v10.html?utm_source=chatgpt.com "MySQL: Protocol::HandshakeV10"
