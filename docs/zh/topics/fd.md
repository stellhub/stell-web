---
title: "Linux 文件描述符研究：从“一切皆文件”到 fd 的内核抽象与工程实践"
category: "操作系统"
summary: "系统梳理 Linux 文件描述符的来源、open file description、VFS、inode、socket、epoll、继承语义和线上工程实践。"
tags:
  - "Linux"
  - "文件描述符"
  - "VFS"
  - "epoll"
  - "系统编程"
readingDirection: "适合在学习 Linux I/O 模型、排查 fd 泄漏、理解 socket/epoll 生命周期，或设计高并发服务资源治理时阅读。"
outline: deep
---

# Linux 文件描述符研究：从“一切皆文件”到 fd 的内核抽象与工程实践

## 概览

系统梳理 Linux 文件描述符的来源、open file description、VFS、inode、socket、epoll、继承语义和线上工程实践。

## 摘要

文件描述符，通常简称 fd，是 Linux/Unix 系统编程中最基础也最容易被低估的抽象之一。它表面上只是进程中的一个非负整数，但它背后连接的是进程文件描述符表、系统级 open file description、VFS `struct file`、目录项、inode、具体文件系统、设备驱动、socket、pipe、eventfd、epoll 等一整套内核对象。

Linux 的“一切皆文件”并不是说系统里所有东西都是磁盘文件，而是说 Linux 尽量用统一的文件 I/O 接口抽象各种资源。`read()`、`write()`、`close()`、`fcntl()`、`poll()`、`epoll()` 等接口可以作用于普通文件、管道、FIFO、socket、终端、设备文件等多类对象。《The Linux Programming Interface》对通用 I/O 模型的描述是：所有执行 I/O 的系统调用都使用文件描述符引用打开的文件；文件描述符可用于普通文件、管道、FIFO、socket、终端、设备等各种打开文件，并且每个进程都有自己的一组文件描述符。([Man7][1])

本文围绕 Linux fd 的来源、作用、内核结构、使用场景和工程关注点展开，试图说明：fd 不是简单的 int，而是 Linux 统一资源访问模型在用户态暴露出来的句柄。

**关键词**：Linux；文件描述符；fd；VFS；open file description；inode；socket；epoll；close-on-exec；一切皆文件

---

## 1. 引言：为什么 fd 是理解 Linux 的入口

在 Java、Go、C、Rust、Python、Node.js 等语言中，开发者经常会接触到连接、文件、socket、pipe、日志文件、标准输入输出、epoll、event loop 等概念。它们在语言层面表现不同，但只要落到 Linux 内核，很多对象最终都会通过 fd 进入统一的 I/O 管理体系。

例如：

```text
打开一个日志文件        -> fd
建立一个 TCP 连接       -> fd
创建一个 pipe           -> 两个 fd
创建一个 epoll 实例     -> fd
创建一个 eventfd        -> fd
访问 /proc/pid/fd       -> 查看进程 fd
标准输入输出错误        -> fd 0 / 1 / 2
```

因此，fd 是 Linux 把“用户态程序”和“内核资源对象”连接起来的基础句柄。它既是系统调用的参数，也是进程资源隔离的边界；既是高性能网络编程的基础，也是线上故障排查中的核心指标。

---

## 2. “一切皆文件”的真实含义

“一切皆文件”是 Unix/Linux 系统设计中非常著名的思想。但它容易被误解。

它并不是说：

```text
所有资源都是磁盘上的普通文件。
```

更准确地说，它表达的是：

```text
Linux 尽量把不同资源抽象成可以通过文件接口操作的对象。
```

普通文件、目录、字符设备、块设备、终端、管道、socket、procfs、sysfs、eventfd、timerfd、signalfd、epoll 实例等资源，都可以通过 fd 被进程引用。进程拿到 fd 后，不需要直接知道后面是磁盘文件、网络连接还是内核事件对象，而是通过统一的系统调用接口进行操作。

这个模型的价值在于：

```text
统一访问接口
统一权限模型
统一生命周期管理
统一事件通知机制
统一资源限制和统计
```

Linux 内核中的 VFS 正是承载这一思想的重要层。Linux 内核文档对 VFS 的描述是：VFS 是内核中处理文件和文件系统相关系统调用的组件，它为用户和具体文件系统之间提供通用接口，从而简化文件系统实现并让多种文件系统更容易集成。([Linux Kernel Labs][2])

