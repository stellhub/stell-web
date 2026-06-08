# Java 并发锁从用户态到内核态的实现链路研究

## 摘要

Java 并发锁体系包含语言级同步机制、类库级同步器、原子变量、分段累加器以及写时复制容器。语言规范层面，`synchronized` 基于对象监视器实现互斥，并通过 monitor 的 lock 与 unlock 建立 happens-before 关系。虚拟机实现层面，HotSpot 将无竞争或轻度竞争的 monitor 获取尽量限制在用户态，通过对象头、CAS、自旋和锁膨胀路径降低阻塞成本；当竞争加剧或线程需要挂起时，执行流进入 `ObjectMonitor` 或 `LockSupport.park` 等阻塞路径，并进一步进入 JVM 平台相关的 park/unpark 实现，最终可能触发操作系统线程调度与内核阻塞机制。类库层面，`ReentrantLock`、`ReentrantReadWriteLock`、`Semaphore` 等主要基于 `AbstractQueuedSynchronizer` 构建，通过一个原子 `int state` 与 FIFO 等待队列管理独占或共享获取。`StampedLock`、`Atomic`、`LongAdder` 与 `CopyOnWriteArrayList` 则分别通过版本戳、CAS、分段计数和快照复制降低特定场景下的同步成本。本文按照“Java 语言语义—HotSpot monitor—AQS—park/unpark—OS 调度”的路径，整理 Java 并发锁从用户态到内核态的执行链路。

## 关键词

Java 并发；synchronized；ObjectMonitor；AQS；LockSupport；CAS；StampedLock；Semaphore；LongAdder；CopyOnWrite

## 1. 引言

Java 并发锁的语义基础来自 Java 语言规范和 Java 虚拟机规范。Java 语言规范规定，每个对象都关联一个 monitor；`synchronized` 方法或语句通过获取和释放该 monitor 实现同步。同一时刻只有一个线程可以持有某个对象的 monitor 锁，释放同一 monitor 的动作 happens-before 后续对该 monitor 的获取动作。[1]

Java 虚拟机规范规定，`monitorenter` 指令用于进入对象 monitor，`monitorexit` 指令用于退出对象 monitor。monitor 支持重入，线程已经持有某个 monitor 后，再次进入会递增进入计数；退出时递减计数，计数归零后释放 monitor。[2]

语言规范并不要求 JVM 使用某一种固定的底层锁结构。HotSpot 的实现中，无竞争路径可以通过对象头 mark word、CAS 与轻量级锁完成；竞争路径可能进入 `ObjectMonitor`；阻塞路径通过 park/unpark 抽象让 Java 线程失去调度资格，进而进入操作系统线程阻塞与唤醒机制。[3][4]

因此，Java 锁从用户态到内核态的链路不是“所有加锁都调用内核锁函数”，而是分阶段发生：无竞争或轻度竞争时主要在 JVM 用户态和 CPU 原子指令层完成；竞争加剧后进入 JVM monitor 或 AQS 队列；线程需要挂起时通过 park/unpark 与操作系统调度器发生交互。

## 2. Java 锁语义与实现层次

Java 锁体系可以分为四个层次。

第一层是语言语义层。`synchronized` 由 Java 语言和 JVM 指令定义，核心语义是 monitor 的进入、退出、重入、阻塞和 happens-before 关系。[1][2]

第二层是 HotSpot monitor 实现层。HotSpot 对象头中包含 mark word，mark word 可承载锁状态位。在轻量级锁路径中，JVM 可以直接修改对象头中的锁标记；当轻量级锁无法满足条件时，monitor 会膨胀为 `ObjectMonitor` 结构。[3][4]

第三层是 Java 类库同步器层。`ReentrantLock`、`ReentrantReadWriteLock`、`Semaphore` 等不是 Java 语言关键字，而是 `java.util.concurrent` 包中的同步工具。它们通常基于 `AbstractQueuedSynchronizer`，通过原子状态和等待队列实现独占锁、共享锁、信号量和条件队列。[5]

第四层是阻塞与调度层。当 synchronized 的 `ObjectMonitor` 或 AQS 同步器判断线程不能继续通过自旋或重试获取锁时，线程可能进入 park 状态。`LockSupport.park` 会禁用当前线程的调度资格，直到获得 permit、中断、超时或虚假返回。[6]

