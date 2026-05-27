---
title: "Linux 进程间通信机制及 mmap 用户态调用路径研究"
category: "操作系统"
summary: "系统梳理 Linux IPC 机制，包括信号、管道、FIFO、UNIX Domain Socket、消息队列、共享内存、mmap、futex、eventfd、epoll，以及 mmap 在多语言用户态到内核系统调用的路径。"
tags:
  - "Linux"
  - "IPC"
  - "mmap"
  - "共享内存"
  - "系统调用"
readingDirection: "适合在学习 Linux 进程间通信、共享内存、mmap 调用链、事件循环或跨语言本机通信方案选型时阅读。"
outline: deep
---

# Linux 进程间通信机制及 mmap 用户态调用路径研究

## 概览

系统梳理 Linux IPC 机制，包括信号、管道、FIFO、UNIX Domain Socket、消息队列、共享内存、mmap、futex、eventfd、epoll，以及 mmap 在多语言用户态到内核系统调用的路径。

## 摘要

Linux 进程间通信（Inter-Process Communication, IPC）不是单一接口，而是一组由内核对象、文件描述符、虚拟内存映射、信号投递、队列、套接字、同步原语共同构成的通信机制。本文围绕 Linux 用户态可直接接触到的主要 IPC 方式展开，包括信号、管道、FIFO、UNIX Domain Socket、TCP/UDP loopback、POSIX/System V 消息队列、POSIX/System V 共享内存、`mmap` 文件映射、`memfd_create`、POSIX/System V 信号量、`futex`、`eventfd`、`signalfd`、`epoll`、文件锁、`ptrace`、`process_vm_readv/writev`、Netlink、D-Bus 等机制。文章重点分析这些机制的定义、实现路径、特征与限制、典型使用场景，并进一步拆解 `mmap` 从 Java、Go、Python、Rust、C/C++ 等用户态语言到 Linux 内核系统调用的链路。

关键词：Linux；IPC；mmap；共享内存；信号；管道；UNIX Domain Socket；futex；eventfd；epoll；系统调用

---

## 1. 引言

Linux IPC 的核心事实是：用户进程不能直接修改另一个进程的私有地址空间，跨进程通信通常需要借助内核维护的共享对象、文件描述符、内核缓冲区、共享页映射、信号投递或受控调试/内存访问接口。Linux manual pages 将 System V IPC 定义为三类机制：消息队列、信号量、共享内存；同时，Linux 还提供 POSIX IPC、管道、FIFO、套接字、信号、`mmap`、`eventfd`、`signalfd`、`futex` 等机制。([Man7][1])

本文不把 IPC 限定为传统 System V IPC，而采用“两个或多个执行上下文通过内核可见机制交换数据、事件、引用或同步状态”的口径。因此，`epoll` 本身不是数据传输 IPC，但它是大量 IPC 文件描述符的事件分发基础；`futex` 本身不是消息通道，但它是共享内存同步的重要内核接口；`mmap` 既可用于文件 I/O，也可在 `MAP_SHARED`、POSIX shared memory、System V shared memory、`memfd_create` 等场景中成为 IPC 的数据面。

---

## 2. Linux IPC 机制分类

### 2.1 信号：异步事件通知机制

Linux 支持 POSIX 标准信号和实时信号。信号的核心语义是向进程或线程投递异步事件，接收方根据当前 signal disposition 执行默认动作、忽略或进入用户态 signal handler。内核在进入 handler 前会保存被中断线程的上下文，在用户栈上构造 signal frame，设置程序计数器到 handler，handler 返回后通过 `sigreturn` 恢复原执行状态。([Man7][2])

信号的实现入口包括 `kill(2)`、`tgkill(2)`、`pthread_kill(3)`、`sigqueue(3)`、终端驱动、异常、定时器、子进程状态变化等。标准信号不排队；同一标准信号在阻塞期间多次到达时，通常只保留一个 pending 实例。实时信号支持排队，并可携带附加值。([Man7][2])

**特征与限制：**

| 项目    | 客观特征                                              |
| ----- | ------------------------------------------------- |
| 数据能力  | 标准信号主要传递事件编号；`sigqueue` 可带一个整数或指针大小的值             |
| 同步/异步 | 异步投递，handler 在被中断线程上下文执行                          |
| 可组合性  | 传统 handler 与事件循环结合困难；`signalfd` 可把信号转为 fd 事件      |
| 限制    | handler 中只能安全调用 async-signal-safe 函数；标准信号不保证多实例排队 |

**典型场景：**

信号常用于进程生命周期控制，如 `SIGTERM` 优雅退出、`SIGKILL` 强制终止、`SIGHUP` 配置重载、`SIGCHLD` 子进程回收、`SIGINT` 终端中断、`SIGPIPE` 管道读端关闭后的写入错误通知。

`signalfd` 提供另一种接收信号方式：它创建一个文件描述符用于接收目标信号，并且该 fd 可被 `select`、`poll`、`epoll` 监控，因此更适合事件循环模型。([Man7][3])

---

### 2.2 匿名管道 pipe：亲缘进程字节流通道

`pipe(2)` 创建一个单向数据通道，返回两个文件描述符：读端和写端。写入写端的数据由内核缓冲，直到从读端读取。`pipe(7)` 明确说明，管道与 FIFO 提供单向 IPC 通道，通信内容是字节流，没有消息边界。([Man7][4])

**实现方式：**

典型 shell 管道 `cmd1 | cmd2` 的过程是：

1. shell 调用 `pipe2()` 创建管道；
2. shell 调用 `fork()` 创建两个子进程；
3. 子进程 A 将 `stdout` 通过 `dup2()` 指向管道写端；
4. 子进程 B 将 `stdin` 通过 `dup2()` 指向管道读端；
5. 两个子进程分别 `execve()`；
6. `cmd1` 的 `write(1, ...)` 进入管道缓冲区；
7. `cmd2` 的 `read(0, ...)` 从管道缓冲区取出数据。

