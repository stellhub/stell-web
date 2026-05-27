## Abstract

Netty is an asynchronous event-driven network application framework for building protocol servers and clients. The official Netty documentation describes it as an NIO client-server framework that simplifies TCP, UDP, and other network programming while balancing performance, stability, and flexibility. ([Netty][1]) This article focuses on the Netty 4.1 series and explains which parameters should be observed and adjusted under specific symptoms, including connection establishment, read/write buffers, backpressure, threading, memory allocation, connection liveness, and Linux native transport. The parameter semantics and boundaries in this article are based only on the official Netty API documentation, the Netty Wiki, Linux man-pages, and Oracle JDK documentation; empirical values are not presented as fixed conclusions.

## 1. Introduction

Netty tuning is not the optimization of one isolated parameter. It is a joint configuration problem across the application event model, JDK socket options, operating-system TCP queues, Netty `ChannelConfig`, the `ByteBuf` allocator, and business-processing threads. The official `ChannelOption` documentation states that `ChannelOption` is used to configure `ChannelConfig` in a type-safe way, but the concrete options supported depend on the actual `ChannelConfig` implementation and the underlying transport type. ([Netty][2]) Therefore, the same option may have different support and practical effects under NIO, epoll, kqueue, domain sockets, or UDP.

Netty server configuration also distinguishes between the parent channel and child channels. In `ServerBootstrap.group(parentGroup, childGroup)`, the parent group handles the `ServerChannel`, while the child group handles established connection `Channel`s; `childOption` applies to child `Channel`s created after accept. ([Netty][3]) Therefore, listening-socket options such as `SO_BACKLOG` are usually configured with `option(...)`, while connection-socket options such as `TCP_NODELAY`, `SO_KEEPALIVE`, `SO_RCVBUF`, `SO_SNDBUF`, and `WRITE_BUFFER_WATER_MARK` are usually configured with `childOption(...)`.

## 2. A Classification Framework for Tuning Parameters

Netty parameters can be divided into six problem domains.

The first category is connection-establishment parameters, including `SO_BACKLOG`, Linux `somaxconn`, `tcp_max_syn_backlog`, `SO_REUSEADDR`, and `SO_REUSEPORT` under the epoll transport.

The second category is connection-transfer parameters, including `TCP_NODELAY`, `SO_KEEPALIVE`, `SO_RCVBUF`, `SO_SNDBUF`, `IP_TOS`, and `ALLOW_HALF_CLOSURE`. Netty `ChannelOption` lists standard socket options such as `SO_KEEPALIVE`, `SO_SNDBUF`, `SO_RCVBUF`, `SO_REUSEADDR`, `SO_BACKLOG`, and `TCP_NODELAY`. ([Netty][2])

The third category is read/write backpressure parameters, including `AUTO_READ`, `WRITE_BUFFER_WATER_MARK`, `WRITE_SPIN_COUNT`, `MAX_MESSAGES_PER_WRITE`, and `RCVBUF_ALLOCATOR`. Netty `ChannelOption` explicitly includes options such as `AUTO_READ`, `RCVBUF_ALLOCATOR`, `WRITE_BUFFER_WATER_MARK`, and `WRITE_SPIN_COUNT`. ([Netty][2])

The fourth category is threading-model parameters, including the number of boss/worker `EventLoopGroup` threads, whether blocking handlers use an independent `EventExecutorGroup`, and whether native epoll transport is used. The `ServerBootstrap` documentation explains that the parent and child `EventLoopGroup`s handle events and I/O for `ServerChannel` and child `Channel`s. ([Netty][3])

The fifth category is memory and `ByteBuf` parameters, including `ALLOCATOR`, whether to use a pooled allocator, direct buffers, the `ResourceLeakDetector` level, and JVM direct-memory limits. `PooledByteBufAllocator` provides methods for observing pinned direct memory and pinned heap memory, which shows that an allocator may pin more memory than the buffer capacity due to implementation details. ([Netty][4])

