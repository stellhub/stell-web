---
title: Linux Inter-Process Communication and the mmap User-Space Call Path
category: Operating Systems
summary: A systematic study of Linux IPC mechanisms, including signals, pipes, FIFOs, UNIX Domain Sockets, message queues, shared memory, mmap, futex, eventfd, epoll, and the mmap path from multiple user-space languages to kernel syscalls.
tags:
  - Linux
  - IPC
  - mmap
  - Shared Memory
  - System Calls
readingDirection: Read this when learning Linux inter-process communication, shared memory, mmap call paths, event loops, or cross-language local communication design choices.
outline: deep
---

# Linux Inter-Process Communication and the mmap User-Space Call Path

## Overview

A systematic study of Linux IPC mechanisms, including signals, pipes, FIFOs, UNIX Domain Sockets, message queues, shared memory, mmap, futex, eventfd, epoll, and the mmap path from multiple user-space languages to kernel syscalls.

## Abstract

Linux inter-process communication (IPC) is not a single interface. It is a family of communication mechanisms built from kernel objects, file descriptors, virtual memory mappings, signal delivery, queues, sockets, synchronization primitives, and event-dispatch facilities. This article studies the major IPC mechanisms directly visible from Linux user space, including signals, pipes, FIFOs, UNIX Domain Sockets, TCP/UDP loopback sockets, POSIX/System V message queues, POSIX/System V shared memory, `mmap` file mappings, `memfd_create`, POSIX/System V semaphores, `futex`, `eventfd`, `signalfd`, `epoll`, file locks, `ptrace`, `process_vm_readv/writev`, Netlink, D-Bus, and related mechanisms. It focuses on their definitions, implementation paths, characteristics, limitations, and typical use cases. It also decomposes the path from user-space languages such as Java, Go, Python, Rust, and C/C++ to Linux kernel system calls when using `mmap`.

Keywords: Linux; IPC; mmap; shared memory; signal; pipe; UNIX Domain Socket; futex; eventfd; epoll; system call

---

## 1. Introduction

The core fact of Linux IPC is this: a user process cannot directly modify another process's private address space. Cross-process communication usually needs kernel-maintained shared objects, file descriptors, kernel buffers, shared page mappings, signal delivery, or controlled debugging and memory-access interfaces. Linux manual pages define System V IPC as three mechanisms: message queues, semaphores, and shared memory. Linux also provides POSIX IPC, pipes, FIFOs, sockets, signals, `mmap`, `eventfd`, `signalfd`, `futex`, and other mechanisms. ([Man7][1])

This article does not limit IPC to traditional System V IPC. It uses a broader definition: two or more execution contexts exchange data, events, references, or synchronization state through mechanisms visible to the kernel. Under this definition, `epoll` is not a data-transfer IPC mechanism by itself, but it is the event-dispatch foundation for many IPC file descriptors. `futex` is not a message channel by itself, but it is an important kernel interface for shared-memory synchronization. `mmap` can be used for file I/O, but in `MAP_SHARED`, POSIX shared memory, System V shared memory, `memfd_create`, and related scenarios, it can also become the data plane for IPC.

---

## 2. Linux IPC Mechanism Categories

### 2.1 Signals: Asynchronous Event Notification

Linux supports POSIX standard signals and real-time signals. The core semantics of signals are to deliver asynchronous events to processes or threads. The receiver executes the default action, ignores the signal, or enters a user-space signal handler according to the current signal disposition. Before entering the handler, the kernel saves the interrupted thread context, builds a signal frame on the user stack, sets the program counter to the handler, and later restores the original execution state through `sigreturn`. ([Man7][2])

Signal sources include `kill(2)`, `tgkill(2)`, `pthread_kill(3)`, `sigqueue(3)`, terminal drivers, exceptions, timers, and child-process state changes. Standard signals are not queued; if the same standard signal arrives multiple times while blocked, usually only one pending instance is kept. Real-time signals support queuing and can carry additional values. ([Man7][2])

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Data capability | Standard signals mainly carry an event number; `sigqueue` can carry one integer or pointer-sized value |
| Sync/async | Asynchronous delivery; the handler runs in the interrupted thread context |
| Composability | Traditional handlers are hard to combine with event loops; `signalfd` can turn signals into fd events |
| Limits | Only async-signal-safe functions are safe inside handlers; standard signals do not guarantee multi-instance queuing |

**Typical scenarios:**

Signals are often used for process lifecycle control, such as `SIGTERM` for graceful shutdown, `SIGKILL` for forced termination, `SIGHUP` for configuration reload, `SIGCHLD` for child reaping, `SIGINT` for terminal interruption, and `SIGPIPE` when writing to a pipe whose read end has been closed.

`signalfd` offers another way to receive signals. It creates a file descriptor for receiving target signals, and that fd can be monitored by `select`, `poll`, or `epoll`, which makes it more suitable for event-loop models. ([Man7][3])

---

### 2.2 Anonymous Pipe: A Byte-Stream Channel for Related Processes