**特征与限制：**

| 项目   | 客观特征                             |
| ---- | -------------------------------- |
| 数据模型 | 字节流，无消息边界                        |
| 方向   | 单向；双向通信通常需要两个 pipe 或 socketpair  |
| 关联关系 | 常用于父子进程或共同祖先进程                   |
| 阻塞行为 | 空管道读阻塞，满管道写阻塞；可设非阻塞              |
| 错误行为 | 所有读端关闭后写入会触发 `SIGPIPE` 或 `EPIPE` |

**典型场景：**

shell pipeline、`ProcessBuilder`/`exec.Cmd` 捕获子进程 stdout/stderr、守护进程与 worker 的轻量数据流、父子进程间传递日志或小块数据。

---

### 2.3 FIFO：具名管道

FIFO 又称 named pipe，与匿名管道语义相近，但它以文件系统路径作为名字。`fifo(7)` 说明 FIFO special file 与 pipe 类似，但通过文件系统访问；数据交换时内核在内部传递数据，不写入文件系统内容，路径只作为访问引用点。([Man7][5])

**实现方式：**

1. `mkfifo("/tmp/x", mode)` 创建 FIFO 节点；
2. 进程 A `open("/tmp/x", O_WRONLY)`；
3. 进程 B `open("/tmp/x", O_RDONLY)`；
4. A 调用 `write()`，B 调用 `read()`；
5. 实际数据仍在内核管道对象中流动。

**特征与限制：**

| 项目   | 客观特征                      |
| ---- | ------------------------- |
| 命名方式 | 文件系统路径                    |
| 进程关系 | 无需父子关系                    |
| 数据模型 | 字节流，无消息边界                 |
| 生命周期 | 路径节点存在于文件系统；打开后的管道对象由内核维护 |
| 限制   | 单向；打开行为受读写端是否存在影响；不适合复杂协议 |

**典型场景：**

命令行工具间通信、简单本机 daemon 控制入口、脚本化数据传递、兼容传统 UNIX 工具链。

---

### 2.4 UNIX Domain Socket：本机进程套接字通信

UNIX Domain Socket 使用 `AF_UNIX`/`AF_LOCAL` 地址族，在同一台机器上的进程间通信。`unix(7)` 说明该机制用于本机进程间高效通信，支持 pathname socket、unnamed socket、Linux abstract namespace；支持 `SOCK_STREAM`、`SOCK_DGRAM`、`SOCK_SEQPACKET`，并可通过 ancillary data 传递文件描述符和进程凭据。([Man7][6])

**实现方式：**

服务端通常执行：

```text
socket(AF_UNIX, SOCK_STREAM, 0)
bind(pathname 或 abstract address)
listen()
accept()
read()/write() 或 recvmsg()/sendmsg()
```

客户端执行：

```text
socket(AF_UNIX, SOCK_STREAM, 0)
connect()
read()/write() 或 recvmsg()/sendmsg()
```

**特征与限制：**

| 项目   | 客观特征                                          |
| ---- | --------------------------------------------- |
| 数据模型 | stream、datagram、seqpacket                     |
| 命名方式 | 文件系统路径、匿名 socketpair、Linux abstract namespace |
| 能力传递 | 支持 `SCM_RIGHTS` 传递文件描述符，支持凭据传递                |
| 可组合性 | fd 模型，可接入 `epoll`                             |
| 限制   | 仅本机；pathname socket 受路径长度与文件权限影响              |

**典型场景：**

Docker/containerd 本地 API、systemd notify/socket activation、数据库本地连接、Envoy/Nginx 与本机 sidecar 通信、D-Bus 底层传输、本地 RPC、父子进程双向通信 `socketpair()`。

---

### 2.5 TCP/UDP loopback socket：基于网络栈的本机 IPC

当客户端连接 `127.0.0.1` 或 `::1` 时，通信仍经过 Linux 网络协议栈，但不离开本机。它不属于传统“同机专用 IPC”，但在工程实践中经常作为本机进程通信方式。

**实现方式：**

```text
socket(AF_INET/AF_INET6, SOCK_STREAM/SOCK_DGRAM, 0)
bind()
listen()/connect()
send()/recv()
```

**特征与限制：**

| 项目    | 客观特征                                      |
| ----- | ----------------------------------------- |
| 跨机器能力 | 可从 loopback 扩展到网络通信                       |
| 协议生态  | HTTP/gRPC/Redis/MySQL 等协议天然可用             |
| 开销    | 经过网络协议栈，比共享内存和 UDS 多协议处理                  |
| 隔离    | 可配合 firewall、network namespace、cgroup、TLS |

**典型场景：**

本机微服务调用、sidecar 代理、agent 与应用通信、HTTP 管理端口、跨语言 RPC。

---

### 2.6 POSIX 消息队列

POSIX message queue 允许进程以消息为单位交换数据，每条消息带优先级。`mq_overview(7)` 说明，队列通过 `mq_open()` 创建或打开，通过同一名称让两个进程操作同一队列；消息通过 `mq_send()`、`mq_receive()` 传递，并按优先级从高到低交付。Linux 中 POSIX message queue 从 Linux 2.6.6 起支持，glibc 从 2.3.4 起提供支持。([Man7][7])

**实现方式：**

```text
mq_open("/name", O_CREAT | O_RDWR, mode, attr)
mq_send()
mq_receive()
mq_notify()
mq_close()
mq_unlink()
```

