---
title: 虚拟线程的本质、运行时调度与 Linux 内核线程模型研究
category: 并发工程
summary: 对比 Java 虚拟线程、Go goroutine 与 Linux task_struct，解释用户态调度、阻塞卸载、clone 调用链和内核线程模型的边界。
tags:
  - 虚拟线程
  - Project Loom
  - Goroutine
  - Linux
  - task_struct
readingDirection: 适合在评估 Java 虚拟线程、Go goroutine、M:N 调度、阻塞 I/O 与 Linux 内核线程关系时阅读。
outline: deep
---

# 虚拟线程的本质、运行时调度与 Linux 内核线程模型研究

## 摘要

虚拟线程是由语言运行时实现的用户态并发执行单元。它在 Java 中表现为 `java.lang.Thread` 的一种轻量级实现，在 Go 中对应 goroutine 所代表的轻量级并发单元。虚拟线程并不是 Linux 内核直接调度的实体，内核能够直接调度的是进程或线程在 Linux 中统一抽象出来的 `task_struct`。Java 虚拟线程和 Go goroutine 都需要依附于少量操作系统线程执行用户代码，但它们的调度、阻塞处理、栈管理、与标准库集成方式不同。

虚拟线程带来的性能收益并不是让单段 CPU 代码执行得更快，而是在大量阻塞型任务中减少内核线程数量、减少线程创建成本、减少内核调度压力，并通过运行时调度把等待 I/O 的并发单元从承载线程上卸载下来。JEP 444 明确说明，虚拟线程不是“更快的线程”，它的目标是提升规模和吞吐，而不是降低单个任务的执行延迟。([OpenJDK][1])

**关键词**：虚拟线程；Project Loom；goroutine；M:N 调度；Linux clone；task_struct；内核线程；用户态调度

---

## 1. 引言

传统服务端程序常采用“一个请求一个线程”的模型。该模型直接、可调试、调用栈清晰，但在高并发 I/O 场景下，平台线程或操作系统线程的数量会成为资源约束。每个操作系统线程通常对应内核调度实体，涉及内核栈、调度状态、线程本地存储、信号、文件描述符视图、地址空间引用等资源。线程数量上升时，内核调度、上下文切换、内存占用和阻塞等待都会增加系统负担。

虚拟线程模型将“应用并发单元”和“内核调度单元”解耦。应用可以创建大量轻量级并发单元，而真正进入 Linux 内核调度队列的是较少数量的承载线程。在 Java 中，虚拟线程由 JDK 提供，运行在平台线程之上；在 Go 中，goroutine 由 Go runtime 提供，运行在 M，即操作系统线程之上。Java 官方文档说明，虚拟线程运行 Java 代码时会挂载到平台线程，阻塞 I/O 时可以从平台线程卸载，使该平台线程继续服务其他虚拟线程。([Oracle Docs][2])

---

## 2. 虚拟线程的本质

从操作系统视角看，虚拟线程不是内核线程。它没有独立的 Linux `task_struct`，不会作为独立调度实体出现在内核调度器中。JEP 444 将 Java 虚拟线程定义为由 JDK 而非 OS 提供的轻量级线程，并明确称其属于用户态线程的一种实现。它采用 M:N 调度，即大量虚拟线程映射到较少数量的操作系统线程。([OpenJDK][1])

从语言运行时视角看，虚拟线程是“可挂起、可恢复的执行上下文”。这个上下文至少包含：

1. 代码执行位置；
2. 调用栈或栈片段；
3. 局部变量状态；
4. 线程或协程状态；
5. 调度器可识别的就绪、等待、阻塞、结束等状态；
6. 与运行时集成的唤醒机制。

Java 虚拟线程使用 continuation 保存和恢复执行状态。OpenJDK 的 `VirtualThread` 源码中可以看到虚拟线程内部持有 `Continuation`，并在运行时执行 mount、unmount、yield、park、unpark 等状态转换。虚拟线程运行代码时挂载到当前平台线程，发生 park、阻塞或 yield 时通过 continuation 让出执行权。([GitHub][3])

