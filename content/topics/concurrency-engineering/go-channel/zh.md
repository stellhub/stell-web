# Go 并发同步机制调研：Channel 与 sync 包并发原语的语义、原理与使用边界

## 摘要

Go 语言在并发编程中同时提供基于通信的同步机制与基于共享内存的同步机制。Channel 是 Go 语言规范中定义的通信原语，用于在并发执行的函数之间发送和接收指定元素类型的值；`sync` 包提供互斥锁、读写锁、条件变量、一次性初始化、任务等待、并发 Map、临时对象池等同步原语；`sync/atomic` 包提供底层原子内存操作。本文基于 Go 语言规范、Go 内存模型、Go 官方源码和标准库文档，对 Channel、`sync.Mutex`、`sync.RWMutex`、`sync.Cond`、`sync.Once`、`sync.WaitGroup`、`sync.Map`、`sync.Pool` 以及 `sync/atomic` 的语义、运行机制和适用边界进行归纳。调研结论表明，Channel 适用于 goroutine 间通信、所有权传递、任务分发、结果返回、关闭通知和并发限制；锁和原子操作适用于保护共享状态、低层库实现和性能敏感路径；不同同步机制不构成互斥关系，而是在不同并发问题中承担不同同步语义。

**关键词：** Go；Golang；Channel；goroutine；sync；Mutex；RWMutex；Cond；WaitGroup；atomic；并发同步

## 1. 引言

Go 语言将 goroutine 和 channel 作为语言层面的并发构造，同时在标准库中提供 `sync` 与 `sync/atomic` 包。Go 内存模型指出，当多个 goroutine 同时访问同一数据，并且至少存在写操作时，程序必须通过 channel 操作、锁或其他同步原语对访问进行串行化；如果没有数据竞争，Go 程序表现为顺序一致模型。[1]

因此，Go 并发同步不应仅理解为“加锁”。Channel 提供通信与同步语义；`sync.Mutex` 与 `sync.RWMutex` 提供共享状态保护；`sync.Cond` 提供条件等待与通知；`sync.Once` 提供一次性初始化；`sync.WaitGroup` 提供任务完成等待；`sync.Map` 提供特定场景下的并发 Map；`sync.Pool` 提供并发安全的临时对象复用；`sync/atomic` 提供底层原子内存操作。

## 2. 资料来源与研究方法

本文资料来源包括 Go 语言规范、Go 内存模型、Go 官方运行时源码、`sync` 标准库文档、`sync/atomic` 标准库文档和 Go Wiki。研究方法采用文档归纳法：首先根据语言规范确定 Channel 的语义；其次根据运行时源码说明 Channel 的内部数据结构；再次根据 Go 内存模型确定 Channel、锁、Once、atomic 的 happens-before 关系；最后根据标准库文档归纳各并发原语的使用边界。

## 3. Channel 的语言语义与基本特性

### 3.1 Channel 的定义

Go 语言规范将 Channel 定义为一种用于并发执行函数之间通信的机制。Channel 通过发送和接收指定元素类型的值完成通信。未初始化的 Channel 零值为 `nil`。[2]

Channel 类型可以分为双向 Channel、只发送 Channel 和只接收 Channel：

```go
var bidirectional chan int
var sendOnly chan<- int
var receiveOnly <-chan int
```

其中，`chan T` 可以发送和接收 `T` 类型的值；`chan<- T` 只能发送；`<-chan T` 只能接收。方向可以通过赋值或显式类型转换收窄。该设计使 API 可以在类型层面表达调用方权限，避免接收方误发送或发送方误接收。[2]

### 3.2 有缓冲与无缓冲 Channel

Channel 通过 `make` 创建，并可以指定容量：

```go
unbuffered := make(chan int)
buffered := make(chan int, 10)
```

容量为 0 或未指定容量时，Channel 为无缓冲 Channel。无缓冲 Channel 的通信只有在发送方和接收方同时准备好时才成功。容量大于 0 时，Channel 为有缓冲 Channel；当缓冲区未满时发送可以继续，当缓冲区非空时接收可以继续。`nil` Channel 永远不会准备好通信。[2]