这四层共同构成 Java 锁从用户态到内核态的主要路径。

## 3. synchronized 的作用与锁状态链路

### 3.1 synchronized 的语言作用

`synchronized` 的直接作用是对对象 monitor 建立互斥访问。同步实例方法锁定接收者对象；同步静态方法锁定对应的 `Class` 对象；同步代码块显式指定锁对象。[1][2]

在字节码层面，同步代码块通常表现为 `monitorenter` 与 `monitorexit` 指令。线程执行 `monitorenter` 时，如果 monitor 的进入计数为 0，则线程进入 monitor 并将计数设置为 1；如果当前线程已经持有该 monitor，则重入并递增计数；如果其他线程持有该 monitor，则当前线程阻塞，直到 monitor 的进入计数变为 0。[2]

`monitorexit` 用于退出 monitor。只有 monitor 所有者可以执行退出操作。退出时进入计数递减；当计数归零后，monitor 被释放，其他等待线程可以继续尝试获取。[2]

`synchronized` 不仅提供互斥，也提供内存可见性。Java 内存模型规定，对某个 monitor 的 unlock happens-before 后续对同一个 monitor 的 lock。因此，线程在同步块内完成的写入，可以通过同一 monitor 的后续获取被其他线程观察到。[1]

### 3.2 synchronized 的锁信息保存位置

Java 规范只规定每个对象关联一个 monitor，并不规定 monitor 必须保存在对象的哪个字段中。[1][2]

HotSpot 实现中，对象头包含 mark word。mark word 中可以保存锁状态标记。在现代 HotSpot 轻量级锁实现中，未锁定对象头可通过标记位表示为 unlocked；轻量级锁获取时，JVM 可以将对象头中的 tag bits 从未锁定状态改为轻量级锁定状态。该路径不需要为每次无竞争加锁创建额外 monitor 数据结构。[3]

当锁进入膨胀状态时，JVM 会将对象与 `ObjectMonitor` 关联。`ObjectMonitor` 维护 owner、递归计数、等待队列、入口队列等信息。OpenJDK 文档说明，未使用 ObjectMonitorTable 时，`ObjectMonitor` 可以通过对象的 mark word 与对象关联；使用 ObjectMonitorTable 时，对象与 `ObjectMonitor` 的映射可以由表结构维护。[4]

因此，`synchronized` 的锁状态在实现上可能经历三个位置：对象头 mark word、线程栈上的轻量级锁记录或 JVM monitor 表/`ObjectMonitor`。具体位置取决于 JDK 版本、HotSpot 配置和锁状态。

### 3.3 第一阶段：偏向锁与轻量级锁

偏向锁是 HotSpot 的历史优化。它的目标是减少同一线程反复进入同一 monitor 的成本；在没有竞争时，偏向锁可以避免每次进入都执行 CAS。JEP 374 说明，偏向锁在 JDK 15 起默认禁用，并且相关命令行选项被废弃。[7]

轻量级锁是更通用的无竞争或低竞争路径。HotSpot 轻量级锁可以通过 CAS 修改对象头中的锁状态位完成锁获取。该过程发生在 JVM 用户态和 CPU 原子指令层面，不需要让 Java 线程进入操作系统阻塞状态。[3][4]

这一阶段的执行特征是：线程尝试在对象头或轻量级锁记录上完成状态更新；成功后进入临界区；释放时恢复或更新对象头状态。该路径不需要创建或进入重量级 `ObjectMonitor` 阻塞等待队列，也不需要调用 park 使线程休眠。

### 3.4 第二阶段：自旋与锁膨胀

当轻量级锁 CAS 失败，说明可能出现竞争。HotSpot 不一定立即让线程阻塞。OpenJDK 的同步实现包含快速锁路径、CAS 修改锁位、SpinWait、自旋退避以及在需要时创建 `ObjectMonitor` 的逻辑。[4]