Go goroutine 则由 Go runtime 中的 `g` 结构表示。Go 官方 runtime 文档说明，调度器管理 G、M、P 三类资源：G 是 goroutine，M 是操作系统线程，P 是执行用户 Go 代码所需的调度与分配器资源。调度器的任务是把 G、M、P 匹配起来执行。([Go][4])

因此，虚拟线程的本质不是“创建了更多内核线程”，而是“在用户态创建了更多可调度执行上下文，并把它们复用到较少的内核线程上”。

---

## 3. 虚拟线程性能收益的来源

虚拟线程的性能收益主要来自规模化能力，而不是单个线程的指令执行速度。JEP 444 明确指出：如果任务是 CPU 计算，例如排序大数组，线程数量超过处理器核心数并不会带来收益；虚拟线程不是更快的线程，它们提供的是更高吞吐规模，而不是更低延迟。([OpenJDK][1])

在阻塞 I/O 场景中，传统平台线程执行阻塞调用时，线程本身会被占住。这个线程即使没有执行 CPU 指令，也仍然作为内核调度实体存在，并持有线程栈和调度状态。虚拟线程在 JDK 可感知的阻塞点上可以卸载：虚拟线程保存执行上下文，承载它的平台线程被释放，随后可以挂载其他虚拟线程继续执行。Oracle 文档描述了这一过程：虚拟线程执行阻塞 I/O 时，Java runtime 暂停虚拟线程；原先关联的 OS 线程可以执行其他虚拟线程。([Oracle Docs][2])

这个收益可以拆成四类客观机制：

第一，创建成本降低。虚拟线程或 goroutine 的创建主要是运行时对象与栈元数据的创建，不需要每个并发单元都进入 `clone()` 创建新的内核调度实体。

第二，阻塞成本降低。阻塞 I/O 可以被运行时转化为挂起用户态执行上下文，而不是长期占用一个 OS 线程。

第三，调度成本降低。大量等待态并发单元由语言运行时管理，内核只需要调度少量承载线程。

第四，栈成本降低。Go 官方文档说明，非死亡状态的 G 有用户栈，用户栈从较小尺寸开始并可动态增长或收缩。([Go][4]) Java 虚拟线程也避免为每个应用任务分配传统平台线程所需的固定大栈。

---

## 4. Java 虚拟线程与 Go goroutine 的运行时差异

Java 和 Go 都采用用户态轻量级并发单元复用 OS 线程的模式，但二者在语言表层、调度器结构、阻塞集成、生态兼容目标上存在差异。

Java 虚拟线程的关键目标是保留 `java.lang.Thread` 编程模型。JEP 444 将虚拟线程设计为 `Thread` 的一种实现，使已有基于 thread-per-request 的代码可以以较少改动迁移。虚拟线程仍然可以被调试器、JFR、`jcmd` 等工具观察。([OpenJDK][1]) Java 的模型是：应用看到的是 `Thread`，JDK 调度器把虚拟线程挂载到平台线程，平台线程再由 OS 调度。

Go goroutine 则是语言级并发构造。`go f()` 创建 goroutine，调度由 Go runtime 的 G-M-P 模型完成。Go runtime 文档说明，M 可以执行用户 Go 代码、runtime 代码、系统调用或处于空闲状态；当 M 进入系统调用时，它会把 P 归还给空闲 P 池，使其他 M 可以继续执行 Go 代码。([Go][4])

两者的映射关系可以概括为：

| 层次       | Java 虚拟线程                             | Go goroutine                            |
| -------- | ------------------------------------- | --------------------------------------- |
| 应用并发单元   | `VirtualThread`，仍是 `java.lang.Thread` | `G`，即 goroutine                         |
| 承载执行单元   | Platform thread / carrier thread      | `M`，即 OS thread                         |
| 调度资源     | JDK 虚拟线程调度器                           | Go runtime 的 G-M-P 调度器                  |
| 并发模型暴露方式 | 保留 Java Thread API                    | 语言关键字 `go`                              |
| 阻塞处理     | JDK 可感知阻塞点可卸载虚拟线程                     | runtime 管理 syscall、netpoll、park/goready |
| 内核可见性    | OS 看不到虚拟线程，只看到承载平台线程                  | OS 看不到 goroutine，只看到 M                  |

