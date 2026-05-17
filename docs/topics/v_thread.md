---
title: "Virtual Threads, Runtime Scheduling, and the Linux Kernel Thread Model"
category: Concurrency Engineering
summary: A comparative explanation of Java virtual threads, Go goroutines, Linux task_struct, user-mode scheduling, blocking I/O unmounting, clone paths, and kernel-visible thread boundaries.
tags:
  - Virtual Threads
  - Project Loom
  - Goroutine
  - Linux
  - task_struct
readingDirection: Read this when evaluating Java virtual threads, Go goroutines, M:N scheduling, blocking I/O behavior, or their relationship with Linux kernel threads.
outline: deep
---

# Virtual Threads, Runtime Scheduling, and the Linux Kernel Thread Model

## Overview

A comparative explanation of Java virtual threads, Go goroutines, Linux task_struct, user-mode scheduling, blocking I/O unmounting, clone paths, and kernel-visible thread boundaries.

## Abstract

Virtual threads are user-mode concurrency units implemented by a language runtime. In Java, they appear as a lightweight implementation of `java.lang.Thread`. In Go, the closest equivalent is the lightweight concurrency unit represented by goroutines. Virtual threads are not entities directly scheduled by the Linux kernel. The kernel directly schedules processes or threads represented in Linux by the unified task abstraction, `task_struct`. Java virtual threads and Go goroutines both need a smaller number of operating-system threads to execute user code, but their scheduling, blocking behavior, stack management, and standard-library integration differ.

The performance benefit of virtual threads does not come from making a single CPU-bound block of code run faster. It comes from reducing the number of kernel threads, lowering thread-creation cost, reducing kernel-scheduler pressure, and letting the runtime detach waiting I/O tasks from their carrier threads. JEP 444 clearly states that virtual threads are not "faster threads"; their purpose is to improve scale and throughput, not the latency of a single task. ([OpenJDK][1])

**Keywords:** virtual threads, Project Loom, goroutine, M:N scheduling, Linux clone, task_struct, kernel thread, user-mode scheduling

---

## 1. Introduction

Traditional server programs often use a "one request, one thread" model. This model is direct, debuggable, and has a clear call stack, but in high-concurrency I/O workloads, the number of platform threads or operating-system threads becomes a resource constraint. Each OS thread is usually a kernel scheduling entity and involves a kernel stack, scheduling state, thread-local storage, signal semantics, file-descriptor view, and address-space references. As thread count increases, kernel scheduling, context switching, memory usage, and blocking waits all increase system load.

The virtual-thread model separates "application concurrency unit" from "kernel scheduling unit." Applications can create many lightweight concurrency units, while only a smaller number of carrier threads enter the Linux scheduler. In Java, virtual threads are provided by the JDK and run on platform threads. In Go, goroutines are provided by the Go runtime and run on M, the operating-system thread. Java documentation states that when a virtual thread runs Java code, it is mounted on a platform thread; when it performs blocking I/O, it can be unmounted so that the platform thread can serve other virtual threads. ([Oracle Docs][2])

---

## 2. Essence of Virtual Threads

From the operating-system perspective, a virtual thread is not a kernel thread. It has no independent Linux `task_struct` and does not appear as an independent scheduling entity in the kernel scheduler. JEP 444 defines Java virtual threads as lightweight threads provided by the JDK rather than the OS, and describes them as a form of user-mode thread. They use M:N scheduling, where many virtual threads are mapped to a smaller number of operating-system threads. ([OpenJDK][1])

From the language-runtime perspective, a virtual thread is a suspendable and resumable execution context. It contains at least:

1. The current code execution position.
2. The call stack or stack chunks.
3. Local-variable state.
4. Thread or coroutine state.
5. Scheduler-visible states such as ready, waiting, blocked, terminated.
6. Runtime-integrated wakeup mechanisms.

Java virtual threads use continuations to save and restore execution state. The OpenJDK `VirtualThread` source shows that a virtual thread holds a `Continuation` and performs mount, unmount, yield, park, and unpark transitions at runtime. When a virtual thread runs code, it is mounted on the current platform thread. When it parks, blocks, or yields, the continuation lets it give up execution. ([GitHub][3])

