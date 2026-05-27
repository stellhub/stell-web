# gRPC Java 基于 Netty 的分层封装与执行模型研究

## 摘要

gRPC Java 并不是直接把业务方法挂在 Netty `ChannelHandler` 上，而是在 Netty 之上建立了 **Stub、Channel、Transport、Stream、Call、Interceptor、Listener/Observer** 等一组 RPC 语义抽象。该设计的核心事实是：gRPC 本身定义的是“基于接口定义语言的远程过程调用模型”，而 Netty 提供的是“异步事件驱动网络 I/O 模型”。grpc-java 官方 README 将库划分为 Stub、Channel、Transport 三层，其中 Transport 层负责“putting and taking bytes off the wire”，且 Netty-based HTTP/2 transport 是主要传输实现。([GitHub][1])

因此，gRPC Java 对 Netty 的封装目标不是简化 Netty Handler 编程，而是把 **HTTP/2 字节流、帧、连接、流控、Header/Trailer、DATA frame** 转换成 **RPC 方法、请求消息、响应消息、状态码、元数据、取消、deadline、流式回调** 等上层语义。gRPC 官方协议说明也表明，gRPC 的双向消息流映射到 HTTP/2 stream，Call Header 与 Initial Metadata 映射为 HTTP/2 headers，Payload Message 被编码为 length-prefixed gRPC frame 后再拆成 HTTP/2 frames，Status 与 Trailing Metadata 映射为 HTTP/2 trailers。([GitHub][2])

---

## 1. 引言

gRPC 的基础不是 HTTP API 风格，而是 RPC 风格。官方概念文档说明，开发者从 `.proto` 文件中的服务定义开始，gRPC 通过 Protocol Buffer compiler plugins 生成客户端和服务端代码；客户端通过本地 stub 调用远端方法，服务端实现对应服务方法，gRPC infrastructure 负责解码请求、执行服务方法、编码响应。([gRPC][3])

grpc-java 的公共 API 文档进一步给出 Java 侧的基本模型：gRPC 基于 client-server RPC 模型；客户端创建连接到服务端的 `Channel`；RPC 由客户端发起，服务端响应；双方发送完消息后分别 half close；服务端关闭后 RPC 完成。客户端通常通过 generated stub 调用服务端，服务端通过 `ServerBuilder` 暴露服务实现。([grpc.github.io][4])

由此可得出一个事实性的结构判断：**gRPC Java 的核心对象不是 Netty Channel，而是 RPC Call；Netty Channel 只是某种 Transport 的底层 I/O 承载。**

---

## 2. gRPC 的基本设计原理

### 2.1 接口优先：`.proto` 是服务契约

gRPC 官方概念文档说明，开发者使用语言无关的 RPC 服务描述，gRPC 会生成客户端和服务端接口；服务端实现接口，客户端通过对应接口远程调用。默认情况下，gRPC 使用 Protocol Buffers 作为 IDL 描述服务接口和消息结构。([GitHub][2])

这决定了 grpc-java 的上层封装必须围绕 `MethodDescriptor`、Stub、Marshaller、ServiceDescriptor 展开，而不是围绕 Netty 的 byte buffer 展开。Netty 只知道字节、事件、连接、pipeline；gRPC 需要知道“哪个服务、哪个方法、请求类型、响应类型、调用类型、元数据、状态码”。

### 2.2 RPC 生命周期：一次调用是一个双向消息流

gRPC 官方 CONCEPTS 文档定义，一个 gRPC call 是客户端发起的双向消息流。客户端到服务端方向包含 mandatory `Call Header`、optional `Initial-Metadata`、零个或多个 `Payload Messages`；服务端到客户端方向包含 optional `Initial-Metadata`、零个或多个 `Payload Messages`，并以 mandatory `Status` 和 optional `Status-Metadata` 结束。([GitHub][2])

这也是为什么 gRPC Java 内部大量使用 callback/listener/observer：因为 RPC 并不总是一个“同步 request -> response”的函数调用。它可以是 unary、server streaming、client streaming、bidirectional streaming。官方文档说明，双向流式 RPC 中客户端流和服务端流相互独立，双方可以按任意顺序读写消息。([gRPC][3])

### 2.3 HTTP/2 是传输映射，而不是业务 API