### 3.3 FIFO 特性与并发安全性

Go 语言规范规定，一个 Channel 可以被任意数量的 goroutine 用于发送、接收、`cap` 和 `len` 调用，无需额外同步。Channel 按先进先出队列工作；如果一个 goroutine 发送值，另一个 goroutine 接收值，则接收顺序与发送顺序一致。[2]

这意味着 Channel 自身的发送队列、接收队列、缓冲区状态和关闭状态由运行时维护，调用方不需要为 Channel 自身再额外加锁。但是，如果 Channel 中传递的是指针、slice、map 或其他引用类型，Channel 只保证“值的传递与同步关系”，不自动保证被引用对象后续访问的并发安全。

## 4. Channel 解决的问题及缺失后的影响

### 4.1 Channel 解决的核心问题

Channel 解决的是 goroutine 之间的通信、同步和顺序关系建立问题。Go 内存模型规定，每一次 Channel 发送都与该 Channel 上对应的接收匹配，并且 Channel 发送发生在对应接收完成之前；关闭 Channel 发生在因 Channel 关闭而返回零值的接收之前；无缓冲 Channel 的接收发生在对应发送完成之前。[1]

因此，Channel 不只是数据队列，也是同步边界。通过 Channel 传递数据时，发送前的写入可以通过 happens-before 关系被接收方安全观察到。

### 4.2 没有 Channel 时的替代方式

如果没有 Channel，goroutine 之间仍可通过共享变量、`sync.Mutex`、`sync.RWMutex`、`sync.Cond`、`sync.WaitGroup` 或 `sync/atomic` 实现协作。然而，Go 内存模型明确要求：如果多个 goroutine 同时修改并访问数据，必须通过同步机制串行化访问。没有 Channel 或其他同步原语时，一个 goroutine 的写入不保证被另一个 goroutine 观察到，并可能形成数据竞争。[1]

例如，下面代码通过 Channel 建立同步顺序：

```go
package main

import "fmt"

func main() {
	ch := make(chan struct{})
	var result string

	go func() {
		result = "done"
		ch <- struct{}{}
	}()

	<-ch
	fmt.Println(result)
}
```

如果去掉 Channel 或其他同步机制，只依赖 goroutine 的执行时间，主 goroutine 不具备可靠的可见性保证。

## 5. Channel 的运行时数据结构

### 5.1 hchan 结构

Go 官方运行时源码中，Channel 的实现文件为 `runtime/chan.go`。该文件声明 Channel 的运行时结构为 `hchan`。`hchan` 包含以下核心字段：[3]

```go
type hchan struct {
	qcount   uint
	dataqsiz uint
	buf      unsafe.Pointer
	elemsize uint16
	closed   uint32
	timer    *timer
	elemtype *_type
	sendx    uint
	recvx    uint
	recvq    waitq
	sendq    waitq
	bubble   *synctestBubble
	lock     mutex
}
```

这些字段可以分为五类：

第一，缓冲区状态字段。`qcount` 表示队列中已有元素数量；`dataqsiz` 表示环形队列容量；`buf` 指向缓冲区；`sendx` 和 `recvx` 分别表示发送索引和接收索引。

第二，元素元数据字段。`elemsize` 表示元素大小；`elemtype` 表示元素类型。

第三，关闭状态字段。`closed` 表示 Channel 是否已关闭。

第四，等待队列字段。`recvq` 表示等待接收的 goroutine 队列；`sendq` 表示等待发送的 goroutine 队列。

第五，内部互斥字段。`lock` 保护 `hchan` 的所有字段，也保护阻塞在该 Channel 上的若干 `sudog` 字段。[3]

### 5.2 Channel 如何防止并发问题

Channel 运行时结构包含互斥锁 `lock`。Go 源码注释说明，该锁保护 `hchan` 中的所有字段以及阻塞在该 Channel 上的若干 `sudog` 字段。[3] 因此，多个 goroutine 并发发送或接收时，运行时通过内部锁、发送等待队列、接收等待队列和环形缓冲区维护 Channel 状态一致性。

