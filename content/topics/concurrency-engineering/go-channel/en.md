# Go Concurrency Synchronization Research: Semantics, Principles, and Usage Boundaries of Channels and `sync` Primitives

## Abstract

Go provides both communication-based synchronization mechanisms and shared-memory-based synchronization mechanisms for concurrent programming. A channel is a communication primitive defined in the Go language specification. It is used to send and receive values of a specified element type between concurrently executing functions. The `sync` package provides synchronization primitives such as mutual exclusion locks, read-write locks, condition variables, one-time initialization, task waiting, concurrent maps, and temporary object pools. The `sync/atomic` package provides low-level atomic memory operations. Based on the Go language specification, the Go memory model, official Go source code, and standard library documentation, this article summarizes the semantics, runtime mechanisms, and usage boundaries of channels, `sync.Mutex`, `sync.RWMutex`, `sync.Cond`, `sync.Once`, `sync.WaitGroup`, `sync.Map`, `sync.Pool`, and `sync/atomic`. The research conclusion is that channels are suitable for communication between goroutines, ownership transfer, task distribution, result return, close notification, and concurrency limiting. Locks and atomic operations are suitable for protecting shared state, implementing low-level libraries, and performance-sensitive paths. These synchronization mechanisms are not mutually exclusive; they carry different synchronization semantics in different concurrency problems.

**Keywords:** Go; Golang; Channel; goroutine; sync; Mutex; RWMutex; Cond; WaitGroup; atomic; concurrency synchronization

## 1. Introduction

Go provides goroutines and channels as language-level concurrency constructs, while also providing the `sync` and `sync/atomic` packages in the standard library. The Go memory model states that when multiple goroutines access the same data concurrently and at least one access is a write, programs must serialize such access through channel operations, locks, or other synchronization primitives. In the absence of data races, Go programs behave as if all goroutines are multiplexed onto a single processor in sequentially consistent order. [1]

Therefore, Go concurrency synchronization should not be understood merely as "adding locks." Channels provide communication and synchronization semantics. `sync.Mutex` and `sync.RWMutex` protect shared state. `sync.Cond` provides condition waiting and notification. `sync.Once` provides one-time initialization. `sync.WaitGroup` waits for task completion. `sync.Map` provides a concurrent map for specific scenarios. `sync.Pool` provides concurrent-safe reuse of temporary objects. `sync/atomic` provides low-level atomic memory operations.

## 2. Sources and Research Method

The sources for this article include the Go language specification, the Go memory model, official Go runtime source code, `sync` standard library documentation, `sync/atomic` standard library documentation, and the Go Wiki. The research method is document-based synthesis. First, the language specification is used to determine channel semantics. Second, runtime source code is used to explain the internal data structure of channels. Third, the Go memory model is used to determine happens-before relationships for channels, locks, Once, and atomic operations. Finally, standard library documentation is used to summarize the usage boundaries of each concurrency primitive.

## 3. Channel Language Semantics and Basic Characteristics

### 3.1 Definition of Channel

The Go language specification defines a channel as a mechanism for communication between concurrently executing functions. A channel completes communication by sending and receiving values of a specified element type. The zero value of an uninitialized channel is `nil`. [2]

Channel types can be divided into bidirectional channels, send-only channels, and receive-only channels:

```go
var bidirectional chan int
var sendOnly chan<- int
var receiveOnly <-chan int
```

Here, `chan T` can send and receive values of type `T`; `chan<- T` can only send; `<-chan T` can only receive. Direction can be narrowed through assignment or explicit type conversion. This design allows APIs to express caller permissions at the type level and prevents receivers from accidentally sending or senders from accidentally receiving. [2]

### 3.2 Buffered and Unbuffered Channels

Channels are created with `make`, and capacity can be specified:

```go
unbuffered := make(chan int)
buffered := make(chan int, 10)
```

When capacity is 0 or omitted, the channel is an unbuffered channel. Communication on an unbuffered channel succeeds only when both sender and receiver are ready. When capacity is greater than 0, the channel is a buffered channel. A send can proceed when the buffer is not full, and a receive can proceed when the buffer is not empty. A `nil` channel is never ready for communication. [2]