Linux 的 `mq_*()` 库接口多数映射到底层同名或相近系统调用，例如 `mq_send(3)` 对应 `mq_timedsend(2)`，`mq_receive(3)` 对应 `mq_timedreceive(2)`。([Man7][7])

**特征与限制：**

| 项目   | 客观特征                                   |
| ---- | -------------------------------------- |
| 数据模型 | 有消息边界                                  |
| 排序   | 按消息优先级交付                               |
| 命名方式 | `/somename`                            |
| 持久性  | 未 `mq_unlink()` 时具有内核持久性，直到系统关闭        |
| 限制   | 受 `/proc/sys/fs/mqueue/*` 限制；消息大小与数量有限 |

**典型场景：**

实时系统、小型控制消息、优先级事件、无需引入 broker 的本机消息交换。

---

### 2.7 System V 消息队列

System V IPC 包括消息队列、信号量和共享内存。System V 消息队列允许以消息为单位交换数据，每条消息有类型字段。`sysvipc(7)` 将 System V message queue 列为 System V IPC 三大机制之一。([Man7][1])

**实现方式：**

```text
msgget(key, IPC_CREAT | mode)
msgsnd(msqid, msgp, size, flags)
msgrcv(msqid, msgp, size, type, flags)
msgctl(msqid, IPC_RMID, ...)
```

**特征与限制：**

| 项目   | 客观特征                                               |
| ---- | -------------------------------------------------- |
| 数据模型 | 有消息边界                                              |
| 命名方式 | `key_t` + kernel IPC id                            |
| 生命周期 | 显式 `IPC_RMID` 删除；否则对象可在进程退出后继续存在                   |
| 限制   | API 较旧；与 fd/epoll 事件循环组合不如 POSIX MQ、pipe、socket 自然 |

**典型场景：**

历史 UNIX 程序、遗留 C/C++ 系统、需要兼容 System V IPC 的服务。

---

### 2.8 POSIX 共享内存 + mmap

`shm_open()` 创建或打开 POSIX shared memory object。官方文档说明，POSIX shared memory object 本质上是一个 handle，可被无亲缘关系进程用 `mmap(2)` 映射到同一片共享内存区域。新对象初始长度为 0，通常需要 `ftruncate()` 设置大小。([Man7][8])

**实现方式：**

```text
fd = shm_open("/name", O_CREAT | O_RDWR, mode)
ftruncate(fd, size)
addr = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0)
```

另一个进程使用同名 `shm_open()` 和同样的 `mmap()` 即可映射同一对象。

**特征与限制：**

| 项目   | 客观特征                                             |
| ---- | ------------------------------------------------ |
| 数据模型 | 共享字节区域，无内置消息格式                                   |
| 性能结构 | 数据读写在映射后主要是普通内存访问                                |
| 同步要求 | 需要额外同步机制，如 semaphore、pthread mutex、futex、eventfd |
| 生命周期 | 名称由 `shm_unlink()` 删除；映射由 `munmap()` 解除          |
| 限制   | 需自行设计内存布局、一致性、并发控制和崩溃恢复                          |

**典型场景：**

高吞吐低延迟数据共享、同机多进程 ring buffer、图像/音视频帧共享、数据库/缓存引擎、跨语言共享内存通道。

---

### 2.9 System V 共享内存

System V shared memory 通过 `shmget()` 获取或创建共享内存段，通过 `shmat()` 附加到进程地址空间，通过 `shmdt()` 分离，通过 `shmctl()` 控制和删除。`shmget(2)` 返回与 key 关联的 System V shared memory segment 标识符；`shmat(2)` 将该 segment 附加到调用进程地址空间。([Man7][9])

**实现方式：**

```text
shmid = shmget(key, size, IPC_CREAT | mode)
addr = shmat(shmid, NULL, 0)
shmdt(addr)
shmctl(shmid, IPC_RMID, NULL)
```

**特征与限制：**

| 项目   | 客观特征                        |
| ---- | --------------------------- |
| 数据模型 | 共享内存段                       |
| 命名方式 | `key_t`                     |
| 生命周期 | 可独立于进程存在，需显式删除              |
| 同步要求 | 需配合 semaphore/futex/mutex 等 |
| 限制   | API 较旧；对象管理与权限模型不同于 fd 模型   |

**典型场景：**

遗留 UNIX 程序、高性能 C/C++ 本机共享数据、数据库与工业控制系统中的传统实现。

---

### 2.10 mmap 文件映射

`mmap(2)` 在调用进程虚拟地址空间中创建新映射。文件映射的内容由文件描述符 `fd` 指向对象的指定偏移初始化；`MAP_SHARED` 允许修改对其他映射同一区域的进程可见，并可回写到底层文件；`MAP_PRIVATE` 使用 copy-on-write。`mmap()` 返回后，文件描述符可关闭而不使映射失效。([Man7][10])

**实现方式：**

```text
fd = open(path, O_RDWR)
addr = mmap(NULL, length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, offset)
```

**作为 IPC 的条件：**

`mmap` 只有在多个进程映射同一底层对象且使用共享语义时才构成 IPC 数据面。例如：

| 底层对象                               | IPC 形态      |
| ---------------------------------- | ----------- |
| 普通文件 + `MAP_SHARED`                | 多进程共享文件页缓存  |
| POSIX shm object + `MAP_SHARED`    | 共享内存        |
| `memfd_create()` fd + `MAP_SHARED` | 匿名 RAM 文件共享 |
| System V shm + `shmat()`           | 共享内存段       |
| tmpfs 文件 + `MAP_SHARED`            | 内存文件共享      |

访问映射区域可能产生信号：写只读映射可能触发 `SIGSEGV`，访问超出文件末尾的映射页可能触发 `SIGBUS`。([Man7][11])

---

### 2.11 memfd_create：匿名内存文件