`pipe(2)` creates a unidirectional data channel and returns two file descriptors: a read end and a write end. Data written to the write end is buffered by the kernel until it is read from the read end. `pipe(7)` states that pipes and FIFOs provide unidirectional IPC channels whose content is a byte stream without message boundaries. ([Man7][4])

**Implementation path:**

A typical shell pipeline `cmd1 | cmd2` works like this:

1. The shell calls `pipe2()` to create a pipe.
2. The shell calls `fork()` to create two child processes.
3. Child process A redirects `stdout` to the pipe write end through `dup2()`.
4. Child process B redirects `stdin` to the pipe read end through `dup2()`.
5. Both child processes call `execve()`.
6. `cmd1` writes data through `write(1, ...)` into the pipe buffer.
7. `cmd2` reads data through `read(0, ...)` from the pipe buffer.

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Data model | Byte stream, no message boundary |
| Direction | Unidirectional; bidirectional communication usually needs two pipes or a socketpair |
| Relationship | Commonly used between parent/child processes or processes with a common ancestor |
| Blocking behavior | Empty pipe blocks reads, full pipe blocks writes; nonblocking mode is possible |
| Error behavior | Writing after all read ends close triggers `SIGPIPE` or `EPIPE` |

**Typical scenarios:**

Shell pipelines, capturing child-process stdout/stderr through `ProcessBuilder` or `exec.Cmd`, lightweight daemon-worker streams, and passing logs or small data chunks between parent and child processes.

---

### 2.3 FIFO: Named Pipe

A FIFO, also called a named pipe, has semantics close to an anonymous pipe, but it is named through a file-system path. `fifo(7)` explains that a FIFO special file is similar to a pipe but is accessed through the file system. During data exchange, the kernel passes data internally; the file-system path is only an access reference point and does not store the data. ([Man7][5])

**Implementation path:**

1. `mkfifo("/tmp/x", mode)` creates the FIFO node.
2. Process A calls `open("/tmp/x", O_WRONLY)`.
3. Process B calls `open("/tmp/x", O_RDONLY)`.
4. A calls `write()`, B calls `read()`.
5. The actual data still flows through an in-kernel pipe object.

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Naming | File-system path |
| Process relationship | No parent-child relationship required |
| Data model | Byte stream, no message boundary |
| Lifecycle | Path node exists in the file system; the opened pipe object is maintained by the kernel |
| Limits | Unidirectional; open behavior depends on whether the other end exists; not ideal for complex protocols |

**Typical scenarios:**

Communication between command-line tools, a simple local daemon control entry, scripted data passing, and compatibility with traditional UNIX toolchains.

---

### 2.4 UNIX Domain Socket: Local Process Socket Communication

UNIX Domain Socket uses the `AF_UNIX` / `AF_LOCAL` address family for communication between processes on the same machine. `unix(7)` states that this mechanism is used for efficient local IPC and supports pathname sockets, unnamed sockets, Linux abstract namespace sockets, `SOCK_STREAM`, `SOCK_DGRAM`, and `SOCK_SEQPACKET`. It also supports passing file descriptors and process credentials through ancillary data. ([Man7][6])

**Implementation path:**

The server usually performs:

```text
socket(AF_UNIX, SOCK_STREAM, 0)
bind(pathname or abstract address)
listen()
accept()
read()/write() or recvmsg()/sendmsg()
```

The client performs:

```text
socket(AF_UNIX, SOCK_STREAM, 0)
connect()
read()/write() or recvmsg()/sendmsg()
```

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Data model | stream, datagram, or seqpacket |
| Naming | File-system path, anonymous socketpair, or Linux abstract namespace |
| Capability passing | Supports `SCM_RIGHTS` for file descriptor passing and supports credential passing |
| Composability | fd model, can be integrated with `epoll` |
| Limits | Local machine only; pathname sockets are affected by path length and file permissions |

**Typical scenarios:**

Docker/containerd local APIs, systemd notify and socket activation, local database connections, Envoy/Nginx communicating with local sidecars, D-Bus transport, local RPC, and bidirectional parent-child communication through `socketpair()`.

---

### 2.5 TCP/UDP Loopback Socket: Local IPC through the Network Stack

When a client connects to `127.0.0.1` or `::1`, communication still goes through the Linux network stack, but it does not leave the local machine. It is not a traditional "local-only IPC" mechanism, but in engineering practice it is often used for local process communication.

**Implementation path:**

```text
socket(AF_INET/AF_INET6, SOCK_STREAM/SOCK_DGRAM, 0)
bind()
listen()/connect()
send()/recv()
```

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Cross-machine capability | Can expand from loopback to real network communication |
| Protocol ecosystem | HTTP/gRPC/Redis/MySQL and many other protocols are immediately usable |
| Overhead | Goes through the network stack, with more protocol processing than shared memory or UDS |
| Isolation | Can work with firewall, network namespace, cgroup, and TLS |

**Typical scenarios:**

Local microservice calls, sidecar proxies, agent-to-application communication, HTTP management ports, and cross-language RPC.

---

### 2.6 POSIX Message Queue