也就是说，应用层看到的是 fd 和 read/write/open/close，内核内部则通过 VFS 把这些操作分发给不同类型对象的具体实现。

---

## 3. fd 的来源：从 `open()` 开始

最经典的 fd 来源是 `open()`。

`open(2)` 手册明确说明：调用 `open()` 会创建一个新的 open file description，它是系统级打开文件表中的一个条目；open file description 记录文件偏移量和文件状态标志；文件描述符是对 open file description 的引用。([Man7][3])

这句话非常关键。它说明 fd 不是文件本身，也不是 inode 本身，而是进程文件描述符表里的一个引用。

可以把它简化成三层结构：

```text
用户态进程
  fd = 3

内核：进程文件描述符表
  fd 3 -> open file description

内核：系统级打开文件对象
  open file description -> file offset / status flags / struct file

文件系统层
  struct file -> dentry -> inode -> 具体文件或设备
```

一次 `open("/tmp/a.log", O_RDWR)` 大致发生了这些事情：

```text
1. 用户态调用 open()
2. 内核根据路径解析目录项 dentry
3. VFS 找到对应 inode
4. 内核创建 struct file / open file description
5. 当前进程的 fd table 分配一个最小可用 fd
6. fd 指向这个 open file description
7. open() 返回 fd 给用户态
```

Linux 内核 VFS 文档说明，路径查找到 inode 后，VFS 就可以执行 `open(2)`、`stat(2)` 等操作；而旧版 VFS 文档也描述了 `file` 结构会被放入进程的文件描述符表，之后读、写、关闭等 VFS 操作会使用用户态 fd 找到相应的 `file` 结构。([Linux内核文档][4])

---

## 4. fd、open file description、inode 不是同一个东西

这是理解 fd 最重要的一点。

很多线上问题来自这个误解：

```text
fd == 文件
```

这个理解不准确。

更准确的关系是：

```text
fd 是进程内的整数句柄
open file description 是系统级打开文件状态
inode 是文件系统对象的元数据
```

三者关系如下：

```text
process A fd table
  fd 3 ─┐
        ├── open file description ─── struct file ─── dentry ─── inode
process B fd table
  fd 8 ─┘
```

### 4.1 fd 是进程局部的

同一个整数 fd 在不同进程中可以指向完全不同的对象：

```text
进程 A 的 fd 3 -> /tmp/a.log
进程 B 的 fd 3 -> socket:[12345]
```

因此，日志里只看到 `fd=3` 没有太大意义，必须结合进程 PID 才能判断它指向什么。

### 4.2 open file description 保存共享状态

`open(2)` 明确说 open file description 保存文件偏移量和文件状态标志。([Man7][3])

这意味着，如果两个 fd 指向同一个 open file description，它们会共享文件偏移量和状态标志。

`dup(2)` 手册也明确说明，`dup()` 后的新旧文件描述符可以互换使用，因为它们引用同一个 open file description，所以共享文件偏移量和文件状态标志；如果一个 fd 通过 `lseek()` 修改偏移量，另一个 fd 也会受到影响。([Man7][5])

示意：

```text
fd 3 ─┐
      ├── same open file description
fd 4 ─┘

共享：
  file offset
  file status flags
```

### 4.3 inode 表示文件系统对象

inode 描述文件系统中的对象，例如普通文件、目录、设备节点等。它包含权限、所有者、大小、时间戳、数据块位置等元信息。VFS 通过 dentry 和 inode 解析路径并定位具体对象。Linux VFS 文档说明，查找 inode 需要 VFS 调用父目录 inode 的 `lookup()` 方法；一旦 VFS 拿到 dentry 和 inode，就可以执行 open/stat 等操作。([Linux内核文档][4])

因此，一个路径被删除或重命名，并不会立刻让已经打开的 fd 失效。`open(2)` 也明确说明，fd 对 open file description 的引用不受后续路径删除或修改为指向不同文件的影响。([Man7][3])

这就是为什么 Linux 中常见：

```text
文件已经被 rm
进程仍然持有 fd
磁盘空间没有释放
```

