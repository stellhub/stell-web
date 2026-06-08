# Java Concurrent Locks: Implementation Path from User Space to Kernel Space

## Abstract

The Java concurrent lock system includes language-level synchronization mechanisms, library-level synchronizers, atomic variables, segmented accumulators, and copy-on-write containers. At the language specification level, `synchronized` implements mutual exclusion through object monitors and establishes happens-before relationships through monitor lock and unlock. At the virtual machine implementation level, HotSpot tries to keep uncontended or lightly contended monitor acquisition in user space through object headers, CAS, spinning, and lock inflation paths to reduce blocking cost. When contention intensifies or a thread needs to be suspended, the execution flow enters blocking paths such as `ObjectMonitor` or `LockSupport.park`, then enters JVM platform-specific park/unpark implementations, and may eventually trigger operating system thread scheduling and kernel blocking mechanisms. At the library level, `ReentrantLock`, `ReentrantReadWriteLock`, `Semaphore`, and similar tools are mainly built on `AbstractQueuedSynchronizer`, using an atomic `int state` and FIFO wait queues to manage exclusive or shared acquisition. `StampedLock`, `Atomic`, `LongAdder`, and `CopyOnWriteArrayList` reduce synchronization cost in specific scenarios through version stamps, CAS, segmented counting, and snapshot copying respectively. This article organizes the execution path of Java concurrent locks from user space to kernel space along the route of "Java language semantics - HotSpot monitor - AQS - park/unpark - OS scheduling."

## Keywords

Java concurrency; synchronized; ObjectMonitor; AQS; LockSupport; CAS; StampedLock; Semaphore; LongAdder; CopyOnWrite

## 1. Introduction

The semantic foundation of Java concurrent locks comes from the Java Language Specification and the Java Virtual Machine Specification. The Java Language Specification states that every object is associated with a monitor; `synchronized` methods or statements implement synchronization by acquiring and releasing that monitor. At any moment, only one thread can hold the monitor lock of a given object, and an unlock action on a monitor happens-before every subsequent lock action on that same monitor. [1]

The Java Virtual Machine Specification defines the execution semantics of the `monitorenter` instruction for entering an object monitor and the `monitorexit` instruction for exiting an object monitor. Monitors support reentrancy. If a thread already holds a monitor and enters it again, the entry count is incremented; when it exits, the count is decremented, and the monitor is released when the count reaches zero. [2]

The language specification does not require the JVM to use one fixed underlying lock structure. In HotSpot, uncontended paths can be completed through object header mark words, CAS, and lightweight locks; contended paths may enter `ObjectMonitor`; blocking paths use the park/unpark abstraction to remove Java threads from scheduling eligibility, which then enters operating system thread blocking and wakeup mechanisms. [3][4]

Therefore, the path of Java locks from user space to kernel space is not "all lock acquisition calls a kernel lock function." It happens in stages: uncontended or lightly contended cases are mainly completed in JVM user space and at the CPU atomic-instruction layer; when contention intensifies, execution enters JVM monitor or AQS queues; when a thread needs to be suspended, park/unpark interacts with the operating system scheduler.

## 2. Java Lock Semantics and Implementation Layers

The Java lock system can be divided into four layers.

The first layer is the language semantics layer. `synchronized` is defined by the Java language and JVM instructions. Its core semantics are monitor entry, exit, reentrancy, blocking, and happens-before relationships. [1][2]

The second layer is the HotSpot monitor implementation layer. HotSpot object headers contain mark words, and mark words can carry lock-state bits. In the lightweight-lock path, the JVM can directly modify the lock mark in the object header. When a lightweight lock can no longer satisfy the required conditions, the monitor inflates into an `ObjectMonitor` structure. [3][4]

The third layer is the Java library synchronizer layer. `ReentrantLock`, `ReentrantReadWriteLock`, `Semaphore`, and similar tools are not Java language keywords; they are synchronization tools in the `java.util.concurrent` package. They are usually based on `AbstractQueuedSynchronizer`, implementing exclusive locks, shared locks, semaphores, and condition queues through atomic state and wait queues. [5]