Java 文档明确说明，OS 调度平台线程，而 Java runtime 调度虚拟线程；虚拟线程挂载到平台线程后，平台线程再由 OS 正常调度。([Oracle Docs][2]) Go 文档则说明调度器负责匹配 G、M、P，M 进入系统调用时 P 可被释放给其他执行单元。([Go][4])

---

## 5. 系统调用层面的共同点与差异

从 Linux 内核角度看，不同语言最终访问文件、网络、定时器、线程、内存映射等内核资源时，都必须通过 Linux 提供的系统调用接口、vDSO、共享内存机制或设备接口进入内核能力边界。Java、Go、C、Rust 等语言调用 socket、epoll、futex、clone、mmap、read、write 等内核能力时，底层必须落到当前操作系统和 CPU 架构支持的 ABI 上。

但“不同库函数最终都指向相同系统调用”这一说法只在部分语义等价的场景成立。不同库函数是否落到相同 syscall，取决于：

1. 目标操作系统；
2. CPU 架构；
3. libc 或 runtime 实现；
4. 文件描述符是否非阻塞；
5. 是否使用 epoll、io_uring、poll、select；
6. 是否经过缓存、缓冲区、用户态队列；
7. 是否使用 JIT intrinsic、vDSO 或纯用户态实现；
8. 是否由 runtime 拦截并转换为异步等待。

例如，Java 中看似阻塞的 `SocketInputStream.read()`，在虚拟线程场景下可能由 JDK 通过非阻塞 I/O 与 poller 协作完成挂起和恢复；Go 中的网络 I/O 会与 runtime netpoller 集成；C 中直接调用阻塞 `read()` 则可能直接阻塞当前内核线程。它们对应用暴露的语义可能相似，但系统调用路径、阻塞行为和调度后果并不一定相同。

对于线程创建，Linux 提供 `clone()` / `clone3()` 作为更精细的创建接口。man-pages 描述 `clone()` 和 `clone3()` 可以控制子执行上下文是否共享虚拟地址空间、文件描述符表、信号处理器等资源。([man7.org][5]) Linux Kernel Labs 文档说明，在 Linux 中新线程或新进程都通过 `clone()` 创建，`fork()` 和 `pthread_create()` 都使用 clone 实现。([linux-kernel-labs.github.io][6])

但是 Java 虚拟线程创建本身不会为每个虚拟线程调用 `clone()` 创建新的 Linux 线程。它创建的是 JDK 内部对象和 continuation。只有承载虚拟线程的平台线程本身需要对应 OS 线程，平台线程创建才会涉及内核线程创建路径。Go goroutine 创建同理，不会为每个 goroutine 调用 `clone()`；Go runtime 创建新的 M，也就是新的 OS thread 时，才会进入内核线程创建路径。

---

## 6. Linux 系统调用函数是否“都一样”

Linux 系统调用接口在“同一内核、同一架构、同一 ABI”下具有统一入口语义。例如用户态程序调用 `clone3()`，最终进入内核中对应的 `SYSCALL_DEFINE2(clone3, ...)` 实现，并由内核复制参数后调用 `kernel_clone()`。Linux `fork.c` 当前源码显示，`clone3` 系统调用会复制用户态参数、校验参数，然后调用 `kernel_clone(args)`。([codebrowser.dev][7])

但不能把“Linux 系统调用函数都一样”理解成所有环境下完全相同。差异至少包括：

1. 不同 CPU 架构的 syscall 入口不同；
2. 不同内核版本的内部函数名和调用链可能不同；
3. 同名 syscall 在不同架构上的参数传递 ABI 可能不同；
4. glibc、musl、Go runtime、JDK native 层可能使用不同封装；
5. 新接口可能替代旧接口，例如 `clone3()` 相比 `clone()` 有更大的 flags 空间和更清晰的参数结构；
6. 内核内部函数不是稳定 ABI，稳定边界主要是用户态可见 syscall ABI。