因为真正的数据对象仍然被 open file description 引用。

---

## 5. fd 的作用：把不同资源统一成 I/O 句柄

fd 的核心作用是作为系统调用入口参数。

常见系统调用：

```c
read(fd, buf, size);
write(fd, buf, size);
close(fd);
fcntl(fd, ...);
ioctl(fd, ...);
poll(... fd ...);
epoll_ctl(epfd, ..., fd, ...);
send(fd, ...);
recv(fd, ...);
```

从设计上看，fd 提供了几个能力。

第一，fd 隐藏了资源类型。应用可以对普通文件、socket、pipe 使用相似的 I/O 调用。

第二，fd 隔离了进程资源。每个进程有自己的 fd table，fd 编号只在进程内有意义。

第三，fd 支持跨系统调用复用。进程先 `open()` 得到 fd，之后用这个 fd 调用 read/write/fcntl/ioctl/epoll 等接口。

第四，fd 支持事件通知。`poll()`、`select()`、`epoll()` 都以 fd 为监控对象。`epoll(7)` 说明，epoll API 用于监控多个 fd，判断其中哪些 fd 可以执行 I/O，并且可扩展到大量被监控 fd。([Man7][6])

---

## 6. fd 的典型使用场景

### 6.1 普通文件

最直观的使用场景是读写普通文件：

```c
int fd = open("/var/log/app.log", O_WRONLY | O_APPEND);
write(fd, buf, len);
close(fd);
```

这里 fd 指向一个 open file description，open file description 记录偏移量和状态标志。如果使用 `O_APPEND`，写入行为由内核以追加方式处理。

### 6.2 标准输入、标准输出、标准错误

Unix/Linux 约定：

```text
fd 0 -> stdin
fd 1 -> stdout
fd 2 -> stderr
```

`proc_pid_fd(5)` 手册也明确说明，`/proc/pid/fd/` 目录中每个条目对应进程打开的一个 fd，其中 0 是标准输入，1 是标准输出，2 是标准错误。([Man7][7])

这就是 shell 重定向的基础：

```bash
command > out.log 2> err.log
```

它本质上是在调整进程启动时的 fd 指向。

### 6.3 socket

网络连接在 Linux 中也通过 fd 表示：

```c
int fd = socket(AF_INET, SOCK_STREAM, 0);
connect(fd, ...);
send(fd, ...);
recv(fd, ...);
close(fd);
```

这体现了“一切皆文件”的思想：TCP 连接不是磁盘文件，但它可以通过 fd 被 read/write/poll/epoll 管理。

### 6.4 pipe 和 FIFO

`pipe()` 会返回两个 fd：一个读端，一个写端。《The Linux Programming Interface》中关于 pipe 的章节说明，`pipe()` 成功后会在数组中返回两个打开的文件描述符，`filedes[0]` 是读端，`filedes[1]` 是写端，并且可像其他 fd 一样使用 `read()` 和 `write()`。([Fenix Técnico Lisboa][8])

```text
pipefd[0] -> read end
pipefd[1] -> write end
```

这让进程间通信也被纳入 fd 模型。

### 6.5 epoll 实例本身也是 fd

`epoll_create()` 会返回一个指向 epoll 实例的 fd，这个 fd 后续用于 epoll 接口；当所有引用该 epoll 实例的 fd 都关闭后，内核会销毁该实例并释放资源。([Linux Documentation][9])

这说明 fd 不只是“文件和 socket”的句柄，也可以是内核事件对象的句柄。

### 6.6 `/proc` 观测 fd

Linux 提供 `/proc/<pid>/fd` 查看进程当前打开的 fd。`proc_pid_fd(5)` 说明，该目录下每个条目以 fd 编号命名，并且是指向实际文件的符号链接。对于 pipe 和 socket，这些链接会显示类似 `type:[inode]` 的格式。([Man7][7])

常用排查命令：

```bash
ls -l /proc/<pid>/fd
readlink /proc/<pid>/fd/<fd>
lsof -p <pid>
```

---

## 7. fork、exec、dup 与 fd 继承

fd 不仅影响 I/O，还影响进程创建和程序替换。

### 7.1 `fork()` 后 fd 会继承