在无缓冲 Channel 中，如果接收方已经等待，发送方可以将数据直接复制给接收方并唤醒接收方；如果没有接收方，发送方会进入发送等待队列并阻塞。在有缓冲 Channel 中，如果缓冲区未满，发送方将元素写入环形缓冲区；如果缓冲区已满，则发送方阻塞。接收过程与之对应：优先从等待发送者或缓冲区接收数据；如果没有可接收数据，则进入接收等待队列并阻塞。[3]

## 6. Channel 如何在 goroutine 之间完成通信

Channel 通信由发送、接收、关闭和选择四类操作构成。

发送语句格式为：

```go
ch <- value
```

Go 语言规范规定，发送语句会将值发送到 Channel；Channel 类型必须允许发送；待发送值必须可赋值给 Channel 的元素类型。发送在通信可以进行前阻塞。无缓冲 Channel 要求接收方已准备好；有缓冲 Channel 要求缓冲区有空间；向已关闭 Channel 发送会导致运行时 panic；向 `nil` Channel 发送会永久阻塞。[4]

接收表达式格式为：

```go
value := <-ch
value, ok := <-ch
```

接收表达式会阻塞，直到有值可用。从关闭的 Channel 接收可以立即继续；在此前发送的值被接收完之后，接收会得到元素类型零值。双返回值形式中的 `ok` 用于判断接收到的值是否来自关闭前发送的数据。[5]

关闭 Channel 使用：

```go
close(ch)
```

`close(ch)` 表示不会再向该 Channel 发送值。关闭已关闭 Channel、关闭 `nil` Channel 或向已关闭 Channel 发送都会导致 panic。关闭后，在历史发送值被接收完之后，接收操作返回元素类型零值且不阻塞。[6]

`select` 用于在多组 Channel 发送或接收操作中选择一个可以进行的操作。当多个通信操作可进行时，Go 规范规定会通过均匀伪随机选择其中一个；如果没有操作可进行且存在 `default`，则执行 `default`；如果没有 `default`，则阻塞直到至少一个通信操作可进行。[7]

## 7. Channel 的方向属性及使用场景

### 7.1 只读 Channel

只读 Channel 类型为 `<-chan T`。它只能接收，不能发送，也不能关闭。只读 Channel 常用于函数返回值，表示调用方只能消费数据流，不能干预生产者。

```go
func generate(nums []int) <-chan int {
	out := make(chan int)

	go func() {
		defer close(out)
		for _, n := range nums {
			out <- n
		}
	}()

	return out
}
```

该形式适合数据生产者对外暴露结果流，例如任务结果流、事件订阅流、分页扫描结果流和异步计算结果流。

### 7.2 只写 Channel

只写 Channel 类型为 `chan<- T`。它只能发送，不能接收。只写 Channel 常用于函数参数，表示函数只负责生产数据或提交任务，不能消费队列中的数据。

```go
func submitJobs(out chan<- int, jobs []int) {
	for _, job := range jobs {
		out <- job
	}
}
```

该形式适合任务提交器、事件发布器、日志写入器和生产者函数。

### 7.3 必须或事实依赖 Channel 的场景

从语言机制和标准库交互方式看，以下场景事实依赖 Channel：

第一，基于 `select` 的多路通信。`select` 的 case 只能围绕 Channel 发送、接收或 `default` 构成，因此需要同时等待多个异步事件时，Channel 是该语言机制的直接操作对象。[7]

第二，基于关闭广播的完成通知。Go 内存模型规定，关闭 Channel 发生在因关闭而返回零值的接收之前，因此关闭 Channel 可以作为通知多个接收者停止或完成的同步事件。[1]

第三，基于 `for range` 的生产者到消费者数据流。Go 规范规定，对 Channel 执行 `range` 会持续产生已发送值，直到 Channel 被关闭；如果 Channel 为 `nil`，则 range 永久阻塞。[8]

第四，基于缓冲 Channel 的并发限制。Go 内存模型指出，容量为 `C` 的 Channel 上第 `k` 次接收发生在第 `k+C` 次发送完成之前，该规则可用于将缓冲 Channel 建模为计数信号量，用于限制同时执行的 goroutine 数量。[1]

