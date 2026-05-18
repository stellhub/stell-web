---
title: Evolution of epoll-Based NIO Network Models and Multi-Framework Implementations
category: Java Engineering
summary: A study of Linux epoll, NIO network model evolution, epoll system call semantics, differences between select, poll, and epoll, and event-driven implementations in Netty, Go, Redis, and Nginx.
tags:
  - epoll
  - NIO
  - Netty
  - Go
  - Virtual Threads
readingDirection: Read this when studying the Linux NIO network model, Netty native epoll, Go runtime netpoll, Redis and Nginx event models, or the boundary between virtual threads and EventLoop.
outline: deep
---

# Evolution of epoll-Based NIO Network Models and Multi-Framework Implementations

## Overview

A study of Linux epoll, NIO network model evolution, epoll system call semantics, differences between select, poll, and epoll, and event-driven implementations in Netty, Go, Redis, and Nginx.

## Abstract

This article explains the formation background of the NIO network model around the Linux `epoll` mechanism, the semantics of its system calls, the differences between `epoll`, `select`, and `poll`, and the implementation approaches used by Java Netty, Go, Redis, and Nginx in event-driven network models. According to Linux man-pages, `epoll` is an I/O event notification facility used to monitor multiple file descriptors to see whether I/O can be performed. Its core object is the kernel-side epoll instance, and from the user-space perspective it appears as two sets: an interest list and a ready list. ([man7.org][1])

## 1. Introduction: From BIO to NIO

Early BIO, or blocking I/O, usually used a "one thread per connection" or "one thread per request" processing model. The direct problem with this model is that when the number of connections increases, thread count, thread-stack memory, context switching, and scheduling cost all grow with the number of connections. The C10K problem originally focused on "handling ten thousand concurrent connections on one machine." C10M pushed the discussion further to tens of millions of concurrent connections. The core of C10K/C10M is not simply request throughput; it is the combined constraint of operating system, network stack, I/O model, thread model, and memory usage under many long-lived or concurrent connections. ([St. Louis Linux Users Group][2])

The direction of NIO evolution is to move from "one blocking thread per connection" to "a small number of threads managing many connections." On Linux, this direction mainly depends on I/O multiplexing mechanisms: `select`, `poll`, and `epoll`. Linux man-pages define `epoll` as a mechanism similar to `poll`, used to monitor multiple file descriptors to see whether I/O can be performed. It supports both level-triggered and edge-triggered interfaces and is suitable for scenarios with many monitored file descriptors. ([man7.org][1])

Therefore, the evolution from BIO to NIO is essentially an evolution from threads blocking while waiting for I/O to event loops waiting for I/O readiness. Application threads no longer block directly for every connection; instead, they use kernel event notification to learn "which connections are ready."

## 2. Core Implementation and Contents of an epoll Instance

Linux documentation describes an epoll instance as a kernel data structure. From the user-space perspective, it can be thought of as containing two lists.

The first is the **interest list**, also called the epoll set. It represents the set of file descriptors that the process has registered on this epoll instance and wants to monitor.

The second is the **ready list**. It represents file descriptors that are already ready and can perform I/O. The ready list is a subset of the interest list, or more precisely, a set of references to relevant file descriptors in the interest list. It is dynamically populated by the kernel when I/O activity happens on file descriptors. ([man7.org][1])

`epoll_create` creates an epoll instance and returns a file descriptor that refers to it. Later, `epoll_ctl` and `epoll_wait` operate on the instance through this epoll file descriptor. After all file descriptors referring to the epoll instance are closed, the kernel destroys the instance and releases resources. ([man7.org][3])

From the implementation semantics, an epoll instance stores at least:

1. The monitored target file descriptor set, namely the interest list.
2. The ready target file descriptor reference set, namely the ready list.
3. The event mask associated with each monitored file descriptor, such as `EPOLLIN`, `EPOLLOUT`, `EPOLLET`, and `EPOLLONESHOT`.
4. The user data carried by every registration item, namely `struct epoll_event.data`. The kernel stores this data and returns it through `epoll_wait` when the file descriptor becomes ready. ([man7.org][4])

## 3. epoll System Call Semantics

### 3.1 epoll_create

The function prototype is:

```c
int epoll_create(int size);
```