The fourth layer is the blocking and scheduling layer. When a synchronized `ObjectMonitor` or AQS synchronizer decides that a thread cannot continue acquiring a lock through spinning or retrying, the thread may enter a parked state. `LockSupport.park` disables scheduling eligibility for the current thread until a permit is available, interruption occurs, a timeout expires, or a spurious return happens. [6]

Together, these four layers form the main path from Java locks in user space to kernel space.

## 3. The Role of synchronized and Its Lock-State Path

### 3.1 Language-Level Role of synchronized

The direct role of `synchronized` is to establish mutual exclusion on an object monitor. A synchronized instance method locks the receiver object. A synchronized static method locks the corresponding `Class` object. A synchronized block explicitly specifies the lock object. [1][2]

At the bytecode level, a synchronized block usually appears as `monitorenter` and `monitorexit` instructions. When a thread executes `monitorenter`, if the monitor entry count is 0, the thread enters the monitor and sets the count to 1. If the current thread already holds the monitor, it reenters and increments the count. If another thread holds the monitor, the current thread blocks until the monitor entry count becomes 0. [2]

`monitorexit` exits the monitor. Only the monitor owner can execute the exit operation. On exit, the entry count is decremented; when the count reaches zero, the monitor is released and other waiting threads can try to acquire it. [2]

`synchronized` provides not only mutual exclusion, but also memory visibility. The Java memory model specifies that an unlock on a monitor happens-before every subsequent lock on the same monitor. Therefore, writes completed by a thread inside a synchronized block can be observed by other threads after they later acquire the same monitor. [1]

### 3.2 Where synchronized Lock Information Is Stored

The Java specification only states that every object is associated with a monitor; it does not require the monitor to be stored in a specific object field. [1][2]

In HotSpot, an object header contains a mark word. The mark word can store lock-state markers. In modern HotSpot lightweight-lock implementation, an unlocked object header can be represented as unlocked through tag bits. When lightweight locking acquires the lock, the JVM can change the tag bits in the object header from the unlocked state to the lightweight-locked state. This path does not need to create an extra monitor data structure for every uncontended lock acquisition. [3]

When a lock enters inflated state, the JVM associates the object with an `ObjectMonitor`. `ObjectMonitor` maintains owner, recursion count, wait queues, entry queues, and related information. OpenJDK documentation explains that when ObjectMonitorTable is not used, an `ObjectMonitor` can be associated with an object through the object's mark word; when ObjectMonitorTable is used, the mapping between object and `ObjectMonitor` can be maintained by a table structure. [4]

Therefore, the lock state of `synchronized` can be stored in three places in implementation: the object header mark word, lightweight lock records on the thread stack, or JVM monitor tables / `ObjectMonitor`. The specific location depends on the JDK version, HotSpot configuration, and lock state.

### 3.3 First Stage: Biased Locking and Lightweight Locking

Biased locking is a historical HotSpot optimization. Its goal was to reduce the cost of repeatedly entering the same monitor by the same thread. Without contention, biased locking could avoid executing CAS on every entry. JEP 374 explains that biased locking has been disabled by default since JDK 15 and that related command-line options have been deprecated. [7]

Lightweight locking is a more general uncontended or low-contention path. HotSpot lightweight locking can acquire a lock by using CAS to modify lock-state bits in the object header. This happens in JVM user space and at the CPU atomic-instruction layer; it does not require putting the Java thread into an operating system blocked state. [3][4]

The execution characteristics of this stage are: the thread attempts to complete a state update on the object header or lightweight lock record; after success, it enters the critical section; on release, it restores or updates the object-header state. This path does not need to create or enter a heavyweight `ObjectMonitor` blocking wait queue, nor does it need to call park to make the thread sleep.

### 3.4 Second Stage: Spinning and Lock Inflation

When lightweight-lock CAS fails, contention may exist. HotSpot does not necessarily block the thread immediately. OpenJDK synchronization implementation includes fast-lock paths, CAS modification of lock bits, SpinWait, spin backoff, and logic for creating an `ObjectMonitor` when needed. [4]

In OpenJDK `ObjectMonitor` source, when a thread enters a monitor it first attempts `spin_enter`; if it cannot directly acquire owner and contention conditions are met, it enters a contended path. Source comments also explain that a small amount of fixed spinning can reduce the cost of threads entering and leaving queues; the monitor subsystem tries to avoid directly depending on native synchronization primitives and mainly relies on atomic operations and platform-specific park/unpark abstractions. [8]