POSIX message queues allow processes to exchange message units, each with a priority. `mq_overview(7)` explains that queues are created or opened by `mq_open()`, and two processes operate on the same queue through the same name. Messages are sent and received through `mq_send()` and `mq_receive()`, and are delivered from high priority to low priority. Linux has supported POSIX message queues since Linux 2.6.6, with glibc support since 2.3.4. ([Man7][7])

**Implementation path:**

```text
mq_open("/name", O_CREAT | O_RDWR, mode, attr)
mq_send()
mq_receive()
mq_notify()
mq_close()
mq_unlink()
```

Most Linux `mq_*()` library interfaces map to same-name or closely related system calls. For example, `mq_send(3)` maps to `mq_timedsend(2)`, and `mq_receive(3)` maps to `mq_timedreceive(2)`. ([Man7][7])

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Data model | Has message boundaries |
| Ordering | Delivered by message priority |
| Naming | `/somename` |
| Persistence | Has kernel persistence until `mq_unlink()` or system shutdown |
| Limits | Limited by `/proc/sys/fs/mqueue/*`; message size and message count are bounded |

**Typical scenarios:**

Real-time systems, small control messages, priority events, and local message exchange without introducing a broker.

---

### 2.7 System V Message Queue

System V IPC includes message queues, semaphores, and shared memory. System V message queues let processes exchange message units, each with a type field. `sysvipc(7)` lists System V message queues as one of the three System V IPC mechanisms. ([Man7][1])

**Implementation path:**

```text
msgget(key, IPC_CREAT | mode)
msgsnd(msqid, msgp, size, flags)
msgrcv(msqid, msgp, size, type, flags)
msgctl(msqid, IPC_RMID, ...)
```

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Data model | Has message boundaries |
| Naming | `key_t` plus kernel IPC id |
| Lifecycle | Deleted explicitly with `IPC_RMID`; otherwise the object can remain after process exit |
| Limits | Older API; less natural to combine with fd/epoll event loops than POSIX MQ, pipe, or socket |

**Typical scenarios:**

Historical UNIX programs, legacy C/C++ systems, and services that need System V IPC compatibility.

---

### 2.8 POSIX Shared Memory + mmap

`shm_open()` creates or opens a POSIX shared memory object. Official documentation explains that a POSIX shared memory object is essentially a handle that unrelated processes can map into the same shared memory region with `mmap(2)`. A new object initially has length 0 and usually needs `ftruncate()` to set its size. ([Man7][8])

**Implementation path:**

```text
fd = shm_open("/name", O_CREAT | O_RDWR, mode)
ftruncate(fd, size)
addr = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0)
```

Another process can map the same object by using the same `shm_open()` name and the same `mmap()` pattern.

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Data model | Shared byte region, no built-in message format |
| Performance structure | After mapping, data reads and writes are mainly normal memory accesses |
| Synchronization requirement | Requires extra synchronization such as semaphore, pthread mutex, futex, or eventfd |
| Lifecycle | Name is removed with `shm_unlink()`; mapping is removed with `munmap()` |
| Limits | Application must design layout, consistency, concurrency control, and crash recovery |

**Typical scenarios:**

High-throughput and low-latency data sharing, local multi-process ring buffers, image/audio/video frame sharing, database/cache engines, and cross-language shared-memory channels.

---

### 2.9 System V Shared Memory

System V shared memory uses `shmget()` to get or create a shared memory segment, `shmat()` to attach it into a process address space, `shmdt()` to detach it, and `shmctl()` to control or delete it. `shmget(2)` returns the System V shared memory segment identifier associated with a key; `shmat(2)` attaches that segment to the calling process address space. ([Man7][9])

**Implementation path:**

```text
shmid = shmget(key, size, IPC_CREAT | mode)
addr = shmat(shmid, NULL, 0)
shmdt(addr)
shmctl(shmid, IPC_RMID, NULL)
```

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Data model | Shared memory segment |
| Naming | `key_t` |
| Lifecycle | Can exist independently of processes and must be deleted explicitly |
| Synchronization requirement | Needs semaphore/futex/mutex or another mechanism |
| Limits | Older API; object management and permission model differ from the fd model |

**Typical scenarios:**

Legacy UNIX programs, high-performance local shared data in C/C++, databases, and traditional industrial control systems.

---

### 2.10 mmap File Mapping

`mmap(2)` creates a new mapping in the calling process's virtual address space. The content of a file mapping is initialized from the object referenced by file descriptor `fd` at the specified offset. `MAP_SHARED` lets modifications be visible to other processes mapping the same region and allows writeback to the underlying file; `MAP_PRIVATE` uses copy-on-write. After `mmap()` returns, the file descriptor can be closed without invalidating the mapping. ([Man7][10])

**Implementation path:**

```text
fd = open(path, O_RDWR)
addr = mmap(NULL, length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, offset)
```

**Condition for IPC:**

`mmap` becomes an IPC data plane only when multiple processes map the same underlying object with shared semantics. For example:

| Underlying object | IPC form |
| --- | --- |
| Regular file + `MAP_SHARED` | Multi-process shared file page cache |
| POSIX shm object + `MAP_SHARED` | Shared memory |
| `memfd_create()` fd + `MAP_SHARED` | Anonymous RAM-backed file sharing |
| System V shm + `shmat()` | Shared memory segment |
| tmpfs file + `MAP_SHARED` | Memory-file sharing |

Accessing a mapped region can produce signals. Writing to a read-only mapping can trigger `SIGSEGV`, and accessing a mapped page beyond the end of a file can trigger `SIGBUS`. ([Man7][11])

---

### 2.11 memfd_create: Anonymous Memory File

`memfd_create()` creates an anonymous file and returns an fd. Official documentation explains that this file can be modified, truncated, and memory-mapped like a regular file. The difference is that it lives in RAM, has volatile backing storage, and is automatically released after all references disappear. ([Man7][12])

**Implementation path:**

```text
fd = memfd_create("name", flags)
ftruncate(fd, size)
addr = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0)
```

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Naming | No global path; the name is mainly displayed for debugging under `/proc/self/fd` |
| Passing | Usually passed through UNIX Domain Socket `SCM_RIGHTS` |
| Storage | RAM, volatile |
| Extension | Can work with file sealing to restrict later modifications |
| Scenarios | Wayland, sandboxing, browsers, multi-process shared buffers, zero-copy data passing |

---

### 2.12 POSIX Semaphores

POSIX semaphores are used for process or thread synchronization. `sem_overview(7)` defines a semaphore as an integer that never goes below 0. `sem_post()` increments the value, and `sem_wait()` decrements it; when the value is 0, `sem_wait()` blocks. POSIX semaphores are divided into named and unnamed semaphores. Process-shared unnamed semaphores must live in a shared memory region, such as System V shared memory or a POSIX shared memory object. ([Man7][13])

**Implementation path:**

Named semaphore:

```text
sem_open("/name", O_CREAT, mode, value)
sem_wait()
sem_post()
sem_close()
sem_unlink()
```

Unnamed process-shared semaphore:

```text
addr = mmap(... MAP_SHARED ...)
sem_init(addr, pshared = 1, value)
sem_wait(addr)
sem_post(addr)
```

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Type | Synchronization primitive, not a data channel |
| Sharing | Named semaphore uses a name; unnamed semaphore requires shared memory |
| Blocking | `sem_wait()` can block |
| Scenarios | Producer-consumer coordination, shared memory read/write synchronization, process-level throttling |

---

### 2.13 System V Semaphores

System V semaphores are the synchronization mechanism in System V IPC. They are usually created as semaphore sets through `semget()`, operated atomically through `semop()`, and controlled through `semctl()`. `sysvipc(7)` lists semaphores as one of the three System V IPC mechanisms. ([Man7][1])

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Type | Synchronization mechanism |
| Object | semaphore set |
| Lifecycle | Kernel object, must be deleted explicitly |
| Scenarios | Legacy UNIX programs, multi-process resource counting, shared-memory synchronization |

---

### 2.14 futex: User-Space-First Blocking Synchronization Primitive

`futex(2)` provides a way to wait until a condition becomes true and is commonly used for shared-memory synchronization. Official documentation explains that most synchronization operations are performed in user space; a program uses the `futex()` system call only when it may need to block for a long time. For inter-process futex sharing, the futex word must reside in a shared memory region, such as one created by `mmap()` or `shmat()`. ([Man7][14])

**Implementation path:**

Typical mutex path:

```text
User-space atomic compare-and-swap succeeds -> does not enter kernel
User-space CAS fails and waiting is needed -> futex(FUTEX_WAIT)
Unlock path observes waiters -> futex(FUTEX_WAKE)
```

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Data size | A futex word is a 32-bit value |
| Performance structure | No contention means pure user-space operation; blocking contention enters the kernel |
| Sharing condition | For cross-process use, the word must be in shared memory |
| Scenarios | pthread mutex, condition variable, Go runtime, JVM runtime, shared-memory locks |

---

### 2.15 eventfd: Event Counter fd

`eventfd(2)` creates an event notification file descriptor backed by a 64-bit counter. Official documentation states that applications can use eventfd instead of a pipe when only event notification is needed. eventfd has lower kernel overhead than a pipe, needs only one fd, and can be monitored by `select`, `poll`, or `epoll`. ([Man7][15])

**Implementation path:**

```text
efd = eventfd(initval, EFD_NONBLOCK | EFD_CLOEXEC)
write(efd, uint64)
read(efd, &uint64)
epoll_ctl(epfd, EPOLL_CTL_ADD, efd, ...)
```

**Typical scenarios:**

Thread/process wakeups, shared-memory ring-buffer doorbells, io_uring/AIO completion notification, virtualization-device notification, and event-loop wakeup.

---

### 2.16 epoll: Event-Dispatch Foundation for IPC fds

`epoll` monitors whether multiple fds are ready. Official documentation explains that an epoll instance is a kernel data structure that, from user space, contains an interest list and a ready list. `epoll_create` creates the instance, `epoll_ctl` registers fds, and `epoll_wait` waits for events. ([Man7][16])

