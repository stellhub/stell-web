# Concurrent Locks: From Hardware Atomicity to User-Space Synchronization Abstractions

## 1. Why Concurrent Locks Exist

The basic role of a concurrent lock is to constrain a critical region when multiple execution flows access shared mutable state at the same time, so only execution flows satisfying the synchronization rules can read or write that state at a given moment. [1]

Without synchronization mechanisms, concurrent programs encounter three types of problems. The first is thread interference: multiple threads may simultaneously execute "read old value, compute new value, write new value," causing lost updates. The second is memory consistency: data written by one execution flow may not be observed by another execution flow without a synchronization relationship, or may be observed in an incomplete state. The third is object lifecycle problems: in kernels or low-level systems, if readers are still accessing an object while writers free or replace it, dangling references, use-after-free, or structural corruption can occur. [1]

A lock is not just a "queuing tool." In modern concurrency models, locks carry three responsibilities at the same time: mutual exclusion, visibility boundaries, and ordering constraints. Mutual exclusion protects critical sections. Visibility ensures that writes before releasing a lock can be observed by later execution flows that acquire the same lock. Ordering constraints restrict compiler and CPU reordering of critical memory accesses. [1]

## 2. Hardware Layer: CPUs Provide Atomic Capabilities, Not Business Locks

CPU hardware does not understand business concepts such as "inventory lock," "account lock," or "order lock." Hardware provides lower-level atomic read-modify-write capabilities, cache coherence protocols, and memory barrier capabilities. [2]

Common hardware atomic capabilities include test-and-set, exchange, compare-and-swap, fetch-add, load-linked/store-conditional, and load-exclusive/store-exclusive. These instructions guarantee that one read-modify-write operation on a memory location cannot be interrupted by other CPU cores. The x86 LOCK prefix can let the cache coherence protocol guarantee atomic execution; Arm exclusive load/store pairs can complete a single-copy atomic update when successful. [2]

Software locks are built on these hardware capabilities. Spin locks usually modify a lock variable through atomic exchange, test-and-set, or CAS. The fast path of mutexes may also use atomic compare-and-swap. Read-write locks usually maintain reader counts, writer state, or wait queues. Mechanisms such as RCU and seqlock also combine atomic pointer publishing, version numbers, and memory barriers. [2]

Therefore, hardware atomic instructions are not locks themselves. CAS is a conditional atomic update primitive. A spin lock is a synchronization protocol constructed from atomic primitives. Whether to retry after CAS failure, how many times to retry, whether to yield the CPU, and whether to enter blocking wait are determined by the software algorithm, not by the CAS instruction itself. [2]

## 3. Main Types of Kernel-Space Concurrent Locks

Linux kernel documentation divides lock primitives into three categories: sleeping locks, CPU-local locks, and spinning locks. [3]

### 3.1 Sleeping Locks

Sleeping locks allow waiters to sleep and are suitable for process context where blocking is allowed. Typical members include mutex, rt_mutex, semaphore, rw_semaphore, ww_mutex, and percpu_rw_semaphore. [3]

mutex is the kernel mutual exclusion lock used to serialize access. It is similar to a binary semaphore, but has clearer ownership constraints. Linux mutex implementation contains an atomic owner field, a wait queue, and an internal spin lock. The uncontended path uses a fast path; under contention it enters a slow path, where waiting or optimistic spinning may occur. [3]

rt_mutex is a mutex with priority inheritance, used to reduce priority inversion. semaphore is a counting semaphore representing a group of permitted resources. Because it has no strict owner, it cannot provide priority inheritance semantics similar to rt_mutex. rw_semaphore is a sleeping read-write semaphore that allows multiple readers to enter concurrently while writers enter exclusively. [3]

### 3.2 CPU-Local Locks

CPU-local locks are not general-purpose cross-CPU mutual exclusion mechanisms. They are mainly used to protect per-CPU data. Common approaches restrict preemption, soft interrupts, or hard interrupts on the current CPU, thereby preventing concurrent paths on the same CPU from damaging local state. [3]

This type of mechanism acts at the scheduling and interrupt layers, rather than making all CPUs compete for a shared lock variable. They are only suitable for CPU-local data, not for protecting shared objects accessed by multiple CPUs. [3]