`memfd_create()` 创建匿名文件并返回 fd。官方文档说明，该文件像普通文件一样可修改、截断、内存映射；不同点是它位于 RAM 中，具有易失性 backing storage，所有引用消失后自动释放。([Man7][12])

**实现方式：**

```text
fd = memfd_create("name", flags)
ftruncate(fd, size)
addr = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0)
```

**特征与限制：**

| 项目   | 客观特征                                      |
| ---- | ----------------------------------------- |
| 命名方式 | 无全局路径；名称主要用于 `/proc/self/fd` 调试显示         |
| 传递方式 | 通常通过 UNIX Domain Socket `SCM_RIGHTS` 传 fd |
| 存储   | RAM，易失                                    |
| 扩展能力 | 可配合 file sealing 限制后续修改                   |
| 场景   | Wayland、沙箱、浏览器、多进程共享 buffer、零拷贝数据传递       |

---

### 2.12 POSIX 信号量

POSIX semaphore 用于进程或线程同步。`sem_overview(7)` 定义 semaphore 是不会低于 0 的整数，`sem_post()` 增加值，`sem_wait()` 减少值；当值为 0 时，`sem_wait()` 阻塞。POSIX semaphore 分为 named semaphore 和 unnamed semaphore；进程共享 unnamed semaphore 必须放在共享内存区域，例如 System V shared memory 或 POSIX shared memory object。([Man7][13])

**实现方式：**

named semaphore：

```text
sem_open("/name", O_CREAT, mode, value)
sem_wait()
sem_post()
sem_close()
sem_unlink()
```

unnamed process-shared semaphore：

```text
addr = mmap(... MAP_SHARED ...)
sem_init(addr, pshared = 1, value)
sem_wait(addr)
sem_post(addr)
```

**特征与限制：**

| 项目   | 客观特征                     |
| ---- | ------------------------ |
| 类型   | 同步原语，不是数据通道              |
| 共享方式 | named 通过名称；unnamed 需共享内存 |
| 阻塞   | `sem_wait()` 可阻塞         |
| 场景   | 生产者消费者、共享内存读写同步、进程级限流    |

---

### 2.13 System V 信号量

System V semaphore 是 System V IPC 的同步机制，通常通过 `semget()` 创建 semaphore set，通过 `semop()` 执行一个或多个原子操作，通过 `semctl()` 控制。`sysvipc(7)` 将 semaphore 列为 System V IPC 三大机制之一。([Man7][1])

**特征与限制：**

| 项目   | 客观特征                      |
| ---- | ------------------------- |
| 类型   | 同步机制                      |
| 对象   | semaphore set             |
| 生命周期 | 内核对象，需显式删除                |
| 场景   | 遗留 UNIX 程序、多进程资源计数、共享内存同步 |

---

### 2.14 futex：用户态优先的阻塞同步原语

`futex(2)` 提供等待某条件成立的方法，常用于共享内存同步。官方文档说明，大多数同步操作在用户态完成，程序只有在可能需要长期阻塞时才使用 `futex()` 系统调用；进程间共享 futex 时，futex word 必须放在共享内存区域中，例如 `mmap()` 或 `shmat()` 创建的区域。([Man7][14])

**实现方式：**

典型互斥锁路径：

```text
用户态 atomic compare-and-swap 成功 -> 不进内核
用户态 CAS 失败且需要等待 -> futex(FUTEX_WAIT)
解锁时发现等待者 -> futex(FUTEX_WAKE)
```

**特征与限制：**

| 项目   | 客观特征                                                          |
| ---- | ------------------------------------------------------------- |
| 数据大小 | futex word 是 32-bit 值                                         |
| 性能结构 | 无竞争时纯用户态；竞争阻塞时进入内核                                            |
| 共享条件 | 跨进程时必须位于共享内存                                                  |
| 场景   | pthread mutex、condition variable、Go runtime、JVM runtime、共享内存锁 |

---

### 2.15 eventfd：事件计数 fd

`eventfd(2)` 创建一个事件通知文件描述符，内部维护 64-bit counter。官方文档说明，应用可用 eventfd 替代只用于事件通知的 pipe；eventfd 的内核开销低于 pipe，且只需要一个 fd；它可被 `select`、`poll`、`epoll` 监控。([Man7][15])

**实现方式：**

```text
efd = eventfd(initval, EFD_NONBLOCK | EFD_CLOEXEC)
write(efd, uint64)
read(efd, &uint64)
epoll_ctl(epfd, EPOLL_CTL_ADD, efd, ...)
```

**典型场景：**

线程/进程事件唤醒、共享内存 ring buffer 的 doorbell、io_uring/AIO 完成通知、虚拟化设备通知、event loop 唤醒。

---

### 2.16 epoll：IPC fd 的事件分发基础

`epoll` 监控多个 fd 是否 ready。官方文档说明，epoll instance 是内核数据结构，从用户态看包含 interest list 和 ready list；`epoll_create` 创建实例，`epoll_ctl` 注册 fd，`epoll_wait` 等待事件。([Man7][16])

`epoll` 不是独立数据传输 IPC，但它是 pipe、FIFO、socket、eventfd、signalfd、timerfd 等 fd 型 IPC 的统一事件分发机制。事件驱动网络服务、Go netpoller、Java Netty epoll transport、Rust Tokio mio/epoll 等均依赖这一类机制。

---

### 2.17 文件锁与文件系统作为 IPC

文件系统可作为最低层次 IPC：一个进程写文件，另一个进程读文件；多个进程通过 `flock()`、`fcntl()` record lock 或 lock file 协调访问。`mmap(MAP_SHARED)` 普通文件也是该类别的一种高效形式。

**特征与限制：**

