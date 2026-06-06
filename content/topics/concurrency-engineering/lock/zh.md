# 并发锁：从硬件原子性到用户态同步抽象

## 一、并发锁存在的意义

并发锁的基本作用，是在多个执行流同时访问共享可变状态时，对关键区进行约束，使同一时刻只有满足同步规则的执行流可以读写该状态。[1]

如果没有同步机制，并发程序会出现三类问题。第一类是线程干扰，例如多个线程同时执行“读取旧值、计算新值、写回新值”，会造成更新丢失。第二类是内存一致性问题，即一个执行流已经写入的数据，另一个执行流可能在没有同步关系的情况下观察不到，或者观察到不完整状态。第三类是对象生命周期问题，在内核或底层系统中，读者仍在访问对象时，写者释放或替换该对象，会产生悬挂引用、use-after-free 或结构破坏。[1]

锁并不只是“排队工具”。在现代并发模型中，锁同时承担三件事：互斥、可见性边界和顺序约束。互斥用于保护临界区；可见性用于保证释放锁前的写入能被后续获得同一锁的执行流观察到；顺序约束用于限制编译器和 CPU 对关键内存访问的重排序。[1]

## 二、硬件层：CPU 提供原子能力，而不是业务锁

CPU 硬件并不知道“库存锁”“账户锁”“订单锁”这类业务概念。硬件提供的是更底层的原子读改写能力、缓存一致性协议和内存屏障能力。[2]

常见硬件原子能力包括 test-and-set、exchange、compare-and-swap、fetch-add、load-linked/store-conditional 或 load-exclusive/store-exclusive 等。这些指令能保证某个内存位置上的一次读改写操作不可被其他 CPU 核心打断。x86 的 LOCK 前缀可以让缓存一致性协议保证原子执行；Arm 的 exclusive load/store 对可以在成功时完成单拷贝原子更新。[2]

软件锁建立在这些硬件能力之上。自旋锁通常通过原子交换、test-and-set 或 CAS 修改一个锁变量；互斥锁的快速路径也可能使用原子比较交换；读写锁通常维护读者计数、写者状态或等待队列；RCU、seqlock 等机制还会结合原子指针发布、版本号和内存屏障。[2]

因此，硬件原子指令不是锁本身。CAS 是一种条件原子更新原语；自旋锁是利用原子原语构造出来的一种同步协议。CAS 失败后是否重试、重试多少次、是否让出 CPU、是否进入阻塞等待，取决于软件算法，而不是 CAS 指令自身。[2]

## 三、内核态并发锁的主要类型

Linux 内核文档把锁原语分为三类：sleeping locks、CPU-local locks 和 spinning locks。[3]

### 1. Sleeping locks

Sleeping locks 允许等待者睡眠，适用于可以阻塞的进程上下文。典型成员包括 mutex、rt_mutex、semaphore、rw_semaphore、ww_mutex 和 percpu_rw_semaphore。[3]

mutex 是内核中的互斥锁，用于串行化访问。它类似二值信号量，但具有更明确的所有权约束。Linux mutex 的实现包含原子 owner 字段、等待队列和内部自旋锁；无竞争时走快速路径，竞争时进入慢路径，可能发生等待或乐观自旋。[3]

rt_mutex 是带优先级继承的互斥锁，用于减少优先级反转。semaphore 是计数信号量，表示一组许可资源；由于它没有严格所有者，不能提供类似 rt_mutex 的优先级继承语义。rw_semaphore 是睡眠型读写信号量，允许多个读者同时进入，写者独占进入。[3]

### 2. CPU-local locks

CPU-local locks 不是跨 CPU 的通用互斥机制。它们主要用于保护每 CPU 数据，常见做法是限制本 CPU 上的抢占、软中断或硬中断，从而避免同一个 CPU 上的并发路径破坏局部状态。[3]

这类机制作用在调度和中断层面，而不是通过一个共享锁变量让所有 CPU 竞争。它们只适合 CPU-local 数据，不适合保护多个 CPU 都会访问的共享对象。[3]