### 3.3 FIFO Behavior and Concurrency Safety

The Go language specification states that a channel may be used by any number of goroutines for sends, receives, calls to `cap`, and calls to `len` without additional synchronization. Channels work as first-in-first-out queues. If one goroutine sends values and another goroutine receives them, the received values are observed in the same order as they were sent. [2]

This means the channel's send queue, receive queue, buffer state, and closed state are maintained by the runtime. Callers do not need to add another lock to protect the channel itself. However, if pointers, slices, maps, or other reference types are passed through the channel, the channel only guarantees value transfer and synchronization relationships. It does not automatically guarantee the concurrency safety of subsequent access to the referenced objects.

## 4. What Problems Channels Solve and What Happens Without Them

### 4.1 Core Problems Solved by Channels

Channels solve the problem of establishing communication, synchronization, and ordering relationships between goroutines. The Go memory model states that every channel send is matched to a corresponding receive on that channel, and the send is synchronized before the completion of the corresponding receive. Closing a channel is synchronized before a receive that returns a zero value because the channel is closed. For an unbuffered channel, the receive is synchronized before the completion of the corresponding send. [1]

Therefore, a channel is not only a data queue; it is also a synchronization boundary. When data is passed through a channel, writes that happen before the send can be safely observed by the receiver through the happens-before relationship.

### 4.2 Alternatives Without Channels

Without channels, goroutines can still coordinate through shared variables, `sync.Mutex`, `sync.RWMutex`, `sync.Cond`, `sync.WaitGroup`, or `sync/atomic`. However, the Go memory model explicitly requires that when multiple goroutines modify and access data concurrently, access must be serialized through synchronization mechanisms. Without channels or other synchronization primitives, a write by one goroutine is not guaranteed to be observed by another goroutine and may form a data race. [1]

For example, the following code establishes synchronization order through a channel:

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

If the channel or another synchronization mechanism is removed and the program only relies on goroutine execution timing, the main goroutine has no reliable visibility guarantee.

## 5. Runtime Data Structure of Channels

### 5.1 The `hchan` Structure

In the official Go runtime source code, channel implementation is in `runtime/chan.go`. This file declares the runtime channel structure as `hchan`. `hchan` contains the following core fields: [3]

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

These fields can be divided into five categories.

First, buffer state fields. `qcount` represents the number of elements already in the queue. `dataqsiz` represents the capacity of the circular queue. `buf` points to the buffer. `sendx` and `recvx` represent the send index and receive index.

Second, element metadata fields. `elemsize` represents element size. `elemtype` represents element type.

Third, the close state field. `closed` represents whether the channel has been closed.

Fourth, wait queue fields. `recvq` represents the queue of goroutines waiting to receive. `sendq` represents the queue of goroutines waiting to send.

Fifth, the internal mutual exclusion field. `lock` protects all fields in `hchan` and also protects several `sudog` fields for goroutines blocked on this channel. [3]

### 5.2 How Channels Prevent Concurrency Problems

The channel runtime structure contains the mutex `lock`. Comments in the Go source code explain that this lock protects all fields in `hchan` and several `sudog` fields for goroutines blocked on this channel. [3] Therefore, when multiple goroutines send or receive concurrently, the runtime maintains channel state consistency through the internal lock, send wait queue, receive wait queue, and circular buffer.

For an unbuffered channel, if a receiver is already waiting, the sender can copy data directly to the receiver and wake it. If no receiver is waiting, the sender enters the send wait queue and blocks. For a buffered channel, if the buffer is not full, the sender writes the element into the circular buffer. If the buffer is full, the sender blocks. The receive process is symmetrical: it first receives from a waiting sender or from the buffer; if no data can be received, it enters the receive wait queue and blocks. [3]

## 6. How Channels Complete Communication Between Goroutines

Channel communication consists of four operations: send, receive, close, and select.

The send statement has this form:

```go
ch <- value
```

The Go language specification states that a send statement sends a value on a channel. The channel type must permit send operations, and the value being sent must be assignable to the channel element type. A send blocks until communication can proceed. An unbuffered channel requires a receiver to be ready. A buffered channel requires room in the buffer. Sending on a closed channel causes a runtime panic. Sending on a `nil` channel blocks forever. [4]