第五，标准库或业务 API 已将 Channel 作为接口契约时。此时调用方必须遵守该 API 的 Channel 协议，例如只读结果流、取消通知、事件通知和任务队列。

## 8. sync.Mutex 的基本原理与用法

`sync.Mutex` 是互斥锁。标准库文档定义其为 mutual exclusion lock。`Mutex` 的零值是未加锁状态，并且首次使用后不得复制。[9]

`Mutex.Lock()` 用于加锁。如果锁已被占用，调用 goroutine 会阻塞直到锁可用。`Mutex.Unlock()` 用于解锁；如果进入 `Unlock` 时锁未被持有，会导致运行时错误。Go 内存模型规定，同一个 `Mutex` 上第 `n` 次 `Unlock` 发生在第 `m` 次 `Lock` 返回之前，其中 `n < m`。[9]

典型用法如下：

```go
package main

import "sync"

type Counter struct {
	mu    sync.Mutex
	value int
}

func (c *Counter) Inc() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.value++
}

func (c *Counter) Value() int {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.value
}
```

`Mutex` 适用于保护共享变量、复合结构体状态、普通 `map`、连接状态和缓存状态。当并发问题本质是多个 goroutine 读写同一块共享内存时，`Mutex` 是直接同步手段。

## 9. sync.RWMutex 的基本原理与用法

`sync.RWMutex` 是读写互斥锁。标准库文档定义其为 reader/writer mutual exclusion lock。它允许任意数量的读者同时持有读锁，或者一个写者持有写锁。`RWMutex` 的零值是未加锁状态，首次使用后不得复制。[10]

`RLock` 和 `RUnlock` 用于读锁；`Lock` 和 `Unlock` 用于写锁。如果已有读锁存在并且有 goroutine 调用 `Lock` 请求写锁，后续 `RLock` 会阻塞，直到写锁获得并释放，以保证写者最终可获得锁。文档还明确指出，`RLock` 不能升级为 `Lock`，`Lock` 也不能降级为 `RLock`。[10]

典型用法如下：

```go
package main

import "sync"

type Cache struct {
	mu   sync.RWMutex
	data map[string]string
}

func (c *Cache) Get(key string) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	v, ok := c.data[key]
	return v, ok
}

func (c *Cache) Set(key, value string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.data[key] = value
}
```

`RWMutex` 适用于读多写少且读操作可以并发执行的共享状态，例如配置快照、本地缓存、路由表和元数据索引。若写操作频繁或临界区很短，读写锁带来的状态管理成本需要通过实际基准测试确认。

## 10. sync.Cond 的基本使用

`sync.Cond` 实现条件变量，是 goroutine 等待或通知事件发生的 rendezvous point。每个 `Cond` 关联一个 `Locker`，通常是 `*sync.Mutex` 或 `*sync.RWMutex`。在修改条件或调用 `Wait` 时必须持有该锁。[11]

`Cond.Wait()` 会原子地解锁 `c.L` 并挂起当前 goroutine；恢复后，`Wait` 会在返回前重新加锁。标准库文档说明，调用方通常不能假定 `Wait` 返回时条件一定为真，因此应在循环中调用 `Wait`。[11]

```go
package main

import "sync"

type Queue struct {
	mu       sync.Mutex
	notEmpty *sync.Cond
	items    []int
}

func NewQueue() *Queue {
	q := &Queue{}
	q.notEmpty = sync.NewCond(&q.mu)
	return q
}

func (q *Queue) Push(v int) {
	q.mu.Lock()
	defer q.mu.Unlock()

	q.items = append(q.items, v)
	q.notEmpty.Signal()
}

func (q *Queue) Pop() int {
	q.mu.Lock()
	defer q.mu.Unlock()

	for len(q.items) == 0 {
		q.notEmpty.Wait()
	}

	v := q.items[0]
	q.items = q.items[1:]
	return v
}
```

`Signal` 唤醒一个等待 goroutine；`Broadcast` 唤醒所有等待 goroutine。标准库文档同时指出，对于许多简单场景，使用 Channel 通常比 `Cond` 更合适；`Broadcast` 对应关闭 Channel，`Signal` 对应向 Channel 发送值。[11]

## 11. sync.Once 的基本使用

