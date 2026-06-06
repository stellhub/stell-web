# Go Runtime G/M/P Scheduling Model, Network I/O, and Concurrency Safety

## Abstract

Go provides goroutines as concurrent execution units, and the runtime scheduler manages the execution relationship between goroutines and operating system threads in user space. Official Go runtime documentation describes the three core scheduler entities as G, M, and P: G represents a goroutine, M represents an operating system thread, and P represents the scheduling and resource context required to execute Go user code. The goal of this model is to provide the language-level ability to express a large number of concurrent tasks, while connecting goroutine creation, blocking, resumption, execution, and destruction with operating system thread scheduling through runtime scheduling, the network poller, system call handling, and synchronization primitives. Based on the Go specification, runtime documentation, runtime source notes, the Go memory model, and Linux scheduling documentation, this article explains the definitions and roles of G/M/P, their user-space associations, kernel-space mapping, goroutine lifecycle, network I/O paths, and concurrency-safe usage. [S1][S2][S3][S4][S5][S6][S7][S9]

## Keywords

Go; goroutine; G/M/P; runtime scheduler; netpoll; task_struct; concurrency safety; memory model

## 1. Introduction

The Go language specification states that a `go` statement starts an independent concurrent execution unit, a goroutine, in the same address space. The function call expression and its parameters are evaluated in the goroutine that initiates the `go` statement, while the called function executes in the new goroutine. When that function returns, the corresponding goroutine terminates and its return values are discarded. [S2]

Go concurrency execution does not directly map each goroutine to a fixed operating system thread. The Go runtime maintains the relationships among goroutines, operating system threads, and execution resource contexts in user space. Official runtime documentation calls these three objects G, M, and P, and explains that the scheduler's responsibility is to match G, M, and P so runnable goroutines can run on threads that are able to execute Go code. [S1]

Therefore, the G/M/P model is the core mechanism by which the Go runtime connects language-level concurrency with operating system thread scheduling. It affects ordinary goroutine scheduling, blocking system calls, network I/O, synchronization waits, and concurrency-safety practices.

## 2. Definitions and Roles of the G/M/P Model

Official Go runtime documentation defines G as a goroutine, represented by the `g` type in the runtime. G stores the goroutine stack, scheduling context, current state, and runtime fields related to the execution thread. After a goroutine exits, the G object can be returned to a free pool for reuse. [S1][S5]

M represents an operating system thread. M can execute Go user code, runtime code, and system calls, or be idle. M is the Go runtime entity corresponding to a kernel thread. On Linux, the basic object scheduled by the kernel is a task. Linux documentation explains that pid, tid, and task in the taskstats documentation context all refer to standard Linux tasks represented by `task_struct`; threads in the same process thread group share an address space. [S1][S9]

P represents the resource context required to execute Go user code. Official runtime documentation explains that P contains scheduler and memory allocator state, and that the number of Ps equals `GOMAXPROCS`. For an M to execute Go user code, it normally needs to hold a P. When an M enters a system call, it releases or hands back its P, so other Ms can continue executing runnable goroutines. [S1][S3]

Thus, G/M/P does not simply create threads. It establishes the following relationship in user space:

| Entity | Go Runtime Meaning | Corresponds to Kernel Object? | Main Role |
| --- | --- | --- | --- |
| G | goroutine | No direct correspondence | Stores the goroutine stack, state, and scheduling context |
| M | OS thread | Corresponds to an operating system thread; on Linux, this appears as a task represented by task_struct | Carries actual CPU execution |
| P | processor/resource context | Does not correspond to a kernel object | Holds the scheduling and allocation resources required to run Go code |

## 3. Problems Solved by G/M/P

The first problem solved by the G/M/P model is decoupling the number of goroutines from the number of operating system threads. The Go blog explains that Go could allocate a dedicated operating system thread for each goroutine, but Go actually uses a runtime scheduler so multiple goroutines reuse a set of Go-managed threads; creating a new goroutine does not require creating a new operating system thread. [S3]

The second problem is parallelism control. `GOMAXPROCS` represents the maximum number of CPUs or thread execution quotas used by Go to execute user-level Go code simultaneously. The Go FAQ explains that `GOMAXPROCS` limits the number of CPUs executing goroutines at the same time, while the runtime may still allocate more threads than that for I/O or system calls. [S3]