The receive expression has these forms:

```go
value := <-ch
value, ok := <-ch
```

A receive expression blocks until a value is available. Receiving from a closed channel can proceed immediately. After all previously sent values have been received, a receive returns the zero value of the element type. In the two-result form, `ok` indicates whether the received value came from data sent before the channel was closed. [5]

Channels are closed with:

```go
close(ch)
```

`close(ch)` indicates that no more values will be sent on the channel. Closing an already closed channel, closing a `nil` channel, or sending on a closed channel causes a panic. After close, once historically sent values have been received, receive operations return the zero value of the element type without blocking. [6]

`select` chooses one operation among multiple channel send or receive operations. When multiple communication operations can proceed, the Go specification states that one is selected through a uniform pseudo-random choice. If no operation can proceed and a `default` exists, `default` is executed. If no `default` exists, the `select` blocks until at least one communication operation can proceed. [7]

## 7. Channel Direction Properties and Usage Scenarios

### 7.1 Receive-Only Channels

The receive-only channel type is `<-chan T`. It can only receive; it cannot send or close. Receive-only channels are often used as function return values to indicate that the caller can only consume the data stream and cannot interfere with the producer.

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

This form is suitable for data producers exposing result streams, such as task result streams, event subscription streams, paginated scan result streams, and asynchronous computation result streams.

### 7.2 Send-Only Channels

The send-only channel type is `chan<- T`. It can only send and cannot receive. Send-only channels are often used as function parameters to indicate that the function is only responsible for producing data or submitting tasks, and cannot consume data from the queue.

```go
func submitJobs(out chan<- int, jobs []int) {
	for _, job := range jobs {
		out <- job
	}
}
```

This form is suitable for task submitters, event publishers, log writers, and producer functions.

### 7.3 Scenarios That Necessarily or Practically Depend on Channels

From the perspective of language mechanisms and standard library interaction patterns, the following scenarios practically depend on channels.

First, multiplexed communication based on `select`. A `select` case can only be built around a channel send, a channel receive, or `default`, so when multiple asynchronous events must be waited on at the same time, channels are the direct operands of this language mechanism. [7]

Second, completion notification based on close broadcast. The Go memory model states that closing a channel is synchronized before a receive that returns a zero value because of the close. Therefore, closing a channel can act as a synchronization event that notifies multiple receivers to stop or complete. [1]

Third, producer-to-consumer data streams based on `for range`. The Go specification states that ranging over a channel repeatedly produces sent values until the channel is closed. If the channel is `nil`, the range blocks forever. [8]

Fourth, concurrency limiting based on buffered channels. The Go memory model states that the `k`th receive on a channel with capacity `C` is synchronized before the completion of the `k+C`th send. This rule allows a buffered channel to be modeled as a counting semaphore for limiting the number of goroutines executing simultaneously. [1]

Fifth, when standard library or business APIs have already made channels part of the interface contract. In such cases, callers must follow the channel protocol of that API, such as receive-only result streams, cancellation notification, event notification, and task queues.

## 8. Basic Principles and Usage of `sync.Mutex`

`sync.Mutex` is a mutual exclusion lock. Standard library documentation defines it as a mutual exclusion lock. The zero value of a `Mutex` is an unlocked mutex, and a mutex must not be copied after first use. [9]

`Mutex.Lock()` locks the mutex. If the lock is already in use, the calling goroutine blocks until the mutex is available. `Mutex.Unlock()` unlocks the mutex. If the mutex is not locked when `Unlock` is entered, a runtime error occurs. The Go memory model states that for a given `Mutex`, the `n`th call to `Unlock` is synchronized before the `m`th call to `Lock` returns, for any `n < m`. [9]

A typical usage is:

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

`Mutex` is suitable for protecting shared variables, composite struct state, ordinary `map` values, connection state, and cache state. When the essence of a concurrency problem is that multiple goroutines read and write the same shared memory, `Mutex` is the direct synchronization tool.

## 9. Basic Principles and Usage of `sync.RWMutex`

`sync.RWMutex` is a reader/writer mutual exclusion lock. Standard library documentation defines it as a reader/writer mutual exclusion lock. It allows any number of readers to hold the read lock simultaneously, or one writer to hold the write lock. The zero value of an `RWMutex` is an unlocked mutex, and it must not be copied after first use. [10]