Go goroutines are represented by the runtime `g` structure. Go runtime documentation explains that the scheduler manages G, M, and P: G is a goroutine, M is an operating-system thread, and P is the resource required to execute user Go code, including scheduler and allocator state. The scheduler matches G, M, and P for execution. ([Go][4])

Therefore, the essence of virtual threads is not "creating more kernel threads." It is "creating more user-mode schedulable execution contexts and multiplexing them onto fewer kernel threads."

---

## 3. Where the Performance Benefit Comes From

Virtual-thread performance benefits mainly come from scalability, not faster instruction execution. JEP 444 states that if a task is CPU-bound, such as sorting a large array, having more threads than processor cores does not improve throughput. Virtual threads are not faster threads; they provide higher throughput scale, not lower latency for a single task. ([OpenJDK][1])

In blocking I/O workloads, a traditional platform thread is occupied when it executes a blocking call. Even if it is not executing CPU instructions, it still exists as a kernel scheduling entity and holds its stack and scheduling state. At blocking points that the JDK can recognize, a virtual thread can be unmounted: the virtual thread saves its execution context, releases its carrier platform thread, and later resumes on a platform thread when the operation is ready. Oracle documentation describes this process: when a virtual thread performs blocking I/O, the Java runtime suspends the virtual thread and the associated OS thread can execute other virtual threads. ([Oracle Docs][2])

The benefit can be split into four mechanisms:

### 3.1 Lower Creation Cost

Creating a virtual thread or goroutine mainly creates runtime objects and stack metadata. It does not require every concurrency unit to enter `clone()` and create a new kernel scheduling entity.

### 3.2 Lower Blocking Cost

Blocking I/O can be converted into suspension of a user-mode execution context instead of occupying one OS thread for the entire wait.

### 3.3 Lower Kernel Scheduling Pressure

Many waiting concurrency units are managed by the language runtime. The kernel only needs to schedule the smaller number of carrier threads.

### 3.4 Lower Stack Cost

Go documentation states that a non-dead G has a user stack that starts small and can grow or shrink dynamically. ([Go][4]) Java virtual threads similarly avoid allocating the large fixed native stack commonly associated with traditional platform threads for every application task.

---

## 4. Java Virtual Threads and Go Goroutines

Java and Go both multiplex lightweight user-mode concurrency units onto OS threads, but their surface model, scheduler structure, blocking integration, and compatibility goals differ.

Java virtual threads aim to preserve the `java.lang.Thread` programming model. JEP 444 makes virtual threads an implementation of `Thread`, so existing thread-per-request code can often migrate with fewer changes. Virtual threads can still be observed by debuggers, JFR, `jcmd`, and similar tools. ([OpenJDK][1]) The model is:

```text
application sees Thread
JDK scheduler mounts virtual thread on platform thread
platform thread is scheduled by the OS
```

Go goroutines are language-level concurrency constructs. `go f()` creates a goroutine, and scheduling is handled by the Go runtime G-M-P scheduler. Go runtime documentation states that M can execute user Go code, runtime code, a system call, or be idle; when M enters a system call, it releases P to the idle P pool so other M instances can continue executing Go code. ([Go][4])

| Layer | Java virtual thread | Go goroutine |
| --- | --- | --- |
| Application concurrency unit | `VirtualThread`, still a `java.lang.Thread` | `G`, the goroutine |
| Carrier execution unit | Platform thread / carrier thread | `M`, the OS thread |
| Scheduling resource | JDK virtual-thread scheduler | Go runtime G-M-P scheduler |
| Surface model | Java Thread API | `go` keyword |
| Blocking handling | JDK-aware blocking points can unmount virtual threads | runtime manages syscall, netpoll, park, goready |
| Kernel visibility | OS sees carrier threads, not virtual threads | OS sees M, not goroutines |

Java documentation states that the OS schedules platform threads, while the Java runtime schedules virtual threads. A virtual thread mounted on a platform thread then runs because the OS schedules that platform thread. ([Oracle Docs][2]) Go documentation states that the scheduler matches G, M, and P, and that P can be released while M is in a system call. ([Go][4])

---

## 5. System Calls: Common Boundary, Different Paths

From the Linux kernel perspective, languages eventually access files, networks, timers, threads, memory mappings, and other kernel resources through system calls, vDSO, shared memory, or device interfaces. Java, Go, C, and Rust all cross the OS and CPU ABI boundary when they use socket, epoll, futex, clone, mmap, read, write, and similar capabilities.