`epoll_create()` creates a new epoll instance and returns a file descriptor referring to that instance. On success, the return value is a non-negative integer. On failure, it returns `-1` and sets `errno`. ([man7.org][3])

In early implementations, the `size` argument told the kernel how many file descriptors the caller expected to add to the epoll instance, so the kernel could preallocate space for internal event data structures. If necessary, the kernel could still allocate more space. Since Linux 2.6.8, `size` no longer has that space-hint meaning, but it must be greater than 0 or `EINVAL` is returned. ([man7.org][3])

Therefore, the `1024` in `epoll_create(1024)` does not mean "at most 1024 connections can be listened to" on modern Linux. It also does not limit the number of events returned by one `epoll_wait` call. It is only a historical compatibility argument that must be positive.

Modern code more commonly uses:

```c
int epoll_create1(int flags);
```

When `flags` is 0, `epoll_create1()` is equivalent to `epoll_create()` except for the obsolete `size` argument. `flags` can contain `EPOLL_CLOEXEC`, which sets the close-on-exec flag on the new file descriptor. ([man7.org][3])

### 3.2 epoll_ctl

The function prototype is:

```c
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event);
```

This system call adds, modifies, or deletes entries in the interest list of the epoll instance referred to by `epfd`. `op` specifies the operation type, `fd` is the target file descriptor, and `event` describes the event configuration associated with that target file descriptor. ([man7.org][4])

Parameter meanings:

| Parameter | Meaning |
| --- | --- |
| `epfd` | The epoll file descriptor returned by `epoll_create` or `epoll_create1`, representing one epoll instance |
| `op` | Operation type: `EPOLL_CTL_ADD`, `EPOLL_CTL_MOD`, or `EPOLL_CTL_DEL` |
| `fd` | The target file descriptor whose monitoring relationship should be added, modified, or deleted, usually a socket fd |
| `event` | Pointer to `struct epoll_event`, describing monitored events and user data |

The three main `op` values are:

| `op` | Official semantics |
| --- | --- |
| `EPOLL_CTL_ADD` | Add `fd` to the interest list of `epfd`; the entry includes `fd`, a reference to the corresponding open file description, and the settings specified in `event` |
| `EPOLL_CTL_MOD` | Modify the event settings associated with `fd` in the interest list |
| `EPOLL_CTL_DEL` | Remove the target `fd` from the interest list; `event` is ignored and can be `NULL` |

A typical `struct epoll_event` is:

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

`events` is the event mask, representing the I/O events of interest. `data` is user data. The kernel stores it and returns it unchanged through `epoll_wait` when the corresponding file descriptor becomes ready. ([man7.org][4])

### 3.3 epoll_wait

The function prototype is:

```c
int epoll_wait(int epfd, struct epoll_event *events, int maxevents, int timeout);
```

This system call waits for I/O events on the epoll instance referred to by `epfd`. `events` points to a user-space array. The kernel writes available events into the array. At most `maxevents` events are returned, and `maxevents` must be greater than 0. ([man7.org][5])

Parameter meanings:

| Parameter | Meaning |
| --- | --- |
| `epfd` | File descriptor of the epoll instance |
| `events` | User-allocated `struct epoll_event` array for receiving ready events |
| `maxevents` | Maximum number of events to return in this call; must be greater than 0 and should not exceed the array capacity |
| `timeout` | Wait timeout in milliseconds |

`timeout` semantics:

| `timeout` value | Behavior |
| --- | --- |
| `-1` | Block indefinitely until an event arrives or the call is interrupted by a signal |
| `0` | Return immediately even if no event is available |
| `> 0` | Block for at most the specified milliseconds; time is measured against `CLOCK_MONOTONIC`, and actual blocking may slightly exceed the value due to clock granularity and scheduling delay |

For every `epoll_event` returned by `epoll_wait`, the `data` field is the data most recently set for that file descriptor by `epoll_ctl(EPOLL_CTL_ADD)` or `epoll_ctl(EPOLL_CTL_MOD)`, and the `events` field represents the actual event mask that occurred on the open file description. ([man7.org][5])

## 4. Differences between select, poll, and epoll

`select`, `poll`, and `epoll` are all I/O multiplexing interfaces, but they differ structurally in how they represent file descriptors, how they scale, and how they return ready events.