OpenJDK `ObjectMonitor` 源码中，线程进入 monitor 时会先尝试 `spin_enter`；如果不能直接获得 owner，并且竞争条件满足，则进入带竞争标记的路径。源码注释还说明，少量固定自旋可以减少线程进入和离开队列的成本；monitor 子系统尽量避免直接依赖原生同步原语，而是主要依赖原子操作和平台相关的 park/unpark 抽象。[8]

锁膨胀发生在轻量级锁无法继续表达同步状态时。典型触发条件包括竞争增强、需要 wait/notify、JNI monitor 进入、或 JVM 判断轻量级路径不足以承载当前同步状态。膨胀后，对象与 `ObjectMonitor` 关联，后续竞争线程通过 monitor 的队列和 owner 状态协调进入临界区。[3][4]

这一阶段是用户态与内核态之间的过渡期。线程仍可能通过自旋和 CAS 在用户态完成获取；如果自旋失败并进入 park，则开始进入阻塞路径。

### 3.5 第三阶段：重量级锁与内核态交互

重量级锁并不表示 Java 代码直接调用某个统一的“内核互斥锁函数”。在 HotSpot 中，重量级 monitor 主要表现为 `ObjectMonitor`。竞争线程进入 `ObjectMonitor` 后，可能被加入 entry list 或 wait set；如果不能继续执行，则通过 park 机制挂起。[8]

OpenJDK `Unsafe_Park` 的实现会调用当前 Java 线程关联的 `Parker::park`；`Unsafe_Unpark` 会取得目标 Java 线程的 `Parker` 并调用 `unpark`。[9] `LockSupport` 的官方文档说明，`park` 会在没有 permit 时禁用当前线程的调度资格；`unpark` 会使对应线程的 permit 可用。[6]

因此，从 `synchronized` 到内核态的实际链路可以概括为：

Java 源码中的 `synchronized`
→ 字节码 `monitorenter/monitorexit` 或同步方法标志
→ HotSpot 对象头 mark word 的轻量级 CAS 路径
→ 竞争失败后的自旋、退避与锁膨胀
→ `ObjectMonitor` 的 owner、entry list、wait set
→ 线程无法继续获取时进入 park
→ JVM 平台相关 park/unpark
→ 操作系统线程阻塞、唤醒与调度

其中，只有线程需要阻塞或唤醒时，才会进入与操作系统调度相关的路径。无竞争和低竞争场景主要停留在 JVM 用户态与 CPU 原子操作层面。

## 4. ReentrantLock 与 ReentrantReadWriteLock 的 AQS 实现原理

### 4.1 AQS 的基本结构

`AbstractQueuedSynchronizer` 是 Java 并发包中构建阻塞锁和同步器的框架。官方文档说明，AQS 依赖一个原子 `int state` 表示同步状态，并通过 FIFO 等待队列管理阻塞线程。子类通过 `tryAcquire`、`tryRelease`、`tryAcquireShared`、`tryReleaseShared` 等方法定义具体获取和释放规则。[5]

AQS 支持独占模式和共享模式。独占模式用于一次只允许一个线程通过的同步器，例如 `ReentrantLock`。共享模式允许多个线程同时通过，例如 `Semaphore` 和读锁。[5]

AQS 的核心路径并不是“直接进入内核锁”。线程首先在 Java 用户态尝试修改同步状态；失败后进入 AQS 队列；在队列中仍可能重复尝试获取；当无法继续时，才通过 `LockSupport.park` 阻塞当前线程。[5][6]

### 4.2 ReentrantLock 的执行流程

`ReentrantLock` 是可重入互斥锁，具有与 `synchronized` 类似的基本互斥语义，但提供可中断获取、限时获取、公平锁配置和 `Condition` 条件队列等扩展能力。[10]

其典型执行链路为：

`ReentrantLock.lock()`
→ AQS `acquire(1)`
→ 子类 `tryAcquire(1)`
→ CAS 将 `state` 从 0 改为 1
→ 设置 owner 为当前线程
→ 获取成功，完全在用户态返回

如果当前线程已经是 owner，则递增 state 表示重入次数。释放时，`unlock()` 调用 AQS `release(1)`，递减 state；当 state 归零后清除 owner，并唤醒队列中的后继线程。[10]