### 3.3 Spinning Locks

Spinning locks wait by busy-waiting. Typical members include raw_spinlock_t, spinlock_t, rwlock_t, and bit spinlocks. [3]

raw_spinlock_t is a strict spin lock, where waiters do not sleep. spinlock_t usually maps to raw_spinlock_t on non-PREEMPT_RT kernels; on PREEMPT_RT kernels, part of spin-lock semantics may be transformed into sleepable lock semantics by the real-time kernel. rwlock_t is a spin-based read-write lock, allowing multiple readers to enter concurrently while writers enter exclusively. [3]

Spin locks directly consume CPU resources: a failed execution flow continues occupying the CPU to execute loops and repeatedly reads or attempts to modify the same lock variable. The cache line containing that variable is transferred or invalidated among multiple CPU cores through the cache coherence protocol. The more concentrated the contention, the higher the cache-coherence traffic. [2][3]

### 3.4 seqlock and RCU

seqlock and RCU are more specialized concurrency control mechanisms.

seqlock implements lock-free read paths through version counters. A reader reads the version number, reads the data, and then checks the version number again. If a writer modified the data during the read, the reader retries. seqlock is suitable for write-rare/read-heavy scenarios where data structures do not contain pointers that can be freed by writers and readers can retry. [4]

RCU splits updates into two phases: first remove or replace references, then wait for existing readers to exit, and finally reclaim old objects. RCU is suitable for read-mostly data structures. Reader paths can be very lightweight, while updaters avoid readers accessing freed objects through delayed reclamation. [4]

## 4. Locks and Synchronization Abstractions in Java User Space

Java extends low-level locking mechanisms into multiple language-level and library-level synchronization abstractions. [5]

### 4.1 synchronized

`synchronized` uses object monitors to implement built-in locks. When a synchronized method or synchronized block is entered, it acquires the object's intrinsic lock; when it exits, it releases the lock. Releasing a lock has a happens-before relationship with subsequent acquisition of the same lock, so it provides both mutual exclusion and visibility guarantees. [5]

It is suitable for protecting object invariants, method-level critical sections, and simple mutual exclusion. Its characteristics are simple syntax and lock release guaranteed by language structure, but it does not directly provide interruptible acquisition, timed acquisition, or multiple condition queues. [5]

### 4.2 ReentrantLock

`ReentrantLock` provides the same basic semantics as `synchronized` as a reentrant mutual exclusion lock, while extending it with explicit locking, explicit release, interruptible waiting, timed waiting, nonblocking try-acquire, fair lock configuration, and `Condition` queues. [5]

It is suitable when lock acquisition needs to be controlled explicitly, when multiple condition queues are needed, when try-lock is needed, or when interruptible waiting is needed. Explicit locks must be released in `finally`, otherwise exception paths can leak locks. [5]

### 4.3 ReentrantReadWriteLock

`ReentrantReadWriteLock` divides access into read locks and write locks. Multiple readers can hold read locks simultaneously. When a writer holds the write lock, it excludes all readers and other writers. It supports fair and nonfair modes and supports reentrancy. A writer thread can acquire a read lock while holding the write lock to perform lock downgrading, but a reader thread cannot directly upgrade to a write lock. [5]

It is suitable for read-mostly scenarios where read operations are long enough to offset the maintenance cost of a read-write lock and where read operations do not need mutual exclusion among themselves. It is not suitable for write-heavy scenarios, very short critical sections, or unstable read/write ratios.

### 4.4 StampedLock

`StampedLock` provides three modes: write lock, read lock, and optimistic read. Optimistic reads do not hold a stable read-lock state like traditional read locks. A reader first obtains a stamp, reads data, and then calls `validate` to check whether a write lock was acquired during the read. If validation fails, the reader must discard the result and switch to a pessimistic read lock or reread. [5]

It is suitable for read-mostly scenarios with short read logic where read results can be validated and retried. It cannot completely replace traditional read-write locks, because some code cannot tolerate retry, some reads contain side effects, some scenarios require object state to remain stable throughout the read, and some scenarios need traditional lock features such as reentrancy, condition queues, or explicit fairness semantics. [5]

### 4.5 Semaphore