`epoll` is not an independent data-transfer IPC mechanism, but it is the unified event-dispatch mechanism for fd-style IPC such as pipes, FIFOs, sockets, eventfd, signalfd, and timerfd. Event-driven network services, the Go netpoller, Java Netty epoll transport, Rust Tokio's mio/epoll path, and similar systems all depend on this type of mechanism.

---

### 2.17 File Locks and File Systems as IPC

The file system can act as the lowest-level IPC mechanism: one process writes a file and another process reads it. Multiple processes can coordinate access through `flock()`, `fcntl()` record locks, or lock files. A regular file mapped with `mmap(MAP_SHARED)` is an efficient form in this category.

**Characteristics and limitations:**

| Item | Objective characteristic |
| --- | --- |
| Data persistence | Can persist to disk |
| Process relationship | No parent-child relationship required |
| Performance | Affected by file system, page cache, and fsync strategy |
| Scenarios | Configuration hot reload, pidfile, lockfile, SQLite, log/state exchange |

---

### 2.18 ptrace and process_vm_readv/writev

`ptrace` lets one process observe and control another process. Typical users include debuggers, strace, and gdb. `process_vm_readv()` and `process_vm_writev()` allow one process to directly read or write data in another process's address space, subject to permission checks. These interfaces are closer to controlled debugging, observation, or injection mechanisms than ordinary business communication channels.

**Typical scenarios:**

Debuggers, profilers, crash diagnosis, process-memory sampling, container runtimes, and security tools.

---

### 2.19 Netlink

Netlink is a socket mechanism for user-kernel communication and can also be used for communication between user-space processes. Typical protocol families include routing, network devices, connection tracking, audit, and uevent. It is often used for system management rather than ordinary business-process data transfer.

**Typical scenarios:**

`iproute2` interacting with the kernel network stack, udev listening to kernel device events, container network configuration, and audit logs.

---

### 2.20 D-Bus, Binder, io_uring, pidfd, and Related Mechanisms

D-Bus is a user-space message bus whose lower layer often relies on UNIX Domain Socket. It is common in desktop Linux and system services. Android Binder is the core IPC mechanism in the Android ecosystem, and the mainline Linux kernel also includes the binder driver. `io_uring` is mainly an asynchronous I/O interface, but its rings, eventfd integration, and shared-memory structures are related to IPC-style event notification. `pidfd` is mainly used for process references and lifecycle management and can be combined with `poll`/`epoll` to observe process exit.

Strictly speaking, not all of these are traditional IPC data channels, but in modern Linux systems they often carry cross-process control, events, references, or kernel interaction responsibilities.

---

## 3. Comparison of Major IPC Mechanisms

| Mechanism | Data form | Message boundary | Works across unrelated processes | fd-based | Common sync requirement | Typical scenario |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| signal | Event number / small value | Yes | Yes | Traditional signal no, signalfd yes | None | Exit, reload, child notification |
| pipe | Byte stream | No | Usually parent-child / inherited fd | Yes | Kernel blocking semantics | Shell pipeline, child stdout |
| FIFO | Byte stream | No | Yes | Yes | Kernel blocking semantics | Scripts, simple daemon |
| UNIX Domain Socket | Byte stream / datagram / seqpacket | Depends on type | Yes | Yes | Protocol-layer handling | Local RPC, fd passing |
| TCP/UDP loopback | Byte stream / datagram | Depends on protocol | Yes | Yes | Protocol-layer handling | Local HTTP/gRPC |
| POSIX MQ | Message | Yes | Yes | fd-able on Linux | Queue blocking semantics | Priority control messages |
| System V MQ | Message | Yes | Yes | No | Queue blocking semantics | Legacy UNIX programs |
| POSIX shm + mmap | Shared memory | No built-in format | Yes | `shm_open` returns fd | Extra sync required | High-throughput shared data |
| System V shm | Shared memory | No built-in format | Yes | No | Extra sync required | Legacy shared memory |
| memfd + mmap | Shared memory / anonymous file | No built-in format | Through fd passing | Yes | Extra sync required | Sandbox, buffer passing |
| semaphore | Sync counter | No business data | Yes | Named depends on implementation | Itself is sync | Shared resource coordination |
| futex | Sync wait | No business data | Cross-process if in shared memory | No | Itself is sync | mutex, condvar |
| eventfd | Counter event | Counter value | Through fd passing/inheritance | Yes | Often combined with shared memory | Event-loop wakeup |
| signalfd | signal event | signal info | Received by the process itself | Yes | None | Put signals into epoll |
| epoll | fd-ready events | Event set | fd can be inherited/passed | Yes | None | High-concurrency event loop |
| File lock | Lock state | No business data | Yes | Yes | Itself is sync | lockfile, database |
| ptrace/process_vm | Remote control / memory access | Not ordinary messages | Yes, with permission | Partially fd-based | Permission and stopped state | Debugging, observation |

---

## 4. Which Languages Call mmap?

### 4.1 C/C++

C/C++ usually includes `<sys/mman.h>` and calls `mmap()` directly. POSIX defines `mmap()` as establishing a mapping between a process address space and a file or shared memory object. ([pubs.opengroup.org][17])