竞争失败时，线程不会立即进入操作系统。AQS 会将失败线程封装为等待节点，加入同步队列。AQS 官方文档给出的获取过程是：重复检查 `tryAcquire`，如果失败则将线程入队，并可能阻塞；释放时解除第一个排队线程的阻塞。[5]

OpenJDK AQS 源码还包含 `Thread.onSpinWait()` 和 `LockSupport.park(this)` 的路径。也就是说，AQS 在进入阻塞之前存在有限的重试、自旋提示和队列状态调整；当线程被设置为 WAITING 且不能获得同步状态时，执行 `LockSupport.park`。[11]

因此，`ReentrantLock` 从用户态到内核态的路径是：

`lock()`
→ CAS state 成功：用户态完成
→ CAS 失败：进入 AQS 队列
→ 队列头附近线程重复尝试获取
→ 仍失败：`LockSupport.park`
→ `Unsafe.park`
→ JVM Parker
→ OS 调度阻塞

### 4.3 ReentrantReadWriteLock 的执行流程

`ReentrantReadWriteLock` 基于读锁和写锁区分共享访问和独占访问。读锁允许多个读线程同时持有；写锁独占，排斥其他读者和写者。[12]

官方文档说明，它不强制默认 reader preference 或 writer preference；公平模式下，锁倾向于按照近似到达顺序分配；非公平模式下，进入顺序不固定，但通常吞吐量更高。写线程可以在持有写锁时获取读锁，从而进行锁降级；读线程不能直接升级为写锁。[12]

其 AQS 链路与 `ReentrantLock` 类似，但同步状态表达更复杂。写锁属于独占模式；读锁属于共享模式。读锁获取成功时，多个线程可以同时通过；写锁获取成功时，只允许写线程独占访问。读写锁的阻塞仍通过 AQS 队列和 `LockSupport.park` 完成。[5][12]

`ReentrantReadWriteLock` 的使用场景由官方文档给出：当集合较大、读线程数量多于写线程、并且操作开销足以抵消读写锁本身维护成本时，读写锁通常更适合。若数据结构很小、临界区很短或写入频繁，读写锁维护读者计数、写者状态和队列策略的成本可能抵消读并发收益。[12]

## 5. StampedLock 与 Semaphore

### 5.1 StampedLock 的核心逻辑

`StampedLock` 是基于 stamp 的能力型锁。它维护内部状态，该状态同时表示版本信息和锁模式。它支持三种访问模式：写锁、读锁和乐观读。[13]

写锁是独占模式。写锁获取成功后返回一个 stamp，释放时必须使用对应 stamp。读锁是非独占模式，允许多个读者同时进入。乐观读不是传统意义上的读锁；线程调用 `tryOptimisticRead` 获取 stamp 后读取字段，随后调用 `validate` 检查读取期间是否发生写入。如果校验失败，读取结果不能作为一致结果使用，需要重试或退化为悲观读锁。[13]

典型流程为：

`tryOptimisticRead()`
→ 读取字段到局部变量
→ `validate(stamp)`
→ 校验成功：使用读取结果
→ 校验失败：获取 `readLock()` 或 `writeLock()` 后重新读取
→ `unlockRead(stamp)` 或 `unlockWrite(stamp)`

`StampedLock` 不可重入，不强制所有权语义，也不保证固定的公平策略。它适合短读路径、读多写少、读取过程可校验且可重试的内部状态保护场景。它不适合需要可重入、条件队列、严格公平、读过程有副作用或读取对象生命周期无法通过版本校验保证的场景。[13]

### 5.2 Semaphore 的核心逻辑

`Semaphore` 是计数信号量。它维护一组 permits。线程执行 `acquire` 时，如果可用 permits 足够，则减少 permits 并继续执行；如果 permits 不足，则阻塞直到其他线程 release permits、中断或超时。线程执行 `release` 时增加 permits，并可能唤醒等待线程。[14]

`Semaphore` 可用于限制资源并发访问数量，例如连接池、对象池、限流槽位、并发任务数控制等。二值信号量可以作为互斥工具使用，但它没有锁所有权概念；一个线程 acquire 后，另一个线程也可以 release。[14]