The sixth category is platform-transport parameters. Netty's native transport documentation explains that Linux and macOS/BSD have platform-specific JNI transports; these transports add platform features, produce less garbage, and usually improve performance compared with the NIO transport. ([Netty][5])

## 3. Problems and Parameters during Connection Establishment

### 3.1 Client Connection Failures or Connection Latency during Spikes

When a server receives a large number of TCP connection requests at once, the problem may occur in the kernel listen queue, accept speed, or application-level connection-processing capacity. The Linux `listen(2)` documentation states that the `backlog` argument defines the maximum length to which the pending-connection queue may grow; when a connection request arrives and the queue is full, the client may receive `ECONNREFUSED`, or the request may be ignored and wait for a later retry if the underlying protocol supports retransmission. ([man7.org][6])

In Netty, the option directly related to this symptom is:

```java
serverBootstrap.option(ChannelOption.SO_BACKLOG, backlog);
```

`SO_BACKLOG` is a Netty `ChannelOption<Integer>` and belongs to the server listening socket. ([Netty][2]) However, `SO_BACKLOG` is not the only limit. Since Linux 2.2, for TCP sockets, `backlog` means the length of the completed-connection queue waiting for accept; the incomplete connection queue is controlled by `/proc/sys/net/ipv4/tcp_max_syn_backlog`. ([man7.org][6]) Therefore, when the symptom is failure, timeout, or `ECONNREFUSED` during connection spikes, the Netty layer should check `SO_BACKLOG`, while the system layer should also check `net.core.somaxconn` and `tcp_max_syn_backlog`.

Configuration example:

```java
ServerBootstrap bootstrap = new ServerBootstrap();

bootstrap
    .group(bossGroup, workerGroup)
    .channel(NioServerSocketChannel.class)
    // Configure the accept queue length for the server socket.
    .option(ChannelOption.SO_BACKLOG, 1024)
    .childHandler(channelInitializer);
```

This option only increases the connection queuing capacity. It does not increase business-processing speed. If worker threads are blocked or handlers after accept are slow, increasing backlog alone changes queuing behavior but does not remove the processing bottleneck.

### 3.2 Binding Fails Shortly after Port Restart

When a process restart is followed by address-in-use or bind failures, the related option is `SO_REUSEADDR`. Netty provides `ChannelOption.SO_REUSEADDR`. ([Netty][2]) Oracle `StandardSocketOptions` documentation explains that standard socket options are used by Java network channels and defined as named fields. ([Oracle Documentation][7])

Configuration example:

```java
bootstrap.option(ChannelOption.SO_REUSEADDR, true);
```

The behavior of this option is affected by the operating-system TCP state machine. It does not replace proper connection shutdown and does not allow multiple ordinary TCP server sockets to bind unconditionally to the same address and port.

### 3.3 Multiple Linux Processes or Reactors Listening on the Same Port

Under Linux native epoll transport, `EpollChannelOption.SO_REUSEPORT` is worth attention. The Netty native transport documentation states that Linux native transport provides platform-specific capabilities. ([Netty][5]) This type of option applies only to epoll transport and is not a cross-platform NIO option. To use it, `NioEventLoopGroup` and `NioServerSocketChannel` need to be replaced with `EpollEventLoopGroup` and `EpollServerSocketChannel`. The official native transport documentation describes migration in exactly this way: replace the `EventLoopGroup` and channel types. ([Netty][5])

Configuration form:

```java
ServerBootstrap bootstrap = new ServerBootstrap();

bootstrap
    .group(bossGroup, workerGroup)
    .channel(EpollServerSocketChannel.class)
    // Linux epoll transport only.
    .option(EpollChannelOption.SO_REUSEPORT, true);
```

This option should not be treated as a general solution outside the Linux epoll transport.

## 4. Problems and Parameters during Data Sending

### 4.1 Increased Latency for Small Packets

