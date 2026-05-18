---
title: 基于 epoll 的 NIO 网络模型演进与多框架实现研究
category: Java 工程
summary: 围绕 Linux epoll 机制分析 NIO 网络模型演进、epoll 系统调用语义、select/poll/epoll 差异，以及 Netty、Go、Redis、Nginx 的事件驱动实现和虚拟线程边界。
tags:
  - epoll
  - NIO
  - Netty
  - Go
  - 虚拟线程
readingDirection: 适合在理解 Linux NIO 网络模型、Netty native epoll、Go runtime netpoll、Redis/Nginx 事件模型，或评估虚拟线程与 EventLoop 边界时阅读。
outline: deep
---

# 基于 epoll 的 NIO 网络模型演进与多框架实现研究

## 摘要

本文围绕 Linux `epoll` 机制说明 NIO 网络模型的形成背景、系统调用语义、与 `select`、`poll` 的差异，以及 Java Netty、Go、Redis、Nginx 在事件驱动网络模型中的实现方式。依据 Linux man-pages，`epoll` 是一种 I/O 事件通知机制，用于监视多个文件描述符是否可执行 I/O；其核心对象是内核中的 epoll instance，并从用户空间角度表现为 interest list 与 ready list 两类集合。([man7.org][1]) 

## 1. 引言：从 BIO 到 NIO 的演进背景

早期 BIO，即 blocking I/O，通常采用“一个连接对应一个线程”或“一个请求对应一个线程”的处理方式。该模型的直接问题是：当连接数量增加时，线程数量、线程栈内存、上下文切换、调度成本都会随连接数增长。C10K 问题最早围绕“单机同时处理一万个并发连接”展开；C10M 则进一步把并发连接规模推进到千万级连接讨论。C10K/C10M 的核心不是单纯请求吞吐，而是大量长连接或并发连接下，操作系统、网络栈、I/O 模型、线程模型与内存占用的综合约束。([圣路易斯 Linux 用户组][2])

NIO 的演进方向是将“每连接阻塞线程”改为“少量线程管理大量连接”。在 Linux 上，该方向主要依赖 I/O 多路复用机制：`select`、`poll`、`epoll`。其中 `epoll` 被 Linux man-pages 定义为与 `poll` 类似的机制，用于监控多个文件描述符是否可进行 I/O，并且支持 level-triggered 与 edge-triggered 两种接口形式，适合大量被监控文件描述符的场景。([man7.org][1])

因此，BIO 到 NIO 的演进，本质上是从线程阻塞等待 I/O，演进为事件循环等待 I/O 就绪；应用线程不再直接为每个连接阻塞，而是通过内核事件通知获取“哪些连接已经就绪”。

## 2. epoll 的核心实现与实例内容

Linux 官方文档将 epoll instance 描述为一个内核数据结构。从用户空间视角看，它可以被认为包含两个列表：

一是 **interest list**，也称 epoll set，表示进程注册到该 epoll 实例上、希望监控的文件描述符集合。

二是 **ready list**，表示已经就绪、可执行 I/O 的文件描述符集合。ready list 是 interest list 的子集，或者更精确地说，是指向 interest list 中相关文件描述符的引用集合，由内核在文件描述符发生 I/O 活动时动态填充。([man7.org][1])

`epoll_create` 创建 epoll instance，并返回一个引用该实例的文件描述符；后续 `epoll_ctl`、`epoll_wait` 都基于这个 epoll 文件描述符操作该实例。所有引用该 epoll instance 的文件描述符关闭后，内核销毁该实例并释放资源。([man7.org][3])

从实现语义看，epoll instance 至少保存以下信息：

1. 被注册监控的目标文件描述符集合，即 interest list。
2. 已经就绪的目标文件描述符引用集合，即 ready list。
3. 每个被监控文件描述符关联的事件掩码，例如 `EPOLLIN`、`EPOLLOUT`、`EPOLLET`、`EPOLLONESHOT` 等。
4. 每个注册项携带的用户数据，即 `struct epoll_event.data`，内核会保存该数据，并在文件描述符就绪时通过 `epoll_wait` 返回。([man7.org][4])

## 3. epoll 系统调用语义

### 3.1 epoll_create

函数原型如下：

```c
int epoll_create(int size);
```

`epoll_create()` 创建一个新的 epoll instance，并返回引用该实例的文件描述符。返回值成功时是非负整数，失败时返回 `-1` 并设置 `errno`。([man7.org][3])