The third problem is handling blocking behavior. When a goroutine blocks on a channel, lock, network I/O, timer, or system call, the runtime needs to prevent the entire process from being dragged down by one blocking operation. Through goroutine state transitions, P release, network poller wakeups, and run-queue scheduling, the G/M/P model allows non-blocked goroutines to continue receiving execution opportunities. [S1][S5][S6]

The fourth problem is the division of work between user-space scheduling and kernel-space scheduling. The Go runtime decides which G runs on which M. The Linux kernel scheduler decides which task corresponding to an M runs on the CPU. G does not directly enter the kernel scheduling queue; M is the kernel-visible scheduling object. [S1][S4][S9]

## 4. User-Space Association, Communication Mechanisms, and Kernel-Space Mapping

At the Go language level, there is no special communication mechanism between the "main thread" and coroutines. The `main` function runs in the main goroutine, and other goroutines share the same address space as the main goroutine. The communication mechanism mainly defined by the Go specification is the channel. Channels transmit values between concurrently executing functions through send and receive operations. An unbuffered channel completes communication when both sender and receiver are ready; a buffered channel queues values according to its capacity. The specification also states that the same channel can be used by any number of goroutines without extra synchronization for concurrent access to the channel itself. [S2]

Besides channels, goroutines can also cooperate through shared memory combined with synchronization primitives. The Go memory model specifies that when multiple goroutines access the same data concurrently and at least one access is a write, the access must be serialized using mechanisms such as channels, `sync`, or `sync/atomic`; programs without data races have sequential consistency guarantees. [S7]

In runtime user-space structures, the association between G and M occurs during scheduled execution. The runtime `execute` logic sets the current M's `curg` to the G that is about to run, sets the G's `m` field to the current M, and changes the G state from `_Grunnable` to `_Grunning`. This means the goroutine is executing on an operating system thread. [S4][S5]

This association is temporary. After a goroutine blocks, yields, enters a system call, is preempted, or exits, the runtime removes the current association between G and M. A waiting goroutine can later be scheduled onto the same M or a different M. Therefore, an ordinary goroutine does not own a fixed thread. The Go runtime provides `runtime.LockOSThread`, which binds the current goroutine to the current operating system thread. Without using that mechanism, there is no stable one-to-one binding between a goroutine and an M. [S3][S10]

In kernel space, the Linux scheduler handles thread-level scheduling objects. Linux documentation explains that the scheduler selects the next runnable thread to be executed by the CPU, and the Linux source uses `task_struct` as the core task structure. Therefore, Go's mapping can be expressed as follows: G is a user-space runtime object and does not directly correspond to `task_struct`; M is an operating system thread and corresponds to a kernel task on Linux; P is a Go runtime resource token and has no kernel entity. When a G is running on an M, the CPU is actually executing the kernel task corresponding to that M. When that G is suspended or migrated, its execution relationship with that task_struct ends. [S9]

## 5. Goroutine Lifecycle and Its Relationship with task_struct

A goroutine lifecycle can be divided into creation, enqueueing, scheduling, execution, blocking or system call, resumption, termination, and reuse.

First is creation. The Go specification states that `go f()` starts a new goroutine to execute function `f`. In the compiled runtime path, Go runtime source comments explain that the compiler translates a `go` statement into a call to `runtime.newproc`; `newproc` creates a new G and puts it into a queue of goroutines waiting to run. [S2][S4]

Second is initialization. The runtime obtains a G from the free G list or allocates a new G, and initializes its stack, scheduling register context, entry function, parent goroutine information, and starting program counter. Then the G state changes from `_Gdead` to `_Grunnable`. [S4][S5]

Third is enqueueing and wakeup. The newly created G is placed into the current P's local run queue, and the runtime may call wakeup logic to involve an idle M in scheduling. If a runnable M/P combination already exists, this G waits for scheduling. If more execution threads are needed, the runtime may wake or create an M. [S4]