`sync.Once` 用于在多个 goroutine 存在时安全地执行一次初始化操作。`Once.Do(f)` 只会在该 `Once` 实例上第一次调用时执行 `f`；即使后续调用传入不同函数值，也不会再次执行。`Once` 首次使用后不得复制。[12]

Go 内存模型规定，`once.Do(f)` 中 `f` 的完成发生在任意 `once.Do(f)` 返回之前。[1]

```go
package main

import "sync"

type Config struct {
	loaded bool
}

var (
	once   sync.Once
	config *Config
)

func LoadConfig() *Config {
	once.Do(func() {
		config = &Config{loaded: true}
	})
	return config
}
```

`Once` 适用于单例初始化、全局配置加载、只初始化一次的连接池、指标注册和只执行一次的懒加载逻辑。若 `f` 中再次调用同一个 `Once.Do`，标准库文档指出会导致死锁；如果 `f` panic，`Do` 会认为该函数已返回，后续调用不会再次执行 `f`。[12]

## 12. sync.WaitGroup 的基本使用

`sync.WaitGroup` 是计数信号量，通常用于等待一组 goroutine 或任务完成。当前官方文档提供两类用法：一类是 `WaitGroup.Go(f)`；另一类是传统的 `Add`、`Done`、`Wait`。其中 `WaitGroup.Go` 被标注为 Go 1.25 新增；旧版本 Go 仍使用 `Add` 与 `Done`。[13]

Go 1.25+ 写法如下：

```go
package main

import "sync"

func main() {
	var wg sync.WaitGroup

	wg.Go(func() {
		// Do task A.
	})

	wg.Go(func() {
		// Do task B.
	})

	wg.Wait()
}
```

传统写法如下：

```go
package main

import "sync"

func main() {
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		// Do task A.
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		// Do task B.
	}()

	wg.Wait()
}
```

`Add(delta)` 修改任务计数，计数变为 0 时释放所有阻塞在 `Wait` 上的 goroutine；计数变为负数会 panic。`Done()` 等价于 `Add(-1)`。`Wait()` 阻塞直到任务计数为 0。标准库文档要求，当计数器为 0 时，正数 `Add` 必须发生在 `Wait` 之前；复用 `WaitGroup` 时，新一轮 `Add` 必须发生在上一轮 `Wait` 返回之后。[13]

## 13. sync.Map 的基本使用

`sync.Map` 类似 `map[any]any`，但可被多个 goroutine 并发使用，无需额外加锁或协调。`Load`、`Store`、`Delete` 等操作具备摊还常数时间复杂度。[14]

标准库文档同时说明，`sync.Map` 是专用类型。大多数代码应使用普通 Go map 并配合独立锁或其他协调方式，以获得更好的类型安全，并更容易维护与 map 内容相关的不变量。`sync.Map` 优化的两个常见场景是：某个 key 的条目只写入一次但读取多次，例如只增长缓存；多个 goroutine 读、写、覆盖互不相交的 key 集合。[14]

```go
package main

import "sync"

type Registry struct {
	m sync.Map
}

func (r *Registry) Register(name string, value any) {
	r.m.Store(name, value)
}

func (r *Registry) Load(name string) (any, bool) {
	return r.m.Load(name)
}
```

`sync.Map` 适用于读多写少、key 独立、无需维护强类型不变量的并发字典。若业务需要维护多个字段之间的一致性，普通 `map` 加 `Mutex` 或 `RWMutex` 通常更便于表达原子更新边界。

## 14. sync.Pool 的基本使用

`sync.Pool` 是临时对象集合，可并发安全地保存和取回对象。标准库文档说明，`Pool` 中的任何对象都可能在任意时间被自动移除且不通知调用方；如果对象在移除时只有 `Pool` 持有引用，则可能被释放。[15]

`Pool` 的目标是缓存已分配但暂时未使用的对象，以便后续复用，从而减轻垃圾回收压力。标准库文档给出的典型正例是 `fmt` 包维护临时输出 buffer；该存储在高并发打印时扩展，在空闲时收缩。[15]