`fork(2)` 手册明确说明，子进程会继承父进程打开 fd 集合的副本；子进程中的每个 fd 都引用与父进程对应 fd 相同的 open file description，因此父子进程共享 open file status flags、file offset 和 signal-driven I/O 属性。([Man7][10])

这意味着：

```text
父进程 fd 3 ─┐
             ├── same open file description
子进程 fd 3 ─┘
```

共享偏移量会带来真实影响。例如父子进程同时读同一个 fd，会相互影响读取位置。

### 7.2 `dup()` 后共享 open file description

`dup()`、`dup2()`、`dup3()` 创建的是新的 fd，但不是新的 open file description。新旧 fd 指向同一个 open file description，因此共享偏移量和状态标志。([Man7][5])

这也是 shell 重定向、日志重定向、标准输出复制的基础。

### 7.3 `exec()` 与 close-on-exec

默认情况下，fd 可能跨 `exec()` 保留。`fcntl(3p)` 对 `FD_CLOEXEC` 的说明是：如果 `FD_CLOEXEC` 标志为 0，fd 会在 exec 函数之后保持打开；否则会在成功 exec 时关闭。([Man7][11])

这也是安全和资源泄漏中的高频问题。

错误示例：

```text
父进程打开数据库连接 socket
fork + exec 启动子进程
子进程意外继承该 socket fd
父进程关闭 socket 后，连接仍被子进程持有
服务端迟迟感知不到连接关闭
```

工程上应优先使用带 `O_CLOEXEC`、`SOCK_CLOEXEC`、`EPOLL_CLOEXEC` 等原子 close-on-exec 能力的接口，避免 open 后再 fcntl 设置产生竞态。

---

## 8. fd 与 VFS：Linux 如何把不同对象统一起来

Linux 的 VFS 层是理解“一切皆文件”的关键。

简化后的 VFS 对象关系是：

```text
fd
 └── file descriptor table entry
      └── struct file
           ├── file operations
           ├── file offset
           ├── file flags
           └── dentry
                └── inode
                     └── filesystem / device / socket implementation
```

VFS 的价值在于给不同文件系统和对象类型提供统一接口。内核文档说明，VFS 是用户与具体文件系统之间的通用接口。([Linux Kernel Labs][2])

对于普通文件，`read()` 最终可能走具体文件系统的读取逻辑。

对于字符设备，`read()` 可能走设备驱动的 `file_operations.read`。

对于 socket，`read()` / `recv()` 会进入网络协议栈。

对于 pipe，`read()` 会从 pipe buffer 中取数据。

也就是说：

```text
用户态看到的是 fd
VFS 看到的是 struct file
具体实现看到的是自己的 file_operations
```

这就是 Linux 统一 I/O 模型的本质。

---

## 9. 我们在工程中应该关注哪些点

### 9.1 fd 泄漏

fd 泄漏是 Linux 服务端程序最常见的问题之一。

典型原因：

```text
open 后异常路径没有 close
socket accept 后没有 close
HTTP response body 没有关闭
文件流没有关闭
fork/exec 后子进程继承不该继承的 fd
epoll fd、eventfd、timerfd 没有关闭
```

表现：

```text
Too many open files
accept 失败
open 失败
socket 创建失败
服务端连接异常
```

排查：

```bash
ulimit -n
cat /proc/<pid>/limits
ls /proc/<pid>/fd | wc -l
lsof -p <pid>
```

治理：

```text
所有 fd 必须有明确 owner
异常路径必须 close
使用 try-with-resources / defer / RAII
设置 close-on-exec
监控进程 fd 数量
压测时观察 fd 是否随时间单调增长
```

### 9.2 fd 上限

Linux 对 fd 有多层限制：

```text
进程级限制：ulimit -n
系统级限制：fs.file-max
systemd LimitNOFILE
容器 runtime 限制
应用框架连接数限制
```

线上服务应关注：

```bash
cat /proc/<pid>/limits
cat /proc/sys/fs/file-max
cat /proc/sys/fs/file-nr
```

如果连接数很大，例如网关、注册中心、长连接服务、MQ、推送系统，fd 上限必须按容量规划。

### 9.3 fd 继承与安全

fd 继承问题经常不明显，但危害很大。

典型问题：

```text
子进程继承监听 socket
子进程继承敏感文件 fd
子进程继承数据库连接
子进程继承 pipe 写端导致读端永远不 EOF
```