When the workload mainly consists of small, low-latency requests and observed request latency is related to TCP packet coalescing, check `TCP_NODELAY`. Netty provides `ChannelOption.TCP_NODELAY`, whose type is `Boolean`. ([Netty][2]) Oracle `StandardSocketOptions` defines `TCP_NODELAY` as the socket option that disables the Nagle algorithm. ([Oracle Documentation][8])

Configuration example:

```java
bootstrap.childOption(ChannelOption.TCP_NODELAY, true);
```

The factual semantics of this option are to disable the Nagle algorithm. It can reduce latency caused by small packets waiting to be merged, but it does not reduce application serialization cost, handler execution time, or network RTT.

### 4.2 Writes Outpace Peer Reads and Memory Keeps Growing

When the application continuously calls `writeAndFlush`, but the peer reads slowly, the network is congested, or the system send buffer cannot drain in time, Netty's outbound buffer may accumulate. The `WriteBufferWaterMark` documentation explains that it sets the low and high water marks of the write buffer; when queued bytes in the write buffer exceed the high water mark, `Channel.isWritable()` starts returning `false`; when bytes fall below the low water mark, `Channel.isWritable()` starts returning `true`. ([Netty][9])

Related option:

```java
ChannelOption.WRITE_BUFFER_WATER_MARK
```

Configuration example:

```java
bootstrap.childOption(
    ChannelOption.WRITE_BUFFER_WATER_MARK,
    new WriteBufferWaterMark(32 * 1024, 64 * 1024)
);
```

Business code must also throttle based on `Channel.isWritable()` or `channelWritabilityChanged`; setting the water mark alone does not automatically stop the application from writing. The Netty documentation also notes that messages need to be handled by `MessageSizeEstimator` for `Channel.isWritable()` to provide accurate backpressure. ([Netty][9])

Typical handling form:

```java
@Override
public void channelWritabilityChanged(ChannelHandlerContext ctx) {
    if (ctx.channel().isWritable()) {
        // Resume application writes when the outbound buffer is below the low water mark.
        resumeWrite();
    } else {
        // Stop or slow down application writes when the outbound buffer exceeds the high water mark.
        pauseWrite();
    }
    ctx.fireChannelWritabilityChanged();
}
```

### 4.3 A Single Write Operation Cannot Flush Completely

Netty `ChannelOption` provides `WRITE_SPIN_COUNT` and `MAX_MESSAGES_PER_WRITE`. ([Netty][2]) These options affect the number of write attempts or messages written in one event-loop round. They are useful when analyzing single-connection write behavior related to event-loop scheduling, but they should not be the entry point for solving every throughput problem. If the root cause is a slow receiver or network congestion, prefer `WRITE_BUFFER_WATER_MARK` and application-level backpressure.

## 5. Problems and Parameters during Data Reading

### 5.1 Inbound Traffic Exceeds Business-Processing Capacity

When server read speed exceeds business-processing speed, accumulation, memory growth, and amplified latency may occur. Netty provides the `AUTO_READ` option. In `ChannelOption`, `AUTO_READ` is a `Boolean`. ([Netty][2]) When the application needs to control the read pace, automatic reads can be disabled and `ctx.read()` can be called explicitly after processing capacity recovers.

Configuration example:

```java
bootstrap.childOption(ChannelOption.AUTO_READ, false);
```

Handler example:

```java
@Override
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    try {
        // Process the inbound message.
        process(msg);
    } finally {
        ReferenceCountUtil.release(msg);
    }

    if (canAcceptMore()) {
        // Request the next read explicitly when the application is ready.
        ctx.read();
    }
}
```

This option solves read-pace control. It does not solve blocking inside handlers, exhausted business thread pools, or slow downstream systems.

### 5.2 Inbound Packet Size Fluctuation Causes Frequent Expansion or Memory Waste

The `AdaptiveRecvByteBufAllocator` documentation states that this allocator automatically increases or decreases the predicted buffer size based on feedback: if the previous read filled the allocated buffer, it gradually increases the expected readable bytes; if two consecutive reads do not reach a certain fill level, it gradually lowers the expected readable bytes; otherwise, it keeps the prediction unchanged. ([Netty][10])