| Dimension | select | poll | epoll |
| --- | --- | --- | --- |
| Monitored object representation | `fd_set` bitmap | `struct pollfd` array | interest list inside an epoll instance |
| fd count limit | Limited by `FD_SETSIZE`; Linux man-pages state this is usually 1024 and will not change | Does not depend on `FD_SETSIZE`; `nfds` indicates array item count | Registered into a kernel-maintained interest list through `epoll_ctl` |
| Ready result | Modifies the input fd sets | Modifies `pollfd.revents` | `epoll_wait` returns ready events from the ready list |
| Registration style | Full set passed on every call | Full array passed on every call | Incremental add/modify/delete through `epoll_ctl` |
| Trigger mode | level-like | level-like | Supports LT and ET |
| Official usage hint | man-pages explicitly warn modern applications should use `poll` or `epoll` instead of `select` | man-pages state `poll` is similar to `select`, while `epoll` provides features beyond `poll` | man-pages state it is suitable for many monitored fds |

Linux man-pages give a clear warning for `select`: `select()` can monitor only file descriptor numbers less than `FD_SETSIZE`; this limit is usually 1024, is too low for modern applications, and will not change. Modern applications should use `poll` or `epoll` instead. ([man7.org][6]) `poll()` is similar to `select()` and waits for any file descriptor in a set to become ready for I/O, but it represents the monitored set with a `struct pollfd` array. ([man7.org][7]) `epoll` stores the interest list and ready list inside a kernel epoll instance, avoiding the need to pass the complete monitored set on every call. ([man7.org][1])

## 5. Java and Netty: Event-Driven Models Based on NIO/epoll

Java standard NIO provides abstractions such as `Selector`, `SelectableChannel`, and `SelectionKey`. On Linux, OpenJDK has platform-specific implementations such as `EPollSelectorImpl` and `EPoll`; the `EPoll` class is used to access the Linux epoll facility. ([GitHub][8])

Netty is an asynchronous event-driven network application framework. Its official README describes it as an asynchronous event-driven network application framework for rapid development of maintainable high-performance protocol servers and clients. ([GitHub][9]) Netty's thread model is usually composed of a boss group and a worker group: the boss accepts connections, while workers handle I/O traffic for accepted connections. The exact thread count and how threads map to Channels depend on the `EventLoopGroup` implementation and configuration. ([netty.io][10])

In Netty, an `EventLoop` is responsible for handling all I/O operations for the `Channel`s registered to it. One `EventLoop` usually handles multiple `Channel`s. ([netty.io][11]) This means Netty is not a BIO model with one thread per connection. It is an event-loop model in which a small number of EventLoop threads multiplex many Channels.

On Linux, Netty also provides a native epoll transport. Official documentation states that Netty provides platform-specific JNI transports. The Linux native transport has been available since 4.0.16. Compared with the NIO transport, these native transports can provide platform-specific features, generate less garbage, and usually improve performance. When using the Linux native transport, the official documentation shows replacements such as `NioEventLoopGroup` to `EpollEventLoopGroup`, `NioServerSocketChannel` to `EpollServerSocketChannel`, and `NioSocketChannel` to `EpollSocketChannel`. ([netty.io][12])

Therefore, the reason Netty makes NIO faster is not merely that it "calls epoll." It combines several objective mechanisms:

1. Multiple Channels are bound to a small number of EventLoops, reducing thread count.
2. One EventLoop serially handles I/O events on the same Channel, reducing lock contention.
3. Boss/worker separation separates connection acceptance from connection read/write processing.
4. Linux native epoll transport avoids some JDK NIO abstraction overhead and uses platform capabilities.
5. Netty provides ByteBuf, pipeline, handler, batch flush, event task queue, and other abstractions that reduce the complexity of directly using JDK NIO.

## 6. Go's epoll Implementation

The Go runtime has an integrated network poller on Unix platforms. The comment in the official source `runtime/netpoll.go` says the platform-independent part is supported by concrete implementations that provide `netpollinit`, `netpollopen`, `netpollclose`, `netpoll`, and related functions. The concrete implementation can be epoll, kqueue, port, AIX, or Windows. ([Go][13])