治理：

```text
默认使用 O_CLOEXEC
默认使用 SOCK_CLOEXEC
默认使用 EPOLL_CLOEXEC
fork 后在子进程关闭不需要的 fd
审计 /proc/<pid>/fd
```

### 9.4 共享 offset 的副作用

`dup()` 和 `fork()` 后共享 open file description，会共享文件偏移量。([Man7][5])

如果多个执行流并发读写同一个 open file description，可能出现：

```text
读取位置互相影响
写入位置不符合预期
日志错乱
文件处理重复或遗漏
```

解决办法：

```text
需要独立 offset 时，分别 open
需要并发写日志时，使用 O_APPEND 或日志框架
需要指定位置读写时，使用 pread/pwrite
```

### 9.5 socket fd 与连接生命周期

每个 TCP 连接通常对应一个 socket fd。长连接系统要关注：

```text
连接数
fd 数
CLOSE-WAIT
TIME-WAIT
ESTABLISHED
send queue / recv queue
```

如果 `CLOSE-WAIT` 很多，通常说明对端已经关闭连接，但本端应用没有及时 close fd。

排查：

```bash
ss -antp
ss -s
lsof -p <pid> -i
```

### 9.6 epoll 与 fd 生命周期

epoll 监控的是 fd 相关的内核对象。`epoll_ctl(2)` 说明，`epoll_ctl()` 用于向 epoll 实例的 interest list 添加、修改、删除目标 fd。([Man7][12])

工程上要关注：

```text
fd close 后是否及时从 epoll 删除
连接对象和 fd 生命周期是否一致
fd 编号复用是否导致业务对象错配
EPOLLONESHOT / EPOLLET 是否正确处理
```

fd 编号会被内核复用，因此应用层绝对不能只靠 fd int 作为长期唯一身份。高并发网络框架通常会把 fd 与 connection object、generation、channel id 绑定，避免 fd 复用导致误操作。

### 9.7 删除文件但磁盘空间不释放

常见现象：

```text
rm 大日志文件后 df 仍然显示磁盘空间没释放
```

原因通常是进程仍持有该文件 fd。由于 fd 引用 open file description，而 open file description 仍引用底层文件对象，所以磁盘空间不会立即释放。

排查：

```bash
lsof | grep deleted
ls -l /proc/<pid>/fd | grep deleted
```

处理：

```text
让进程关闭 fd
重启进程
通过日志框架 reload
使用 logrotate 的 copytruncate 或正确 reopen 机制
```

### 9.8 非阻塞 fd 与事件驱动

高性能网络服务通常会把 socket fd 设置为非阻塞，然后交给 epoll 管理。

关注点：

```text
O_NONBLOCK 是否设置正确
EAGAIN / EWOULDBLOCK 是否正确处理
边缘触发是否读到 EAGAIN
写缓冲区满时是否注册写事件
慢客户端是否导致发送队列膨胀
```

fd 是事件驱动模型的核心，epoll 只是告诉你“哪个 fd 可读/可写”，真正的状态机仍然需要应用正确管理。

---

## 10. fd 在线上排查中的常用命令体系

### 10.1 查看某进程打开了哪些 fd

```bash
ls -l /proc/<pid>/fd
```

`/proc/pid/fd` 中每个条目都对应进程打开的一个 fd。([Man7][7])

### 10.2 查看 fd 详细信息

```bash
cat /proc/<pid>/fdinfo/<fd>
```

`/proc/pid/fdinfo` 提供对应 fd 的信息，内容会根据 fd 类型变化。([Ubuntu Manpages][13])

### 10.3 统计 fd 数量

```bash
ls /proc/<pid>/fd | wc -l
```

### 10.4 查看 socket 连接状态

```bash
ss -antp
ss -s
```

### 10.5 找 deleted 文件

```bash
lsof | grep deleted
```

### 10.6 查看进程限制

```bash
cat /proc/<pid>/limits
ulimit -n
```

---

## 11. fd 设计带来的工程启示

fd 的设计把复杂资源统一成小整数句柄，这带来了巨大的简洁性，但也带来了工程责任。