Related option:

```java
ChannelOption.RCVBUF_ALLOCATOR
```

Configuration example:

```java
bootstrap.childOption(
    ChannelOption.RCVBUF_ALLOCATOR,
    new AdaptiveRecvByteBufAllocator(64, 1024, 64 * 1024)
);
```

This option applies when the read-buffer allocation strategy does not match the message-size distribution. If the problem comes from a protocol decoder that does not correctly handle partial packets or sticky packets, adjust the codec instead of only changing `RCVBUF_ALLOCATOR`.

### 5.3 One Connection's Read Events Occupy Too Much EventLoop Time

`MAX_MESSAGES_PER_READ` is marked as deprecated in `ChannelOption`, with a recommendation to use `MaxMessagesRecvByteBufAllocator` and its `maxMessagesPerRead(int)`. ([Netty][2]) Therefore, when the maximum number of messages read in one round needs to be controlled, tune the concrete `RecvByteBufAllocator` implementation instead of continuing to rely on the deprecated option.

## 6. Connection Liveness and Abnormal Connections

### 6.1 Idle Connections Remain Open for a Long Time

Netty provides `SO_KEEPALIVE` as a socket option. ([Netty][2]) This option enables TCP keepalive. The concrete probing interval and behavior are usually determined by operating-system parameters. It is suitable for detecting whether a long-idle TCP connection is still valid, but it is not the same as an application-level heartbeat.

Configuration example:

```java
bootstrap.childOption(ChannelOption.SO_KEEPALIVE, true);
```

If a protocol needs second-level or business-semantic liveness detection, use Netty handlers such as `IdleStateHandler` together with application heartbeats instead of relying only on TCP keepalive.

### 6.2 Half-Close Handling Does Not Match Protocol Requirements

Netty `ChannelOption` provides `ALLOW_HALF_CLOSURE`. ([Netty][2]) Protocols that need to handle TCP half-close should configure it explicitly and distinguish input shutdown from output shutdown in handlers. For ordinary request-response protocols, whether half-close should be allowed depends on protocol semantics.

## 7. Client Connection Timeout

When a client connects to a remote service and waits too long or times out during connection establishment, check:

```java
ChannelOption.CONNECT_TIMEOUT_MILLIS
```

Netty `ChannelOption` defines `CONNECT_TIMEOUT_MILLIS` as an `Integer` option. ([Netty][2])

Configuration example:

```java
Bootstrap bootstrap = new Bootstrap();

bootstrap
    .group(workerGroup)
    .channel(NioSocketChannel.class)
    // Configure TCP connect timeout in milliseconds.
    .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 3000);
```

This option only constrains connection establishment. It does not constrain business read timeout, write timeout, or total request duration. Read/write timeouts usually need timeout handlers in the pipeline or support from the upper-level protocol client.

## 8. Threading-Model Problems and Parameters

### 8.1 EventLoop Threads Are Blocked by Business Logic

Netty's core model is event-driven. The `ServerBootstrap` documentation states that parent and child `EventLoopGroup`s handle all events and I/O for `ServerChannel` and child `Channel`s. ([Netty][3]) Therefore, if a `ChannelHandler` executes blocking JDBC, blocking HTTP calls, file I/O, or long CPU computations, it occupies the EventLoop thread and affects I/O event processing for other channels on the same EventLoop.

The Netty `ChannelPipeline` API provides `addFirst`, `addLast`, and other methods that take an `EventExecutorGroup`; that group is used to execute the corresponding `ChannelHandler` methods. ([Netty][11]) Therefore, blocking or time-consuming handlers should be placed in an independent executor rather than running on the I/O EventLoop.

Example:

```java
EventExecutorGroup businessGroup = new DefaultEventExecutorGroup(32);

pipeline.addLast("decoder", decoder);
pipeline.addLast(businessGroup, "blockingBusinessHandler", blockingBusinessHandler);
pipeline.addLast("encoder", encoder);
```