`RLock` and `RUnlock` are used for read locking. `Lock` and `Unlock` are used for write locking. If there are existing read locks and a goroutine calls `Lock` to request the write lock, subsequent `RLock` calls block until the writer obtains and releases the lock, ensuring that the writer can eventually obtain it. The documentation also explicitly states that `RLock` cannot be upgraded to `Lock`, and `Lock` cannot be downgraded to `RLock`. [10]

A typical usage is:

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

`RWMutex` is suitable for shared state with many reads and few writes where read operations can execute concurrently, such as configuration snapshots, local caches, route tables, and metadata indexes. If writes are frequent or critical sections are very short, the state management cost introduced by a read-write lock should be confirmed through actual benchmarks.

## 10. Basic Usage of `sync.Cond`

`sync.Cond` implements a condition variable, a rendezvous point for goroutines waiting for or announcing the occurrence of an event. Each `Cond` is associated with a `Locker`, usually `*sync.Mutex` or `*sync.RWMutex`. The lock must be held when changing the condition or calling `Wait`. [11]

`Cond.Wait()` atomically unlocks `c.L` and suspends the current goroutine. After resuming, `Wait` locks again before returning. Standard library documentation explains that callers usually cannot assume that the condition is true when `Wait` returns, so `Wait` should be called in a loop. [11]

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

`Signal` wakes one waiting goroutine. `Broadcast` wakes all waiting goroutines. Standard library documentation also notes that for many simple cases, channels are usually more appropriate than `Cond`; `Broadcast` corresponds to closing a channel, and `Signal` corresponds to sending on a channel. [11]

## 11. Basic Usage of `sync.Once`

`sync.Once` is used to safely execute an initialization operation exactly once when multiple goroutines are present. `Once.Do(f)` executes `f` only on the first call for that `Once` instance. Even if later calls pass different function values, the function is not executed again. `Once` must not be copied after first use. [12]

The Go memory model states that the completion of `f` in `once.Do(f)` is synchronized before the return of any call to `once.Do(f)`. [1]

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

`Once` is suitable for singleton initialization, global configuration loading, connection pools initialized only once, metrics registration, and one-time lazy loading. If `f` calls `Do` on the same `Once` again, standard library documentation states that it will deadlock. If `f` panics, `Do` considers the function to have returned, and later calls do not execute `f` again. [12]

## 12. Basic Usage of `sync.WaitGroup`

`sync.WaitGroup` is a counting semaphore, usually used to wait for a group of goroutines or tasks to complete. Current official documentation provides two usage forms: `WaitGroup.Go(f)` and the traditional `Add`, `Done`, and `Wait`. `WaitGroup.Go` is marked as added in Go 1.25. Older Go versions still use `Add` and `Done`. [13]

Go 1.25+ usage:

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

Traditional usage:

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

`Add(delta)` modifies the task count. When the count becomes 0, all goroutines blocked on `Wait` are released. If the count becomes negative, it panics. `Done()` is equivalent to `Add(-1)`. `Wait()` blocks until the task count is 0. Standard library documentation requires that when the counter is 0, positive `Add` calls must happen before `Wait`. When reusing a `WaitGroup`, the new round of `Add` calls must happen after the previous `Wait` has returned. [13]

## 13. Basic Usage of `sync.Map`

`sync.Map` is similar to `map[any]any`, but it can be used concurrently by multiple goroutines without additional locking or coordination. Operations such as `Load`, `Store`, and `Delete` have amortized constant time complexity. [14]

Standard library documentation also explains that `sync.Map` is a specialized type. Most code should use an ordinary Go map with a separate lock or other coordination mechanism to gain better type safety and make invariants related to map contents easier to maintain. Two common scenarios optimized by `sync.Map` are: entries for a given key are written only once but read many times, such as grow-only caches; and multiple goroutines read, write, and overwrite disjoint sets of keys. [14]

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

`sync.Map` is suitable for concurrent dictionaries that are read-heavy, have independent keys, and do not need strong typed invariants. If business logic needs to maintain consistency across multiple fields, an ordinary `map` plus `Mutex` or `RWMutex` is usually better at expressing atomic update boundaries.