Lock inflation occurs when lightweight locking can no longer express synchronization state. Typical triggers include increased contention, a need for wait/notify, JNI monitor entry, or the JVM deciding that the lightweight path is insufficient for the current synchronization state. After inflation, the object is associated with an `ObjectMonitor`, and subsequent contending threads coordinate entry to the critical section through monitor queue and owner state. [3][4]

This stage is the transition between user space and kernel space. A thread may still acquire the lock in user space through spinning and CAS. If spinning fails and it enters park, the blocking path begins.

### 3.5 Third Stage: Heavyweight Locks and Kernel-Space Interaction

A heavyweight lock does not mean Java code directly calls one unified "kernel mutex function." In HotSpot, a heavyweight monitor mainly appears as `ObjectMonitor`. After contending threads enter `ObjectMonitor`, they may be added to the entry list or wait set. If they cannot continue executing, they are suspended through the park mechanism. [8]

OpenJDK `Unsafe_Park` implementation calls the `Parker::park` associated with the current Java thread. `Unsafe_Unpark` obtains the target Java thread's `Parker` and calls `unpark`. [9] Official `LockSupport` documentation explains that `park` disables the current thread's scheduling eligibility when no permit is available, and `unpark` makes the corresponding thread's permit available. [6]

Therefore, the actual path from `synchronized` to kernel space can be summarized as:

Java source `synchronized`
-> bytecode `monitorenter/monitorexit` or synchronized method flag
-> HotSpot object-header mark word lightweight CAS path
-> spinning, backoff, and lock inflation after contention failure
-> `ObjectMonitor` owner, entry list, wait set
-> park when the thread cannot continue acquiring
-> JVM platform-specific park/unpark
-> operating system thread blocking, wakeup, and scheduling

Only when a thread needs to be blocked or woken does it enter an operating-system-scheduling-related path. Uncontended and low-contention cases mainly stay in JVM user space and CPU atomic operations.

## 4. AQS Implementation Principles of ReentrantLock and ReentrantReadWriteLock

### 4.1 Basic Structure of AQS

`AbstractQueuedSynchronizer` is the framework used in the Java concurrency package to build blocking locks and synchronizers. Official documentation explains that AQS relies on an atomic `int state` to represent synchronization state and uses a FIFO wait queue to manage blocked threads. Subclasses define concrete acquisition and release rules through methods such as `tryAcquire`, `tryRelease`, `tryAcquireShared`, and `tryReleaseShared`. [5]

AQS supports exclusive mode and shared mode. Exclusive mode is used by synchronizers that allow only one thread to pass at a time, such as `ReentrantLock`. Shared mode allows multiple threads to pass simultaneously, such as `Semaphore` and read locks. [5]

The core path of AQS is not "directly entering a kernel lock." A thread first tries to modify synchronization state in Java user space. After failure, it enters an AQS queue. Inside the queue, it may still repeatedly try to acquire. Only when it cannot continue does it block the current thread through `LockSupport.park`. [5][6]

### 4.2 Execution Flow of ReentrantLock

`ReentrantLock` is a reentrant mutual exclusion lock with basic mutual exclusion semantics similar to `synchronized`, but it provides extended capabilities such as interruptible acquisition, timed acquisition, fairness configuration, and `Condition` queues. [10]

Its typical execution path is:

`ReentrantLock.lock()`
-> AQS `acquire(1)`
-> subclass `tryAcquire(1)`
-> CAS changes `state` from 0 to 1
-> sets owner to current thread
-> acquisition succeeds and returns entirely in user space

If the current thread is already the owner, state is incremented to represent the reentrancy count. On release, `unlock()` calls AQS `release(1)` and decrements state. When state reaches zero, owner is cleared and successor threads in the queue are woken. [10]

When acquisition fails due to contention, the thread does not immediately enter the operating system. AQS wraps the failed thread as a wait node and enqueues it into the synchronization queue. The acquisition process described by official AQS documentation is: repeatedly check `tryAcquire`; if it fails, enqueue the thread and possibly block it; on release, unblock the first queued thread. [5]