| 项目    | 客观特征                                  |
| ----- | ------------------------------------- |
| 数据持久性 | 可持久化到磁盘                               |
| 进程关系  | 无需父子关系                                |
| 性能    | 受文件系统、page cache、fsync 策略影响           |
| 场景    | 配置热加载、pidfile、lockfile、SQLite、日志/状态交换 |

---

### 2.18 ptrace 与 process_vm_readv/writev

`ptrace` 用于一个进程观察和控制另一个进程，典型场景是调试器、strace、gdb。`process_vm_readv()` 和 `process_vm_writev()` 允许一个进程直接读写另一个进程地址空间中的数据，受权限检查约束。这类接口更接近受控调试/观测/注入机制，不是普通业务通信首选通道。

**典型场景：**

调试器、性能分析器、崩溃诊断、进程内存采样、容器运行时或安全工具。

---

### 2.19 Netlink

Netlink 是用户态与内核态通信的 socket 机制，也可用于用户态进程间通信。典型协议族包括路由、网络设备、连接跟踪、audit、uevent 等。它常用于系统管理，而不是普通业务进程间数据传输。

**典型场景：**

`iproute2` 与内核网络栈交互、udev 监听内核设备事件、容器网络配置、audit 日志。

---

### 2.20 D-Bus、Binder、io_uring、pidfd 等扩展机制

D-Bus 是用户态消息总线，底层常依赖 UNIX Domain Socket；它是桌面 Linux 和 system service 常用 IPC。Android Binder 是 Android 生态核心 IPC，主线 Linux 也包含 binder 驱动。`io_uring` 主要是异步 I/O 接口，但 ring、eventfd、shared memory 结构使其与 IPC 事件通知相关。`pidfd` 主要用于进程引用和生命周期管理，可配合 `poll/epoll` 等机制观察进程退出。

这些机制在严格意义上不都属于传统 IPC 数据通道，但在 Linux 现代系统中经常承担跨进程控制、事件、引用或内核交互职责。

---

## 3. 主要 IPC 机制对比

| 机制                 |        数据形态 |     是否有消息边界 |   是否可跨无亲缘进程 |                是否 fd 化 |  常见同步需求 | 典型场景                |
| ------------------ | ----------: | ----------: | ----------: | ---------------------: | ------: | ------------------- |
| signal             |    事件编号/少量值 |           是 |           是 | 传统 signal 否，signalfd 是 |       无 | 退出、重载、子进程通知         |
| pipe               |         字节流 |           否 |  通常父子/继承 fd |                      是 |  内核阻塞语义 | shell 管道、子进程 stdout |
| FIFO               |         字节流 |           否 |           是 |                      是 |  内核阻塞语义 | 脚本、简单 daemon        |
| UNIX Domain Socket | 字节流/数据报/顺序包 |       取决于类型 |           是 |                      是 |   协议层处理 | 本机 RPC、fd 传递        |
| TCP/UDP loopback   |     字节流/数据报 |       取决于协议 |           是 |                      是 |   协议层处理 | 本机 HTTP/gRPC        |
| POSIX MQ           |          消息 |           是 |           是 |          Linux 上可 fd 化 |  队列阻塞语义 | 优先级控制消息             |
| System V MQ        |          消息 |           是 |           是 |                      否 |  队列阻塞语义 | 遗留 UNIX 程序          |
| POSIX shm + mmap   |        共享内存 |       无内置格式 |           是 |         shm_open 返回 fd |  必须额外同步 | 高吞吐共享数据             |
| System V shm       |        共享内存 |       无内置格式 |           是 |                      否 |  必须额外同步 | 遗留共享内存              |
| memfd + mmap       |   共享内存/匿名文件 |       无内置格式 |    通过 fd 传递 |                      是 |  必须额外同步 | 沙箱、buffer 传递        |
| semaphore          |        同步计数 |      不传业务数据 |           是 |              named 依实现 |   本身即同步 | 共享资源协调              |
| futex              |        同步等待 |      不传业务数据 |   共享内存中可跨进程 |                      否 |   本身即同步 | mutex、condvar       |
| eventfd            |        计数事件 |         计数值 | 通过 fd 传递/继承 |                      是 | 常配合共享内存 | event loop 唤醒       |
| signalfd           |   signal 事件 | signal info |      进程本身接收 |                      是 |       无 | signal 纳入 epoll     |
| epoll              | fd ready 事件 |        事件集合 |   fd 可继承/传递 |                      是 |       无 | 高并发事件循环             |
| 文件锁                |         锁状态 |      不传业务数据 |           是 |                      是 |   本身即同步 | lockfile、数据库        |
| ptrace/process_vm  |   远程控制/内存访问 |       非普通消息 |       是，需权限 |                部分 fd 化 | 权限与停止状态 | 调试、观测               |

---

## 4. mmap 函数被哪些语言调用

### 4.1 C/C++

C/C++ 通常直接包含 `<sys/mman.h>` 调用 `mmap()`。POSIX 定义 `mmap()` 在进程地址空间与文件或 shared memory object 之间建立映射。([pubs.opengroup.org][17])

典型调用：

```c
void *addr = mmap(NULL, length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
```

### 4.2 Java

Java 标准 API 中，`MappedByteBuffer` 是一个内容为文件内存映射区域的 direct byte buffer，并由 `FileChannel.map` 创建。Oracle JDK 文档说明，mapped byte buffer 及其代表的 file mapping 在 buffer 被 GC 前保持有效；映射内容可能因本进程或其他进程修改对应文件区域而变化。([Oracle 文档][18])

常见用户态入口：

```java
try (FileChannel ch = FileChannel.open(path, StandardOpenOption.READ, StandardOpenOption.WRITE)) {
    MappedByteBuffer buf = ch.map(FileChannel.MapMode.READ_WRITE, 0, ch.size());
}
```

常见三方库或中间件场景：