Fourth is scheduling and execution. After an M enters the scheduling loop, the runtime looks for runnable Gs from the local queue, global queue, network poller, or other sources. After finding a G, `execute` binds it to the current M and changes its state to `_Grunning`. At this point, G is still a Go runtime user-space object, while the object actually scheduled by the kernel is the operating system thread corresponding to M. [S4][S5][S9]

Fifth is the runtime kernel association while running. When the Linux scheduler selects the task_struct corresponding to this M to run on the CPU, the CPU executes the machine instructions of the G bound to the current M. Therefore, the relationship between goroutine and task_struct is not a persistent object relationship, but a runtime execution carrier relationship: G -> M -> task_struct. Later, the G may be scheduled onto another M, so the same goroutine can be executed by different task_struct objects at different times during its lifecycle. [S4][S9]

Sixth is blocking or system call. When a G blocks on a channel, lock, network I/O, timer, or other wait condition, the runtime changes its state to `_Gwaiting`, removes the current execution association between G and M, and lets the M continue scheduling other runnable Gs. When a G enters a system call, its state can change to `_Gsyscall`; if the system call blocks, the M may remain blocked in the kernel while the P can be released to another M to continue executing Go code. [S1][S4][S5]

Seventh is resumption. When the wait condition is satisfied, for example a channel receives data, a lock becomes available, a timer expires, or a network fd becomes ready, the runtime marks the corresponding G runnable again and places it back into a run queue. Later this G is executed again by an M that holds a P. That M may be different from the one that executed it last time. [S4][S5][S6]

Eighth is termination and reuse. When the goroutine function returns, the runtime executes the goroutine exit path. Runtime source shows that the exit flow destroys the current G's running state, changes its state from `_Grunning` to `_Gdead`, removes its association with M, and returns the G to the free pool. This process does not require the corresponding operating system thread to exit; M is usually reused by the runtime. [S4][S5]

## 6. Network I/O from Receiving to Goroutine Processing and Read/Write

Go network I/O is completed through cooperation among the `net` package, the internal poll layer, and the runtime network poller. The runtime network poller is integrated into the Go runtime, and different operating systems use different implementations, such as epoll on Linux, kqueue on BSD/macOS, and IOCP on Windows. Runtime documentation explains that the network poller can return a list of ready goroutines for the scheduler to reschedule. [S6]

Using TCP connection reads as an example, after a goroutine calls `conn.Read`, it enters the `internal/poll.FD.Read` path. That structure stores the underlying file descriptor and poll descriptor. The read operation first attempts a nonblocking `read` system call. If data is already ready, the system call returns data directly and the goroutine continues executing business logic. [S6]

If the underlying fd has no data and returns `EAGAIN`, and the fd is managed by the runtime poller, the current goroutine does not occupy an operating system thread for a long time while waiting for data. It waits through `pollDesc.waitRead`. The runtime poll descriptor contains read-wait and write-wait signal slots, respectively associated with read goroutines and write goroutines that may be blocked. At this point, G is suspended, while M and P can continue executing other runnable goroutines. [S5][S6]

When the kernel notifies that the fd is readable, the runtime netpoll mechanism receives the event and marks the corresponding waiting goroutine runnable. The scheduler then places that G into a run queue and resumes execution on some M/P combination. The resumed goroutine continues the previous read path, retries the system call, and obtains data. After the business goroutine obtains data, it executes application-layer processing; if it needs to write back a response, it enters the write path. The scheduling semantics of the write path are the same as the read path: if the fd is writable, the system call advances; if it returns `EAGAIN`, the goroutine waits for a write-ready event and is woken by netpoll when writable. [S6]

This mechanism improves concurrency because goroutines waiting on network I/O are suspended as user-space G objects instead of occupying one kernel thread per blocked connection for a long time. The Go runtime can let a small number of active M/P combinations handle many goroutines in waiting state. `GOMAXPROCS` limits the parallelism of simultaneously executing Go code, while goroutines blocked on I/O are not equivalent to the same number of running threads. [S1][S3][S6]

Therefore, the complete process of a network request can be abstracted as: the connection event enters the kernel event mechanism; runtime netpoll receives an fd-ready event; the goroutine waiting on that fd is marked runnable; the scheduler binds it to an M/P; business code reads data, processes the request, and writes a response; if `EAGAIN` is encountered again during read or write, the goroutine is suspended again and waits for the next fd-ready event. [S4][S6]