`Semaphore` 也基于 AQS 的共享模式实现。轻度竞争时，线程可以通过 CAS 更新 permits；重度竞争时，线程进入 AQS 队列并通过 `LockSupport.park` 阻塞。因此，它与 `ReentrantLock` 的主要差异不在阻塞机制，而在同步状态语义：`ReentrantLock` 管理独占 owner 与重入次数，`Semaphore` 管理 permits 数量。[5][14]

## 6. Atomic、LongAdder 与 CopyOnWrite

### 6.1 Atomic 的核心逻辑

`AtomicInteger`、`AtomicLong`、`AtomicReference` 等原子类用于对单个变量执行原子更新。以 `AtomicInteger` 为例，官方文档说明它可以用于原子递增计数器；`compareAndSet` 在当前值等于期望值时，将值原子更新为新值。[15]

Atomic 类的核心路径是 CPU 原子指令和 JVM 原子访问封装，而不是 AQS 队列。其典型流程为：

读取当前值
→ 计算新值
→ CAS 尝试写入
→ 成功返回
→ 失败则根据方法语义重试或返回失败

`updateAndGet`、`getAndUpdate` 等方法要求传入函数无副作用，因为在竞争下函数可能被重复执行。[15]

Atomic 适合单变量状态更新、状态标记、引用发布、轻量计数和无锁算法中的局部原子步骤。它不适合需要维护多个字段不变量的复合状态；如果多个字段必须一起更新，单个 CAS 无法直接保证整体一致性。

### 6.2 LongAdder 的核心逻辑

`LongAdder` 维护一个或多个变量共同组成一个 sum。官方文档说明，当多个线程竞争更新时，变量集合可以动态增长以降低竞争；最终 `sum()` 返回各分量之和。在高竞争统计场景下，`LongAdder` 通常比单个 `AtomicLong` 具有更高吞吐，但空间成本更高。[16]

其执行逻辑可以概括为：

低竞争时更新 base
→ 竞争增强时分散到不同 cell
→ 每个线程主要更新某个 cell
→ 读取时汇总 base 与 cells
→ 返回统计值

`LongAdder.sum()` 不是并发更新下的原子快照。调用 `sum()` 时如果仍有线程并发更新，返回值可能不包含同一时刻的全局一致状态。[16]

因此，`LongAdder` 适合 QPS 统计、请求计数、指标累加、热点计数等统计类场景，不适合库存扣减、余额变更、序列号生成等要求精确线性一致的场景。

### 6.3 CopyOnWriteArrayList 的核心逻辑

`CopyOnWriteArrayList` 是写时复制容器。官方文档说明，其所有修改操作都会创建底层数组的新副本。由于修改成本高，它适合遍历操作数量远多于修改操作数量的场景。迭代器基于创建迭代器时的数组快照，不会在迭代期间反映后续增删改，也不会抛出 `ConcurrentModificationException`。[17]

其执行流程可以概括为：

读操作读取当前数组引用
→ 迭代器持有数组快照
→ 写操作复制当前数组
→ 在副本上完成修改
→ 发布新数组引用
→ 后续读者读取新快照

CopyOnWrite 的读路径避免了读写互斥。其代价是每次写入复制数组，并且旧迭代器继续观察旧快照。因此，它适合监听器列表、订阅者列表、配置快照、路由规则、功能开关、插件列表等读多写少场景，不适合高频写入、大数组频繁修改或必须让所有读者立即观察最新值的场景。[17]

## 7. Java 锁从用户态到内核态的统一链路

Java 并发锁的实现可以归纳为三段路径。

第一段是纯用户态快速路径。`synchronized` 的轻量级锁、`ReentrantLock` 的 CAS state、`Semaphore` 的 CAS permits、Atomic 的 CAS 更新、LongAdder 的分散更新，都可以在 JVM 用户态和 CPU 原子指令层完成。这一阶段不会让线程进入操作系统阻塞状态。

第二段是 JVM 内部竞争管理路径。`synchronized` 进入 `ObjectMonitor`；AQS 工具进入同步队列；读写锁维护读者和写者状态；`StampedLock` 维护 stamp 与模式转换。这一阶段仍然可能通过自旋、重试、CAS 和队列调整完成，不必立即进入内核态。