第一，fd 是资源，必须关闭。它不像普通内存对象那样只靠语言 GC 就能可靠表达生命周期。很多语言的文件对象、socket 对象最终仍然持有 fd；如果应用不关闭，内核资源仍然泄漏。

第二，fd 是进程局部的。跨进程传递 fd 编号本身没有意义，除非通过 Unix domain socket 的 SCM_RIGHTS 这类机制传递真正的 fd 引用。

第三，fd 背后可能不是普通文件。它可能是 socket、pipe、eventfd、epoll、设备、procfs 节点。因此排查 fd 时不能只看编号，要看 `/proc/<pid>/fd/<n>` 指向的对象。

第四，fd 的生命周期经常跨越 fork、exec、dup、epoll、线程池和连接池。服务端稳定性问题中，很多“连接没释放”“日志删了空间不释放”“进程退出慢”“客户端连接异常”，最后都能追溯到 fd 生命周期管理。

第五，“一切皆文件”不是口号，而是 Linux 内核接口统一化的实践。它让普通文件、网络连接、管道、终端、设备、事件通知对象都可以通过一组统一系统调用协同工作。

---

## 12. 结论

Linux 文件描述符是“一切皆文件”思想在用户态最直接的体现。fd 表面上是一个非负整数，本质上是当前进程文件描述符表中的索引，它指向系统级 open file description，再进一步连接 VFS `struct file`、dentry、inode 和具体资源实现。

fd 的价值在于统一。普通文件、socket、pipe、终端、设备、epoll、eventfd 等资源可以通过相似的接口被打开、读写、关闭、监控和传递。VFS 则在内核中承担适配层，把统一的 fd 操作分发到不同对象的具体实现。

工程实践中，fd 是服务稳定性的关键资源。我们需要关注 fd 泄漏、fd 上限、close-on-exec、fork/dup 共享 open file description、连接池复用、epoll 生命周期、CLOSE-WAIT、deleted 文件占用磁盘空间等问题。

最终可以把 fd 理解为一句话：

```text
fd 是 Linux 进程访问内核资源的统一句柄；
“一切皆文件”的工程落点，就是一切可 I/O 资源尽量都能被 fd 引用、被 VFS 管理、被统一系统调用操作。
```

[1]: https://man7.org/tlpi/download/TLPI-04-File_IO_The_Universal_IO_Model.pdf?utm_source=chatgpt.com "FILE I/O: THE UNIVERSAL I/O MODEL"
[2]: https://linux-kernel-labs.github.io/refs/pull/189/merge/labs/filesystems_part1.html?utm_source=chatgpt.com "File system drivers (Part 1)"
[3]: https://man7.org/linux/man-pages/man2/open.2.html?utm_source=chatgpt.com "open(2) - Linux manual page"
[4]: https://docs.kernel.org/filesystems/vfs.html?utm_source=chatgpt.com "Overview of the Linux Virtual File System"
[5]: https://man7.org/linux/man-pages/man2/dup.2.html?utm_source=chatgpt.com "dup(2) - Linux manual page"
[6]: https://man7.org/linux/man-pages/man7/epoll.7.html?utm_source=chatgpt.com "epoll(7) - Linux manual page"
[7]: https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html?utm_source=chatgpt.com "proc_pid_fd(5) - Linux manual page"
[8]: https://fenix.tecnico.ulisboa.pt/downloadFile/1126518382330349/Lab%205%20-%20the-linux-programming-interface-44.pdf?utm_source=chatgpt.com "The Linux Programming Interface"
[9]: https://linux.die.net/man/2/epoll_create?utm_source=chatgpt.com "epoll_create(2): open epoll file descriptor - Linux man page"
[10]: https://man7.org/linux/man-pages/man2/fork.2.html?utm_source=chatgpt.com "fork(2) - Linux manual page"
[11]: https://man7.org/linux/man-pages/man3/fcntl.3p.html?utm_source=chatgpt.com "fcntl(3p) - Linux manual page"
[12]: https://man7.org/linux/man-pages/man2/epoll_ctl.2.html?utm_source=chatgpt.com "epoll_ctl(2) - Linux manual page"
[13]: https://manpages.ubuntu.com/manpages/noble/man5/proc_pid_fdinfo.5.html?utm_source=chatgpt.com "proc/pid/fdinfo/ - information about file descriptors"