OpenJDK AQS source also contains paths using `Thread.onSpinWait()` and `LockSupport.park(this)`. In other words, before entering blocking state, AQS performs limited retry, spin hints, and queue-state adjustment. When a thread is set to WAITING and cannot acquire synchronization state, it executes `LockSupport.park`. [11]

Therefore, the path from `ReentrantLock` user space to kernel space is:

`lock()`
-> CAS state succeeds: completed in user space
-> CAS fails: enters AQS queue
-> thread near queue head repeatedly tries to acquire
-> still fails: `LockSupport.park`
-> `Unsafe.park`
-> JVM Parker
-> OS scheduling block

### 4.3 Execution Flow of ReentrantReadWriteLock

`ReentrantReadWriteLock` distinguishes shared access and exclusive access through read locks and write locks. The read lock allows multiple reader threads to hold it simultaneously. The write lock is exclusive and excludes other readers and writers. [12]

Official documentation explains that it does not enforce default reader preference or writer preference. In fair mode, the lock tends to assign access in approximate arrival order. In nonfair mode, entry order is not fixed, but throughput is usually higher. A writer thread can acquire the read lock while holding the write lock to perform lock downgrading; a reader thread cannot directly upgrade to a write lock. [12]

Its AQS path is similar to `ReentrantLock`, but synchronization state expression is more complex. The write lock belongs to exclusive mode; the read lock belongs to shared mode. When read-lock acquisition succeeds, multiple threads can pass simultaneously. When write-lock acquisition succeeds, only the writer thread can access exclusively. Read-write lock blocking is still completed through the AQS queue and `LockSupport.park`. [5][12]

The use cases of `ReentrantReadWriteLock` are given by official documentation: when a collection is large, the number of reader threads is greater than the number of writer threads, and operation overhead is high enough to offset the maintenance cost of the read-write lock itself, a read-write lock is usually more suitable. If the data structure is small, the critical section is short, or writes are frequent, the cost of maintaining reader counts, writer state, and queue strategy may offset the benefits of concurrent reads. [12]

## 5. StampedLock and Semaphore

### 5.1 Core Logic of StampedLock

`StampedLock` is a stamp-based capability lock. It maintains internal state that represents both version information and lock mode. It supports three access modes: write lock, read lock, and optimistic read. [13]

The write lock is exclusive mode. After successful write-lock acquisition, it returns a stamp, and release must use the corresponding stamp. The read lock is nonexclusive mode and allows multiple readers to enter simultaneously. Optimistic read is not a traditional read lock. A thread calls `tryOptimisticRead` to obtain a stamp, reads fields, and then calls `validate` to check whether a write occurred during the read. If validation fails, the read result cannot be used as a consistent result and must be retried or degraded to a pessimistic read lock. [13]

The typical flow is:

`tryOptimisticRead()`
-> read fields into local variables
-> `validate(stamp)`
-> validation succeeds: use read result
-> validation fails: acquire `readLock()` or `writeLock()` and reread
-> `unlockRead(stamp)` or `unlockWrite(stamp)`

`StampedLock` is not reentrant, does not enforce ownership semantics, and does not guarantee a fixed fairness policy. It is suitable for internal state protection where reads are frequent, writes are rare, read paths are short, and read results can be validated and retried. It is not suitable for scenarios requiring reentrancy, condition queues, strict fairness, reads with side effects, or object lifecycles that cannot be guaranteed through version validation. [13]

### 5.2 Core Logic of Semaphore

`Semaphore` is a counting semaphore. It maintains a set of permits. When a thread executes `acquire`, if enough permits are available, permits are reduced and the thread continues executing; if permits are insufficient, the thread blocks until other threads release permits, it is interrupted, or a timeout expires. When a thread executes `release`, permits are increased and waiting threads may be woken. [14]

`Semaphore` can be used to limit concurrent access to resources, such as connection pools, object pools, rate-limit slots, and concurrent task count control. A binary semaphore can be used as a mutual exclusion tool, but it has no lock ownership concept; one thread can acquire it and another thread can release it. [14]