`size` 参数在早期实现中用于告诉内核调用方预计会向 epoll instance 中添加多少个文件描述符，内核据此为内部事件数据结构预分配空间；如果需要，内核仍可继续分配更多空间。Linux 2.6.8 以后，`size` 参数不再具有该空间提示语义，但必须大于 0，否则会返回 `EINVAL`。([man7.org][3])

因此，`epoll_create(1024)` 中的 `1024` 在现代 Linux 上不表示“最多只能监听 1024 个连接”，也不限制 `epoll_wait` 一次返回的事件数量；它只是历史兼容参数，要求传入正数。

现代代码更常使用：

```c
int epoll_create1(int flags);
```

当 `flags` 为 0 时，除去过时的 `size` 参数外，`epoll_create1()` 与 `epoll_create()` 等价。`flags` 可包含 `EPOLL_CLOEXEC`，用于在新文件描述符上设置 close-on-exec 标志。([man7.org][3])

### 3.2 epoll_ctl

函数原型如下：

```c
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event);
```

该系统调用用于向 `epfd` 引用的 epoll instance 的 interest list 添加、修改或删除条目。`op` 指定操作类型，`fd` 是目标文件描述符，`event` 描述要关联到该目标文件描述符的事件配置。([man7.org][4])

各参数含义如下：

| 参数      | 含义                                                                    |
| ------- | --------------------------------------------------------------------- |
| `epfd`  | `epoll_create` 或 `epoll_create1` 返回的 epoll 文件描述符，代表一个 epoll instance。 |
| `op`    | 操作类型，取值包括 `EPOLL_CTL_ADD`、`EPOLL_CTL_MOD`、`EPOLL_CTL_DEL`。            |
| `fd`    | 需要添加、修改或删除监听关系的目标文件描述符，通常是 socket fd。                                 |
| `event` | 指向 `struct epoll_event` 的指针，描述监听事件和用户数据。                              |

`op` 的三种主要取值如下：

| `op`            | 官方语义                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------- |
| `EPOLL_CTL_ADD` | 将 `fd` 添加到 `epfd` 的 interest list；条目包括 `fd`、对应 open file description 的引用，以及 `event` 中指定的设置。 |
| `EPOLL_CTL_MOD` | 修改 interest list 中 `fd` 关联的事件设置。                                                            |
| `EPOLL_CTL_DEL` | 从 interest list 中移除目标 `fd`；此时 `event` 参数会被忽略，并且可以为 `NULL`。                                  |

`struct epoll_event` 的典型结构如下：

```c
typedef union epoll_data {
    void     *ptr;
    int       fd;
    uint32_t  u32;
    uint64_t  u64;
} epoll_data_t;

struct epoll_event {
    uint32_t      events;
    epoll_data_t data;
};
```

其中 `events` 是事件掩码，表示关注的 I/O 事件；`data` 是用户数据，内核保存该数据，并在对应文件描述符就绪时由 `epoll_wait` 原样返回。([man7.org][4])

### 3.3 epoll_wait

函数原型如下：

```c
int epoll_wait(int epfd, struct epoll_event *events, int maxevents, int timeout);
```

该系统调用等待 `epfd` 引用的 epoll instance 上的 I/O 事件。`events` 指向用户空间数组，内核会把可用事件写入该数组；最多返回 `maxevents` 个事件，并且 `maxevents` 必须大于 0。([man7.org][5])

各参数含义如下：

| 参数          | 含义                                         |
| ----------- | ------------------------------------------ |
| `epfd`      | epoll instance 的文件描述符。                     |
| `events`    | 用户分配的 `struct epoll_event` 数组，用于接收就绪事件。    |
| `maxevents` | 本次调用最多返回的事件数量，必须大于 0，并且应不超过 `events` 数组容量。 |
| `timeout`   | 等待超时时间，单位为毫秒。                              |

`timeout` 的语义如下：

| `timeout` 值 | 行为                                                           |
| ----------- | ------------------------------------------------------------ |
| `-1`        | 无限阻塞，直到有事件到达或被信号中断。                                          |
| `0`         | 立即返回，即使没有事件可用。                                               |
| `> 0`       | 最多阻塞指定毫秒数；时间以 `CLOCK_MONOTONIC` 计量，实际阻塞时间可能因系统时钟粒度和调度延迟略有超出。 |

`epoll_wait` 返回的每个 `epoll_event.data` 字段，是最近一次 `epoll_ctl(EPOLL_CTL_ADD)` 或 `epoll_ctl(EPOLL_CTL_MOD)` 为该文件描述符设置的数据；`events` 字段表示该 open file description 上实际发生的事件掩码。([man7.org][5])

## 4. select、poll、epoll 的差异

`select`、`poll`、`epoll` 都属于 I/O 多路复用接口，但它们在文件描述符表达方式、扩展能力和事件返回方式上存在结构性差异。