## 7. Goroutine Limits, Abuse Prevention, and Concurrency Safety

Goroutines are lightweight concurrent units, but they are not zero-cost objects. G stores a stack, scheduling state, and runtime metadata. A blocked but not exited goroutine still holds its stack, referenced objects, and waiting resources. Runtime documentation explains that G objects are managed and reusable by the runtime, and Go release notes also state that goroutine stacks have maximum limits. Therefore, unbounded goroutine creation increases memory, scheduling, and external resource pressure. [S1][S3]

Basic ways to prevent goroutine abuse include limiting concurrency, defining lifecycles, and setting cancellation conditions. For external requests, background tasks, and I/O tasks, `context.Context` should be used to propagate cancellation signals, deadlines, and request-scoped data. Official Go documentation explains that `Context` carries deadline, cancellation signal, and values across API boundaries, and its methods can be called concurrently by multiple goroutines. When setting a timeout or deadline, the cancel function should be called to release related resources. [S8]

For task groups, `sync.WaitGroup` should be used to wait for goroutines to complete, and counter increments must occur before waiting. Official `sync` documentation explains that `WaitGroup` is a counting semaphore used to wait for a collection of goroutines to finish; new tasks represented by `WaitGroup.Go` or `Add` must be correctly ordered with `Wait`. [S7]

The core basis for preventing concurrency problems is the Go memory model. The memory model specifies that when multiple goroutines concurrently access shared data and at least one access is a write, the access must be serialized through synchronization mechanisms. A data race is defined as a concurrent read-write or write-write access to the same memory location where those accesses are not synchronization operations; programs without data races have sequential consistency guarantees. [S7]

In shared-memory scenarios, `sync.Mutex` provides mutual exclusion. Official documentation explains that a `Mutex` zero value is unlocked and must not be copied after first use; an `Unlock` synchronizes before a later `Lock`. Therefore, safe lock usage should satisfy the following factual constraints: the lock object should not be copied; lock and unlock should appear in pairs; all access paths to shared data should be protected by the same lock or the same synchronization rules; blocking operations with uncertain duration should be avoided while holding the lock to reduce wait chains; and when multiple locks are used together, a fixed order should be maintained to avoid circular waits. [S7]

`sync.RWMutex` is suitable when shared data has a read/write distinction. Official documentation explains that `RWMutex` allows any number of readers or one writer to hold the lock, and must not be copied after first use. It is not bound to a specific goroutine; lock acquisition and release are guaranteed by program logic. [S7]

Channels also have boundary conditions. The Go specification states that sending to a closed channel causes a panic; communication on a nil channel blocks forever; and `select` pseudo-randomly chooses one executable communication branch when multiple branches are ready. Go race detector documentation also points out that unsynchronized send and close can constitute a data race. Therefore, closing a channel should be the responsibility of the sender or a clearly defined owner, and synchronization relationships should ensure it does not conflict concurrently with send operations. [S2][S7]

When detecting concurrency errors, Go's official race detector can detect data races on executed paths through `go test -race`, `go run -race`, and similar commands. Official documentation also explains that the race detector can only find races that occur on actual execution paths, so test coverage affects detection results. [S7]

## 8. Conclusion

Go's G/M/P model separates goroutines, operating system threads, and execution resource contexts. G represents language-level concurrent tasks, M represents the operating system thread that carries execution, and P represents the runtime resources required to execute Go user code. This model allows many goroutines to reuse a limited number of operating system threads and uses `GOMAXPROCS` to control the parallelism of simultaneously executing Go code.

In user space, goroutines cooperate through mechanisms such as channels, shared memory with synchronization primitives, Context, and WaitGroup. The runtime completes scheduling through the state relationships among G, M, and P. In kernel space, the Linux scheduler only sees the task_struct corresponding to M and does not directly schedule G. The relationship between goroutine and task_struct exists only indirectly while the goroutine is executed by some M.

In network I/O, the Go runtime netpoll mechanism associates fd-ready events with waiting goroutines, allowing goroutines waiting on I/O to suspend without occupying operating system threads for a long time. Combined with G/M/P scheduling, this mechanism lets network services maintain a smaller number of active execution threads while many connections wait for I/O.