`Semaphore` is also implemented based on AQS shared mode. Under light contention, a thread can update permits through CAS. Under heavy contention, the thread enters the AQS queue and blocks through `LockSupport.park`. Therefore, its main difference from `ReentrantLock` is not the blocking mechanism, but synchronization-state semantics: `ReentrantLock` manages exclusive owner and reentrancy count, while `Semaphore` manages permit count. [5][14]

## 6. Atomic, LongAdder, and CopyOnWrite

### 6.1 Core Logic of Atomic

Atomic classes such as `AtomicInteger`, `AtomicLong`, and `AtomicReference` are used to perform atomic updates on a single variable. Taking `AtomicInteger` as an example, official documentation explains that it can be used as an atomically incremented counter; `compareAndSet` atomically updates the value to a new value if the current value equals the expected value. [15]

The core path of Atomic classes is CPU atomic instructions and JVM atomic-access wrappers, not AQS queues. The typical flow is:

read current value
-> compute new value
-> CAS attempts to write
-> success returns
-> failure retries or returns failure depending on method semantics

Methods such as `updateAndGet` and `getAndUpdate` require the supplied function to be side-effect-free, because under contention the function may be executed repeatedly. [15]

Atomic is suitable for single-variable state updates, state flags, reference publication, lightweight counting, and local atomic steps in lock-free algorithms. It is not suitable for compound state that must maintain invariants across multiple fields; if multiple fields must be updated together, a single CAS cannot directly guarantee overall consistency.

### 6.2 Core Logic of LongAdder

`LongAdder` maintains one or more variables that together form a sum. Official documentation explains that when multiple threads contend for updates, the set of variables may grow dynamically to reduce contention; `sum()` returns the sum of all components. Under high-contention statistics workloads, `LongAdder` usually has higher throughput than a single `AtomicLong`, but with higher space cost. [16]

Its execution logic can be summarized as:

update base under low contention
-> disperse updates into different cells as contention increases
-> each thread mainly updates one cell
-> aggregate base and cells when reading
-> return statistic value

`LongAdder.sum()` is not an atomic snapshot under concurrent updates. If threads are still updating concurrently when `sum()` is called, the returned value may not include a globally consistent state at one instant. [16]

Therefore, `LongAdder` is suitable for statistics scenarios such as QPS metrics, request counts, metric accumulation, and hot counters. It is not suitable for scenarios requiring exact linear consistency, such as inventory deduction, balance changes, or sequence number generation.

### 6.3 Core Logic of CopyOnWriteArrayList

`CopyOnWriteArrayList` is a copy-on-write container. Official documentation explains that all modification operations create a new copy of the underlying array. Because modification is expensive, it is suitable for scenarios where traversal operations greatly outnumber modification operations. Iterators are based on the array snapshot at iterator creation time, do not reflect subsequent additions, deletions, or modifications during iteration, and do not throw `ConcurrentModificationException`. [17]

Its execution flow can be summarized as:

read operation reads current array reference
-> iterator holds array snapshot
-> write operation copies current array
-> modification is completed on the copy
-> new array reference is published
-> later readers read the new snapshot

CopyOnWrite avoids read-write mutual exclusion on the read path. Its cost is copying the array on every write, and old iterators continue observing old snapshots. Therefore, it is suitable for read-mostly scenarios such as listener lists, subscriber lists, configuration snapshots, routing rules, feature flags, and plugin lists. It is not suitable for high-frequency writes, frequent modification of large arrays, or scenarios requiring all readers to observe the latest value immediately. [17]

## 7. Unified Path from Java Locks in User Space to Kernel Space

The implementation of Java concurrent locks can be summarized into three path segments.

The first segment is the pure user-space fast path. `synchronized` lightweight locks, `ReentrantLock` CAS state, `Semaphore` CAS permits, Atomic CAS updates, and LongAdder dispersed updates can all be completed in JVM user space and at the CPU atomic-instruction layer. This stage does not put the thread into an operating system blocked state.

The second segment is JVM internal contention-management path. `synchronized` enters `ObjectMonitor`; AQS tools enter synchronization queues; read-write locks maintain reader and writer state; `StampedLock` maintains stamps and mode transitions. This stage can still complete through spinning, retrying, CAS, and queue adjustment, without immediately entering kernel space.