## 14. Basic Usage of `sync.Pool`

`sync.Pool` is a set of temporary objects that can be saved and retrieved concurrently and safely. Standard library documentation explains that any object stored in a `Pool` may be removed automatically at any time without notifying the caller. If the `Pool` holds the only reference to an object when it is removed, the object may be released. [15]

The goal of `Pool` is to cache allocated but currently unused objects for later reuse, thereby reducing garbage collection pressure. A typical positive example from standard library documentation is that the `fmt` package maintains temporary output buffers; the storage scales under high-concurrency printing and shrinks when idle. [15]

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

`sync.Pool` is suitable for high-frequency, short-lived, resettable temporary objects, such as buffers, temporary encoder structures, compression scratch space, and log assembly objects. It is not suitable as a lifecycle management container for business objects, nor is it suitable for cache semantics that depend on objects definitely being retained.

## 15. Basic Usage of `sync/atomic`

The `sync/atomic` package provides low-level atomic memory primitives for implementing synchronization algorithms. Official documentation explicitly states that these functions require great care to be used correctly. Except for special low-level applications, synchronization is better done with channels or the facilities of the `sync` package. [16]

Atomic operations include load, store, add, swap, compare-and-swap, and others. The Go memory model states that if the effect of atomic operation A is observed by atomic operation B, then A is synchronized before B. All atomic operations in a program behave as though executed in some sequentially consistent order. [16]

Since Go 1.19, the standard library has provided typed atomic wrappers such as `atomic.Int64`, `atomic.Bool`, and `atomic.Pointer[T]`. Basic usage is:

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

`atomic` is suitable for simple counters, state switches, replacement of read-only configuration pointers, lock-free fast-path flags, and low-level synchronization structures. It is not suitable for expressing consistency updates across multiple fields. If one business update involves multiple variables, `Mutex`, `RWMutex`, or channels usually express the critical section or communication boundary more directly.

## 16. Selection Boundaries Between Channels and Locks

The Go Wiki summarizes the selection boundary between channels and mutexes as follows: channels are suitable for passing ownership of data, distributing units of work, and communicating asynchronous results; mutexes are suitable for protecting caches and state. The Go Wiki also points out that most locking problems can be solved with either channels or traditional locks, and the selection criterion should be expressiveness and simplicity. [17]

Therefore, channels and locks are not replacements for each other. They model different forms of concurrency.

Channels are suitable for problems where data or events flow between goroutines. Examples include task queues, producer-consumer pipelines, asynchronous return values, cancellation notification, timeout selection, concurrency limiting, and state-machine event loops.

`Mutex` and `RWMutex` are suitable for problems where multiple goroutines access the same shared object. Examples include local caches, connection state, route tables, configuration objects, statistics aggregation, and in-memory indexes.

`Cond` is suitable for problems where waiters should be awakened after shared state satisfies a condition. Examples include bounded queues, batch-processing conditions, resource-pool availability conditions, and complex state-machine wakeups.

`WaitGroup` is suitable for waiting for a group of tasks to complete. It does not pass results. Results should be returned through channels, lock-protected shared structures, or other concurrency-safe containers.

`Map` is suitable for specific concurrent dictionary scenarios. It is not a comprehensive replacement for ordinary maps.

`Pool` is suitable for temporary object reuse. It is not a cache and does not guarantee object retention.

`Atomic` is suitable for low-level, simple, single-variable synchronization. It is not suitable for maintaining complex business state.

## 17. Conclusion

Go's concurrency synchronization system consists of language-level channels, standard-library-level `sync` primitives, and low-level `sync/atomic` atomic operations. The core role of a channel is communication and synchronization between goroutines. Through typed data transfer, blocking semantics, close semantics, FIFO queues, happens-before relationships, and an internal runtime lock, it prevents races on the channel's own state. The core role of `sync.Mutex` and `sync.RWMutex` is protecting shared memory. `sync.Cond` is used for condition waiting. `sync.Once` is used for one-time initialization. `sync.WaitGroup` waits for a group of tasks to complete. `sync.Map` is used for specific concurrent map scenarios. `sync.Pool` is used for temporary object reuse. `sync/atomic` is used for low-level atomic memory operations.