gRPC 官方协议说明，抽象 gRPC 协议由 HTTP/2 具体承载：gRPC bidirectional streams 映射到 HTTP/2 streams；headers 受 HPACK 压缩；payload message 被序列化为 length-prefixed gRPC frames，然后再拆分为 HTTP/2 frames；status 和 trailing metadata 通过 HTTP/2 trailing headers 发送。([GitHub][2])

HTTP/2 协议层支持多路复用、header compression、flow control 等能力。HTTP/2 RFC 说明，HTTP/2 通过 header field compression 和在同一连接上允许多个并发 exchange 来更有效使用网络资源并降低感知延迟。([IETF HTTP Working Group][5])

因此，grpc-java 基于 Netty 的封装必然要处理：

| gRPC 抽象                    | HTTP/2/Netty 层对应物                             |
| -------------------------- | --------------------------------------------- |
| RPC Call                   | HTTP/2 stream                                 |
| Metadata                   | HTTP/2 headers / trailers                     |
| Request / Response message | length-prefixed gRPC message over DATA frames |
| Status                     | `grpc-status` trailer                         |
| Deadline / cancellation    | gRPC call control + HTTP/2 stream control     |
| Flow control               | HTTP/2 flow control                           |
| Interceptor                | RPC 调用链扩展点                                    |
| Netty Handler              | I/O 事件、HTTP/2 frame、连接级处理                     |

---

## 3. grpc-java 的三层封装模型

grpc-java 官方 README 将库分为三层：Stub、Channel、Transport。Stub 层面向大多数开发者，提供类型安全绑定；Channel 层是 Transport 处理之上的抽象，适合 interception/decoration，并暴露比 Stub 更多的行为；Transport 层负责网络字节收发，接口抽象到可插拔不同实现。([GitHub][1])

### 3.1 Stub 层

Stub 是业务开发者主要接触的入口。Java basics 文档说明，Java 客户端可以创建 blocking/synchronous stub，也可以创建 non-blocking/asynchronous stub；异步 stub 以异步方式返回响应，并且某些 streaming call 只能通过 asynchronous stub 使用。([gRPC][6])

`io.grpc.stub` 包文档说明，客户端 stub 类是 `AbstractStub` 的实现，RPC 方法内部使用 `ClientCalls` 与 call layer 交互；异步 stub 的 RPC 方法会接收 `StreamObserver responseObserver`，对于 client-streaming 或 bidirectional-streaming，还会返回一个 `requestObserver`。([grpc.github.io][7])

### 3.2 Channel 层

Channel 是客户端侧对远端端点的抽象。grpc-java Javadoc 描述，客户端创建 `Channel`，generated stub 包装该 channel，stub 是客户端与服务端交互的主要方式。([grpc.github.io][4])

Channel 层适合做装饰与拦截。grpc-java README 明确说明，Channel 层适合应用框架处理 logging、monitoring、auth 等 cross-cutting concerns。([GitHub][1])

### 3.3 Transport 层

Transport 层负责真正的字节收发。grpc-java README 明确说明，Transport 层 “does the heavy lifting of putting and taking bytes off the wire”，并且 Transport API 属于 gRPC internal API，API 稳定性弱于 `io.grpc` core API。([GitHub][1])

旧版 grpc-java README 还明确指出，Transport 被建模为 `Stream` factories；server stream 与 client stream 接口差异用于编码它们在 cancellation 和 error reporting 上的不同语义。([android.googlesource.com][8])

这解释了“为什么不是直接暴露 Netty Handler”：因为 grpc-java 要允许 Transport 可插拔。官方 README 列出的 Transport 包括 Netty、OkHttp、in-process、Binder 等；Netty 只是其中一种实现。([GitHub][1])

---

## 4. gRPC Java 基于 Netty 实现的主要封装

### 4.1 Netty transport：HTTP/2 transport 的主要实现

grpc-java README 明确说明，Netty-based HTTP/2 transport 是基于 Netty 的主要 transport implementation；`grpc-netty-shaded` 通常优先于直接使用 Netty transport，因为它减少依赖管理并更容易升级。([GitHub][1])