However, saying "different library functions eventually point to the same syscall" is only partially true. Whether functions reach the same syscall depends on:

1. The target operating system.
2. CPU architecture.
3. libc or runtime implementation.
4. Whether the file descriptor is nonblocking.
5. Whether epoll, io_uring, poll, or select is used.
6. Whether caches, buffers, or user-mode queues are involved.
7. Whether JIT intrinsics, vDSO, or pure user-mode implementations apply.
8. Whether the runtime intercepts the operation and converts it into async waiting.

For example, Java `SocketInputStream.read()` may look blocking, but with virtual threads the JDK can implement it through nonblocking I/O and a poller so the virtual thread is suspended and resumed. Go network I/O integrates with the runtime netpoller. A C program directly calling blocking `read()` can block the current kernel thread. The application-level semantics may look similar, but syscall path, blocking behavior, and scheduling consequence can differ.

For thread creation, Linux provides `clone()` and `clone3()`. man-pages describes how these interfaces control whether the child execution context shares virtual address space, file-descriptor table, signal handlers, and other resources. ([man7.org][5]) Linux Kernel Labs documentation explains that in Linux both new threads and new processes are created through `clone()`, and that `fork()` and `pthread_create()` are implemented using clone. ([linux-kernel-labs.github.io][6])

Java virtual-thread creation does not call `clone()` for every virtual thread. It creates JDK internal objects and continuations. Only the carrier platform threads correspond to OS threads. Go goroutine creation is similar: `go f()` does not create a new `task_struct`; the Go runtime creates an OS thread only when it needs a new M.

---

## 6. Are Linux System Call Functions "All the Same"?

Under the same kernel, architecture, and ABI, Linux syscalls have unified entry semantics. For example, user-space `clone3()` eventually reaches the kernel implementation for that syscall, which copies user arguments and calls `kernel_clone(args)`. Current Linux `fork.c` shows that `clone3` copies the user-space argument structure, validates it, and then calls `kernel_clone(args)`. ([codebrowser.dev][7])

But this does not mean all environments use completely identical paths:

1. Syscall entry differs across CPU architectures.
2. Internal function names and call chains differ across kernel versions.
3. The same syscall can have different argument ABI across architectures.
4. glibc, musl, Go runtime, and JDK native code can use different wrappers.
5. Newer interfaces can replace older ones, such as `clone3()` improving on `clone()`.
6. Kernel-internal functions are not stable ABI; the stable boundary is the user-space syscall ABI.

man-pages explains that `clone3()` is a newer syscall and a functional superset of the older `clone()` interface, with clearer argument separation and additional extensibility such as child-stack size. ([man7.org][5])

So different languages use the same kernel capability set on Linux, but not every language, library, or kernel version follows the exact same function path.

---

## 7. Performance Improvement Is Not Only in Kernel Mode

Language-level performance improvement does not only happen in kernel mode. Virtual threads, goroutines, coroutines, and async runtimes mainly optimize in user mode. They reduce kernel entries, reduce the number of kernel threads, reduce blocked OS threads, and reduce the number of kernel scheduling entities. They do not directly modify the kernel scheduler.

User-mode runtime can improve:

```text
user-mode scheduling policy
on-demand stack growth and shrinking
object allocation and reuse
I/O multiplexing
batching
avoidance of blocking kernel threads
fewer syscalls
less lock contention
fewer context switches
coordination among GC, scheduler, local queues, and work stealing
```

Go runtime documentation notes that G, M, and P are allocated on the heap and never freed, preserving type stability and allowing deep scheduler paths to avoid write barriers. ([Go][4]) This kind of optimization belongs to the language runtime, not the kernel.

Kernel optimization is still important. epoll, futex, io_uring, copy-on-write, scheduling, network stack, and page cache all affect performance. But the key point of virtual-thread technology is to move large amounts of application-level waiting out of the kernel-thread model and let the user-mode runtime do more scheduling work.

---

## 8. Virtual Thread Creation and Linux fork/clone Path

When Linux creates a real process or real thread, the typical path is:

```text
user space:
  fork() / pthread_create() / clone() / clone3()

syscall layer:
  sys_fork / sys_clone / sys_clone3

kernel core:
  kernel_clone()
  older versions often used names such as _do_fork() / do_fork()

core copy logic:
  copy_process()

scheduler activation:
  wake_up_new_task()
```

Current Linux `fork.c` comments describe `kernel_clone()` as the main fork routine. It copies a process, starts the new task on success, calls `copy_process()` to create the new `task_struct`, obtains a PID, and then calls `wake_up_new_task()` to put the task into scheduling. ([codebrowser.dev][7]) `copy_process()` initializes many task fields and calls `sched_fork()` for scheduler-related initialization. ([codebrowser.dev][7])

This path applies when a Linux-kernel-visible task is created:

1. `fork()` creates a new process.
2. `pthread_create()` creates a POSIX thread.
3. The Go runtime creates a new M.
4. The JVM creates a new platform thread.
5. A C/C++ program directly calls `clone()` or `clone3()`.

It does not apply to every Java virtual thread or every Go goroutine. Virtual threads and goroutines create user-mode runtime structures, not Linux kernel tasks. They do not enter `sys_clone`, `kernel_clone`, and `copy_process()` for each concurrency unit. Only their carrier OS threads involve that path.

The standard for whether a concurrency unit goes through `copy_process()` is not whether a language calls it a "thread." The standard is whether Linux must create a new kernel scheduling entity.

```text
Java Thread.ofVirtual().start(...):
  creates a virtual thread, not a new task_struct

Java new Thread(...).start():
  creates a platform thread, which needs an OS thread

Go go f():
  creates a goroutine, not a new task_struct

Go runtime creates a new M:
  creates an OS thread
```

---

## 9. Mapping to task_struct

Linux represents both processes and threads as tasks. Linux Kernel Labs documentation states that the basic Linux unit is called a task and is represented by `struct task_struct`; both threads and processes use it, and their difference is mainly whether resource structures are shared or isolated. ([linux-kernel-labs.github.io][6])

In Linux, processes and threads are not two completely different kernel entities. Both have their own `task_struct`. The difference is which resources clone flags share:

| Type | Independent `task_struct`? | Address space | File descriptors | Signal handling | Typical creation |
| --- | ---: | --- | --- | --- | --- |
| Process | yes | usually independent, COW copied | usually copied | usually independent | `fork()` |
| POSIX thread | yes | shared `mm_struct` | shared or controlled by flags | thread-group semantics | `pthread_create()` -> `clone()` |
| Java platform thread | yes | JVM process address space | JVM process resources | OS thread semantics | JVM native thread |
| Go M | yes | Go process address space | Go process resources | OS thread semantics | Go runtime creates OS thread |
| Java virtual thread | no | JVM user-mode object | no direct kernel fd table | JDK-managed state | JDK runtime |
| Go goroutine | no | Go runtime user-mode object | no direct kernel fd table | runtime-managed state | `go` statement |

Linux `clone()` flags decide sharing. man-pages explains that `clone()` and `clone3()` can control whether virtual address space, file-descriptor tables, signal handlers, and namespaces are shared. ([man7.org][5]) Kernel Labs gives a simple example: if `CLONE_FILES | CLONE_VM | CLONE_FS` is used, the effect is thread-like; without these sharing flags, the result is process-like. ([linux-kernel-labs.github.io][6])

From the `task_struct` perspective, processes and threads are alike because every kernel scheduling entity has one `task_struct`, scheduling state, PID/TID, kernel stack, scheduling class, priority, CPU affinity, and cgroup information.

They differ because threads usually share `mm_struct`, `files_struct`, `fs_struct`, `sighand_struct`, and other resource structures, while different processes usually point to different instances. Kernel Labs notes that if two threads belong to the same process, they point to the same resource structure instances; if they belong to different processes, they point to different instances. ([linux-kernel-labs.github.io][6])

Java virtual threads and Go goroutines have no one-to-one representation in `task_struct`. They exist only inside JVM or Go runtime data structures. Linux sees only JVM platform threads or Go M threads. The kernel does not know which carrier thread a virtual thread is currently mounted on; it only schedules the carrier thread's `task_struct`.

---

## 10. Blocking, Parking, and System Calls