Safe goroutine usage depends on clear lifecycle management, concurrency limits, cancellation mechanisms, and synchronization rules. Unbounded goroutine creation, unsynchronized access to shared data, incorrect channel closing, copying lock objects, or holding locks while performing uncontrolled blocking operations can all cause resource leaks, data races, deadlocks, or unexpected blocking. The Go memory model, `sync` package, `context` package, and race detector provide the corresponding constraints and detection basis.

## References

[S1] Go Runtime HACKING: Scheduler structures.
[S2] The Go Programming Language Specification: Go statements, Channels, Send statements, Select statements.
[S3] Go FAQ, Go Blog, and runtime package documentation: GOMAXPROCS, goroutine scheduling, preemption.
[S4] Go runtime `proc.go`: newproc, schedule, findRunnable, execute, goexit.
[S5] Go runtime `runtime2.go`: G structure and goroutine states.
[S6] Go runtime netpoll and internal/poll: network polling, pollDesc, FD.Read.
[S7] Go Memory Model, sync package documentation, Data Race Detector.
[S8] Go context package documentation.
[S9] Linux Kernel Documentation and Linux scheduler/task_struct-related documentation.
[S10] Go runtime.LockOSThread documentation.

The official sources corresponding to the references above are:

* [S1] Official Go runtime documentation explains that the scheduler manages G, M, and P: G is a goroutine, M is an OS thread, P is the resource required to execute Go user code, and the scheduler is responsible for matching G/M/P. ([Go.dev][1])
* [S2] The Go language specification defines `go` statements, channel communication, send behavior, and select behavior. ([Go.dev][2])
* [S3] Go FAQ, Go Blog, and runtime documentation explain `GOMAXPROCS`, goroutine and OS thread reuse, parallelism limits, and I/O/syscall thread behavior. ([Go.dev][3])
* [S4] Go runtime source explains that `newproc` creates and enqueues Gs, the scheduling loop finds runnable Gs, `execute` establishes the runtime association between G and M, and goroutine exit enters destruction and reuse paths. ([Go.dev][4])
* [S5] Go runtime `runtime2.go` defines key G fields and states such as `_Grunnable`, `_Grunning`, `_Gwaiting`, `_Gsyscall`, and `_Gdead`. ([Go.dev][5])
* [S6] Go runtime netpoll and `internal/poll` source explain epoll/kqueue/IOCP network polling implementations, read/write wait fields in `pollDesc`, and the `FD.Read` path waiting for readable events on `EAGAIN`. ([Go.dev][6])
* [S7] The Go memory model, `sync` package, and race detector documentation define data races, synchronization rules, Mutex/RWMutex/WaitGroup semantics, and the detection scope of `-race`. ([Go.dev][7])
* [S8] Go `context` package documentation explains that Context carries deadlines, cancellation signals, and values across API boundaries, and CancelFunc notifies operations to abandon work. ([Go Packages][8])
* [S9] Linux documentation explains that the Linux scheduler schedules threads, `task_struct` represents the core task structure, and thread groups share address space. ([Linux Kernel Documentation][9])
* [S10] `runtime.LockOSThread` documentation explains that a goroutine can be bound to the current OS thread; otherwise ordinary goroutines do not have stable thread binding. ([Go Packages][10])

[1]: https://go.dev/src/runtime/HACKING " - The Go Programming Language"
[2]: https://go.dev/ref/spec "The Go Programming Language Specification - The Go Programming Language"
[3]: https://go.dev/doc/faq "Frequently Asked Questions (FAQ) - The Go Programming Language"
[4]: https://go.dev/src/runtime/proc.go " - The Go Programming Language"
[5]: https://go.dev/src/runtime/runtime2.go " - The Go Programming Language"
[6]: https://go.dev/src/runtime/netpoll.go " - The Go Programming Language"
[7]: https://go.dev/ref/mem "The Go Memory Model - The Go Programming Language"
[8]: https://pkg.go.dev/context "context package - context - Go Packages"
[9]: https://docs.kernel.org/accounting/taskstats.html "Per-task statistics interface - The Linux Kernel documentation"
[10]: https://pkg.go.dev/runtime "runtime package - runtime - Go Packages"