| 维度      | select                                                  | poll                                                        | epoll                                 |
| ------- | ------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------- |
| 监控对象表达  | `fd_set` 位图                                             | `struct pollfd` 数组                                          | epoll instance 中的 interest list       |
| fd 数量限制 | 受 `FD_SETSIZE` 限制，Linux man-pages 明确指出通常为 1024，且该限制不会改变 | 不依赖 `FD_SETSIZE`，由 `nfds` 表示数组项数量                           | 通过 `epoll_ctl` 注册到内核维护的 interest list |
| 就绪结果    | 修改传入的 fd 集合                                             | 修改 `pollfd.revents`                                         | `epoll_wait` 返回 ready list 中的就绪事件     |
| 注册方式    | 每次调用传入完整集合                                              | 每次调用传入完整数组                                                  | 通过 `epoll_ctl` 增量添加、修改、删除             |
| 触发模式    | level-like                                              | level-like                                                  | 支持 LT 与 ET                            |
| 官方适用提示  | man-pages 明确提示现代应用应使用 `poll` 或 `epoll` 替代 `select`      | man-pages 说明 `poll` 与 `select` 类似，但 `epoll` 提供超出 `poll` 的能力 | man-pages 说明其适合大量被监控 fd 的场景           |

Linux man-pages 对 `select` 给出明确警告：`select()` 只能监控小于 `FD_SETSIZE` 的文件描述符编号，该限制通常为 1024，对现代应用而言过低，且不会改变；现代应用应改用 `poll` 或 `epoll`。([man7.org][6]) `poll()` 与 `select()` 类似，用于等待一组文件描述符中的任意一个变为可执行 I/O，但 `poll` 通过 `struct pollfd` 数组表达监控集合。([man7.org][7]) `epoll` 则通过内核中的 epoll instance 保存 interest list 和 ready list，避免每次调用都完整传入监听集合。([man7.org][1])

## 5. Java 与 Netty：基于 NIO/epoll 的事件驱动模型

Java 标准 NIO 提供 `Selector`、`SelectableChannel`、`SelectionKey` 等抽象。在 Linux 平台上，OpenJDK 存在 `EPollSelectorImpl`、`EPoll` 等平台相关实现；`EPoll` 类用于访问 Linux epoll facility。([GitHub][8])

Netty 是异步事件驱动网络应用框架，官方 README 将其描述为用于快速开发可维护、高性能协议服务器和客户端的 asynchronous event-driven network application framework。([GitHub][9]) Netty 的线程模型通常由 boss group 与 worker group 组成：boss 接受连接，worker 处理已接受连接的 I/O 流量；具体线程数量以及线程如何映射到 Channel，取决于 `EventLoopGroup` 的实现与配置。([netty.io][10])

Netty 中 `EventLoop` 的职责是处理注册到它的 `Channel` 的所有 I/O 操作；一个 `EventLoop` 通常会处理多个 `Channel`。([netty.io][11]) 这说明 Netty 并不是“一个连接一个线程”的 BIO 模型，而是“少量 EventLoop 线程复用处理多个 Channel”的事件循环模型。

在 Linux 上，Netty 还提供 native epoll transport。官方文档说明，Netty 提供平台特定 JNI transports，其中 Linux native transport 自 4.0.16 起提供；这些 native transports 相比 NIO transport 可以提供平台特定特性、生成更少垃圾，并通常提升性能。使用 Linux native transport 时，官方文档给出的替换方式包括 `NioEventLoopGroup` 替换为 `EpollEventLoopGroup`，`NioServerSocketChannel` 替换为 `EpollServerSocketChannel`，`NioSocketChannel` 替换为 `EpollSocketChannel`。([netty.io][12])

因此，Netty 让 NIO 更快的关键并不只是“调用了 epoll”，而是组合了以下客观机制：

1. 多个 Channel 绑定到少量 EventLoop，减少线程数量。
2. EventLoop 串行处理同一 Channel 上的 I/O 事件，降低锁竞争。
3. boss/worker 分离，使连接接收与连接读写处理分工。
4. Linux native epoll transport 避开部分 JDK NIO 抽象开销，并使用平台能力。
5. Netty 自身提供 ByteBuf、pipeline、handler、批量 flush、事件任务队列等抽象，减少直接使用 JDK NIO 的复杂度。

## 6. Go 的 epoll 实现

Go runtime 在 Unix 平台存在集成网络轮询器。官方源码 `runtime/netpoll.go` 注释说明，平台无关部分由具体实现提供 `netpollinit`、`netpollopen`、`netpollclose`、`netpoll` 等函数；具体实现可以是 epoll、kqueue、port、AIX 或 Windows。([Go][13])