由此可见，grpc-java 对 Netty 的封装主要发生在 Transport 层，而不是 Stub 或 Channel 层。应用代码通常看不到 Netty pipeline；它看到的是 `ManagedChannel`、Stub、`ServerBuilder`、`StreamObserver`、`ClientInterceptor`、`ServerInterceptor`。

### 4.2 Netty Channel / Pipeline / Handler 被封装为 Transport 内部机制

Netty 官方 `ChannelPipeline` Javadoc 说明，`ChannelPipeline` 是一组 `ChannelHandler`，用于处理或拦截一个 `Channel` 的 inbound events 和 outbound operations；每个 Channel 自动创建自己的 pipeline；I/O event 由 inbound 或 outbound handler 处理，并通过 `ChannelHandlerContext.fireChannelRead`、`write` 等方法向相邻 handler 传播。([netty.io][9])

grpc-java 的 Netty 实现把这些 Handler 用作 HTTP/2 transport 内部事件处理。grpc-java 源码搜索结果显示，`NettyClientHandler` 是 client-side Netty handler for GRPC processing，并注明所有 event handlers 都在 Netty Channel thread 上下文中执行。([GitHub][10]) `NettyServerHandler` 也被描述为 server-side Netty handler for GRPC processing，所有 event handlers 同样在 Netty Channel thread 上下文执行。([GitHub][11])

这形成了两层回调模型：

```text
业务层回调:
  StreamObserver / ClientCall.Listener / ServerCall.Listener

gRPC Transport 层:
  ClientStream / ServerStream / TransportState / WriteQueue

Netty I/O 层:
  ChannelPipeline / ChannelHandler / EventLoop / ByteBuf / HTTP/2 frame
```

### 4.3 HTTP/2 header 到 gRPC metadata/method 的封装

`NettyServerHandler` 源码片段显示，服务端接收 headers 后会检查 path、content-type、HTTP method；path 去掉前导 `/` 后得到 fully qualified method name；headers 被转换为 `Metadata`；随后创建 `StatsTraceContext`、`NettyServerStream.TransportState` 和 `NettyServerStream`。([android.googlesource.com][12])

这说明 Netty 层看到的是 HTTP/2 headers；gRPC 层需要将其提升为：

```text
:path: /package.Service/Method
:method: POST
content-type: application/grpc
te: trailers
custom metadata...
```

对应的 gRPC 语义是：

```text
method = package.Service/Method
metadata = Metadata
stream = ServerStream
call = ServerCall
handler = ServerCallHandler
service method invocation
```

---

## 5. Interceptor 与 Netty Handler 的关系

### 5.1 二者都类似“拦截链”，但作用层级不同

Netty `ChannelPipeline` 是 ChannelHandler 链，用于处理 Channel 的 inbound events 和 outbound operations。([netty.io][9]) gRPC Interceptor 是 RPC call 层的扩展点。gRPC 官方 Interceptors 文档说明，Interceptor 适合实现独立于具体 RPC 方法、适用于全部或大多数 RPC 的通用功能，例如 metadata handling、logging、fault injection、caching、metrics、policy enforcement、server-side authentication、server-side authorization。([gRPC][13])

所以，二者关系如下：

| 对比项            | gRPC Interceptor                                                | Netty ChannelHandler                                |
| -------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| 所在层级           | gRPC Call / Channel / ServerCall 层                              | Netty I/O / ChannelPipeline 层                       |
| 处理对象           | RPC method、Metadata、CallOptions、ServerCall、ClientCall、消息、Status | ByteBuf、HTTP/2 frame、Channel event、write/read/flush |
| 典型用途           | 鉴权、日志、指标、metadata、策略、重写请求/响应                                    | 编解码、TLS、HTTP/2 frame、连接事件、背压、flush                  |
| 生命周期粒度         | per-call                                                        | per-channel / per-connection                        |
| 是否适合管理 TCP/TLS | 不适合                                                             | 适合                                                  |
| 是否面向业务 RPC 语义  | 是                                                               | 否，除非在 transport 内部转换后                               |

gRPC 官方 Interceptors 文档明确说明，interceptors 是 per-call 的；它们不适合管理 TCP connections、配置 TCP port 或配置 TLS。([gRPC][13])

因此，**gRPC Interceptor 不是 Netty Handler 的替代品，也不是 Netty Handler 的简单包装；它是位于 Channel/ServerCall 抽象上的 RPC 拦截器。**