The third segment is the blocking and wakeup path. When a thread cannot continue acquiring synchronization state through user-space retries, `ObjectMonitor` or AQS calls park. `LockSupport.park` disables scheduling eligibility for the current thread. HotSpot `Unsafe_Park` calls the `Parker::park` associated with the thread. Platform-specific implementation then interacts with operating system thread scheduling mechanisms. [6][9]

Therefore, the core trigger for Java locks entering kernel space is not "calling a lock method," but "a thread needs to be suspended or woken." Uncontended locking, low-contention CAS, spin retries, optimistic read validation, and snapshot reading can all avoid thread blocking. Only when the synchronizer decides that the current thread cannot continue running does the path enter park/unpark and operating-system scheduling.

## 8. Scenario Boundaries of Different Synchronization Tools

`synchronized` is suitable for language-level mutual exclusion, object invariant protection, and simple critical sections. It is directly supported by the JVM, has fixed semantics, and can automatically release the monitor when exiting due to an exception. [1][2]

`ReentrantLock` is suitable when interruptible acquisition, timed acquisition, nonblocking try-acquire, fair locks, or multiple condition queues are needed. It requires explicit release and usually requires calling `unlock` in `finally`. [10]

`ReentrantReadWriteLock` is suitable for read-mostly scenarios where read operations are long enough to offset read-write lock maintenance cost. It is not suitable for write-heavy scenarios, extremely short critical sections, or scenarios requiring read-lock upgrade to write-lock. [12]

`StampedLock` is suitable for read-mostly scenarios where read operations are short, validateable, and retryable. It does not provide reentrancy, ownership, or condition-queue semantics, so it cannot directly replace all read-write lock scenarios. [13]

`Semaphore` is suitable for controlling resource concurrency. Its semantics are permits, not object ownership. [14]

Atomic is suitable for single-variable atomic updates and not for multi-field compound invariants. LongAdder is suitable for high-contention statistics and not for exact consistent counting. CopyOnWrite is suitable for read-mostly and snapshot iteration, not for high-frequency writes. [15][16][17]

## 9. Conclusion

The execution path of Java concurrent locks from user space to kernel space is layered. At the semantic layer, `synchronized` is defined by monitors. At the HotSpot implementation layer, it uses object headers, lightweight locks, spinning, lock inflation, and `ObjectMonitor` to transition from fast paths to blocking paths. `ReentrantLock`, `ReentrantReadWriteLock`, and `Semaphore` are based on AQS, using atomic `state` and FIFO queues to complete initial contention management in user space, and entering blocking paths through `LockSupport.park` when synchronization state can no longer be acquired. `StampedLock` reduces read-path synchronization cost through stamps and optimistic reads. Atomic, LongAdder, and CopyOnWrite serve specific concurrency patterns through CAS, segmented accumulation, and snapshot copying respectively.

Therefore, Java locks are not a single mechanism. They are a layered system composed of language specifications, JVM object layout, CPU atomic instructions, synchronization queues, park/unpark abstractions, and operating system scheduling. Whether they enter kernel space depends on contention degree and whether the thread needs to block, not on whether surface APIs such as `synchronized`, `lock()`, or `acquire()` appear in code.

## References

[1] The Java Language Specification states that every object is associated with a monitor, and defines monitor lock/unlock, wait sets, synchronizes-with, and happens-before relationships. ([Oracle Docs][2])

[2] The Java Virtual Machine Specification defines `monitorenter` / `monitorexit` execution semantics, including object monitors, reentrancy counts, blocking, and exit rules. ([Oracle Docs][3])

[3] OpenJDK JEP 450 explains the relationship among HotSpot object headers, lightweight locks, monitor locks, tag bits, legacy stack locking, and monitor inflation. ([OpenJDK][4])

[4] OpenJDK Wiki explains that HotSpot lightweight locking uses markWord locking bits and CAS fast locking, and may spin, back off, and create or associate `ObjectMonitor` after failure. ([wiki.openjdk.org][5])

[5] Oracle JDK `AbstractQueuedSynchronizer` documentation explains that AQS uses atomic `int state`, FIFO wait queues, exclusive/shared modes, and `LockSupport` blocking support. ([Oracle Docs][6])