### 3. Spinning locks

Spinning locks 的等待方式是忙等。典型成员包括 raw_spinlock_t、spinlock_t、rwlock_t 和 bit spinlocks。[3]

raw_spinlock_t 是严格自旋锁，等待者不会睡眠。spinlock_t 在非 PREEMPT_RT 内核中通常映射到 raw_spinlock_t；在 PREEMPT_RT 内核中，部分自旋锁语义会被实时内核转换为可睡眠锁语义。rwlock_t 是自旋型读写锁，多个读者可以并发进入，写者独占进入。[3]

自旋锁会直接作用到 CPU 资源上：失败的执行流继续占用 CPU 执行循环，并反复读取或尝试修改同一锁变量。该变量所在缓存行会通过缓存一致性协议在多个 CPU 核心之间转移或失效。竞争越集中，缓存一致性流量越高。[2][3]

### 4. seqlock 与 RCU

seqlock 和 RCU 属于更特殊的并发控制机制。

seqlock 通过版本计数实现无锁读路径。读者读取版本号、读取数据、再次校验版本号；如果期间写者修改过数据，读者重试。seqlock 适合写少读多、数据结构不包含会被写者释放的指针、读者可以重试的场景。[4]

RCU 将更新拆成两个阶段：先移除或替换引用，再等待既有读者退出，最后回收旧对象。RCU 适合读多写少的数据结构，读者路径可以非常轻量，更新者通过延迟回收避免读者访问已释放对象。[4]

## 四、Java 用户态中的锁与同步抽象

Java 把底层锁机制扩展成多种语言级和库级同步抽象。[5]

### 1. synchronized

`synchronized` 使用对象监视器实现内置锁。同步方法或同步代码块进入时获得对象的 intrinsic lock，退出时释放。释放锁与后续获取同一锁之间存在 happens-before 关系，因此它同时提供互斥和可见性保证。[5]

适用场景是保护对象内部不变量、方法级临界区和实现简单互斥。它的特点是语法简单，锁释放由语言结构保证，但不直接提供可中断获取、限时获取和多条件队列等能力。[5]

### 2. ReentrantLock

`ReentrantLock` 提供与 `synchronized` 相同基本语义的可重入互斥锁，同时扩展了显式加锁、显式释放、可中断等待、限时等待、非阻塞尝试获取、公平锁配置和 `Condition` 条件队列。[5]

它适合需要明确控制锁获取方式、需要多个条件队列、需要尝试获取锁或需要可中断等待的场景。显式锁必须在 `finally` 中释放，否则异常路径会造成锁泄漏。[5]

### 3. ReentrantReadWriteLock

`ReentrantReadWriteLock` 把访问分成读锁和写锁。多个读者可以同时持有读锁；写者持有写锁时排斥所有读者和其他写者。它支持公平和非公平模式，支持可重入。写线程可以在持有写锁时获取读锁完成锁降级，读线程不能直接升级为写锁。[5]

它适合读多写少、读操作耗时足以抵消读写锁维护成本、并且读操作之间不需要互斥的场景。它不适合写多读少、临界区很短或读写比例不稳定的场景。

### 4. StampedLock

`StampedLock` 提供写锁、读锁和乐观读三种模式。乐观读不会像传统读锁那样持有一个稳定的读锁状态；读者先获取 stamp，读取数据后调用 `validate` 校验期间是否发生过写锁获取。如果校验失败，读者必须丢弃结果，并转入悲观读锁或重新读取。[5]

它适合读多写少、读逻辑较短、读取结果可以校验并重试的场景。它不能完全取代传统读写锁，因为有些代码不能容忍重试，有些读取过程包含副作用，有些场景要求读期间对象状态始终稳定，有些场景需要传统锁的可重入、条件队列或明确公平性语义。[5]

### 5. Semaphore

`Semaphore` 是计数信号量。它维护一组许可，线程获取许可后才能继续执行，释放许可后其他线程可继续获取。[5]