### 5.2 ClientInterceptor 的位置

`ClientInterceptor` Javadoc 说明，它用于在 outgoing calls 被 `Channel` dispatch 之前进行拦截；实现者可以为 Channel 和 stub 添加 cross-cutting behavior，例如 logging/monitoring、添加 metadata、request/response rewriting。([grpc.github.io][14])

客户端路径可以抽象为：

```text
Generated Stub
  -> ClientCalls
    -> ClientInterceptor chain
      -> Channel.newCall(method, callOptions)
        -> ClientCall
          -> ClientTransport.newStream(...)
            -> NettyClientStream
              -> NettyClientHandler
                -> HTTP/2 HEADERS/DATA frames
```

Interceptor 看到的是 `MethodDescriptor`、`CallOptions`、`Metadata`、`ClientCall`。Netty Handler 看到的是 HTTP/2 headers/data/trailers frame 和 channel event。

### 5.3 ServerInterceptor 的位置

`ServerInterceptor` Javadoc 说明，它用于在 incoming calls 被 `ServerCallHandler` dispatch 之前拦截；实现者可以添加 server-side call 的 cross-cutting behavior，例如 enforcing authentication credentials、logging/monitoring、delegating calls。([grpc.github.io][15])

服务端路径可以抽象为：

```text
Socket / TCP
  -> Netty EventLoop
    -> Netty ChannelPipeline
      -> NettyServerHandler
        -> HTTP/2 headers/data/trailers parsing
          -> ServerTransportListener.streamCreated(...)
            -> ServerCall
              -> ServerInterceptor chain
                -> ServerCallHandler.startCall(...)
                  -> Generated service implementation
                    -> StreamObserver.onNext/onCompleted/onError
```

---

## 6. 为什么 gRPC Java 使用大量 callback/listener/observer 接口

### 6.1 网络是异步的，RPC 模型同时支持同步与异步

gRPC CONCEPTS 文档说明，同步 RPC 最接近 RPC 所追求的 procedure call 抽象；但网络本质上是异步的，在许多场景中需要不阻塞当前线程就启动 RPC。gRPC 在多数语言中同时提供同步和异步形式。([GitHub][2])

这解释了 grpc-java 中多个 callback 接口存在的基础原因：**底层 I/O 是异步事件，RPC 语义还支持流式消息，因此 API 需要表达“未来某个时刻收到 headers、消息、完成状态、可继续发送”的事件。**

### 6.2 ClientCall.Listener 表达客户端接收事件

`ClientCall.Listener` Javadoc 说明，它是用于接收服务端 metadata、response messages 和 completion status 的 callbacks；方法包括 `onHeaders`、`onMessage`、`onClose`、`onReady`。其中 `onMessage` 可以调用零次或多次，取决于响应为空、单消息或流式消息；`onReady` 表示 `ClientCall` 可能已经能够发送更多消息而不需要过度内部缓冲。([grpc.github.io][16])

这对应 HTTP/2/gRPC 接收方向：

```text
HTTP/2 response HEADERS
  -> ClientCall.Listener.onHeaders(metadata)

HTTP/2 DATA frames -> gRPC message deframe -> RespT
  -> ClientCall.Listener.onMessage(response)

HTTP/2 trailing HEADERS with grpc-status
  -> ClientCall.Listener.onClose(status, trailers)

HTTP/2 flow-control writable / buffer state
  -> ClientCall.Listener.onReady()
```

### 6.3 StreamObserver 表达应用层流式收发

`io.grpc.stub` 包文档说明，异步 stub 方法会接收 `StreamObserver responseObserver`；client-streaming 或 bidirectional-streaming 会返回 `requestObserver`。([grpc.github.io][7])

因此，`StreamObserver` 是比 `ClientCall.Listener` 更靠近用户 API 的抽象。可以理解为：

```text
应用 API:
  StreamObserver<RespT>.onNext(response)
  StreamObserver<RespT>.onError(error)
  StreamObserver<RespT>.onCompleted()

Call 层:
  ClientCall.Listener.onMessage(...)
  ClientCall.Listener.onClose(...)

Transport 层:
  ClientStreamListener
  ServerStreamListener

Netty 层:
  ChannelInboundHandler.channelRead(...)
  HTTP/2 frame listener
```