[6] Oracle JDK `LockSupport` documentation explains the park/unpark permit model and that `park` disables scheduling eligibility for the current thread and may return for no reason. ([Oracle Docs][7])

[7] OpenJDK JEP 374 explains that biased locking was used to reduce uncontended monitor cost, and has been disabled by default and related options deprecated since JDK 15. ([OpenJDK][1])

[8] OpenJDK `ObjectMonitor` source explains that monitor entry paths include spin, entry list, and park, and that the monitor subsystem tries to rely on atomic operations and platform park/unpark abstractions. ([GitHub][8])

[9] OpenJDK `Unsafe_Park` source shows that `Unsafe.park` calls the current thread's `Parker::park`, and `Unsafe.unpark` calls the target thread's `Parker::unpark`. ([GitHub][9])

[10] Oracle JDK `ReentrantLock` documentation explains its reentrant mutual exclusion semantics, fairness, blocking behavior, release rules, and `Condition` support. ([Oracle Docs][10])

[11] OpenJDK AQS source shows queues, `Thread.onSpinWait()`, and `LockSupport.park(this)` in acquisition paths. ([GitHub][11])

[12] Oracle JDK `ReentrantReadWriteLock` documentation explains read-write locks, fair/nonfair policies, reentrancy, lock downgrading, lack of upgrading, and use cases. ([Oracle Docs][12])

[13] Oracle JDK `StampedLock` documentation explains write locks, read locks, optimistic reads, stamp validation, mode conversion, non-reentrancy, and usage limitations. ([Oracle Docs][13])

[14] Oracle JDK `Semaphore` documentation explains permits, acquire/release, resource pools, binary semaphores, lack of ownership, and fairness. ([Oracle Docs][14])

[15] Oracle JDK `AtomicInteger` documentation explains atomic updates, `compareAndSet` semantics, and that update functions may be executed repeatedly under contention. ([Oracle Docs][15])

[16] Oracle JDK `LongAdder` documentation explains dynamic variable spreading under high contention, statistical throughput, space cost, and non-atomic snapshot behavior of `sum()`. ([Oracle Docs][16])

[17] Oracle JDK `CopyOnWriteArrayList` documentation explains copying the underlying array on modification, snapshot iterators, read-mostly applicability, and memory consistency effects. ([Oracle Docs][17])

[1]: https://openjdk.org/jeps/374 "JEP 374: Deprecate and Disable Biased Locking"
[2]: https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html "Chapter17.Threads and Locks"
[3]: https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-6.html "Chapter6.The Java Virtual Machine Instruction Set"
[4]: https://openjdk.org/jeps/450 "JEP 450: Compact Object Headers (Experimental)"
[5]: https://wiki.openjdk.org/spaces/HotSpot/pages/138215471/Synchronization%2BUsing%2BThe%2BObjectMonitorTable "Synchronization Using The ObjectMonitorTable - HotSpot - OpenJDK Wiki"
[6]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html "AbstractQueuedSynchronizer (Java SE 21 & JDK 21)"
[7]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/LockSupport.html "LockSupport (Java SE 21 & JDK 21)"
[8]: https://github.com/openjdk/jdk/blob/master/src/hotspot/share/runtime/objectMonitor.cpp "jdk/src/hotspot/share/runtime/objectMonitor.cpp at master - openjdk/jdk - GitHub"
[9]: https://github.com/openjdk/jdk/blob/master/src/hotspot/share/prims/unsafe.cpp "jdk/src/hotspot/share/prims/unsafe.cpp at master - openjdk/jdk - GitHub"
[10]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html "ReentrantLock (Java SE 21 & JDK 21)"
[11]: https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java "jdk/src/java.base/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java at master - openjdk/jdk - GitHub"
[12]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html "ReentrantReadWriteLock (Java SE 21 & JDK 21)"
[13]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/StampedLock.html "StampedLock (Java SE 21 & JDK 21)"
[14]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Semaphore.html "Semaphore (Java SE 21 & JDK 21)"
[15]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html "AtomicInteger (Java SE 21 & JDK 21)"
[16]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html "LongAdder (Java SE 21 & JDK 21)"
[17]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html "CopyOnWriteArrayList (Java SE 21 & JDK 21)"