第三段是阻塞与唤醒路径。当线程无法继续通过用户态重试获得同步状态时，`ObjectMonitor` 或 AQS 调用 park。`LockSupport.park` 禁用当前线程调度资格；HotSpot 的 `Unsafe_Park` 调用线程关联的 `Parker::park`；平台相关实现再与操作系统线程调度机制交互。[6][9]

因此，Java 锁进入内核态的核心触发点不是“调用 lock 方法”，而是“线程需要被挂起或唤醒”。无竞争加锁、低竞争 CAS、自旋重试、乐观读验证和快照读取都可以不触发线程阻塞。只有当同步器决定当前线程无法继续运行时，才会进入 park/unpark 与操作系统调度相关的路径。

## 8. 不同同步工具的场景边界

`synchronized` 适合语言级互斥、对象内部不变量保护和简单临界区。它由 JVM 直接支持，语义固定，异常退出时可以自动释放 monitor。[1][2]

`ReentrantLock` 适合需要可中断获取、限时获取、非阻塞尝试、公平锁或多个条件队列的场景。它需要显式释放，通常要求在 `finally` 中调用 `unlock`。[10]

`ReentrantReadWriteLock` 适合读多写少、读操作耗时足以抵消读写锁维护成本的场景。它不适合写多读少、临界区极短或需要读锁升级为写锁的场景。[12]

`StampedLock` 适合读多写少、读过程短、可校验、可重试的场景。它不提供重入、所有权和条件队列语义，不能直接替代所有读写锁场景。[13]

`Semaphore` 适合控制资源并发度。它的语义是 permits，而不是对象所有权。[14]

Atomic 适合单变量原子更新，不适合多字段复合不变量。LongAdder 适合高竞争统计，不适合精确一致计数。CopyOnWrite 适合读多写少和快照遍历，不适合高频写入。[15][16][17]

## 9. 结论

Java 并发锁从用户态到内核态的执行链路具有分层特征。`synchronized` 在语义层由 monitor 定义，在 HotSpot 实现层通过对象头、轻量级锁、自旋、锁膨胀和 `ObjectMonitor` 完成从快速路径到阻塞路径的转换。`ReentrantLock`、`ReentrantReadWriteLock` 和 `Semaphore` 基于 AQS，通过原子 `state` 和 FIFO 队列在用户态完成初始竞争管理，并在无法继续获取同步状态时通过 `LockSupport.park` 进入阻塞路径。`StampedLock` 通过 stamp 和乐观读减少读路径同步成本。Atomic、LongAdder 和 CopyOnWrite 分别通过 CAS、分段累加和快照复制服务于特定并发模式。

因此，Java 锁不是单一机制，而是由语言规范、JVM 对象布局、CPU 原子指令、同步队列、park/unpark 抽象和操作系统调度共同构成的分层系统。是否进入内核态取决于竞争程度和是否需要阻塞线程，而不是取决于代码中是否出现了 `synchronized`、`lock()` 或 `acquire()` 这些表层 API。

## 参考文档

[1] Java 语言规范规定每个对象关联 monitor，并定义 monitor lock/unlock、wait set、synchronizes-with 与 happens-before 关系。([Oracle Docs][2])

[2] Java 虚拟机规范定义 `monitorenter` / `monitorexit` 的执行语义，包括对象 monitor、重入计数、阻塞与退出规则。([Oracle Docs][3])

[3] OpenJDK JEP 450 说明 HotSpot 对象头、轻量级锁、monitor 锁、tag bits、legacy stack locking 与 monitor inflation 的关系。([OpenJDK][4])

[4] OpenJDK Wiki 说明 HotSpot lightweight locking 通过 markWord 锁定位和 CAS fast locking 实现，失败时可能自旋、退避并创建或关联 `ObjectMonitor`。([wiki.openjdk.org][5])

[5] Oracle JDK `AbstractQueuedSynchronizer` 文档说明 AQS 使用原子 `int state`、FIFO 等待队列、独占/共享模式和 `LockSupport` 阻塞支持。([Oracle Docs][6])

[6] Oracle JDK `LockSupport` 文档说明 park/unpark 的 permit 模型，以及 `park` 会禁用当前线程调度资格且可能无理由返回。([Oracle Docs][7])