The key of the virtual-thread model is not eliminating syscalls. It changes the binding between syscalls and application concurrency units.

For Java virtual threads, when code reaches a JDK-aware blocking operation, the JDK can convert blocking wait into runtime-level suspension. JEP 444 states that when code in a virtual thread calls blocking I/O operations in `java.*` APIs, the runtime performs a nonblocking OS call and automatically suspends the virtual thread until it can resume. ([OpenJDK][1])

For Go goroutines, the runtime has `gopark` and `goready` mechanisms. Runtime documentation explains that `gopark` puts the current goroutine into waiting state and removes it from the scheduler runqueue, then schedules another goroutine on the current M/P. `goready` puts a parked goroutine back into runnable state and adds it to the runqueue. ([Go][4])

Both Java and Go move "waiting" away from kernel-thread blocking. The difference is that Java centers on preserving the `Thread` API, while Go centers on language-level goroutines and the runtime scheduler. Network, file, timer, futex, epoll, and other mechanisms still need operating-system capabilities, but every application concurrency unit does not need to occupy an OS thread while waiting.

---

## 11. Are Virtual Threads Kernel Mode?

Virtual threads are user-mode structures. More precisely, their data structures, scheduling state, and suspend/resume logic live in the language runtime. When a virtual thread executes user code, it must run on a real OS thread. If that OS thread enters kernel mode to execute a syscall, the kernel sees the carrier thread, not the virtual thread.

Java documentation states that virtual threads still run code on OS threads but are not bound to a specific OS thread; when blocked, the runtime suspends the virtual thread and releases the associated OS thread to execute other virtual threads. ([Oracle Docs][2]) JEP 444 also states that the OS does not know virtual threads exist, and OS-level monitoring observes fewer OS threads than virtual threads in a JDK process. ([OpenJDK][1])

```text
virtual thread itself:
  user mode

virtual-thread scheduler:
  user-mode runtime

carrier thread:
  kernel-visible task_struct

syscall execution:
  enters kernel mode through carrier thread

I/O completion notification:
  kernel produces an event; user-mode runtime consumes it and resumes the virtual thread
```

---

## 12. Conclusion

Virtual threads are lightweight execution contexts implemented by user-mode runtimes. They are not Linux kernel threads. Their performance benefit comes from M:N scheduling, low-cost creation, low-cost suspend/resume, reduced OS-thread occupation, reduced kernel-scheduler pressure, and integration with blocking I/O. They do not make CPU instructions execute faster, and CPU-bound tasks do not gain linear throughput merely by creating more virtual threads than CPU cores.

Java virtual threads and Go goroutines are both user-mode lightweight concurrency units, but their goals differ. Java virtual threads emphasize compatibility with `java.lang.Thread` and blocking-style code. Go goroutines are part of the language concurrency model and are managed by the G-M-P scheduler. Both need OS threads as real execution carriers. The OS schedules carrier threads or M threads; it does not directly schedule virtual threads or goroutines.

When Linux creates a real kernel thread or process, it goes through paths such as `clone` / `clone3`, `kernel_clone()`, `copy_process()`, and `wake_up_new_task()`. Creating Java virtual threads or Go goroutines does not trigger that path per concurrency unit. Only JVM platform threads, Go M threads, POSIX threads, or normal processes involve `task_struct` creation and initialization.

From the `task_struct` perspective, Linux processes and threads are both tasks. Their difference mainly comes from whether resource structures are shared. Virtual threads and goroutines have no `task_struct` of their own. They only exist inside the language runtime, and the kernel can only observe the real OS threads that carry them.

[1]: https://openjdk.org/jeps/444 "JEP 444: Virtual Threads"
[2]: https://docs.oracle.com/en/java/javase/24/core/virtual-threads.html "Virtual Threads"
[3]: https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/VirtualThread.java "OpenJDK VirtualThread.java"
[4]: https://go.dev/src/runtime/HACKING "Go runtime HACKING"
[5]: https://man7.org/linux/man-pages/man2/clone.2.html "clone(2) - Linux manual page"
[6]: https://linux-kernel-labs.github.io/refs/heads/master/lectures/processes.html "Processes - The Linux Kernel documentation"
[7]: https://codebrowser.dev/linux/linux/kernel/fork.c.html "fork.c source code"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/v_thread)