它适合限流、连接池、资源池、并发度控制等场景。它不等同于互斥锁，因为许可数可以大于 1，并且核心语义是控制并发数量，而不是保护单个对象不变量。

### 6. Atomic、LongAdder 与 CopyOnWrite

`AtomicInteger` 等原子类用于对单个变量执行原子更新。它适合简单状态位、计数器、引用发布和轻量状态机。`LongAdder` 在高竞争计数场景下通过拆分变量降低竞争，官方文档说明它在高竞争统计场景下通常比单个 `AtomicLong` 有更高吞吐，但空间成本更高，并且 `sum()` 不是并发更新下的原子快照。[5]

`CopyOnWriteArrayList` 在每次修改时复制底层数组，迭代器使用快照。它适合遍历次数远多于修改次数的集合，例如监听器列表、配置快照、插件列表、路由规则快照等。它不适合高频写入集合，因为每次写入都要复制数组。[5]

## 五、Go 用户态中的同步抽象

Go 的并发模型同时提供 channel、`sync` 包和 `sync/atomic` 包。Go 官方文档明确要求并发修改共享数据时必须序列化访问，推荐通过 channel 操作或 `sync`、`sync/atomic` 保护共享数据。[6]

### 1. Channel

Go 的核心并发风格是通过通信共享内存，而不是通过共享内存通信。Channel 把数据所有权和执行流同步结合在一起，适合生产者-消费者、流水线、任务分发、事件通知和 goroutine 间数据移交。[6]

Channel 不是所有并发问题的替代品。对于短临界区、已有共享结构、局部状态保护和高频简单互斥，`sync.Mutex` 仍然是标准工具。

### 2. sync.Mutex

`sync.Mutex` 是互斥锁。它的零值是未加锁状态；`Lock` 在锁已被持有时阻塞；`Unlock` 释放锁。Go 的 Mutex 不绑定 goroutine，一个 goroutine 可以加锁，另一个 goroutine 可以解锁。[6]

它适合保护 map、结构体内部不变量、短临界区和不可拆分的复合更新。

### 3. sync.RWMutex

`sync.RWMutex` 允许多个读者或一个写者持有锁。Go 官方文档规定，当写者等待时，新的读者会被阻塞，直到写者获得并释放锁，因此它不是无限制偏向读者的锁。Go 的 RWMutex 不支持递归读锁，也不支持从读锁升级为写锁或从写锁降级为读锁。[6]

它适合读多写少且读临界区有一定长度的场景，不适合写多读少、短临界区或读写比例波动大的场景。

### 4. sync.Cond、sync.Once、sync.WaitGroup、sync.Map、sync.Pool

`sync.Cond` 是条件变量，用于 goroutine 等待某个条件成立。`sync.Once` 保证某个函数只执行一次。`sync.WaitGroup` 用于等待一组 goroutine 完成。`sync.Map` 是并发安全 map，但官方文档说明多数代码仍应使用普通 map 配合锁；`sync.Map` 主要优化两类场景：只写一次多次读取，以及多个 goroutine 读写不相交 key。`sync.Pool` 用于缓存临时对象，降低分配压力。[6]

### 5. sync/atomic

`sync/atomic` 提供底层原子内存原语。官方文档将其定位为低层工具，并说明除特殊底层应用外，同步应优先使用 channel 或 `sync` 包。CAS 在 Go 中的语义是：当地址中的旧值等于期望值时，将其替换为新值并返回成功，否则返回失败。[6]

## 六、CAS 不等于自旋锁，也不保证性能高于加锁

CAS 是硬件或运行时暴露的原子比较交换原语；自旋锁是使用 CAS、test-and-set 或 exchange 等原语构造出来的一种锁。两者属于不同层次。[2]

CAS 自身只执行一次条件更新。所谓“CAS 自旋”，通常是软件代码在 CAS 失败后进入循环重试。失败线程不会天然睡眠；如果算法没有退避、让出 CPU 或转入阻塞路径，它会继续占用执行资源，并反复访问同一共享位置。[2]