| 场景                   | 用户态入口               | 底层机制                                |
| -------------------- | ------------------- | ----------------------------------- |
| Chronicle Queue      | memory-mapped queue | `FileChannel.map` / mmap            |
| MapDB                | mmap file store     | `MappedByteBuffer`                  |
| Lucene/Elasticsearch | mmap directory      | `MMapDirectory` -> Java NIO mapping |
| RocketMQ commitlog   | mapped file         | Java NIO mapped buffer              |
| Kafka index files    | mmap index          | Java NIO file mapping               |

### 4.3 Go

Go 标准库历史上有 `syscall.Mmap`，工程实践中更常见的是 `golang.org/x/sys/unix.Mmap`。Go 官方 package 文档说明，`x/sys/unix` 提供底层操作系统 raw system call interface。([Go Packages][19])

常见调用：

```go
data, err := unix.Mmap(int(file.Fd()), 0, size, unix.PROT_READ|unix.PROT_WRITE, unix.MAP_SHARED)
```

常见三方库或场景：

| 场景                            | 用户态入口                     | 底层机制                |
| ----------------------------- | ------------------------- | ------------------- |
| BoltDB/bbolt                  | mmap database file        | `mmap`              |
| Badger/WiscKey value log 相关实现 | mmap 或 file I/O，取决于版本与配置  | `mmap` 或 read/write |
| 自研 WAL/index                  | `unix.Mmap`               | `mmap`              |
| `golang.org/x/exp/mmap`       | read-only mapped file API | OS mmap             |

### 4.4 Python

Python 标准库提供 `mmap` 模块。官方文档说明，memory-mapped file object 既像 `bytearray`，也像 file object，可在许多需要 `bytearray` 的地方使用，例如用 `re` 搜索映射文件。([Python documentation][20])

常见调用：

```python
import mmap

with open("data.bin", "r+b") as f:
    mm = mmap.mmap(f.fileno(), 0)
```

### 4.5 Rust

Rust 标准库不直接提供稳定的跨平台 mmap 高层 API，常用 crate 是 `memmap2`。其文档说明，`memmap2` 提供跨平台 memory mapped buffer API，核心类型 `Mmap`/`MmapMut` 对应将文件映射为 `&[u8]` 或 `&mut [u8]`。([Docs.rs][21])

常见调用：

```rust
let file = File::open("data.bin")?;
let mmap = unsafe { memmap2::Mmap::map(&file)? };
```

### 4.6 Node.js

Node.js 核心 API 不提供稳定内置 mmap 接口。用户态通常通过 native addon 或 npm 包访问 mmap，例如 `mmap-io`、`mmap-kit` 等。这类包最终需要调用平台 native API，在 Linux 上对应 `mmap(2)`。npm 上 `mmap-io` 明确定位于 shared memory mapping。([NPM][22])

---

## 5. 从用户态操作到 Linux IPC 系统调用的链路拆解

### 5.1 Java FileChannel.map 到 mmap

以 Java 读写大文件或共享映射文件为例：

```text
业务代码
  -> FileChannel.open(path, options)
  -> FileChannel.map(MapMode.READ_WRITE, offset, size)
  -> JDK java.nio / sun.nio.ch FileChannelImpl
  -> JDK native 层
  -> Linux mmap(2)
  -> 内核创建/更新当前进程 vm_area_struct
  -> 返回用户态虚拟地址对应的 DirectByteBuffer/MappedByteBuffer
  -> 用户读写 buffer
  -> CPU 访问虚拟地址
  -> 缺页异常时进入内核
  -> page cache / tmpfs / shm / 文件系统页被装入或建立映射
```

其中，Java 官方 API 层保证的是 `MappedByteBuffer` 表示文件内存映射区域；Linux 层保证的是 `mmap()` 在进程虚拟地址空间中创建映射。二者之间的具体 native 实现属于 JDK 实现细节，但在 Linux 平台上其目标系统能力就是 `mmap(2)`。([Oracle 文档][18])

当多个 Java 进程映射同一个文件并使用 read-write/shared 语义时，`MappedByteBuffer` 可成为跨进程共享数据区域；但是 Java API 文档也明确指出，映射内容可能被本进程或其他进程改变，何时可见属于操作系统相关行为，并建议避免未协调的并发修改。([Oracle 文档][18])

---

### 5.2 Go unix.Mmap 到 mmap

典型 Go 链路：

```text
业务代码
  -> 自研 mmap 封装 / bbolt / x/exp/mmap / x/sys/unix
  -> unix.Mmap(fd, offset, length, prot, flags)
  -> Go syscall raw interface
  -> Linux mmap 系统调用
  -> 内核建立 VMA
  -> 返回 []byte
  -> Go 代码读写 []byte
  -> CPU 访问虚拟地址，必要时触发 page fault
```

Go 的 `golang.org/x/sys/unix` 文档明确其定位是访问底层 OS raw system call interface。([Go Packages][19])

需要注意的是，Go 返回的是 `[]byte` 视图，但这段内存不是 Go heap 常规分配对象；生命周期由 `unix.Munmap` 管理。跨进程共享时仍需要额外同步机制，例如 `eventfd` 负责唤醒，`futex` 或共享内存中的原子字段负责互斥与可见性。

---

### 5.3 Python mmap.mmap 到 mmap

典型 Python 链路：

```text
业务代码
  -> open("file", "r+b")
  -> file.fileno()
  -> mmap.mmap(fileno, length, access/flags/prot)
  -> CPython mmap module C extension
  -> Linux mmap(2)
  -> 返回 Python mmap object
  -> Python 切片/索引/read/write 操作访问映射区域
```

Python 官方文档把 mmap object 描述为既像 bytearray 又像 file object，因此用户态可以使用切片、索引、`read()`、`seek()` 等接口操作映射区域。([Python documentation][20])