```go
package main

import (
	"bytes"
	"sync"
)

var bufferPool = sync.Pool{
	New: func() any {
		return new(bytes.Buffer)
	},
}

func Encode(data string) []byte {
	buf := bufferPool.Get().(*bytes.Buffer)
	defer bufferPool.Put(buf)

	buf.Reset()
	buf.WriteString(data)

	out := make([]byte, buf.Len())
	copy(out, buf.Bytes())
	return out
}
```

`sync.Pool` 适用于高频、短生命周期、可重置的临时对象，例如 buffer、编码器临时结构、压缩临时空间和日志拼接对象。它不适合作为业务对象生命周期管理容器，也不适合依赖对象一定被保留的缓存语义。

## 15. sync/atomic 的基本使用

`sync/atomic` 包提供底层原子内存原语，用于实现同步算法。官方文档明确指出，这些函数需要非常谨慎地正确使用；除特殊低层应用外，同步最好通过 Channel 或 `sync` 包完成。[16]

原子操作包括 load、store、add、swap、compare-and-swap 等。Go 内存模型规定，如果原子操作 A 的效果被原子操作 B 观察到，则 A 发生在 B 之前；程序中的所有原子操作表现为某种顺序一致顺序。[16]

Go 1.19 以后，标准库提供了带类型的原子封装，例如 `atomic.Int64`、`atomic.Bool`、`atomic.Pointer[T]` 等。基本使用如下：

```go
package main

import "sync/atomic"

type Metrics struct {
	requests atomic.Int64
	enabled  atomic.Bool
}

func (m *Metrics) Inc() {
	m.requests.Add(1)
}

func (m *Metrics) Requests() int64 {
	return m.requests.Load()
}

func (m *Metrics) SetEnabled(v bool) {
	m.enabled.Store(v)
}

func (m *Metrics) Enabled() bool {
	return m.enabled.Load()
}
```

`atomic` 适用于简单计数器、状态开关、只读配置指针替换、无锁快路径标志位和低层同步结构。它不适合表达多个字段之间的一致性更新。如果一次业务更新涉及多个变量，`Mutex`、`RWMutex` 或 Channel 通常能更直接地表达临界区或通信边界。

## 16. Channel 与锁的选择边界

Go Wiki 将 Channel 与 Mutex 的选择边界归纳为：Channel 适合传递数据所有权、分发工作单元和通信异步结果；Mutex 适合保护缓存和状态。Go Wiki 同时指出，大多数加锁问题可以通过 Channel 或传统锁解决，选择标准应是表达力和简单性。[17]

因此，Channel 与锁不是替代关系，而是面向不同并发建模方式：

Channel 适合“数据或事件在 goroutine 之间流动”的问题。例如任务队列、生产者-消费者、流水线、异步返回、取消通知、超时选择、并发限流和状态机事件循环。

Mutex 和 RWMutex 适合“多个 goroutine 访问同一个共享对象”的问题。例如本地缓存、连接状态、路由表、配置对象、统计聚合和内存索引。

Cond 适合“共享状态满足某个条件后唤醒等待者”的问题。例如有界队列、批处理条件、资源池可用条件和复杂状态机唤醒。

WaitGroup 适合“等待一组任务完成”的问题。它不负责传递结果；结果应通过 Channel、锁保护的共享结构或其他并发安全容器返回。

Map 适合特定并发字典场景。它不是普通 map 的全面替代品。

Pool 适合临时对象复用。它不是缓存，也不保证对象保留。

Atomic 适合低层、简单、单变量同步。它不适合复杂业务状态维护。

## 17. 结论

Go 并发同步体系由语言级 Channel、标准库级 `sync` 原语和底层 `sync/atomic` 原子操作共同构成。Channel 的核心作用是 goroutine 之间的通信与同步，它通过类型化数据传递、阻塞语义、关闭语义、FIFO 队列、happens-before 关系和运行时内部锁避免 Channel 自身状态竞争。`sync.Mutex` 和 `sync.RWMutex` 的核心作用是保护共享内存；`sync.Cond` 用于条件等待；`sync.Once` 用于一次性初始化；`sync.WaitGroup` 用于等待任务集合完成；`sync.Map` 用于特定并发 Map 场景；`sync.Pool` 用于临时对象复用；`sync/atomic` 用于低层原子内存操作。