在低竞争、低冲突、临界更新非常短、只修改单个机器字的场景中，CAS 可以避免阻塞、唤醒和上下文切换。典型例子包括状态位切换、引用发布、轻量计数器、无锁队列的局部步骤。[6]

在高竞争场景中，大量 CAS 失败会形成重试流量。多个 CPU 核心反复争夺同一个缓存行，失败执行流持续消耗 CPU，吞吐会下降，尾延迟会变差。Java `LongAdder` 的设计事实说明，单点原子计数器在高竞争下并不是最优结构，拆分热点变量可以降低竞争。[5]

加锁也不必然比 CAS 慢。阻塞型锁在竞争激烈或临界区较长时，可以让失败线程睡眠或 park，减少无效自旋和缓存行争夺。锁的代价是阻塞、唤醒、调度和上下文切换；CAS 循环的代价是重试、缓存一致性流量和 CPU 占用。二者没有绝对性能序关系，性能取决于竞争强度、临界区长度、失败重试成本、调度成本和共享数据热点程度。[3][5][6]

## 七、CopyOnWrite + Merge 的适用边界

CopyOnWrite + Merge 的本质，是把“多个执行流直接修改同一份共享数据”改成“每个执行流修改自己的副本或局部分片，之后再发布或合并结果”。当读路径只读取不可变快照，写路径只修改私有副本时，读写临界路径可以不使用传统互斥锁。[5]

这种模式适合大数据、低冲突、可合并、可分区或允许最终一致的场景。典型场景包括：

1. 配置快照、灰度规则、路由表、权限规则、功能开关：读者读取稳定快照，写者生成新快照后原子替换引用。
2. 监听器列表、插件列表、订阅者列表：遍历远多于增删，迭代时使用旧快照可以接受。
3. 日志聚合、指标聚合、埋点统计：各线程或各分片局部累加，周期性 merge。
4. 搜索索引、倒排索引、LSM Tree 类结构：写入进入新段或新层级，查询读取多个不可变段，后台合并。
5. MapReduce、批处理、特征统计：map 阶段局部聚合，reduce 阶段按 key 合并。
6. 推荐系统、风控画像、离线报表：允许按批次合并，并且读者可以接受快照延迟。
7. 分片计数器、直方图、TopN 近似统计：更新可以分散到多个桶或分片，最终读取时聚合。
8. CRDT 或事件追加模型：操作本身可交换、可结合、可幂等，合并规则明确。

它不适合固定热点数据的强一致并发修改。库存扣减、优惠券余量、座位预订、账户余额、订单状态机、唯一用户名注册、全局限流精确配额、分布式锁所有权、拍卖最高价、序列号分配等场景，都不是简单 CopyOnWrite + Merge 可以直接解决的对象。[7]

原因是这些场景的多个更新指向同一逻辑实体，并且存在强顺序约束或唯一性约束。两个副本分别扣减同一件库存，merge 时必须判断谁成功、谁失败；两个副本分别更新账户余额，merge 时必须保证账务顺序和余额约束；两个副本分别预订同一座位，merge 时必须保留唯一成功者。这时 merge 阶段会重新引入事务、锁、CAS、版本校验或单线程串行化。[7]

因此，CopyOnWrite + Merge 并不是对所有并发写的替代品。它适合把冲突推迟到可控合并阶段的场景，不适合冲突集中在同一个业务实体且要求线性一致的场景。

## 八、读写锁不一定比互斥锁性能高

读写锁的价值来自读并发。它允许多个读者同时进入，从而减少读操作之间的互斥。但读写锁需要维护读者数量、写者状态、等待队列和公平性策略，复杂度高于普通互斥锁。[5][6]