---

### 5.4 UNIX Domain Socket 的 Java/Go 调用链

#### Java 常见链路

```text
业务代码
  -> Netty / gRPC Java / JDK SocketChannel / UnixDomainSocketAddress
  -> Java NIO Channel
  -> native socket/connect/send/recv 或 epoll transport
  -> socket(AF_UNIX, ...)
  -> connect()/bind()/listen()/accept()
  -> sendmsg()/recvmsg() 或 read()/write()
  -> Linux AF_UNIX socket layer
```

如果使用 Netty native epoll transport，事件等待通常进入 `epoll_wait`；如果使用 UNIX Domain Socket 传递 fd，则会使用 `sendmsg/recvmsg` 的 ancillary data，Linux 文档将 `SCM_RIGHTS` 描述为把打开文件描述符引用传给另一个进程。([Man7][6])

#### Go 常见链路

```text
业务代码
  -> net.Dial("unix", path) / net.Listen("unix", path)
  -> Go net 包
  -> internal poller
  -> socket(AF_UNIX, ...)
  -> connect()/bind()/listen()/accept()
  -> runtime netpoll -> epoll_wait
  -> read()/write()/sendmsg()/recvmsg()
```

这类链路最终落在 Linux socket API。`socket(2)` 明确定义 `socket()` 创建通信端点并返回对应 fd，`AF_UNIX` 用于本地通信。([Man7][23])

---

### 5.5 子进程 stdout/stderr 管道调用链

Java：

```text
业务代码
  -> ProcessBuilder.start()
  -> JDK ProcessImpl
  -> pipe/pipe2 创建 stdout/stderr/stdin 管道
  -> fork/posix_spawn/clone + execve
  -> 父进程读取 InputStream
  -> read(pipefd)
```

Go：

```text
业务代码
  -> exec.Command(...)
  -> cmd.StdoutPipe()
  -> os.Pipe()
  -> pipe2()
  -> fork/exec
  -> 父 goroutine read()
```

Linux 层面，`pipe()` 创建单向 IPC 通道并返回读写两个 fd；数据写入写端后由内核缓冲，直到读端读取。([Man7][4])

---

### 5.6 eventfd + epoll 在高性能运行时中的路径

典型事件循环唤醒链路：

```text
业务线程
  -> 写 eventfd
  -> write(eventfd, uint64)
  -> 内核增加 eventfd counter
  -> epoll ready list 记录 eventfd readable
  -> event loop 线程 epoll_wait 返回
  -> read(eventfd) 消费 counter
  -> 处理任务队列
```

eventfd 可替代仅用于事件通知的 pipe，且可被 epoll 监控；epoll 内核对象维护 interest list 和 ready list，ready list 由内核根据 fd I/O 活动动态填充。([Man7][15])

---

### 5.7 futex 在语言运行时和锁中的路径

典型 mutex 路径：

```text
业务代码
  -> synchronized / LockSupport / pthread_mutex / Go sync.Mutex
  -> 用户态 CAS 尝试加锁
  -> 成功：不进入内核
  -> 失败：标记等待状态
  -> futex(FUTEX_WAIT)
  -> 解锁线程 futex(FUTEX_WAKE)
  -> 等待线程返回用户态重新竞争锁
```

`futex` 的客观定位是共享内存同步中的阻塞构造；多数同步操作在用户态完成，只有可能长期阻塞时才进入内核。跨进程 futex 必须位于共享内存。([Man7][14])

---

## 6. mmap 作为 IPC 时的完整内核态过程

以“两个进程通过 POSIX shared memory + mmap 共享 ring buffer”为例。

### 6.1 创建阶段

```text
进程 A
  -> shm_open("/rb", O_CREAT | O_RDWR, 0600)
  -> ftruncate(fd, size)
  -> mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0)
```

内核侧发生的核心事实是：

1. `shm_open()` 创建或打开 POSIX shared memory object，返回 fd；
2. `ftruncate()` 设置对象长度；
3. `mmap()` 在进程 A 地址空间建立一段 VMA；
4. 该 VMA 指向 shared memory object 的页；
5. 实际物理页可能按需分配，首次访问时通过 page fault 建立页表映射。

POSIX shared memory object 是可被无关进程用 `mmap()` 映射同一共享内存区域的 handle。([Man7][8])

### 6.2 连接阶段

```text
进程 B
  -> shm_open("/rb", O_RDWR, 0600)
  -> mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0)
```

此时 A 和 B 的虚拟地址可以不同，但页表最终可映射到相同的物理页或同一 page cache/tmpfs backing page。A 对共享区域写入后，B 访问对应位置可观察到变化；可见性与顺序需要由原子操作、内存屏障、锁、信号量、futex 或 eventfd 协调。

### 6.3 数据传输阶段

```text
进程 A
  -> 写 ring buffer data 区
  -> 更新 tail 指针
  -> eventfd write 通知 B

进程 B
  -> epoll_wait 监听 eventfd
  -> read(eventfd)
  -> 读取 ring buffer data 区
  -> 更新 head 指针
```

这个组合中：

| 部分                     | 作用                    |
| ---------------------- | --------------------- |
| mmap/POSIX shm         | 数据面，承载大块共享数据          |
| atomic/futex/semaphore | 并发控制，保护 head/tail 或状态 |
| eventfd                | 控制面，通知对端有新数据          |
| epoll                  | 多 fd 事件分发             |

这是共享内存 IPC 的常见工程模型：数据不通过内核缓冲区反复复制，但同步与通知仍需要内核机制协助。

---

## 7. 不同 IPC 机制的应用选择事实

### 7.1 控制信号