在 Linux 上，Go 的 `runtime/netpoll_epoll.go` 使用 `EpollCreate1(EPOLL_CLOEXEC)` 创建 epoll fd，并创建 `eventfd` 用于 `netpollBreak` 唤醒；源码中定义了 `epfd` 作为 epoll descriptor，`netpollEventFd` 作为唤醒用 eventfd。([Go][14])

Go 的网络 I/O 模型并不是要求开发者直接调用 epoll。开发者使用 goroutine 和标准库网络 API，runtime 在底层把网络 fd 注册到平台网络轮询器。当 fd 就绪时，runtime 将等待该 I/O 的 goroutine 置为 runnable。`netpoll` 注释说明其返回 ready network connections 对应的 goroutine list，并按 `delay` 参数决定非阻塞轮询、限时阻塞或无限阻塞。([GitHub][15])

因此，Go 的实现可以概括为：语言层暴露阻塞式同步 API，runtime 内部使用非阻塞 fd + epoll + goroutine 调度，把 I/O 等待从 OS 线程阻塞转换为 goroutine 挂起与恢复。

## 7. Redis 与 Nginx 的事件模型

Redis 源码中存在 `ae.c` 事件库以及不同平台的事件多路复用实现；`ae_epoll.c` 是 Linux epoll 后端。Redis 的事件库抽象了文件事件与时间事件，在 Linux 上可通过 epoll 后端监听客户端连接、命令读写、复制连接等文件事件。Redis 官方仓库中的 `ae.c` 注释将其描述为一个 simple event-driven programming library。([GitHub][16]) Redis 的 epoll 后端源码位于官方仓库 `src/ae_epoll.c`。([GitHub][17])

Nginx 官方文档说明，Nginx 支持多种连接处理方法，具体可用性取决于平台；当平台支持多种方法时，Nginx 通常会自动选择最高效的方法，也可以通过 `use` 指令显式选择。官方文档列出的连接处理方法包括 `select`、`poll`、`kqueue`、`epoll`、`/dev/poll`、`eventport`；其中 `epoll` 是 Linux 2.6+ 上的高效方法。([Nginx][18])

因此，Redis 与 Nginx 的共同点是：都通过事件循环管理大量连接，并在 Linux 上使用 epoll 作为高并发连接事件通知机制。差异在于：Redis 的主执行模型围绕自身 ae 事件库组织命令处理；Nginx 则围绕 worker process、事件模块和连接处理方法组织网络事件。

## 8. Netty 与 JDK 21 虚拟线程的关系

JDK 21 中，`Executors.newVirtualThreadPerTaskExecutor()` 创建的是“每个任务启动一个新的虚拟线程”的 Executor，且该 Executor 创建的线程数量是无界的。([Oracle 文档][19]) OpenJDK JEP 444 明确说明：虚拟线程不是更快的线程，不会让代码执行得比平台线程更快；它们用于提供规模能力，即更高吞吐，而不是更低延迟。虚拟线程适合大量并发任务且任务不是 CPU-bound 的场景，尤其适合大量时间处于等待状态的服务器任务。([OpenJDK][20])

JEP 444 还明确提出“不要池化虚拟线程”：线程池用于共享昂贵资源，但虚拟线程并不昂贵；如果目的是限制并发访问有限资源，应使用 semaphore 等专门机制，而不是池化虚拟线程。([OpenJDK][20])

将上述官方事实放到 Netty 中，可得到以下客观结论：

1. Netty 的核心 I/O 模型已经是 EventLoop 多路复用模型，一个 EventLoop 通常处理多个 Channel 的 I/O。([netty.io][11])
2. Netty native epoll transport 的性能改进来自平台 native transport，而不是来自虚拟线程。([netty.io][12])
3. `Executors.newVirtualThreadPerTaskExecutor()` 的官方语义是每任务一个虚拟线程、线程数量无界。([Oracle 文档][19])
4. 虚拟线程不会提升 CPU-bound handler 的执行速度，也不会让 epoll_wait、socket read/write 本身更快。([OpenJDK][20])

因此，不应把“在 `ChannelHandler` 中直接使用 `Executors.newVirtualThreadPerTaskExecutor()`”表述为 Netty 官方推荐的通用性能优化方式。更准确的表述是：如果 `ChannelHandler` 中存在阻塞式外部调用，例如阻塞 JDBC、阻塞 HTTP 客户端、阻塞文件 I/O，虚拟线程可以作为一种把阻塞业务逻辑移出 EventLoop 的执行方式；但它不是提升 Netty I/O 线程模型性能的默认手段，也不能替代 EventLoop/epoll。对于 CPU 密集型处理，JEP 444 已明确说明增加超过处理器核心数的线程不能改善吞吐。([OpenJDK][20])