在读多写少、读临界区较长、写入很少发生时，读写锁可以提高并发读吞吐。在写多读少、读临界区极短、读写比例频繁变化或写者等待频繁发生时，读写锁可能不如互斥锁。写者需要等待既有读者退出；写者等待期间，部分实现会阻塞新读者；读者频繁进入退出也会修改共享计数或状态。[5][6]

StampedLock 的乐观读和 Linux RCU、seqlock 进一步降低了读路径成本，但它们不能完全取代传统读写锁。[4][5]

StampedLock 乐观读需要读取后校验。如果校验失败，读取结果没有一致性保证，必须重试或退化为悲观读。它适合短读路径和可重试逻辑，不适合读过程有副作用、读取对象生命周期不稳定、不能重试或必须始终读取最新一致状态的场景。[5]

RCU 的读路径很轻量，但它依赖“替换而不是原地破坏”和“延迟回收旧对象”。读者可能看到旧版本对象；更新者需要等待宽限期后才能释放旧对象。它适合读多写少、读者可接受快照语义、对象可以通过指针替换的数据结构，不适合所有共享状态。[4]

seqlock 的读者不加传统读锁，但读者可能反复重试；如果写入频繁，读者重试成本上升。Linux 文档也指出，sequence counter 不能保护包含指针的数据，因为写者可能使读者正在跟随的指针失效。[4]

因此，StampedLock、RCU 和 seqlock 是特定一致性模型下的优化机制，不是传统读写锁的完全替代。

## 九、从硬件到用户态的概念边界

并发同步概念可以按层次区分：

1. 硬件原子指令：CAS、exchange、fetch-add、test-and-set、load-exclusive/store-exclusive。它们保证单个内存位置上的原子读改写。
2. 内存顺序机制：acquire、release、full barrier、volatile 语义、happens-before。它们约束可见性和重排序。
3. 自旋锁：使用原子指令反复尝试获取锁。它是锁，不是无锁算法。
4. 互斥锁：同一时刻只允许一个执行流进入临界区。竞争时可以睡眠、park 或进入等待队列。
5. 信号量：控制许可数量，适合并发度和资源池控制。
6. 读写锁：允许多个读者或一个写者，适合读多写少。
7. seqlock：读者无传统锁，依靠版本校验重试。
8. RCU：读者读取旧版本或新版本，写者替换引用并延迟回收。
9. CopyOnWrite：写者复制并发布新快照，读者读取旧快照。
10. Channel：通过消息传递转移数据或同步事件，减少共享可变状态。
11. 原子类与无锁数据结构：使用原子原语维护状态，但算法可能包含重试、退避、帮助完成或内存回收协议。

“无锁”不等于“没有同步成本”。无锁算法避免某些互斥等待，但仍然消耗原子指令、缓存一致性流量、内存屏障、重试和内存回收成本。自旋锁虽然使用 CAS，但它仍然是有锁同步机制。CAS 虽然是原子原语，但 CAS 循环在高竞争时可能长时间占用执行资源。[2][6]

## 十、选择并发控制方式的客观维度

并发控制方式不能按“锁一定慢、CAS 一定快、读写锁一定优于互斥锁、乐观读一定优于悲观读”排序。正确分类维度包括：

1. 共享数据是否可变。
2. 是否存在单点热点。
3. 是否需要线性一致。
4. 是否允许读取旧快照。
5. 读写比例是否稳定。
6. 临界区是否足够长。
7. 更新是否可交换、可结合、可幂等。
8. 冲突能否在 merge 阶段解决。
9. 失败重试是否可接受。
10. 阻塞、唤醒和上下文切换成本是否低于自旋重试成本。

低冲突单变量更新适合 CAS 或原子类；高竞争统计适合分片计数或 LongAdder 类结构；复合对象不变量适合互斥锁；读多写少适合读写锁、StampedLock、RCU 或 CopyOnWrite；写多读少通常适合互斥锁或分区锁；可批量合并的数据适合 CopyOnWrite + Merge；固定热点强一致数据通常需要锁、事务、CAS 版本校验或单线程串行化。