进程退出、重载、子进程状态变化等场景使用 signal 或 signalfd。signal 适合表达“事件发生”，不适合承载复杂数据结构。

### 7.2 字节流数据

父子进程、shell、脚本、子进程 stdout/stderr 捕获使用 pipe。无亲缘进程可使用 FIFO，但复杂协议更常用 UNIX Domain Socket。

### 7.3 本机 RPC

本机服务之间的结构化请求响应通常使用 UNIX Domain Socket 或 loopback TCP。UNIX Domain Socket 支持 fd 和 credentials 传递；loopback TCP 便于复用 HTTP/gRPC 生态。

### 7.4 大块数据共享

大块数据、高吞吐、低延迟场景使用 shared memory、`mmap`、`memfd_create`。这类机制只提供共享字节区域，不提供消息边界、并发控制、崩溃恢复，需要应用层协议和同步机制。

### 7.5 同步与唤醒

跨进程同步可用 POSIX semaphore、System V semaphore、pthread process-shared mutex、futex。事件唤醒可用 eventfd。多 fd 事件循环使用 epoll。

### 7.6 遗留兼容

System V IPC 仍存在于老系统、传统 C/C++ 服务、工业控制、数据库历史代码中。新工程若以 fd、epoll、namespace、容器化为核心，POSIX shm、memfd、UDS、eventfd、futex 通常更容易组合。

---

## 8. 结论

Linux IPC 是分层机制集合，不存在一个单一接口覆盖所有需求。信号适合异步事件；pipe/FIFO 适合字节流；UNIX Domain Socket 适合本机 RPC、凭据与 fd 传递；message queue 适合带边界和优先级的消息；shared memory、`mmap`、`memfd_create` 适合高吞吐数据面；semaphore、futex、eventfd 适合同步与唤醒；epoll 负责把 fd 型 IPC 纳入统一事件循环。

`mmap` 的关键定位是把文件、shared memory object 或匿名内存文件映射进进程虚拟地址空间。它被 C/C++、Java、Go、Python、Rust、Node native addon 等语言或库调用。Java 的 `FileChannel.map`、Go 的 `unix.Mmap`、Python 的 `mmap.mmap`、Rust 的 `memmap2`，最终都依赖操作系统内存映射能力。在 IPC 场景下，`mmap` 通常只承担共享数据区域职责；完整通信系统还需要同步、通知、权限、生命周期和故障处理机制。

---

## 参考文献

1. Linux man-pages: `pipe(7)`、`fifo(7)`、`signal(7)`、`signalfd(2)`、`eventfd(2)`、`futex(2)`、`mmap(2)`、`shm_open(3)`、`sysvipc(7)`、`mq_overview(7)`、`sem_overview(7)`、`socket(2)`、`unix(7)`、`epoll(7)`。
2. Oracle Java SE Documentation: `MappedByteBuffer`、`FileChannel.map`。
3. Go Packages Documentation: `golang.org/x/sys/unix`。
4. Python Documentation: `mmap — Memory-mapped file support`。
5. Rust docs.rs: `memmap2` crate documentation。

[1]: https://man7.org/linux/man-pages/man7/sysvipc.7.html "sysvipc(7) - Linux manual page"
[2]: https://man7.org/linux/man-pages/man7/signal.7.html "signal(7) - Linux manual page"
[3]: https://man7.org/linux/man-pages/man2/signalfd.2.html "signalfd(2) - Linux manual page"
[4]: https://man7.org/linux/man-pages/man7/pipe.7.html "pipe(7) - Linux manual page"
[5]: https://man7.org/linux/man-pages/man7/fifo.7.html "fifo(7) - Linux manual page"
[6]: https://man7.org/linux/man-pages/man7/unix.7.html "unix(7) - Linux manual page"
[7]: https://man7.org/linux/man-pages/man7/mq_overview.7.html "mq_overview(7) - Linux manual page"
[8]: https://man7.org/linux/man-pages/man3/shm_open.3.html "shm_open(3) - Linux manual page"
[9]: https://man7.org/linux/man-pages/man2/shmget.2.html?utm_source=chatgpt.com "shmget(2) - Linux manual page"
[10]: https://man7.org/linux/man-pages/man2/mmap.2.html?utm_source=chatgpt.com "mmap(2) - Linux manual page"
[11]: https://man7.org/linux/man-pages/man2/mmap.2.html "mmap(2) - Linux manual page"
[12]: https://man7.org/linux/man-pages/man2/memfd_create.2.html "memfd_create(2) - Linux manual page"
[13]: https://man7.org/linux/man-pages/man7/sem_overview.7.html "sem_overview(7) - Linux manual page"
[14]: https://man7.org/linux/man-pages/man2/futex.2.html "futex(2) - Linux manual page"
[15]: https://man7.org/linux/man-pages/man2/eventfd.2.html "eventfd(2) - Linux manual page"
[16]: https://man7.org/linux/man-pages/man7/epoll.7.html "epoll(7) - Linux manual page"
[17]: https://pubs.opengroup.org/onlinepubs/009695399/functions/mmap.html?utm_source=chatgpt.com "mmap"
[18]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/MappedByteBuffer.html "MappedByteBuffer (Java SE 21 & JDK 21)"
[19]: https://pkg.go.dev/golang.org/x/sys/unix "unix package - golang.org/x/sys/unix - Go Packages"
[20]: https://docs.python.org/3/library/mmap.html?utm_source=chatgpt.com "mmap — Memory-mapped file support"
[21]: https://docs.rs/memmap2?utm_source=chatgpt.com "memmap2 - Rust"
[22]: https://www.npmjs.com/package/mmap-io?utm_source=chatgpt.com "mmap-io"
[23]: https://man7.org/linux/man-pages/man2/socket.2.html "socket(2) - Linux manual page"