在工程选型中，应首先判断并发问题是“通信问题”还是“共享状态问题”。如果问题是任务、事件、结果或所有权在 goroutine 之间流动，Channel 是直接建模手段。如果问题是多个 goroutine 读写同一个对象，锁更直接。如果问题是简单计数或状态位，atomic 可以减少锁的使用，但需要明确内存语义和一致性边界。若涉及多个字段、多个不变量或复杂业务状态，锁或 Channel 通常比裸 atomic 更容易保证正确性。

## 参考文档

[1] Go Memory Model：说明数据竞争定义、必须用 channel/锁/atomic 串行化访问、Channel happens-before、缓冲 Channel 计数信号量、锁与 Once/atomic 的同步语义。([Go][1])
[2] Go Language Specification：说明 Channel 类型、方向、`make` 容量、有缓冲/无缓冲、`nil` Channel、FIFO、可被多个 goroutine 并发使用。([Go][2])
[3] Go 官方 `runtime/chan.go`：说明 `hchan` 字段、等待队列、内部锁、发送/接收/关闭的运行时过程。([Go][3])
[4] Go Language Specification — Send statements：说明发送阻塞、无缓冲/有缓冲发送条件、向已关闭 Channel 发送 panic、向 `nil` Channel 发送永久阻塞。([Go][2])
[5] Go Language Specification — Receive operator：说明接收阻塞、关闭 Channel 接收零值、双返回值形式。([Go][2])
[6] Go Language Specification — Close：说明 `close` 语义、关闭已关闭或 `nil` Channel panic、关闭后接收零值。([Go][2])
[7] Go Language Specification — Select statements：说明 `select` 在多个 Channel 通信操作中选择可执行分支、无 default 时阻塞。([Go][2])
[8] Go Language Specification — Range over Channel：说明 `for range` Channel 持续接收直到 Channel 关闭，`nil` Channel 永久阻塞。([Go][2])
[9] `sync.Mutex` 官方文档：说明 Mutex 零值、不可复制、Lock/Unlock 语义、TryLock 说明和同步关系。([Go Packages][4])
[10] `sync.RWMutex` 官方文档：说明读写锁、多个读者或单个写者、写者等待时阻塞新读者、不可升级/降级。([Go Packages][4])
[11] `sync.Cond` 官方文档：说明条件变量、关联 Locker、Wait/Signal/Broadcast 语义、Wait 应放在循环中、简单场景可用 Channel 替代。([Go Packages][4])
[12] `sync.Once` 官方文档：说明 Do 只执行一次、一次性初始化、panic 后视为已返回、递归调用可能死锁。([Go Packages][4])
[13] `sync.WaitGroup` 官方文档：说明计数信号量、`Go`、`Add`、`Done`、`Wait` 语义，以及 `WaitGroup.Go` 是 Go 1.25 新增。([Go Packages][4])
[14] `sync.Map` 官方文档：说明并发安全、摊还常数时间、专用场景、只写一次读多次和 disjoint keys 场景。([Go Packages][4])
[15] `sync.Pool` 官方文档：说明临时对象集合、可能被自动移除、并发安全、降低 GC 压力、典型 buffer 复用场景。([Go Packages][4])
[16] `sync/atomic` 官方文档：说明低层原子内存原语、需谨慎使用、优先使用 Channel 或 sync、顺序一致语义。([Go Packages][5])
[17] Go Wiki：说明 Channel 与 Mutex 的使用边界：Channel 适合所有权传递、任务分发、异步结果；Mutex 适合缓存和状态。([Go][6])

[1]: https://go.dev/ref/mem "https://go.dev/ref/mem"
[2]: https://go.dev/ref/spec "https://go.dev/ref/spec"
[3]: https://go.dev/src/runtime/chan.go " - The Go Programming Language"
[4]: https://pkg.go.dev/sync "sync package - sync - Go Packages"
[5]: https://pkg.go.dev/sync/atomic "https://pkg.go.dev/sync/atomic"
[6]: https://go.dev/wiki/MutexOrChannel "https://go.dev/wiki/MutexOrChannel"