Typical call:

```c
void *addr = mmap(NULL, length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
```

### 4.2 Java

In the Java standard API, `MappedByteBuffer` is a direct byte buffer whose content is a memory-mapped region of a file, created by `FileChannel.map`. Oracle JDK documentation states that a mapped byte buffer and the file mapping it represents remain valid until the buffer is garbage-collected, and that the mapped content can change because this process or another process modifies the corresponding file region. ([Oracle Documentation][18])

Common user-space entry:

```java
try (FileChannel ch = FileChannel.open(path, StandardOpenOption.READ, StandardOpenOption.WRITE)) {
    MappedByteBuffer buf = ch.map(FileChannel.MapMode.READ_WRITE, 0, ch.size());
}
```

Common third-party library and middleware scenarios:

| Scenario | User-space entry | Lower-level mechanism |
| --- | --- | --- |
| Chronicle Queue | memory-mapped queue | `FileChannel.map` / mmap |
| MapDB | mmap file store | `MappedByteBuffer` |
| Lucene/Elasticsearch | mmap directory | `MMapDirectory` -> Java NIO mapping |
| RocketMQ commitlog | mapped file | Java NIO mapped buffer |
| Kafka index files | mmap index | Java NIO file mapping |

### 4.3 Go

The Go standard library historically provided `syscall.Mmap`, but engineering practice more commonly uses `golang.org/x/sys/unix.Mmap`. The Go package documentation states that `x/sys/unix` provides access to low-level operating-system raw system call interfaces. ([Go Packages][19])

Common call:

```go
data, err := unix.Mmap(int(file.Fd()), 0, size, unix.PROT_READ|unix.PROT_WRITE, unix.MAP_SHARED)
```

Common third-party libraries or scenarios:

| Scenario | User-space entry | Lower-level mechanism |
| --- | --- | --- |
| BoltDB/bbolt | mmap database file | `mmap` |
| Badger/WiscKey value-log related implementations | mmap or file I/O depending on version/configuration | `mmap` or read/write |
| Custom WAL/index | `unix.Mmap` | `mmap` |
| `golang.org/x/exp/mmap` | read-only mapped file API | OS mmap |

### 4.4 Python

Python provides the `mmap` module in the standard library. Official documentation says a memory-mapped file object behaves both like a `bytearray` and like a file object, and can be used in many places that expect a `bytearray`, such as searching mapped files with `re`. ([Python documentation][20])

Common call:

```python
import mmap

with open("data.bin", "r+b") as f:
    mm = mmap.mmap(f.fileno(), 0)
```

### 4.5 Rust

Rust's standard library does not directly provide a stable cross-platform high-level mmap API. A common crate is `memmap2`. Its documentation states that `memmap2` provides a cross-platform memory-mapped buffer API, and the core types `Mmap` / `MmapMut` represent mapping a file as `&[u8]` or `&mut [u8]`. ([Docs.rs][21])

Common call:

```rust
let file = File::open("data.bin")?;
let mmap = unsafe { memmap2::Mmap::map(&file)? };
```

### 4.6 Node.js

Node.js core APIs do not provide a stable built-in mmap interface. User space usually accesses mmap through native addons or npm packages such as `mmap-io` and `mmap-kit`. These packages eventually call platform-native APIs, which correspond to `mmap(2)` on Linux. The npm package `mmap-io` is explicitly positioned for shared memory mapping. ([NPM][22])

---

## 5. From User-Space Operations to Linux IPC System Calls

### 5.1 Java FileChannel.map to mmap

For Java large-file reads/writes or shared mapped files, the path is:

```text
Business code
  -> FileChannel.open(path, options)
  -> FileChannel.map(MapMode.READ_WRITE, offset, size)
  -> JDK java.nio / sun.nio.ch FileChannelImpl
  -> JDK native layer
  -> Linux mmap(2)
  -> kernel creates/updates vm_area_struct in current process
  -> returns a DirectByteBuffer/MappedByteBuffer corresponding to the user virtual address
  -> user reads/writes the buffer
  -> CPU accesses virtual address
  -> page fault enters kernel if needed
  -> page cache / tmpfs / shm / file-system pages are loaded or mapped
```

The Java API layer guarantees that `MappedByteBuffer` represents a memory-mapped file region. The Linux layer guarantees that `mmap()` creates a mapping in the process virtual address space. The exact native implementation between the two is a JDK implementation detail, but on Linux its target system capability is `mmap(2)`. ([Oracle Documentation][18])

When multiple Java processes map the same file with read-write/shared semantics, `MappedByteBuffer` can become a cross-process shared data region. However, Java API documentation also states that mapped content may be changed by this process or another process, that visibility timing is operating-system dependent, and that uncoordinated concurrent modification should be avoided. ([Oracle Documentation][18])

---

### 5.2 Go unix.Mmap to mmap

Typical Go path:

```text
Business code
  -> custom mmap wrapper / bbolt / x/exp/mmap / x/sys/unix
  -> unix.Mmap(fd, offset, length, prot, flags)
  -> Go syscall raw interface
  -> Linux mmap system call
  -> kernel establishes VMA
  -> returns []byte
  -> Go code reads/writes []byte
  -> CPU accesses virtual address and may trigger page fault
```

The `golang.org/x/sys/unix` documentation clearly positions it as access to low-level OS raw system call interfaces. ([Go Packages][19])

One important detail is that Go returns a `[]byte` view, but this memory is not a normal Go heap allocation. Its lifecycle is managed by `unix.Munmap`. Cross-process sharing still needs extra synchronization, such as `eventfd` for wakeup and `futex` or atomic fields in shared memory for mutual exclusion and visibility.

---

### 5.3 Python mmap.mmap to mmap

Typical Python path:

```text
Business code
  -> open("file", "r+b")
  -> file.fileno()
  -> mmap.mmap(fileno, length, access/flags/prot)
  -> CPython mmap module C extension
  -> Linux mmap(2)
  -> returns Python mmap object
  -> Python slicing/index/read/write accesses the mapped region
```

Python documentation describes the mmap object as both bytearray-like and file-like, so user space can operate on the mapped region through slicing, indexing, `read()`, `seek()`, and similar interfaces. ([Python documentation][20])

---

### 5.4 Java/Go Call Chain for UNIX Domain Socket

#### Common Java path

```text
Business code
  -> Netty / gRPC Java / JDK SocketChannel / UnixDomainSocketAddress
  -> Java NIO Channel
  -> native socket/connect/send/recv or epoll transport
  -> socket(AF_UNIX, ...)
  -> connect()/bind()/listen()/accept()
  -> sendmsg()/recvmsg() or read()/write()
  -> Linux AF_UNIX socket layer
```

If Netty native epoll transport is used, event waiting usually enters `epoll_wait`. If UNIX Domain Socket is used to pass fds, it uses ancillary data in `sendmsg/recvmsg`. Linux documentation describes `SCM_RIGHTS` as passing references to open file descriptors to another process. ([Man7][6])

#### Common Go path

```text
Business code
  -> net.Dial("unix", path) / net.Listen("unix", path)
  -> Go net package
  -> internal poller
  -> socket(AF_UNIX, ...)
  -> connect()/bind()/listen()/accept()
  -> runtime netpoll -> epoll_wait
  -> read()/write()/sendmsg()/recvmsg()
```

This type of path ultimately lands on Linux socket APIs. `socket(2)` defines `socket()` as creating a communication endpoint and returning the corresponding fd, and `AF_UNIX` is used for local communication. ([Man7][23])

---

### 5.5 Child-Process stdout/stderr Pipe Call Chain

Java:

```text
Business code
  -> ProcessBuilder.start()
  -> JDK ProcessImpl
  -> pipe/pipe2 creates stdout/stderr/stdin pipes
  -> fork/posix_spawn/clone + execve
  -> parent reads InputStream
  -> read(pipefd)
```

Go:

```text
Business code
  -> exec.Command(...)
  -> cmd.StdoutPipe()
  -> os.Pipe()
  -> pipe2()
  -> fork/exec
  -> parent goroutine read()
```

At the Linux level, `pipe()` creates a unidirectional IPC channel and returns two fds. Data written to the write end is buffered by the kernel until it is read from the read end. ([Man7][4])

---

### 5.6 eventfd + epoll in High-Performance Runtimes

Typical event-loop wakeup path:

```text
Business thread
  -> write eventfd
  -> write(eventfd, uint64)
  -> kernel increments eventfd counter
  -> epoll ready list records eventfd readable
  -> event-loop thread returns from epoll_wait
  -> read(eventfd) consumes counter
  -> process task queue
```

eventfd can replace a pipe used only for event notification and can be monitored by epoll. The epoll kernel object maintains an interest list and a ready list, and the ready list is filled by the kernel according to fd I/O activity. ([Man7][15])

---

### 5.7 futex in Language Runtimes and Locks

Typical mutex path:

```text
Business code
  -> synchronized / LockSupport / pthread_mutex / Go sync.Mutex
  -> user-space CAS attempts to lock
  -> success: no kernel entry
  -> failure: mark waiting state
  -> futex(FUTEX_WAIT)
  -> unlocking thread calls futex(FUTEX_WAKE)
  -> waiting thread returns to user space and competes for the lock again
```

The objective role of `futex` is to provide blocking construction for shared-memory synchronization. Most synchronization operations happen in user space; the kernel is entered only when long blocking may be necessary. Cross-process futex must be located in shared memory. ([Man7][14])

---

## 6. Complete Kernel-Side Process for mmap as IPC

Use "two processes share a ring buffer through POSIX shared memory + mmap" as an example.

### 6.1 Creation Phase

```text
Process A
  -> shm_open("/rb", O_CREAT | O_RDWR, 0600)
  -> ftruncate(fd, size)
  -> mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0)
```

The kernel-side core facts are:

1. `shm_open()` creates or opens a POSIX shared memory object and returns an fd.
2. `ftruncate()` sets the object length.
3. `mmap()` creates a VMA in process A's address space.
4. The VMA points to pages of the shared memory object.
5. Physical pages may be allocated lazily, and the first access may establish page-table mappings through page fault.