The purpose of this configuration is to isolate blocking business logic from the I/O event loop. It does not reduce the business logic's own execution time and does not replace downstream rate limiting.

### 8.2 EventLoop Thread Count Does Not Match the Workload

The `NioEventLoopGroup` constructor allows `nThreads` to be specified; otherwise, it uses a default thread count. ([Netty][12]) `DefaultEventLoopGroup` also provides constructors with a default thread count and explicit `nThreads`. ([Netty][13])

Configuration example:

```java
EventLoopGroup bossGroup = new NioEventLoopGroup(1);
EventLoopGroup workerGroup = new NioEventLoopGroup(8);
```

Thread-count problems should be judged by metrics: growth in EventLoop pending tasks, increased I/O latency, CPU utilization, context switches, and business-handler duration. Increasing worker threads does not guarantee higher throughput. If the bottleneck is single-connection sequential processing, lock contention, downstream services, or kernel queues, changing thread count cannot directly remove the root cause.

### 8.3 NIO Transport Overhead Is High on Linux

The official Netty native transport documentation states that Linux native transport has been available since 4.0.16, can add platform-specific features, produces less garbage, and usually performs better than NIO transport. ([Netty][5]) The Netty 4.0.17 release notes also state that native epoll transport is based on epoll edge-triggered mode for maximal performance and low latency, and works only on Linux. ([Netty][14])

On Linux, it can be switched to:

```java
EventLoopGroup bossGroup = new EpollEventLoopGroup(1);
EventLoopGroup workerGroup = new EpollEventLoopGroup();

ServerBootstrap bootstrap = new ServerBootstrap();

bootstrap
    .group(bossGroup, workerGroup)
    .channel(EpollServerSocketChannel.class)
    .childHandler(channelInitializer);
```

This configuration applies only to Linux and requires `netty-transport-native-epoll` with the corresponding classifier. It is not a cross-platform configuration.

## 9. Memory, ByteBuf, and Leak Detection

### 9.1 Direct Memory or Off-Heap Memory Keeps Growing

Netty uses `ByteBufAllocator` to manage buffers. `ChannelOption.ALLOCATOR` is the allocator configuration item provided by Netty. ([Netty][2]) The `PooledByteBufAllocator` documentation provides `pinnedDirectMemory()` and `pinnedHeapMemory()` metrics, where pinned direct memory means the number of bytes pinned by currently allocated direct buffers; the documentation also explains that due to allocator implementation details, the memory pinned by a buffer may be larger than its capacity. ([Netty][4])

Configuration example:

```java
bootstrap.childOption(ChannelOption.ALLOCATOR, PooledByteBufAllocator.DEFAULT);
```

Related issues should also check:

1. Whether reference-counted objects are released correctly.
2. Whether the outbound buffer is accumulating.
3. Whether business code caches `ByteBuf`s.
4. Whether JVM `MaxDirectMemorySize` matches container memory limits.
5. Whether pinned direct memory in allocator metrics keeps increasing.

### 9.2 Locating ByteBuf Leaks

Netty `ResourceLeakDetector.Level` defines four levels: `DISABLED`, `SIMPLE`, `ADVANCED`, and `PARANOID`. `SIMPLE` is the default level and has small overhead; `ADVANCED` reports recent access locations with high overhead; `PARANOID` is intended for testing and has the highest possible overhead. ([Netty][15])

Therefore, when logs contain `LEAK: ByteBuf.release()` messages, or direct memory keeps growing without explanation from business metrics, increase the leak-detection level in test, staging, or a short diagnostic window:

```bash
-Dio.netty.leakDetection.level=advanced
```

or:

```bash
-Dio.netty.leakDetection.level=paranoid
```

The official description of `PARANOID` includes "for testing purposes only", so it should not be used as the production default. ([Netty][15])

## 10. Mapping Parameters to Symptoms