On Linux, Go's `runtime/netpoll_epoll.go` uses `EpollCreate1(EPOLL_CLOEXEC)` to create an epoll fd and creates an `eventfd` for `netpollBreak` wakeup. The source defines `epfd` as the epoll descriptor and `netpollEventFd` as the wakeup eventfd. ([Go][14])

Go's network I/O model does not require developers to call epoll directly. Developers use goroutines and standard-library network APIs, while the runtime registers network fds with the platform network poller underneath. When an fd becomes ready, the runtime marks the goroutine waiting on that I/O as runnable. The `netpoll` comment says it returns a goroutine list for ready network connections and uses the `delay` argument to decide whether to perform nonblocking polling, timed blocking, or indefinite blocking. ([GitHub][15])

Go can therefore be summarized this way: the language layer exposes blocking-style synchronous APIs, while the runtime internally uses nonblocking fds, epoll, and goroutine scheduling to convert I/O waits from OS-thread blocking into goroutine suspension and resumption.

## 7. Redis and Nginx Event Models

Redis source code contains the `ae.c` event library and different platform event multiplexing implementations. `ae_epoll.c` is the Linux epoll backend. The Redis event library abstracts file events and time events. On Linux, it can use the epoll backend to monitor file events such as client connections, command reads/writes, and replication connections. The comment in Redis's official `ae.c` describes it as a simple event-driven programming library. ([GitHub][16]) Redis's epoll backend source is in the official repository at `src/ae_epoll.c`. ([GitHub][17])

Nginx official documentation states that Nginx supports several connection processing methods, and availability depends on the platform. When a platform supports multiple methods, Nginx usually automatically selects the most efficient method, but the `use` directive can also explicitly select one. The listed connection processing methods include `select`, `poll`, `kqueue`, `epoll`, `/dev/poll`, and `eventport`; `epoll` is an efficient method on Linux 2.6+. ([Nginx][18])

The common point between Redis and Nginx is that both manage many connections through an event loop and use epoll as the high-concurrency connection event notification mechanism on Linux. The difference is that Redis organizes command processing around its own ae event library, while Nginx organizes network events around worker processes, event modules, and connection processing methods.

## 8. The Relationship between Netty and JDK 21 Virtual Threads

In JDK 21, `Executors.newVirtualThreadPerTaskExecutor()` creates an Executor that starts a new virtual thread for each task, and the number of threads created by that Executor is unbounded. ([Oracle Documentation][19]) OpenJDK JEP 444 explicitly states that virtual threads are not faster threads and do not make code execute faster than platform threads. They provide scale, namely higher throughput, not lower latency. Virtual threads are suitable for many concurrent tasks when the tasks are not CPU-bound, especially server tasks that spend much of their time waiting. ([OpenJDK][20])

JEP 444 also clearly says: do not pool virtual threads. Thread pools are used to share expensive resources, but virtual threads are not expensive. If the purpose is to limit concurrent access to finite resources, use a dedicated mechanism such as a semaphore rather than pooling virtual threads. ([OpenJDK][20])

Putting these official facts into Netty leads to the following objective conclusions:

1. Netty's core I/O model is already an EventLoop multiplexing model. One EventLoop usually handles I/O for multiple Channels. ([netty.io][11])
2. Netty native epoll transport performance improvements come from platform-native transport, not from virtual threads. ([netty.io][12])
3. The official semantics of `Executors.newVirtualThreadPerTaskExecutor()` are one virtual thread per task and an unbounded number of threads. ([Oracle Documentation][19])
4. Virtual threads do not speed up CPU-bound handlers and do not make `epoll_wait` or socket read/write faster. ([OpenJDK][20])

Therefore, "directly using `Executors.newVirtualThreadPerTaskExecutor()` inside a `ChannelHandler`" should not be described as a general performance optimization officially recommended by Netty. A more accurate statement is: if a `ChannelHandler` contains blocking external calls, such as blocking JDBC, blocking HTTP client calls, or blocking file I/O, virtual threads can be used as one way to move blocking business logic out of the EventLoop. But they are not the default way to improve the performance of Netty's I/O thread model, and they cannot replace EventLoop/epoll. For CPU-intensive processing, JEP 444 clearly states that having more threads than processor cores cannot improve throughput. ([OpenJDK][20])