工程上更符合 Netty 线程模型的边界是：EventLoop 线程只处理短小、非阻塞、与 I/O 状态机相关的逻辑；耗时或阻塞逻辑应从 EventLoop 中剥离。至于剥离后使用平台线程池、专用业务线程池、`DefaultEventExecutorGroup`，还是虚拟线程，需要由阻塞类型、资源上限、上下文传播、背压和监控能力决定，不能以“虚拟线程一定提升 Netty 性能”作为结论。

## 9. 结论

epoll 是 Linux NIO 网络模型的核心机制之一。它通过 epoll instance 在内核维护 interest list 与 ready list，使应用能够以事件通知方式管理大量文件描述符。`epoll_create` 创建实例，`epoll_ctl` 管理监听集合，`epoll_wait` 获取就绪事件。与 `select`、`poll` 相比，`epoll` 的关键差异在于监听集合由内核对象维护，并支持 ready list 与 LT/ET 触发模式。

Java Netty、Go runtime、Redis、Nginx 都体现了事件驱动网络模型，但抽象层不同：Netty 以 EventLoopGroup、Channel、Pipeline 屏蔽底层多路复用；Go 以 runtime netpoll 把 epoll 与 goroutine 调度结合；Redis 以 ae 事件库封装文件事件；Nginx 以事件模块和 worker 进程模型组织连接处理。

JDK 21 虚拟线程解决的是“大量阻塞任务的线程承载成本”问题，不是 epoll 或 Netty EventLoop 的替代品。对于 Netty，虚拟线程可以作为阻塞业务逻辑的执行载体，但不应被概括为 `ChannelHandler` 中提升性能的官方推荐通用方案。

[1]: https://man7.org/linux/man-pages/man7/epoll.7.html "epoll(7) - Linux manual page"
[2]: https://stllug.sluug.org/meeting_notes/2001/0719/dankegel_c10k.html?utm_source=chatgpt.com "The C10K problem"
[3]: https://man7.org/linux/man-pages/man2/epoll_create.2.html "epoll_create(2) - Linux manual page"
[4]: https://man7.org/linux/man-pages/man2/epoll_ctl.2.html?utm_source=chatgpt.com "epoll_ctl(2) - Linux manual page"
[5]: https://man7.org/linux/man-pages/man2/epoll_wait.2.html?utm_source=chatgpt.com "epoll_wait(2) - Linux manual page"
[6]: https://man7.org/linux/man-pages/man2/select.2.html "select(2) - Linux manual page"
[7]: https://man7.org/linux/man-pages/man2/poll.2.html "poll(2) - Linux manual page"
[8]: https://github.com/AdoptOpenJDK/openjdk-jdk11/blob/master/src/java.base/linux/classes/sun/nio/ch/EPoll.java?utm_source=chatgpt.com "openjdk-jdk11/src/java.base/linux/classes/sun/nio/ch/EPoll. ..."
[9]: https://github.com/netty/netty "GitHub - netty/netty: Netty project - an event-driven asynchronous network application framework · GitHub"
[10]: https://netty.io/wiki/user-guide-for-4.x.html?utm_source=chatgpt.com "User guide for 4.x"
[11]: https://netty.io/4.1/api/io/netty/channel/EventLoop.html?utm_source=chatgpt.com "EventLoop (Netty API Reference (4.1.133.Final))"
[12]: https://netty.io/wiki/native-transports.html "Netty.docs: Native transports"
[13]: https://go.dev/src/runtime/netpoll.go " - The Go Programming Language"
[14]: https://go.dev/src/runtime/netpoll_epoll.go " - The Go Programming Language"
[15]: https://github.com/golang/go/blob/master/src/runtime/netpoll_epoll.go?utm_source=chatgpt.com "go/src/runtime/netpoll_epoll.go at master · golang/go"
[16]: https://github.com/redis/redis/blob/unstable/src/ae.c?utm_source=chatgpt.com "redis/src/ae.c at unstable"
[17]: https://github.com/redis/redis/blob/unstable/src/ae_epoll.c?utm_source=chatgpt.com "redis/src/ae_epoll.c at unstable"
[18]: https://nginx.org/en/docs/events.html "Connection processing methods"
[19]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Executors.html "Executors (Java SE 21 & JDK 21)"
[20]: https://openjdk.org/jeps/444 "JEP 444: Virtual Threads"