man-pages 明确说明 `clone3()` 是较新的系统调用，是旧 `clone()` 接口功能的超集，并提供更清晰的参数分离和指定子栈大小等改进。([man7.org][5])

因此，可以说不同语言在 Linux 上使用的是同一个内核提供的能力集合，但不能说所有语言、所有库函数、所有内核版本都会走完全一样的函数路径。

---

## 7. 性能提升是否只能来自内核态

不同语言对性能的提升并不只发生在内核态。虚拟线程、goroutine、协程、异步 runtime 的核心优化大多发生在用户态。它们减少了进入内核的次数、减少了内核线程数量、减少了阻塞线程、减少了内核调度实体，而不是直接修改内核调度器。

用户态可以影响性能的部分包括：

1. 用户态调度策略；
2. 栈的按需增长和压缩；
3. 对象分配和复用；
4. I/O 多路复用方式；
5. 批处理；
6. 避免阻塞内核线程；
7. 减少 syscall 频率；
8. 减少锁竞争；
9. 减少上下文切换；
10. runtime 对 GC、调度器、本地队列、work stealing 的协调。

Go runtime 文档中提到，G、M、P 对象均在堆上分配且不会释放，以保持类型稳定，并可在调度器深层避免写屏障。([Go][4]) 这类优化发生在语言运行时内部，不属于内核态优化。

内核态优化仍然重要，例如 epoll、futex、io_uring、copy-on-write、调度器、网络协议栈、页缓存都会影响性能。但虚拟线程这类技术的关键点是：把大量应用级等待从内核线程模型中移出，让用户态 runtime 承担更多调度工作。

---

## 8. 虚拟线程创建与 Linux fork/clone 调用链

Linux 中创建真实进程或真实线程时，典型路径可以抽象为：

```text
用户态：
fork() / pthread_create() / clone() / clone3()

系统调用层：
sys_fork / sys_clone / sys_clone3

内核核心层：
kernel_clone()
旧版本中常见 _do_fork() / do_fork() 命名

核心复制逻辑：
copy_process()

调度激活：
wake_up_new_task()
```

当前 Linux `fork.c` 中，`kernel_clone()` 注释说明它是主要 fork routine，会复制进程，成功后启动新任务。源码中 `kernel_clone()` 调用 `copy_process()` 创建新的 `task_struct`，随后取得 PID，并调用 `wake_up_new_task()` 把新任务放入调度流程。([codebrowser.dev][7]) `copy_process()` 负责初始化大量 task 字段，并调用 `sched_fork()` 完成调度相关初始化。([codebrowser.dev][7])

这个调用链适用于“创建 Linux 内核可见任务”的场景，例如：

1. `fork()` 创建新进程；
2. `pthread_create()` 创建 POSIX 线程；
3. Go runtime 创建新的 M；
4. JVM 创建新的平台线程；
5. C/C++ 程序直接调用 `clone()` 或 `clone3()`。

但这个调用链不适用于“每创建一个 Java 虚拟线程”或“每创建一个 Go goroutine”。Java 虚拟线程和 Go goroutine 创建的是用户态运行时结构，不是 Linux 内核任务。它们不会在每次创建时进入 `sys_clone`、`kernel_clone`、`copy_process`。只有承载它们的 OS 线程被创建时，才涉及上述路径。

因此，判断一个并发单元是否经过 `copy_process()`，标准不是它在语言里是否叫 thread，而是它是否需要 Linux 内核创建新的调度实体。Java `Thread.ofVirtual().start(...)` 创建虚拟线程时，不创建新的 `task_struct`；Java `new Thread(...).start()` 创建平台线程时，底层需要创建 OS 线程。Go `go f()` 创建 goroutine 时，不创建新的 `task_struct`；Go runtime 增加 M 时，才创建 OS 线程。