A POSIX shared memory object is a handle that unrelated processes can map into the same shared memory region through `mmap()`. ([Man7][8])

### 6.2 Connection Phase

```text
Process B
  -> shm_open("/rb", O_RDWR, 0600)
  -> mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0)
```

At this point, the virtual addresses of A and B may differ, but their page tables can ultimately map to the same physical pages or to the same page-cache/tmpfs backing pages. After A writes to the shared region, B can observe the change by accessing the corresponding position. Visibility and ordering need coordination through atomics, memory barriers, locks, semaphores, futex, or eventfd.

### 6.3 Data Transfer Phase

```text
Process A
  -> write ring buffer data region
  -> update tail pointer
  -> eventfd write notifies B

Process B
  -> epoll_wait monitors eventfd
  -> read(eventfd)
  -> read ring buffer data region
  -> update head pointer
```

In this combination:

| Part | Role |
| --- | --- |
| mmap/POSIX shm | Data plane carrying large shared data |
| atomic/futex/semaphore | Concurrency control for head/tail or state |
| eventfd | Control plane that notifies the peer of new data |
| epoll | Multi-fd event dispatch |

This is a common engineering model for shared-memory IPC: data does not repeatedly copy through kernel buffers, but synchronization and notification still need help from kernel mechanisms.

---

## 7. Facts for Choosing IPC Mechanisms

### 7.1 Control Signals

Use signal or signalfd for process exit, reload, child-process state changes, and similar control events. Signals are good for expressing "an event happened," not for carrying complex data structures.

### 7.2 Byte-Stream Data

Use pipe for parent-child processes, shells, scripts, and child-process stdout/stderr capture. Unrelated processes can use FIFO, but complex protocols more commonly use UNIX Domain Socket.

### 7.3 Local RPC

Structured request/response between local services usually uses UNIX Domain Socket or loopback TCP. UNIX Domain Socket supports fd and credential passing. Loopback TCP makes it easy to reuse the HTTP/gRPC ecosystem.

### 7.4 Large Data Sharing

Use shared memory, `mmap`, and `memfd_create` for large-data, high-throughput, low-latency scenarios. These mechanisms provide only a shared byte region; they do not provide message boundaries, concurrency control, or crash recovery. Application-layer protocol and synchronization mechanisms are required.

### 7.5 Synchronization and Wakeup

Cross-process synchronization can use POSIX semaphores, System V semaphores, pthread process-shared mutexes, and futex. Event wakeups can use eventfd. Multi-fd event loops use epoll.

### 7.6 Legacy Compatibility

System V IPC still exists in old systems, traditional C/C++ services, industrial control systems, and historical database code. For new engineering centered on fds, epoll, namespaces, and containerization, POSIX shm, memfd, UDS, eventfd, and futex are usually easier to compose.

---

## 8. Conclusion

Linux IPC is a layered collection of mechanisms. No single interface covers every need. Signals are suitable for asynchronous events. pipe/FIFO are suitable for byte streams. UNIX Domain Socket is suitable for local RPC, credential passing, and fd passing. Message queues are suitable for messages with boundaries and priorities. shared memory, `mmap`, and `memfd_create` are suitable for high-throughput data planes. semaphores, futex, and eventfd are suitable for synchronization and wakeup. epoll brings fd-style IPC into a unified event loop.

The key role of `mmap` is to map a file, shared memory object, or anonymous memory file into a process virtual address space. It is called by languages and libraries in C/C++, Java, Go, Python, Rust, and Node native addons. Java `FileChannel.map`, Go `unix.Mmap`, Python `mmap.mmap`, and Rust `memmap2` all ultimately depend on operating-system memory mapping capability. In IPC scenarios, `mmap` usually only provides the shared data region. A complete communication system still needs synchronization, notification, permissions, lifecycle management, and failure handling.

---

## References

1. Linux man-pages: `pipe(7)`, `fifo(7)`, `signal(7)`, `signalfd(2)`, `eventfd(2)`, `futex(2)`, `mmap(2)`, `shm_open(3)`, `sysvipc(7)`, `mq_overview(7)`, `sem_overview(7)`, `socket(2)`, `unix(7)`, `epoll(7)`.
2. Oracle Java SE Documentation: `MappedByteBuffer`, `FileChannel.map`.
3. Go Packages Documentation: `golang.org/x/sys/unix`.
4. Python Documentation: `mmap - Memory-mapped file support`.
5. Rust docs.rs: `memmap2` crate documentation.

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
[20]: https://docs.python.org/3/library/mmap.html?utm_source=chatgpt.com "mmap - Memory-mapped file support"
[21]: https://docs.rs/memmap2?utm_source=chatgpt.com "memmap2 - Rust"
[22]: https://www.npmjs.com/package/mmap-io?utm_source=chatgpt.com "mmap-io"
[23]: https://man7.org/linux/man-pages/man2/socket.2.html "socket(2) - Linux manual page"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/ipc)