### 6.4 callback 数量多是由四类 RPC 形态决定的

gRPC 官方 core concepts 文档列出四类 RPC：unary、server streaming、client streaming、bidirectional streaming。服务端流式 RPC 是一个请求对应响应流；客户端流式 RPC 是请求流对应一个响应；双向流式 RPC 中两条流相互独立，双方可以以任意顺序读写消息。([gRPC][3])

这意味着 Java API 不能只靠一个同步返回值表达所有情况。它必须表达：

```text
收到 headers
收到 0..N 条消息
发送 0..N 条消息
本端 half close
对端 half close
收到 trailers/status
取消
deadline exceeded
流控可写
异常
```

所以 callback/listener/observer 不是装饰性设计，而是异步流式 RPC 语义的直接映射。

---

## 7. 一次 unary RPC 的内部执行流程

以下流程采用 grpc-java + Netty transport 的抽象路径描述。

### 7.1 客户端发起调用

```text
1. 用户调用 generated blocking/async/future stub 方法
2. stub 根据 proto 生成的 MethodDescriptor 找到 RPC 方法定义
3. stub 通过 ClientCalls 创建 ClientCall
4. ClientInterceptor chain 在 Channel dispatch 前拦截 outgoing call
5. ManagedChannel 根据 name resolver / load balancer / subchannel 选择 transport
6. ClientTransport 创建 ClientStream
7. NettyClientStream 将 metadata 和 request message 写入 transport
8. NettyClientHandler 在 Netty EventLoop 中写出 HTTP/2 HEADERS 和 DATA
```

官方 `ClientInterceptor` Javadoc 支持第 4 步：它拦截 outgoing calls before dispatched by Channel。([grpc.github.io][14]) grpc-java README 支持第 5-8 步的分层事实：Channel 位于 Transport 之上，Transport 负责字节收发，Netty transport 是主要 HTTP/2 transport。([GitHub][1])

### 7.2 网络传输

```text
HTTP/2 HEADERS:
  :method = POST
  :path = /package.Service/Method
  content-type = application/grpc
  te = trailers
  custom metadata...

HTTP/2 DATA:
  gRPC length-prefixed message bytes

HTTP/2 END_STREAM:
  unary request 发送完后，客户端 half close
```

gRPC 协议文档说明，payload messages 会被序列化为 length-prefixed gRPC frames，再由 HTTP/2 frames 承载；客户端通过最后一个 DATA frame 的 `END_STREAM` 标志表示其消息流结束。([GitHub][2])

### 7.3 服务端接收并分发

```text
1. Netty EventLoop 读取 socket 数据
2. Netty HTTP/2 codec 解析 HEADERS/DATA frame
3. NettyServerHandler 验证 path / content-type / method
4. headers 转换为 gRPC Metadata
5. 创建 ServerStream / TransportState
6. gRPC Server transport 创建 ServerCall
7. ServerInterceptor chain 执行
8. ServerCallHandler.startCall 分发到 generated service method
9. 业务实现读取 request，写 response
```

`NettyServerHandler` 源码片段显示，它会验证 path、content-type、method，并将 headers 转换为 `Metadata`，再创建 `NettyServerStream.TransportState` 和 `NettyServerStream`。([android.googlesource.com][12]) `ServerInterceptor` Javadoc 支持第 7 步：它在 incoming calls dispatch by `ServerCallHandler` 之前拦截。([grpc.github.io][15])

### 7.4 服务端响应

```text
1. service implementation 调用 responseObserver.onNext(response)
2. gRPC 将 response message marshal 成字节
3. NettyServerStream 写 HTTP/2 response DATA
4. service implementation 调用 responseObserver.onCompleted()
5. gRPC 写 trailers，其中包含 grpc-status
6. HTTP/2 trailers HEADERS 携带 END_STREAM
```

gRPC over HTTP/2 协议规定，响应包含 Response-Headers、零个或多个 length-prefixed message、Trailers；`grpc-status` 必须在 Trailers 中发送，即使状态是 OK。([GitHub][17])

### 7.5 客户端完成调用