| Symptom | Facts to observe | Related parameters | Tuning direction |
| --- | --- | --- | --- |
| Client connection failures, `ECONNREFUSED`, or connection latency during spikes | Whether the listen queue is full, whether accept is timely, and system backlog limits | `SO_BACKLOG`, `net.core.somaxconn`, `tcp_max_syn_backlog` | Increase listen queue limits and check whether boss/worker threads are blocked |
| Abnormal latency for small packets | Whether Nagle packet coalescing is involved | `TCP_NODELAY` | Enable `TCP_NODELAY=true` for low-latency small-packet scenarios |
| Write accumulation, memory growth, `isWritable=false` | Whether the outbound buffer exceeds the high water mark | `WRITE_BUFFER_WATER_MARK`, `MessageSizeEstimator` | Set reasonable high/low water marks and apply business backpressure based on writability |
| Inbound traffic overwhelms business processing | Whether read speed exceeds processing speed | `AUTO_READ`, `RCVBUF_ALLOCATOR` | Disable automatic reads and call `read()` explicitly according to processing capacity |
| Message-size fluctuation causes buffer waste or frequent expansion | Whether actual read size matches predicted buffer size | `RCVBUF_ALLOCATOR` | Use or tune `AdaptiveRecvByteBufAllocator` |
| EventLoop latency increases | Whether handlers execute blocking tasks | `EventLoopGroup` thread count, `DefaultEventExecutorGroup` | Put blocking handlers into an independent executor |
| NIO overhead is high on Linux | Whether the system runs on Linux and can use native transport | `EpollEventLoopGroup`, `EpollServerSocketChannel` | Use native epoll transport |
| Direct memory keeps growing | Whether there is a `ByteBuf` leak or outbound accumulation | `ALLOCATOR`, `ResourceLeakDetector.Level` | Observe allocator metrics and raise leak-detection level for diagnosis |
| Idle connections are not released for a long time | Whether TCP-level or application-level liveness detection exists | `SO_KEEPALIVE`, `IdleStateHandler` | TCP keepalive handles TCP-level checks; application heartbeat handles protocol-level checks |
| Client connection establishment takes too long | Whether the delay is in TCP connect | `CONNECT_TIMEOUT_MILLIS` | Set connect timeout; handle read/write timeouts separately |

## 11. Recommended Configuration Template

The following template expresses option placement and semantics only. It does not represent fixed production values.

```java
public final class NettyServerConfig {

    private final int bossThreads = 1;
    private final int workerThreads = Runtime.getRuntime().availableProcessors() * 2;
    private final int backlog = 1024;
    private final int connectTimeoutMillis = 3000;

    public ServerBootstrap newServerBootstrap(ChannelInitializer<SocketChannel> initializer) {
        EventLoopGroup bossGroup = new NioEventLoopGroup(bossThreads);
        EventLoopGroup workerGroup = new NioEventLoopGroup(workerThreads);

        return new ServerBootstrap()
            .group(bossGroup, workerGroup)
            .channel(NioServerSocketChannel.class)

            // Parent channel option: configure the server listen socket.
            .option(ChannelOption.SO_BACKLOG, backlog)
            .option(ChannelOption.SO_REUSEADDR, true)

            // Child channel options: configure accepted client sockets.
            .childOption(ChannelOption.TCP_NODELAY, true)
            .childOption(ChannelOption.SO_KEEPALIVE, true)
            .childOption(ChannelOption.CONNECT_TIMEOUT_MILLIS, connectTimeoutMillis)
            .childOption(ChannelOption.ALLOCATOR, PooledByteBufAllocator.DEFAULT)
            .childOption(
                ChannelOption.WRITE_BUFFER_WATER_MARK,
                new WriteBufferWaterMark(32 * 1024, 64 * 1024)
            )
            .childOption(
                ChannelOption.RCVBUF_ALLOCATOR,
                new AdaptiveRecvByteBufAllocator(64, 1024, 64 * 1024)
            )
            .childHandler(initializer);
    }
}
```

For pipelines with blocking business processing, place blocking handlers in an independent executor:

```java
public final class ServerChannelInitializer extends ChannelInitializer<SocketChannel> {

    private final EventExecutorGroup businessGroup = new DefaultEventExecutorGroup(32);

    @Override
    protected void initChannel(SocketChannel ch) {
        ChannelPipeline pipeline = ch.pipeline();

        pipeline.addLast("decoder", new MyProtocolDecoder());

        // Execute blocking business logic outside the I/O EventLoop.
        pipeline.addLast(businessGroup, "businessHandler", new BlockingBusinessHandler());

        pipeline.addLast("encoder", new MyProtocolEncoder());
    }
}
```

## 12. Conclusion

Netty parameter tuning should start from symptoms rather than a fixed parameter template. Connection-establishment failures correspond to `SO_BACKLOG` and the Linux listen queue; small-packet latency corresponds to `TCP_NODELAY`; write accumulation corresponds to `WRITE_BUFFER_WATER_MARK` and business backpressure; reads overwhelming business processing correspond to `AUTO_READ` and `RCVBUF_ALLOCATOR`; EventLoop latency corresponds to handler blocking and threading-model isolation; direct-memory growth corresponds to allocator metrics and leak detection; Linux high-performance transport scenarios can use native epoll transport.

From the official documentation semantics, the effectiveness of Netty options depends on the `ChannelConfig` implementation and transport type. ([Netty][2]) Therefore, tuning conclusions must be bound to the runtime environment, protocol type, connection scale, message-size distribution, business-handler duration, kernel parameters, and JVM memory parameters. Fixed parameter values cannot be universal conclusions; verifiable metrics, official option semantics, and benchmark results are the tuning basis.

[1]: https://netty.io/wiki/user-guide-for-4.x.html "Netty.docs: User guide for 4.x"
[2]: https://netty.io/4.1/api/io/netty/channel/ChannelOption.html "ChannelOption (Netty API Reference (4.1.133.Final))"
[3]: https://netty.io/4.1/api/io/netty/bootstrap/ServerBootstrap.html "ServerBootstrap (Netty API Reference (4.1.133.Final))"
[4]: https://netty.io/4.1/api/io/netty/buffer/PooledByteBufAllocator.html?utm_source=chatgpt.com "PooledByteBufAllocator (Netty API Reference (4.1.132.Final))"
[5]: https://netty.io/wiki/native-transports.html "Netty.docs: Native transports"
[6]: https://man7.org/linux/man-pages/man2/listen.2.html "listen(2) - Linux manual page"
[7]: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/StandardSocketOptions.html "StandardSocketOptions (Java SE 25 & JDK 25)"
[8]: https://docs.oracle.com/javase/jp/11/docs/api/java.base/java/net/StandardSocketOptions.html?utm_source=chatgpt.com "StandardSocketOptions (Java SE 11 & JDK 11)"
[9]: https://netty.io/4.1/api/io/netty/channel/WriteBufferWaterMark.html "WriteBufferWaterMark (Netty API Reference (4.1.133.Final))"
[10]: https://netty.io/4.1/api/io/netty/channel/AdaptiveRecvByteBufAllocator.html "AdaptiveRecvByteBufAllocator (Netty API Reference (4.1.133.Final))"
[11]: https://netty.io/4.1/api/io/netty/channel/ChannelPipeline.html?utm_source=chatgpt.com "ChannelPipeline (Netty API Reference (4.1.133.Final))"
[12]: https://netty.io/4.1/api/io/netty/channel/nio/NioEventLoopGroup.html?utm_source=chatgpt.com "NioEventLoopGroup (Netty API Reference (4.1.133.Final))"
[13]: https://netty.io/4.1/api/io/netty/channel/DefaultEventLoopGroup.html?utm_source=chatgpt.com "Class DefaultEventLoopGroup"
[14]: https://netty.io/news/2014/02/25/4-0-17-Final.html "Netty.news: Netty 4.0.17.Final released"
[15]: https://netty.io/4.1/api/io/netty/util/ResourceLeakDetector.Level.html "ResourceLeakDetector.Level (Netty API Reference (4.1.133.Final))"