In engineering selection, the first step is to determine whether the concurrency problem is a communication problem or a shared-state problem. If the problem is that tasks, events, results, or ownership flow between goroutines, a channel is the direct modeling tool. If the problem is that multiple goroutines read and write the same object, a lock is more direct. If the problem is a simple counter or state flag, atomic operations can reduce lock usage, but memory semantics and consistency boundaries must be clear. When multiple fields, multiple invariants, or complex business state are involved, locks or channels are usually easier to use correctly than bare atomic operations.

## References

[1] Go Memory Model: explains the definition of data races, the need to serialize access with channels, locks, or atomic operations, channel happens-before relationships, buffered channels as counting semaphores, and synchronization semantics for locks, Once, and atomic operations. ([Go][1])
[2] Go Language Specification: explains channel types, direction, `make` capacity, buffered and unbuffered channels, `nil` channels, FIFO behavior, and concurrent use by multiple goroutines. ([Go][2])
[3] Official Go `runtime/chan.go`: explains `hchan` fields, wait queues, internal lock, and the runtime process for send, receive, and close. ([Go][3])
[4] Go Language Specification - Send statements: explains send blocking, unbuffered and buffered send conditions, panic when sending on a closed channel, and permanent blocking when sending on a `nil` channel. ([Go][2])
[5] Go Language Specification - Receive operator: explains receive blocking, zero values from closed channels, and the two-result form. ([Go][2])
[6] Go Language Specification - Close: explains `close` semantics, panic when closing an already closed or `nil` channel, and zero-value receives after close. ([Go][2])
[7] Go Language Specification - Select statements: explains how `select` chooses an executable branch among multiple channel communication operations and blocks when there is no default. ([Go][2])
[8] Go Language Specification - Range over Channel: explains that `for range` over a channel keeps receiving until the channel is closed and blocks forever on a `nil` channel. ([Go][2])
[9] Official `sync.Mutex` documentation: explains the zero value, no-copy rule, Lock/Unlock semantics, TryLock notes, and synchronization relationship. ([Go Packages][4])
[10] Official `sync.RWMutex` documentation: explains reader/writer locks, multiple readers or a single writer, blocking new readers while a writer waits, and no upgrade/downgrade support. ([Go Packages][4])
[11] Official `sync.Cond` documentation: explains condition variables, associated Locker, Wait/Signal/Broadcast semantics, calling Wait in a loop, and replacing simple cases with channels. ([Go Packages][4])
[12] Official `sync.Once` documentation: explains that Do executes once, one-time initialization, panic being treated as return, and possible deadlock from recursive calls. ([Go Packages][4])
[13] Official `sync.WaitGroup` documentation: explains the counting semaphore, `Go`, `Add`, `Done`, and `Wait` semantics, and that `WaitGroup.Go` was added in Go 1.25. ([Go Packages][4])
[14] Official `sync.Map` documentation: explains concurrency safety, amortized constant time, specialized scenarios, write-once-read-many cases, and disjoint-key cases. ([Go Packages][4])
[15] Official `sync.Pool` documentation: explains temporary object collections, automatic removal, concurrency safety, reducing GC pressure, and typical buffer reuse. ([Go Packages][4])
[16] Official `sync/atomic` documentation: explains low-level atomic memory primitives, the need for careful use, preference for channels or sync, and sequentially consistent semantics. ([Go Packages][5])
[17] Go Wiki: explains the usage boundary between channels and mutexes: channels are suitable for ownership transfer, work distribution, and asynchronous results; mutexes are suitable for caches and state. ([Go][6])

[1]: https://go.dev/ref/mem "https://go.dev/ref/mem"
[2]: https://go.dev/ref/spec "https://go.dev/ref/spec"
[3]: https://go.dev/src/runtime/chan.go "runtime/chan.go - The Go Programming Language"
[4]: https://pkg.go.dev/sync "sync package - sync - Go Packages"
[5]: https://pkg.go.dev/sync/atomic "https://pkg.go.dev/sync/atomic"
[6]: https://go.dev/wiki/MutexOrChannel "https://go.dev/wiki/MutexOrChannel"