并发锁的核心事实是：锁不是单一工具，而是一组从硬件原子性、内存模型、调度器、内核原语到语言库抽象逐层构建的同步协议。不同协议在互斥性、可见性、等待方式、读写并发度、失败处理和一致性模型上不同，因此不存在适用于所有并发场景的最优锁。

## 参考资料

[1] 并发锁的必要性：Linux 内核文档将锁用于保护 critical region；Oracle Java 教程说明 `synchronized` 可防止线程干扰和内存一致性错误；Go 内存模型规定并发修改共享数据必须通过 channel、`sync` 或 `sync/atomic` 序列化。([内核文档][1])

[2] 硬件原子性与 CAS/自旋边界：Intel 官方文档说明 LOCK 前缀通常通过缓存一致性机制保证原子执行；Arm 官方文档说明 Store-Exclusive 成功时完成单拷贝原子更新；Linux 原子操作文档说明原子位操作和内存屏障语义；Go `sync/atomic` 文档给出 CAS 的条件更新语义。([英特尔][2])

[3] Linux 内核锁分类：Linux 内核文档把锁分为 sleeping locks、CPU-local locks、spinning locks，并列出 mutex、rt_mutex、semaphore、rw_semaphore、raw_spinlock_t、spinlock_t、rwlock_t 等类型；Linux mutex 文档说明 mutex 的 owner、wait queue、spinlock、cmpxchg 快速路径和竞争路径。([内核文档][3])

[4] RCU 与 seqlock：Linux RCU 文档说明 RCU 面向 read-mostly 场景，将更新拆成移除和回收两个阶段，并让读者使用更轻量同步；sequence counter/seqlock 文档说明读者无锁读取后校验版本，写者更新版本，且 sequence counter 不适合保护包含会失效指针的数据。([内核文档][4])

[5] Java 同步抽象：Oracle/JDK 文档分别说明 `synchronized` 的 intrinsic lock 与 happens-before、`ReentrantLock` 的可重入和公平性、`ReentrantReadWriteLock` 的读写语义、`StampedLock` 的 optimistic read 与 validate、`Semaphore` 的 permit、原子类、`LongAdder` 的高竞争统计特性、`CopyOnWriteArrayList` 的写时复制和快照迭代、`LockSupport` 的 park/unpark。([Oracle Docs][5])

[6] Go 并发抽象：Go 官方内存模型、Go Blog、`sync` 和 `sync/atomic` 文档说明 channel 优先的并发风格，以及 `Mutex`、`RWMutex`、`Cond`、`Once`、`WaitGroup`、`sync.Map`、`sync.Pool`、atomic CAS 的语义和适用边界。([Go开发][6])

[7] CopyOnWrite + Merge 的边界：`CopyOnWriteArrayList` 官方文档说明修改会复制底层数组，适合遍历远多于修改的场景；RCU 官方文档说明其依赖替换、宽限期和延迟回收，适合读多写少而不是任意强一致写热点。([Oracle Docs][7])

[1]: https://docs.kernel.org/kernel-hacking/locking.html "Unreliable Guide To Locking — The Linux Kernel  documentation"
[2]: https://www.intel.com/content/www/us/en/support/articles/000099741/processors/intel-xeon-processors.html "Where is the Cache-Coherence Protocol Directory Placed in Intel®..."
[3]: https://docs.kernel.org/locking/locktypes.html "Lock types and their rules — The Linux Kernel  documentation"
[4]: https://docs.kernel.org/RCU/whatisRCU.html "What is RCU? -- “Read, Copy, Update” — The Linux Kernel  documentation"
[5]: https://docs.oracle.com/javase/tutorial/essential/concurrency/locksync.html?utm_source=chatgpt.com "Intrinsic Locks and Synchronization (The Java™ Tutorials > ..."
[6]: https://go.dev/ref/mem "The Go Memory Model - The Go Programming Language"
[7]: https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/CopyOnWriteArrayList.html "CopyOnWriteArrayList (Java Platform SE 8 )"