The engineering boundary that better fits Netty's thread model is: EventLoop threads should handle only short, nonblocking logic related to the I/O state machine; slow or blocking logic should be separated from the EventLoop. After separation, whether to use a platform thread pool, a dedicated business thread pool, `DefaultEventExecutorGroup`, or virtual threads depends on the blocking type, resource limits, context propagation, backpressure, and observability. It should not be concluded that "virtual threads necessarily improve Netty performance."

## 9. Conclusion

epoll is one of the core mechanisms of the Linux NIO network model. It uses an epoll instance to maintain an interest list and ready list in the kernel, allowing applications to manage many file descriptors through event notifications. `epoll_create` creates the instance, `epoll_ctl` manages the monitored set, and `epoll_wait` obtains ready events. Compared with `select` and `poll`, the key difference is that `epoll` maintains the monitored set in a kernel object and supports ready lists and LT/ET trigger modes.

Java Netty, the Go runtime, Redis, and Nginx all demonstrate event-driven network models, but at different abstraction levels. Netty hides lower-level multiplexing behind EventLoopGroup, Channel, and Pipeline. Go combines epoll with goroutine scheduling through runtime netpoll. Redis wraps file events through the ae event library. Nginx organizes connection processing through event modules and a worker process model.

JDK 21 virtual threads solve the thread-capacity cost of many blocking tasks. They are not a replacement for epoll or Netty EventLoop. For Netty, virtual threads can be used as an execution carrier for blocking business logic, but they should not be summarized as a general official recommendation for improving performance inside `ChannelHandler`.

[1]: https://man7.org/linux/man-pages/man7/epoll.7.html "epoll(7) - Linux manual page"
[2]: https://stllug.sluug.org/meeting_notes/2001/0719/dankegel_c10k.html?utm_source=chatgpt.com "The C10K problem"
[3]: https://man7.org/linux/man-pages/man2/epoll_create.2.html "epoll_create(2) - Linux manual page"
[4]: https://man7.org/linux/man-pages/man2/epoll_ctl.2.html?utm_source=chatgpt.com "epoll_ctl(2) - Linux manual page"
[5]: https://man7.org/linux/man-pages/man2/epoll_wait.2.html?utm_source=chatgpt.com "epoll_wait(2) - Linux manual page"
[6]: https://man7.org/linux/man-pages/man2/select.2.html "select(2) - Linux manual page"
[7]: https://man7.org/linux/man-pages/man2/poll.2.html "poll(2) - Linux manual page"
[8]: https://github.com/AdoptOpenJDK/openjdk-jdk11/blob/master/src/java.base/linux/classes/sun/nio/ch/EPoll.java?utm_source=chatgpt.com "openjdk-jdk11/src/java.base/linux/classes/sun/nio/ch/EPoll"
[9]: https://github.com/netty/netty "GitHub - netty/netty: Netty project - an event-driven asynchronous network application framework"
[10]: https://netty.io/wiki/user-guide-for-4.x.html?utm_source=chatgpt.com "User guide for 4.x"
[11]: https://netty.io/4.1/api/io/netty/channel/EventLoop.html?utm_source=chatgpt.com "EventLoop (Netty API Reference (4.1.133.Final))"
[12]: https://netty.io/wiki/native-transports.html "Netty.docs: Native transports"
[13]: https://go.dev/src/runtime/netpoll.go "The Go Programming Language"
[14]: https://go.dev/src/runtime/netpoll_epoll.go "The Go Programming Language"
[15]: https://github.com/golang/go/blob/master/src/runtime/netpoll_epoll.go?utm_source=chatgpt.com "go/src/runtime/netpoll_epoll.go at master"
[16]: https://github.com/redis/redis/blob/unstable/src/ae.c?utm_source=chatgpt.com "redis/src/ae.c at unstable"
[17]: https://github.com/redis/redis/blob/unstable/src/ae_epoll.c?utm_source=chatgpt.com "redis/src/ae_epoll.c at unstable"
[18]: https://nginx.org/en/docs/events.html "Connection processing methods"
[19]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Executors.html "Executors (Java SE 21 & JDK 21)"
[20]: https://openjdk.org/jeps/444 "JEP 444: Virtual Threads"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/nio_epoll)