`Semaphore` is a counting semaphore. It maintains a set of permits. A thread must acquire a permit before continuing, and after a permit is released, other threads can acquire it. [5]

It is suitable for rate limiting, connection pools, resource pools, and concurrency limits. It is not equivalent to a mutual exclusion lock, because the number of permits can be greater than 1, and its core semantics are controlling concurrency quantity rather than protecting a single object's invariant.

### 4.6 Atomic, LongAdder, and CopyOnWrite

Atomic classes such as `AtomicInteger` perform atomic updates on a single variable. They are suitable for simple state bits, counters, reference publication, and lightweight state machines. In high-contention counting scenarios, `LongAdder` reduces contention by splitting variables. Official documentation explains that it usually has higher throughput than a single `AtomicLong` under high-contention statistics workloads, but has higher space cost, and `sum()` is not an atomic snapshot under concurrent updates. [5]

`CopyOnWriteArrayList` copies the underlying array on each modification, and iterators use snapshots. It is suitable for collections where traversal is far more frequent than modification, such as listener lists, configuration snapshots, plugin lists, and routing rule snapshots. It is not suitable for high-frequency write collections because every write copies the array. [5]

## 5. Synchronization Abstractions in Go User Space

Go's concurrency model provides channels, the `sync` package, and the `sync/atomic` package. Official Go documentation clearly requires concurrent modification of shared data to be serialized, and recommends protecting shared data through channel operations or `sync` and `sync/atomic`. [6]

### 5.1 Channel

Go's core concurrency style is to share memory by communicating, not to communicate by sharing memory. Channels combine data ownership transfer and execution-flow synchronization, and are suitable for producer-consumer patterns, pipelines, task distribution, event notification, and data handoff between goroutines. [6]

Channels are not a replacement for every concurrency problem. For short critical sections, existing shared structures, local state protection, and high-frequency simple mutual exclusion, `sync.Mutex` remains the standard tool.

### 5.2 sync.Mutex

`sync.Mutex` is a mutual exclusion lock. Its zero value is unlocked. `Lock` blocks when the lock is already held, and `Unlock` releases the lock. A Go Mutex is not bound to a goroutine: one goroutine can lock it and another goroutine can unlock it. [6]

It is suitable for protecting maps, internal struct invariants, short critical sections, and indivisible compound updates.

### 5.3 sync.RWMutex

`sync.RWMutex` allows multiple readers or one writer to hold the lock. Official Go documentation specifies that when a writer is waiting, new readers are blocked until the writer acquires and releases the lock, so it is not an unbounded reader-preferred lock. Go's RWMutex does not support recursive read locking, upgrading from read lock to write lock, or downgrading from write lock to read lock. [6]

It is suitable for read-mostly scenarios where read critical sections have some length. It is not suitable for write-heavy scenarios, short critical sections, or highly variable read/write ratios.

### 5.4 sync.Cond, sync.Once, sync.WaitGroup, sync.Map, sync.Pool

`sync.Cond` is a condition variable used for goroutines to wait until a condition becomes true. `sync.Once` guarantees that a function executes only once. `sync.WaitGroup` waits for a group of goroutines to finish. `sync.Map` is a concurrent-safe map, but official documentation explains that most code should still use ordinary maps with locks; `sync.Map` mainly optimizes two cases: entries written once and read many times, and multiple goroutines reading/writing disjoint key sets. `sync.Pool` caches temporary objects to reduce allocation pressure. [6]

### 5.5 sync/atomic

`sync/atomic` provides low-level atomic memory primitives. Official documentation positions it as a low-level tool and explains that, except for special low-level applications, synchronization should preferably use channels or the `sync` package. CAS semantics in Go are: if the old value at the address equals the expected value, replace it with the new value and return success; otherwise return failure. [6]

## 6. CAS Is Not a Spin Lock and Does Not Guarantee Better Performance Than Locking

CAS is an atomic compare-and-swap primitive exposed by hardware or runtime. A spin lock is a lock constructed using primitives such as CAS, test-and-set, or exchange. They belong to different layers. [2]

CAS itself performs only one conditional update. So-called "CAS spinning" is usually software code entering a retry loop after CAS failure. Failed threads do not naturally sleep. If the algorithm has no backoff, CPU yield, or transition to a blocking path, it keeps occupying execution resources and repeatedly accesses the same shared location. [2]