```text
1. NettyClientHandler 接收 response HEADERS
2. 转换为 Metadata，触发 ClientCall.Listener.onHeaders
3. 接收 DATA frame，deframe + unmarshal 成 RespT
4. 触发 ClientCall.Listener.onMessage
5. 接收 trailers，解析 grpc-status
6. 触发 ClientCall.Listener.onClose
7. async stub 再映射为 StreamObserver.onNext/onCompleted/onError
8. blocking stub 阻塞等待结果并返回或抛异常
```

`ClientCall.Listener` Javadoc 明确说明 `onHeaders` 表示收到 response headers，`onMessage` 表示收到 response message，`onClose` 表示 call 已关闭并携带 status 与 trailers。([grpc.github.io][16])

---

## 8. 一次 bidirectional streaming RPC 的内部执行流程

双向流式 RPC 与 unary RPC 的根本区别是：请求方向和响应方向都允许 0..N 条消息，且两条流相互独立。官方文档说明，双向流式 RPC 中 client-side 与 server-side stream processing 是 application specific；两条流独立，因此客户端和服务端可以按任意顺序读写消息。([gRPC][3])

其执行模型为：

```text
客户端:
  requestObserver = asyncStub.bidiCall(responseObserver)

发送方向:
  requestObserver.onNext(req1)
    -> ClientCall.sendMessage
      -> ClientStream.writeMessage
        -> Netty write DATA

  requestObserver.onNext(req2)
    -> Netty write DATA

  requestObserver.onCompleted()
    -> ClientCall.halfClose
      -> HTTP/2 END_STREAM on client-to-server direction

接收方向:
  Netty read DATA
    -> ClientCall.Listener.onMessage
      -> responseObserver.onNext(respN)

  Netty read trailers
    -> ClientCall.Listener.onClose
      -> responseObserver.onCompleted/onError
```

服务端也是类似结构：

```text
服务端方法入参:
  StreamObserver<ResponseT> responseObserver

服务端方法返回:
  StreamObserver<RequestT> requestObserver

接收请求:
  requestObserver.onNext(reqN)

发送响应:
  responseObserver.onNext(respN)

完成:
  requestObserver.onCompleted()
  responseObserver.onCompleted()
```

这说明 `StreamObserver` 的双向存在不是偶然设计，而是对双向独立消息流的 Java API 表达。

---

## 9. 为什么 gRPC Java 不让业务直接使用 Netty Handler

基于以上官方资料，可以从事实关系中归纳出四个原因。

### 9.1 gRPC 需要跨语言一致的 RPC 语义

gRPC 官方说明，开发者从语言无关服务定义开始，gRPC 生成不同语言的客户端和服务端接口。([GitHub][2]) 如果 Java 业务直接依赖 Netty Handler，那么 Java 实现会暴露传输层细节，破坏 gRPC 跨语言接口模型。

### 9.2 gRPC Transport 是可插拔的

grpc-java README 明确列出多个 Transport：Netty、OkHttp、in-process、Binder。([GitHub][1]) 如果应用层直接绑定 Netty Handler，则无法保持同一 Stub/Channel API 在不同 Transport 上工作。

### 9.3 Netty Handler 处理的是 I/O 事件，不是 RPC 语义

Netty `ChannelPipeline` 处理 inbound/outbound I/O events 和 operations。([netty.io][9]) gRPC Interceptor 处理的是 per-call 的 RPC 通用逻辑，并且官方明确说 interceptor 不适合管理 TCP connections、TCP port、TLS。([gRPC][13])

因此二者边界明确：

```text
Netty Handler:
  连接级 / 帧级 / 字节级 / I/O 事件级

gRPC Interceptor:
  调用级 / 方法级 / Metadata / Status / Message 级
```

### 9.4 gRPC 的完成状态依赖 trailers，而不是普通 HTTP response body

gRPC over HTTP/2 协议规定，`grpc-status` 在 trailers 中发送，且 OK 状态也必须发送在 trailers 中。([GitHub][17]) 这使得“请求已收到响应 DATA”不等价于“RPC 成功完成”。gRPC Java 必须在 transport 层把 response headers、messages、trailers、status 组合成完整 RPC 生命周期，再向上触发 `onClose`。

---

## 10. 结论

gRPC Java 基于 Netty 的封装可以概括为：