---

## 9. 虚拟线程、内核线程与 `task_struct` 的对应关系

Linux 内核把进程和线程都表示为 task。Linux Kernel Labs 文档说明，Linux 的基本单位叫 task，由 `struct task_struct` 表示，同时用于线程和进程；线程和进程的区别主要体现为资源结构是共享还是隔离。([linux-kernel-labs.github.io][6])

在 Linux 中，进程和线程不是两个完全不同的内核实体。它们都拥有各自的 `task_struct`。差别在于 clone flags 决定哪些资源共享：

| 类型           | 是否有独立 `task_struct` | 地址空间             | 文件描述符表       | 信号处理            | 典型创建方式                         |
| ------------ | ------------------: | ---------------- | ------------ | --------------- | ------------------------------ |
| 进程           |                   有 | 通常独立，COW 复制      | 通常复制         | 通常独立            | `fork()`                       |
| POSIX 线程     |                   有 | 共享 `mm_struct`   | 共享或按 flags   | 共享线程组信号语义       | `pthread_create()` → `clone()` |
| Java 平台线程    |                   有 | 属于 JVM 进程地址空间    | 属于 JVM 进程资源  | OS 线程语义         | JVM native thread              |
| Go M         |                   有 | 属于 Go 进程地址空间     | 属于 Go 进程资源   | OS 线程语义         | Go runtime 创建 OS thread        |
| Java 虚拟线程    |   无独立 `task_struct` | JVM 用户态对象        | 不直接持有内核 FD 表 | JDK 管理状态        | JDK runtime                    |
| Go goroutine |   无独立 `task_struct` | Go runtime 用户态对象 | 不直接持有内核 FD 表 | Go runtime 管理状态 | `go` 语句                        |

Linux `clone()` 的 flags 决定资源共享方式。man-pages 说明，`clone()` / `clone3()` 可以控制是否共享虚拟地址空间、文件描述符表、信号处理器，并可把子进程放入不同 namespace。([man7.org][5]) Kernel Labs 也给出示例：如果使用 `CLONE_FILES | CLONE_VM | CLONE_FS`，效果上创建的是线程；如果不使用这些共享 flags，则创建的是新进程。([linux-kernel-labs.github.io][6])

从 `task_struct` 角度看：

进程与线程的相同点是：每个内核调度实体都有一个 `task_struct`，都有调度状态、PID/TID、内核栈、调度类、优先级、CPU 亲和性、cgroup 信息等。

进程与线程的差异是：线程之间通常共享 `mm_struct`、`files_struct`、`fs_struct`、`sighand_struct` 等资源结构；不同进程通常指向不同资源结构。Kernel Labs 文档明确说明，如果两个线程属于同一进程，它们会指向相同的资源结构实例；如果属于不同进程，则指向不同实例。([linux-kernel-labs.github.io][6])

Java 虚拟线程与 Go goroutine 在 `task_struct` 中没有一对一表现。它们只存在于 JVM 或 Go runtime 的用户态数据结构中。Linux 内核只能看到 JVM 进程中的平台线程，或 Go 进程中的 M。虚拟线程当前挂载到哪个 carrier thread，内核并不知道；内核只调度那个 carrier thread 对应的 `task_struct`。

---

## 10. 阻塞、挂起与系统调用的关系

虚拟线程模型的关键不是取消系统调用，而是改变系统调用与应用并发单元之间的绑定关系。

对于 Java 虚拟线程，当代码执行到 JDK 可感知的阻塞操作时，JDK 可以把阻塞等待转换为运行时级挂起。JEP 444 说明，当虚拟线程中的代码调用 `java.*` API 的阻塞 I/O 操作时，runtime 执行非阻塞 OS 调用，并自动挂起虚拟线程，直到稍后可以恢复。([OpenJDK][1])