In low-contention, low-conflict scenarios where the critical update is very short and only modifies a single machine word, CAS can avoid blocking, wakeups, and context switches. Typical examples include state-bit switches, reference publication, lightweight counters, and local steps in lock-free queues. [6]

In high-contention scenarios, many CAS failures create retry traffic. Multiple CPU cores repeatedly fight for the same cache line, failed execution flows continue consuming CPU, throughput decreases, and tail latency worsens. The design fact behind Java `LongAdder` shows that a single hot atomic counter is not the optimal structure under high contention; splitting hot variables can reduce contention. [5]

Locking is not necessarily slower than CAS. Under heavy contention or longer critical sections, blocking locks can put failed threads to sleep or park them, reducing ineffective spinning and cache-line contention. The cost of locks is blocking, wakeup, scheduling, and context switches. The cost of CAS loops is retry, cache-coherence traffic, and CPU occupation. There is no absolute performance ordering between the two. Performance depends on contention intensity, critical-section length, failed-retry cost, scheduling cost, and shared-data hot-spot intensity. [3][5][6]

## 7. Applicability Boundaries of CopyOnWrite + Merge

The essence of CopyOnWrite + Merge is changing "multiple execution flows directly modifying the same shared data" into "each execution flow modifying its own copy or local shard, then publishing or merging results later." When the read path only reads immutable snapshots and the write path only modifies private copies, the read/write critical path can avoid traditional mutual exclusion locks. [5]

This pattern is suitable for large-data, low-conflict, mergeable, partitionable, or eventually consistent scenarios. Typical scenarios include:

1. Configuration snapshots, canary rules, routing tables, permission rules, and feature flags: readers read stable snapshots, and writers generate new snapshots before atomically replacing references.
2. Listener lists, plugin lists, subscriber lists: traversal is far more frequent than addition/removal, and iterating over old snapshots is acceptable.
3. Log aggregation, metric aggregation, event statistics: each thread or shard accumulates locally and periodically merges.
4. Search indexes, inverted indexes, and LSM Tree-like structures: writes enter new segments or levels, queries read multiple immutable segments, and background merge is performed.
5. MapReduce, batch processing, and feature statistics: the map phase aggregates locally, and the reduce phase merges by key.
6. Recommendation systems, risk profiles, and offline reports: batch merging is allowed and readers can accept snapshot delay.
7. Sharded counters, histograms, and approximate TopN statistics: updates can be distributed to multiple buckets or shards, and final reads aggregate results.
8. CRDT or event-append models: operations are commutative, associative, idempotent, and have clear merge rules.

It is not suitable for strongly consistent concurrent modification of fixed hot data. Inventory deduction, coupon remaining count, seat booking, account balance, order state machine, unique username registration, exact quota for global rate limiting, distributed lock ownership, auction highest bid, and sequence number allocation are not objects that simple CopyOnWrite + Merge can directly solve. [7]

The reason is that updates in these scenarios point to the same logical entity and have strong ordering or uniqueness constraints. If two copies deduct the same inventory item separately, the merge stage must decide who succeeded and who failed. If two copies update the same account balance, the merge stage must preserve accounting order and balance constraints. If two copies reserve the same seat, the merge stage must keep only one successful reservation. At that point, the merge phase reintroduces transactions, locks, CAS, version validation, or single-threaded serialization. [7]

Therefore, CopyOnWrite + Merge is not a replacement for all concurrent writes. It is suitable for scenarios where conflicts can be postponed to a controlled merge phase, not for scenarios where conflicts concentrate on the same business entity and require linear consistency.

## 8. Read-Write Locks Are Not Necessarily Faster Than Mutexes

The value of read-write locks comes from concurrent reads. They allow multiple readers to enter at the same time, reducing mutual exclusion among read operations. But read-write locks need to maintain reader counts, writer state, wait queues, and fairness policies, making them more complex than ordinary mutexes. [5][6]