[7] OpenJDK JEP 374 说明偏向锁用于降低无竞争 monitor 成本，JDK 15 起默认禁用并废弃相关选项。([OpenJDK][1])

[8] OpenJDK `ObjectMonitor` 源码说明 monitor 进入路径包含 spin、entry list、park，并说明 monitor 子系统尽量依赖原子操作与平台 park/unpark 抽象。([GitHub][8])

[9] OpenJDK `Unsafe_Park` 源码显示 `Unsafe.park` 会调用当前线程的 `Parker::park`，`Unsafe.unpark` 会调用目标线程的 `Parker::unpark`。([GitHub][9])

[10] Oracle JDK `ReentrantLock` 文档说明其可重入互斥语义、公平性、阻塞行为、释放规则和 `Condition` 支持。([Oracle Docs][10])

[11] OpenJDK AQS 源码显示获取路径中存在队列、`Thread.onSpinWait()` 和 `LockSupport.park(this)`。([GitHub][11])

[12] Oracle JDK `ReentrantReadWriteLock` 文档说明读写锁、公平/非公平策略、重入、锁降级、不可升级以及适用场景。([Oracle Docs][12])

[13] Oracle JDK `StampedLock` 文档说明写锁、读锁、乐观读、stamp 校验、模式转换、不可重入和适用限制。([Oracle Docs][13])

[14] Oracle JDK `Semaphore` 文档说明 permits、acquire/release、资源池、二值信号量、无所有权和公平性。([Oracle Docs][14])

[15] Oracle JDK `AtomicInteger` 文档说明原子更新、`compareAndSet` 语义，以及 update 函数在竞争下可能重复执行。([Oracle Docs][15])

[16] Oracle JDK `LongAdder` 文档说明高竞争下动态分散变量、统计吞吐、空间成本和 `sum()` 非原子快照。([Oracle Docs][16])

[17] Oracle JDK `CopyOnWriteArrayList` 文档说明修改时复制底层数组、快照迭代器、读多写少适用边界和内存一致性效果。([Oracle Docs][17])

[1]: https://openjdk.org/jeps/374 "JEP 374: Deprecate and Disable Biased Locking"
[2]: https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html "Chapter17.Threads and Locks"
[3]: https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-6.html "Chapter6.The Java Virtual Machine Instruction Set"
[4]: https://openjdk.org/jeps/450 "JEP 450: Compact Object Headers (Experimental)"
[5]: https://wiki.openjdk.org/spaces/HotSpot/pages/138215471/Synchronization%2BUsing%2BThe%2BObjectMonitorTable "Synchronization Using The ObjectMonitorTable - HotSpot - OpenJDK Wiki"
[6]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/AbstractQueuedSynchronizer.html "AbstractQueuedSynchronizer (Java SE 21 & JDK 21)"
[7]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/LockSupport.html "LockSupport (Java SE 21 & JDK 21)"
[8]: https://github.com/openjdk/jdk/blob/master/src/hotspot/share/runtime/objectMonitor.cpp "jdk/src/hotspot/share/runtime/objectMonitor.cpp at master · openjdk/jdk · GitHub"
[9]: https://github.com/openjdk/jdk/blob/master/src/hotspot/share/prims/unsafe.cpp "jdk/src/hotspot/share/prims/unsafe.cpp at master · openjdk/jdk · GitHub"
[10]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html "ReentrantLock (Java SE 21 & JDK 21)"
[11]: https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java "jdk/src/java.base/share/classes/java/util/concurrent/locks/AbstractQueuedSynchronizer.java at master · openjdk/jdk · GitHub"
[12]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html "ReentrantReadWriteLock (Java SE 21 & JDK 21)"
[13]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/StampedLock.html "StampedLock (Java SE 21 & JDK 21)"
[14]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/Semaphore.html "Semaphore (Java SE 21 & JDK 21)"
[15]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html "AtomicInteger (Java SE 21 & JDK 21)"
[16]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html "LongAdder (Java SE 21 & JDK 21)"
[17]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html "CopyOnWriteArrayList (Java SE 21 & JDK 21)"