```text
Netty 提供异步 I/O 与 HTTP/2 frame 处理能力；
grpc-java Transport 把 HTTP/2 frame 转换为 gRPC stream；
Channel 把 transport stream 抽象为 RPC call；
Stub 把 RPC call 抽象为类型安全的 Java 方法；
Interceptor 在 call 级别提供横切扩展；
Listener/Observer 用 callback 表达异步、流式、完成、流控事件。
```

更精确地说，gRPC Java 不是“用 Netty Handler 实现业务 RPC”，而是“用 Netty 实现一个 HTTP/2 Transport，再在其上实现 gRPC 的 call/stream/status/metadata/stub/interceptor 语义”。这也是 Interceptor 与 Netty Handler 的本质区别：**Interceptor 属于 RPC 调用链，Handler 属于网络 I/O 事件链。**

对于 Java 工程实践，判断边界应当非常明确：

```text
鉴权、租户、traceId、metrics、日志、限流策略、metadata 处理:
  使用 gRPC Interceptor

连接参数、TLS、HTTP/2 keepalive、frame、ByteBuf、EventLoop、pipeline:
  属于 Netty transport / builder 配置范围

业务请求/响应:
  使用 generated Stub + StreamObserver

不要把业务 RPC 语义下沉到 Netty Handler；
也不要用 Interceptor 解决 TCP/TLS/HTTP2 frame 级问题。
```

[1]: https://github.com/grpc/grpc-java "GitHub - grpc/grpc-java: The Java gRPC implementation. HTTP/2 based RPC · GitHub"
[2]: https://github.com/grpc/grpc/blob/master/CONCEPTS.md "grpc/CONCEPTS.md at master · grpc/grpc · GitHub"
[3]: https://grpc.io/docs/what-is-grpc/core-concepts/?utm_source=chatgpt.com "Core concepts, architecture and lifecycle"
[4]: https://grpc.github.io/grpc-java/javadoc/io/grpc/package-summary.html "io.grpc (grpc-all 1.81.0 API)"
[5]: https://httpwg.org/specs/rfc7540.html?utm_source=chatgpt.com "RFC 7540 - Hypertext Transfer Protocol Version 2 (HTTP/2)"
[6]: https://grpc.io/docs/languages/java/basics/?utm_source=chatgpt.com "Basics tutorial | Java"
[7]: https://grpc.github.io/grpc-java/javadoc/io/grpc/stub/package-summary.html?utm_source=chatgpt.com "Package io.grpc.stub"
[8]: https://android.googlesource.com/platform/external/grpc-grpc-java/%2B/b9d1bb8b8badaea5bbf5da74ab4b552ffde29524/README.md "gRPC-Java - An RPC library and framework"
[9]: https://netty.io/4.0/api/io/netty/channel/ChannelPipeline.html "ChannelPipeline (Netty API Reference (4.0.56.Final))"
[10]: https://github.com/grpc/grpc-java/blob/master/netty/src/main/java/io/grpc/netty/NettyClientHandler.java?utm_source=chatgpt.com "NettyClientHandler.java"
[11]: https://github.com/grpc/grpc-java/blob/master/netty/src/main/java/io/grpc/netty/NettyServerHandler.java?utm_source=chatgpt.com "NettyServerHandler.java"
[12]: https://android.googlesource.com/platform/external/grpc-grpc-java/%2B/4d84fe10a43381259238fa11d5fa04d35647e5e7/netty/src/main/java/io/grpc/netty/NettyServerHandler.java?utm_source=chatgpt.com "netty/src/main/java/io/grpc/netty/NettyServerHandler.java"
[13]: https://grpc.io/docs/guides/interceptors/ "Interceptors | gRPC"
[14]: https://grpc.github.io/grpc-java/javadoc/io/grpc/ClientInterceptor.html "ClientInterceptor (grpc-all 1.81.0 API)"
[15]: https://grpc.github.io/grpc-java/javadoc/io/grpc/ServerInterceptor.html "ServerInterceptor (grpc-all 1.81.0 API)"
[16]: https://grpc.github.io/grpc-java/javadoc/io/grpc/ClientCall.Listener.html "ClientCall.Listener (grpc-all 1.81.0 API)"
[17]: https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md "grpc/doc/PROTOCOL-HTTP2.md at master · grpc/grpc · GitHub"