In read-mostly scenarios with longer read critical sections and rare writes, read-write locks can improve read throughput. In write-heavy scenarios, very short read critical sections, frequently changing read/write ratios, or frequent writer waits, read-write locks may be worse than mutexes. Writers need to wait for existing readers to exit. While a writer is waiting, some implementations block new readers. Readers entering and exiting frequently also modify shared counters or state. [5][6]

StampedLock optimistic reads, Linux RCU, and seqlock further reduce read-path cost, but they cannot completely replace traditional read-write locks. [4][5]

StampedLock optimistic read requires validation after reading. If validation fails, the read result has no consistency guarantee and must be retried or downgraded to a pessimistic read. It is suitable for short read paths and retryable logic, not for reads with side effects, unstable object lifecycles, non-retryable reads, or scenarios that must always read the latest consistent state. [5]

RCU's read path is lightweight, but it relies on "replace rather than destroy in place" and "delayed reclamation of old objects." Readers may see old versions. Updaters must wait for a grace period before freeing old objects. It is suitable for read-mostly data structures where readers can accept snapshot semantics and objects can be replaced through pointers, not for all shared state. [4]

seqlock readers do not acquire traditional read locks, but readers may retry repeatedly. If writes are frequent, reader retry cost rises. Linux documentation also points out that sequence counters cannot protect data containing pointers, because writers may invalidate pointers readers are following. [4]

Therefore, StampedLock, RCU, and seqlock are optimization mechanisms under specific consistency models, not complete replacements for traditional read-write locks.

## 9. Concept Boundaries from Hardware to User Space

Concurrency synchronization concepts can be distinguished by layer:

1. Hardware atomic instructions: CAS, exchange, fetch-add, test-and-set, load-exclusive/store-exclusive. They guarantee atomic read-modify-write on a single memory location.
2. Memory ordering mechanisms: acquire, release, full barrier, volatile semantics, happens-before. They constrain visibility and reordering.
3. Spin locks: repeatedly try to acquire a lock using atomic instructions. This is a lock, not a lock-free algorithm.
4. Mutexes: allow only one execution flow into a critical section at a time. Under contention, they can sleep, park, or enter wait queues.
5. Semaphores: control the number of permits, suitable for concurrency and resource-pool control.
6. Read-write locks: allow multiple readers or one writer, suitable for read-mostly workloads.
7. seqlock: readers do not use traditional locks and rely on version validation and retry.
8. RCU: readers read old or new versions, while writers replace references and delay reclamation.
9. CopyOnWrite: writers copy and publish new snapshots, while readers read old snapshots.
10. Channel: transfers data or synchronizes events through message passing, reducing shared mutable state.
11. Atomic classes and lock-free data structures: use atomic primitives to maintain state, but algorithms may include retry, backoff, helping, or memory-reclamation protocols.

"Lock-free" does not mean "no synchronization cost." Lock-free algorithms avoid certain mutual exclusion waits, but still consume atomic instructions, cache-coherence traffic, memory barriers, retries, and memory-reclamation costs. A spin lock uses CAS, but it is still a locked synchronization mechanism. CAS is an atomic primitive, but CAS loops can occupy execution resources for a long time under high contention. [2][6]

## 10. Objective Dimensions for Choosing a Concurrency Control Method

Concurrency control methods cannot be ranked by slogans such as "locks are always slow," "CAS is always fast," "read-write locks are always better than mutexes," or "optimistic reads are always better than pessimistic reads." The correct classification dimensions include:

1. Whether shared data is mutable.
2. Whether there is a single hot spot.
3. Whether linear consistency is required.
4. Whether reading old snapshots is acceptable.
5. Whether the read/write ratio is stable.
6. Whether the critical section is long enough.
7. Whether updates are commutative, associative, and idempotent.
8. Whether conflicts can be resolved in a merge phase.
9. Whether failed retries are acceptable.
10. Whether blocking, wakeup, and context-switch costs are lower than spinning retry costs.

Low-conflict single-variable updates are suitable for CAS or atomic classes. High-contention statistics are suitable for sharded counters or LongAdder-like structures. Compound object invariants are suitable for mutexes. Read-mostly workloads are suitable for read-write locks, StampedLock, RCU, or CopyOnWrite. Write-heavy workloads usually fit mutexes or partitioned locks. Batch-mergeable data is suitable for CopyOnWrite + Merge. Fixed hot data requiring strong consistency usually needs locks, transactions, CAS version validation, or single-threaded serialization.