对于 Go goroutine，Go runtime 中存在 `gopark` 和 `goready` 机制。官方 runtime 文档说明，`gopark` 会把当前 goroutine 放入 waiting 状态并从调度器运行队列移除，然后在当前 M/P 上调度其他 goroutine；`goready` 会把 parked goroutine 放回 runnable 状态并加入运行队列。([Go][4])

这说明 Java 和 Go 都把“等待”从内核线程阻塞中抽象出来。区别是 Java 以保留 `Thread` API 为中心，Go 以语言级 goroutine 和 runtime scheduler 为中心。最终的网络、文件、定时器、futex、epoll 等仍然需要操作系统能力，但等待期间不必让每个应用并发单元都占有一个内核线程。

---

## 11. 虚拟线程是否属于内核态

虚拟线程属于用户态。更精确地说，虚拟线程的数据结构、调度状态、挂起恢复逻辑位于语言运行时中。它执行用户代码时必须运行在某个真实 OS 线程上；该 OS 线程进入内核态执行 syscall 时，内核看到的是承载线程，而不是虚拟线程。

Java 官方文档明确描述：虚拟线程仍然在 OS 线程上运行代码，但不绑定到特定 OS 线程；阻塞时 runtime 暂停虚拟线程，释放关联的 OS 线程去执行其他虚拟线程。([Oracle Docs][2]) JEP 444 也说明 OS 不知道虚拟线程存在，OS 级监控只能看到 JDK 进程使用的 OS 线程数量少于虚拟线程数量。([OpenJDK][1])

因此：

```text
虚拟线程本身：用户态
虚拟线程调度器：用户态 runtime
承载线程：内核可见 task_struct
系统调用执行：进入内核态
I/O 完成通知：内核态产生事件，用户态 runtime 消费并恢复虚拟线程
```

---

## 12. 结论

虚拟线程是用户态运行时实现的轻量级执行上下文，不是 Linux 内核线程。它的性能收益来自 M:N 调度、轻量级创建、低成本挂起恢复、减少 OS 线程占用、减少内核调度压力，以及对阻塞 I/O 的 runtime 集成。它不改变 CPU 指令本身的执行速度，也不会让 CPU 密集型任务在线程数量超过核心数后继续获得线性收益。

Java 虚拟线程和 Go goroutine 在本质上都属于用户态轻量级并发单元，但实现目标不同。Java 虚拟线程强调兼容 `java.lang.Thread` 和阻塞式代码风格；Go goroutine 是语言级并发模型的一部分，由 G-M-P scheduler 管理。二者都需要 OS 线程作为实际执行载体，OS 只调度 carrier thread 或 M，而不直接调度虚拟线程或 goroutine。

Linux 中真正创建内核线程或进程时，会进入 `clone` / `clone3`、`kernel_clone()`、`copy_process()`、`wake_up_new_task()` 这类路径。Java 虚拟线程和 Go goroutine 的创建不会逐个触发该路径；只有 JVM 平台线程、Go M、POSIX 线程或普通进程创建时才会涉及 `task_struct` 的创建和初始化。

从 `task_struct` 角度看，Linux 进程和线程都是 task，差异主要来自资源结构是否共享。虚拟线程和 goroutine 没有自己的 `task_struct`，它们只在语言运行时中存在；内核只能感知承载它们运行的真实 OS 线程。

[1]: https://openjdk.org/jeps/444 "JEP 444: Virtual Threads"
[2]: https://docs.oracle.com/en/java/javase/24/core/virtual-threads.html "Virtual Threads"
[3]: https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/VirtualThread.java?utm_source=chatgpt.com "jdk/src/java.base/share/classes/java/lang/VirtualThread. ..."
[4]: https://go.dev/src/runtime/HACKING " - The Go Programming Language"
[5]: https://man7.org/linux/man-pages/man2/clone.2.html "clone(2) - Linux manual page"
[6]: https://linux-kernel-labs.github.io/refs/heads/master/lectures/processes.html "Processes — The Linux Kernel  documentation"
[7]: https://codebrowser.dev/linux/linux/kernel/fork.c.html "fork.c source code [linux/kernel/fork.c] - Codebrowser "