The core fact about concurrent locks is: a lock is not a single tool, but a family of synchronization protocols built layer by layer from hardware atomicity, memory models, schedulers, kernel primitives, and language library abstractions. Different protocols vary in mutual exclusion, visibility, wait behavior, read/write concurrency, failure handling, and consistency model. Therefore, there is no universally optimal lock for all concurrency scenarios.

## References

[1] Necessity of concurrent locks: Linux kernel documentation uses locks to protect critical regions; Oracle Java tutorials explain that `synchronized` prevents thread interference and memory consistency errors; the Go memory model requires concurrent modification of shared data to be serialized through channels, `sync`, or `sync/atomic`. ([Kernel Documentation][1])

[2] Hardware atomicity and the boundary between CAS and spinning: Intel official documentation explains that the LOCK prefix usually guarantees atomic execution through cache-coherence mechanisms; Arm official documentation explains that Store-Exclusive completes a single-copy atomic update when successful; Linux atomic operation documentation explains atomic bit operations and memory barrier semantics; Go `sync/atomic` documentation gives CAS conditional-update semantics. ([Intel][2])

[3] Linux kernel lock classification: Linux kernel documentation divides locks into sleeping locks, CPU-local locks, and spinning locks, and lists types such as mutex, rt_mutex, semaphore, rw_semaphore, raw_spinlock_t, spinlock_t, and rwlock_t; Linux mutex documentation explains mutex owner, wait queue, spinlock, cmpxchg fast path, and contention paths. ([Kernel Documentation][3])

[4] RCU and seqlock: Linux RCU documentation explains that RCU targets read-mostly scenarios, splits updates into removal and reclamation phases, and lets readers use lighter synchronization; sequence counter/seqlock documentation explains that readers validate versions after lock-free reads, writers update versions, and sequence counters are unsuitable for protecting data containing pointers that may become invalid. ([Kernel Documentation][4])

[5] Java synchronization abstractions: Oracle/JDK documentation respectively explains `synchronized` intrinsic locks and happens-before, `ReentrantLock` reentrancy and fairness, `ReentrantReadWriteLock` read-write semantics, `StampedLock` optimistic read and validate, `Semaphore` permits, atomic classes, `LongAdder` high-contention statistics characteristics, `CopyOnWriteArrayList` copy-on-write and snapshot iteration, and `LockSupport` park/unpark. ([Oracle Docs][5])

[6] Go concurrency abstractions: the official Go memory model, Go Blog, `sync`, and `sync/atomic` documentation explain the channel-first concurrency style, and the semantics and boundaries of `Mutex`, `RWMutex`, `Cond`, `Once`, `WaitGroup`, `sync.Map`, `sync.Pool`, and atomic CAS. ([Go.dev][6])

[7] Boundaries of CopyOnWrite + Merge: `CopyOnWriteArrayList` official documentation explains that modifications copy the underlying array and are suitable for scenarios where traversal far exceeds modification; official RCU documentation explains that RCU relies on replacement, grace periods, and delayed reclamation, suitable for read-mostly workloads rather than arbitrary strongly consistent write hotspots. ([Oracle Docs][7])

[1]: https://docs.kernel.org/kernel-hacking/locking.html "Unreliable Guide To Locking - The Linux Kernel documentation"
[2]: https://www.intel.com/content/www/us/en/support/articles/000099741/processors/intel-xeon-processors.html "Where is the Cache-Coherence Protocol Directory Placed in Intel®..."
[3]: https://docs.kernel.org/locking/locktypes.html "Lock types and their rules - The Linux Kernel documentation"
[4]: https://docs.kernel.org/RCU/whatisRCU.html "What is RCU? -- Read, Copy, Update - The Linux Kernel documentation"
[5]: https://docs.oracle.com/javase/tutorial/essential/concurrency/locksync.html?utm_source=chatgpt.com "Intrinsic Locks and Synchronization (The Java Tutorials > ...)"
[6]: https://go.dev/ref/mem "The Go Memory Model - The Go Programming Language"
[7]: https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/CopyOnWriteArrayList.html "CopyOnWriteArrayList (Java Platform SE 8 )"
