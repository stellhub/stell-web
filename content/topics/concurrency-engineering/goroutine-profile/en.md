# Goroutine Troubleshooting: Official References, Observability Entry Points, and Common Error Checklist

## 1. Concept Boundaries

The Go language specification describes a `go` statement as starting an independent concurrent control thread, namely a goroutine. That goroutine runs in the same address space as the current goroutine. After calling `go f()`, the function call begins executing in a new goroutine, and the current program flow does not wait for that function to complete. When the function returns, that goroutine terminates. [1]

Therefore, when troubleshooting goroutine problems in Go programs, the core objects are not operating system threads themselves, but goroutine count, lifecycle, blocking locations, scheduling relationships, synchronization relationships, shared-memory access relationships, and cancellation propagation relationships.

The Go language specification also states that when the `main` function returns, the program exits and does not wait for other non-main goroutines to complete. [1] Therefore, "a goroutine did not finish executing" and "main exited early" are lifecycle problems.

---

## 2. Troubleshooting Entry Points from Official Documentation

### 2.1 Observing Goroutine Count

`runtime.NumGoroutine()` returns the current number of existing goroutines. The official Go diagnostics documentation explains that this metric can be used to monitor goroutine count and detect goroutine leaks. [2]

Common usage:

```go
package main

import (
	"log"
	"runtime"
	"time"
)

func main() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		// Print the current number of existing goroutines.
		log.Printf("goroutines=%d", runtime.NumGoroutine())
	}
}
```

Troubleshooting uses:

| Symptom | Observation Method |
| --- | --- |
| Goroutine count keeps increasing | Periodically record `runtime.NumGoroutine()` |
| Count does not fall after load testing ends | Compare counts before, during, and after load testing |
| Count increases after a specific API call | Record the count at API entry, exit, and async task startup points |
| Periodic growth in production | Export goroutine count as a runtime metric |

---

### 2.2 Capturing Goroutine Stacks

`runtime.Stack(buf, true)` can write the stack of the current goroutine and other goroutines into a buffer. [2]

Example:

```go
package debugutil

import "runtime"

func DumpAllGoroutines() []byte {
	buf := make([]byte, 1<<20)

	for {
		// Write stack traces for all goroutines.
		n := runtime.Stack(buf, true)
		if n < len(buf) {
			return buf[:n]
		}

		// Grow the buffer when it is not large enough.
		buf = make([]byte, len(buf)*2)
	}
}
```

Troubleshooting uses:

| Stack Information | Corresponding Problem |
| --- | --- |
| Many goroutines stopped at the same channel receive | Receiver is waiting for data, sender did not send, channel was not closed, or nil channel |
| Many goroutines stopped at the same channel send | Sender is blocked, insufficient receivers, buffer is full, or nil channel |
| Many goroutines stopped at `sync.(*WaitGroup).Wait` | `Done` did not execute, `Add`/`Wait` order is wrong, or counter did not return to zero |
| Many goroutines stopped at `sync.(*Mutex).Lock` | Lock contention, lock not released, or lock-order waiting |
| Many goroutines stopped in I/O calls | Network, file, syscall, or external dependency blocking |
| Many goroutines stopped in `select` | Waiting for multiple events, but no case is ready |

---

### 2.3 `net/http/pprof`

The official `net/http/pprof` documentation explains that this package exposes runtime profiling data through HTTP, and the data format can be read by the `pprof` tool. Importing this package for side effects registers HTTP handlers under `/debug/pprof/`. [3]

Minimal integration:

```go
package main

import (
	"log"
	"net/http"
	_ "net/http/pprof"
	"runtime"
)

func main() {
	// Enable block profiling. A rate of 1 records every blocking event.
	runtime.SetBlockProfileRate(1)

	// Enable mutex profiling. A rate of 1 records every contention event.
	runtime.SetMutexProfileFraction(1)

	go func() {
		// Expose pprof endpoints on localhost only in this example.
		log.Println(http.ListenAndServe("localhost:6060", nil))
	}()

	select {}
}
```

Common commands:

```bash
# List available pprof profiles.
curl http://localhost:6060/debug/pprof/

# Capture goroutine stack traces in text form.
curl -o goroutine.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"

# Analyze goroutine profile.
go tool pprof http://localhost:6060/debug/pprof/goroutine

# Analyze heap profile.
go tool pprof http://localhost:6060/debug/pprof/heap

# Capture a 30-second CPU profile.
go tool pprof "http://localhost:6060/debug/pprof/profile?seconds=30"

# Analyze block profile after runtime.SetBlockProfileRate is enabled.
go tool pprof http://localhost:6060/debug/pprof/block

# Analyze mutex profile after runtime.SetMutexProfileFraction is enabled.
go tool pprof http://localhost:6060/debug/pprof/mutex

# Capture execution trace.
curl -o trace.out "http://localhost:6060/debug/pprof/trace?seconds=5"

# Open execution trace.
go tool trace trace.out
```

Profiles listed by official Go diagnostics documentation include:

| Profile | Official Troubleshooting Target |
| --- | --- |
| `goroutine` | Stacks of all current goroutines |
| `heap` | Heap memory allocation |
| `threadcreate` | Operating system thread creation |
| `block` | Locations where goroutines block on synchronization primitives |
| `mutex` | Lock contention locations |
| `profile` | CPU profile |
| `trace` | Execution trace |

The block profile is disabled by default and requires calling `runtime.SetBlockProfileRate`; the mutex profile is disabled by default and requires calling `runtime.SetMutexProfileFraction`. [3][4]

---

### 2.4 `runtime/trace`

The official `runtime/trace` documentation explains that an execution trace captures goroutine creation, blocking, unblocking, system call entry, system call exit, system call blocking, GC events, heap size changes, processor start and stop events, and more. [4]

Troubleshooting uses:

| Problem | Trace Observation Point |
| --- | --- |
| Too many goroutines created | goroutine creation events |
| Goroutines blocked for a long time | blocking / unblocking events |
| External calls are slow | syscall enter / exit / block events |
| Scheduling latency | time from goroutine runnable to running |
| GC impact on latency | GC events and goroutine execution timeline |

During testing:

```bash
go test -trace=trace.out ./...
go tool trace trace.out
```

For running services:

```bash
curl -o trace.out "http://localhost:6060/debug/pprof/trace?seconds=5"
go tool trace trace.out
```

---

### 2.5 `go vet`

Official `go vet` documentation explains that this tool checks suspicious constructs in Go source code. Its analyzers include `lostcancel`, `copylocks`, `loopclosure`, `waitgroup`, and others. [8]

Common command:

```bash
go vet ./...
```

Typical goroutine-related checks:

| vet Analyzer | Corresponding Problem |
| --- | --- |
| `lostcancel` | cancel returned by `context.WithCancel`, `context.WithTimeout`, or `context.WithDeadline` is not called |
| `copylocks` | Lock-related objects such as `sync.Mutex` or `sync.WaitGroup` are copied |
| `loopclosure` | Goroutine closure captures loop variable |
| `waitgroup` | `WaitGroup.Add` is called inside a goroutine and may race with `Wait` |

---

### 2.6 Race Detector

The official Go race detector documentation explains that a data race occurs when two goroutines access the same variable concurrently, at least one access is a write, and there is no synchronization constraint. [7]

Common commands:

```bash
go test -race ./...
go run -race ./cmd/app
go build -race ./cmd/app
```

Race detector reports include the conflicting access stacks and the creation stacks of related goroutines. [7]

Notes:

| Official Fact | Troubleshooting Meaning |
| --- | --- |
| The race detector only detects races that actually occur at runtime | Tests or runtime traffic must cover related paths |
| The race detector adds memory and execution-time overhead | Always-on production use needs separate evaluation |
| Reports include goroutine creation stacks | Helps locate which goroutines access shared variables |

---

## 3. Common Goroutine Errors and Troubleshooting Methods

### 3.1 Abnormally Increasing Goroutines / Goroutine Leaks

Symptoms:

| Symptom | Manifestation |
| --- | --- |
| Goroutine count keeps increasing | `runtime.NumGoroutine()` curve rises monotonically or periodically |
| Goroutines are not released after requests end | Count does not fall after load testing stops |
| Same stack appears repeatedly | Many goroutines stop at the same location in `pprof/goroutine?debug=2` |
| Memory grows together | Goroutine count rises together with heap, stack memory, timers, or context objects |

Official basis:

* `runtime.NumGoroutine()` returns the current number of existing goroutines. [2]
* The `goroutine` profile reports stacks of all current goroutines. [3]
* The `context` documentation explains that failing to call `CancelFunc` leaks child contexts and their children until the parent context is canceled. [5]

Troubleshooting steps:

```bash
# 1. Record the current goroutine stacks.
curl -o goroutine_1.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"

# 2. Record again after some time.
curl -o goroutine_2.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"

# 3. Compare repeatedly growing stacks.
diff -u goroutine_1.txt goroutine_2.txt
```

Code checkpoints:

| Checkpoint | Corresponding Problem |
| --- | --- |
| Whether `go func()` is created without limit in loops, requests, or message consumption | Goroutine creation rate exceeds exit rate |
| Whether goroutines listen to `ctx.Done()` | Whether async tasks exit after upstream cancellation |
| Whether `CancelFunc` is called on all control paths | Whether context children and timers are released |
| Whether channels are never closed or never sent to | Whether goroutines block forever |
| Whether tickers call `Stop` | Whether periodic task resources are released |
| Whether external I/O has timeouts | Whether network, database, or RPC calls block for a long time |

---

### 3.2 Process-Level Deadlock

Symptom:

```text
fatal error: all goroutines are asleep - deadlock!
```

Go runtime source contains this fatal message. When all goroutines are in states where they cannot continue running, the runtime triggers this error. [10]

Common trigger patterns:

| Pattern | Example |
| --- | --- |
| main goroutine waits on channel receive, but there is no sender | `<-ch` |
| main goroutine waits on channel send, but there is no receiver | `ch <- v` |
| all goroutines wait on the same WaitGroup | `wg.Wait()` |
| goroutines wait on locks in opposite orders | A holds lock1 and waits for lock2; B holds lock2 and waits for lock1 |
| nil channel send / receive | `var ch chan int; <-ch` |

Troubleshooting steps:

```bash
# Reproduce with all goroutine traceback.
GOTRACEBACK=all ./app
```

Or capture during runtime:

```bash
curl -o goroutine.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"
```

How to judge:

| Stack State | Direction |
| --- | --- |
| All stopped on channel send / receive | Incomplete channel communication parties |
| All stopped at `WaitGroup.Wait` | WaitGroup counter did not return to zero |
| Multiple goroutines stopped at different locks' `Lock` | Lock order or lock release path problem |
| Goroutine stopped around nil channel code | Nil channel not initialized or select logic error |

---

### 3.3 Channel Send / Receive Blocks Forever

Official basis:

* Channels provide a communication mechanism among concurrent goroutines. [9]
* Communication on an unbuffered channel completes only when sender and receiver are both ready. [9]
* A nil channel is never ready. [9]
* Sending to a nil channel blocks forever. [9]
* Receiving from a nil channel blocks forever. [9]

Error patterns:

```go
func blockOnNilChannel() {
	var ch chan int

	// This receive blocks forever because ch is nil.
	<-ch
}
```

```go
func blockOnSend() {
	ch := make(chan int)

	// This send blocks because there is no receiver.
	ch <- 1
}
```

Troubleshooting methods:

| Method | Purpose |
| --- | --- |
| goroutine stack | Determine whether blocked on send or receive |
| block profile | Locate where goroutines block on synchronization primitives |
| trace | View blocking and unblocking timelines |
| code review | Check channel initialization, close, sender, receiver, and buffer capacity |

Commands:

```bash
go tool pprof http://localhost:6060/debug/pprof/block
curl -o trace.out "http://localhost:6060/debug/pprof/trace?seconds=5"
go tool trace trace.out
```

---

### 3.4 send on closed channel / close closed channel / close nil channel

Official basis:

* Sending to a closed channel panics. [9]
* Closing an already closed channel panics. [9]
* Closing a nil channel panics. [9]
* Receiving from a closed channel with no remaining values immediately returns the zero value of the element type. [9]

Error pattern:

```go
func sendClosedChannel() {
	ch := make(chan int)
	close(ch)

	// This panics because the channel is already closed.
	ch <- 1
}
```

Troubleshooting methods:

| Symptom | Method |
| --- | --- |
| `panic: send on closed channel` | Inspect panic stack and locate sender |
| `panic: close of closed channel` | Inspect panic stack and locate repeated closer |
| `panic: close of nil channel` | Check channel initialization path |
| Occasional panic | Use `go test -race` to check whether send / close happen concurrently |

The official Race Detector documentation includes a typical "unsynchronized send and close operations" case. [7]

---

### 3.5 WaitGroup Misuse

Official basis:

* `sync.WaitGroup` is a counting semaphore used to wait for a collection of tasks to complete. [6]
* `Add` adds delta to the WaitGroup counter. [6]
* A negative counter panics. [6]
* `Done` is equivalent to `Add(-1)`. [6]
* `Wait` blocks until the counter reaches zero. [6]
* The `waitgroup` analyzer in `go vet` detects misuse where `WaitGroup.Add` is called inside a new goroutine. [8]

Common errors:

| Error | Symptom |
| --- | --- |
| Missing `Done()` after `Add(1)` | `Wait()` blocks forever |
| More `Done()` calls than `Add()` | `panic: sync: negative WaitGroup counter` |
| Calling `Add()` inside a goroutine | `Add` may race with `Wait` |
| Copying WaitGroup | Counters are inconsistent across copies |
| Goroutine panics before `Done()` executes | `Wait()` blocks |

Incorrect example:

```go
func wrongWaitGroup() {
	var wg sync.WaitGroup

	go func() {
		// Wrong: Add may race with Wait.
		wg.Add(1)
		defer wg.Done()
	}()

	wg.Wait()
}
```

Troubleshooting:

```bash
go vet ./...
```

Runtime investigation:

```bash
curl -o goroutine.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"
```

Stack judgment:

| Stack | Meaning |
| --- | --- |
| `sync.(*WaitGroup).Wait` | Current goroutine waits for counter to reach zero |
| `panic: sync: negative WaitGroup counter` | `Done` or `Add(-1)` count exceeds `Add` |
| Multiple goroutines stopped at `Wait` | Counter did not reach zero or task exit path is abnormal |

---

### 3.6 Mutex / RWMutex / Cond Blocking

Official Go diagnostics documentation explains:

* The block profile shows where goroutines block on synchronization primitives.
* The mutex profile reports lock contention.
* The block profile is disabled by default and requires `runtime.SetBlockProfileRate`.
* The mutex profile is disabled by default and requires `runtime.SetMutexProfileFraction`. [3][4]

Troubleshooting methods:

```go
func enableProfiles() {
	// Enable block profiling. A rate of 1 records every blocking event.
	runtime.SetBlockProfileRate(1)

	// Enable mutex profiling. A rate of 1 records every contention event.
	runtime.SetMutexProfileFraction(1)
}
```

```bash
go tool pprof http://localhost:6060/debug/pprof/block
go tool pprof http://localhost:6060/debug/pprof/mutex
```

Common errors:

| Error | Symptom | Method |
| --- | --- | --- |
| Lock acquired but not released | goroutine stopped at `Lock` | goroutine stack + mutex profile |
| Inconsistent lock order | Multiple goroutines wait on each other | goroutine stack |
| Slow I/O while holding lock | mutex profile shows long contention | mutex profile + trace |
| Copying a struct containing a lock | lock state copied | `go vet -copylocks` |
| Cond wait condition not satisfied | goroutine stopped at `Cond.Wait` | goroutine stack |

---

### 3.7 Data Race

Official basis:

Official Go documentation defines a data race as occurring when two goroutines access the same variable concurrently and at least one access is a write, without a synchronization relationship. [7]

Common patterns:

| Error | Example |
| --- | --- |
| Goroutine closure shares loop variable | Multiple goroutines read/write the same loop variable |
| Concurrent map read/write | One goroutine writes a map and another reads it |
| Global variable without lock | Multiple goroutines read/write package-level variable |
| Channel send and close not synchronized | One goroutine sends and another closes |
| Concurrent read/write of primitive variable | bool, int, pointer, and similar direct accesses |

Troubleshooting commands:

```bash
go test -race ./...
go run -race ./cmd/app
go build -race ./cmd/app
```

Report fields to focus on:

| Report Field | Purpose |
| --- | --- |
| conflicting access stack | Locate conflicting read/write |
| goroutine creation stack | Locate goroutine startup point |
| read/write marker | Determine which path writes shared variable |
| file:line | Locate source line |

---

### 3.8 Loop Variable Closure Capture

The official documentation for the `loopclosure` analyzer in `go vet` explains that before Go 1.22, loop variable lifetimes could cause closures to observe the wrong variable value; starting from Go 1.22, loop variable lifetime semantics changed. [8]

The official Go race detector documentation also lists concurrent access to loop variables as a typical data race example. [7]

Error pattern:

```go
func wrongLoopCapture(values []int) {
	for _, v := range values {
		go func() {
			// In old loop variable semantics, this may capture the loop variable.
			println(v)
		}()
	}
}
```

Compatible style for old semantics:

```go
func correctLoopCapture(values []int) {
	for _, v := range values {
		v := v

		go func() {
			// This goroutine captures the per-iteration value.
			println(v)
		}()
	}
}
```

Troubleshooting commands:

```bash
go vet ./...
go test -race ./...
```

---

### 3.9 Context Not Canceled / Cancellation Signal Not Propagated

Official basis:

Official `context` documentation explains:

* `Context` carries deadlines, cancellation signals, and request-scoped values.
* `CancelFunc` cancels child contexts and their children, removes the parent context's reference to the child, and stops associated timers.
* Failing to call `CancelFunc` leaks child contexts and their children until the parent context is canceled.
* `Done()` returns a channel that is closed when the related work should be canceled. [5]

Error pattern:

```go
func wrongContext(parent context.Context) {
	ctx, _ := context.WithTimeout(parent, time.Second)

	go func() {
		select {
		case <-ctx.Done():
			return
		}
	}()
}
```

Problem: `CancelFunc` is not saved or called.

Troubleshooting:

```bash
go vet ./...
```

The `lostcancel` analyzer detects cases where cancel is not called. [8]

Runtime investigation:

| Symptom | Method |
| --- | --- |
| Goroutine still exists after request ends | Check whether goroutine stack waits on channel, I/O, or timer |
| Many identical business goroutines in pprof | Check whether they listen to `ctx.Done()` |
| Timer resources grow | Check whether `WithTimeout` / `WithDeadline` calls cancel |
| Downstream calls do not exit | Check whether context is propagated downstream |

---

### 3.10 main Exits Early and Goroutines Do Not Finish

Official basis:

The Go language specification explains that program execution begins by initializing the main package and then calling `main`; when that function returns, the program exits and does not wait for other non-main goroutines to complete. [1]

Error pattern:

```go
func main() {
	go func() {
		// This goroutine may not finish before main returns.
		doWork()
	}()
}
```

Symptoms:

| Symptom | Judgment |
| --- | --- |
| Logs are incomplete | Process exited before main waited |
| Async task did not complete | Goroutine lifecycle was not waited for |
| Test fails occasionally | Async goroutine still runs after test function returns |

Troubleshooting:

| Method | Purpose |
| --- | --- |
| Add exit logs | Determine whether main returned first |
| Use WaitGroup or other synchronization | Make main wait for tasks to finish |
| Use `go test -race` | Check whether async goroutines access shared state after test ends |

---

### 3.11 Panic Inside Goroutine

The Go language specification explains that after `panic` is called, the current function stops executing, deferred functions execute in last-in-first-out order, and if there is no recover, the panic continues propagating. [11]

Common symptoms:

| Symptom | Method |
| --- | --- |
| Process exits and prints panic stack | Locate panic goroutine from stack |
| Panic occurs inside async task | Inspect goroutine creation stack or business startup point |
| WaitGroup wait does not return | Goroutine panicked before `Done`, or recovery path is abnormal |

Troubleshooting command:

```bash
GOTRACEBACK=all ./app
```

It can also be set in the program:

```go
func init() {
	// Print all goroutine stacks when an unrecovered panic occurs.
	debug.SetTraceback("all")
}
```

---

### 3.12 Unbounded Goroutine Creation

Symptoms:

| Symptom | Manifestation |
| --- | --- |
| Goroutine count grows with requests, messages, or tasks | `runtime.NumGoroutine()` grows linearly with input |
| Many startup points are identical in goroutine profile | `go func` is in loops, request handling, message consumption, and similar paths |
| Goroutine creation events are dense in trace | Many goroutines are created in a short time |

Troubleshooting:

```bash
curl -o goroutine.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"

curl -o trace.out "http://localhost:6060/debug/pprof/trace?seconds=5"
go tool trace trace.out
```

Code checkpoints:

| Checkpoint | Description |
| --- | --- |
| Whether `go func` is inside an unbounded loop | Whether goroutine creation count is input-controlled |
| Whether async tasks have exit conditions | Whether goroutines exit after task completion or cancellation |
| Whether task queues have capacity boundaries | Whether creation rate can exceed processing rate |
| Whether `ctx.Done()` is observed | Whether goroutines exit after upstream cancellation |

---

### 3.13 Goroutines Blocked on External I/O or Syscalls

Official `runtime/trace` documentation explains that trace captures system call entry, exit, and blocking events. [4]

Common symptoms:

| Symptom | Method |
| --- | --- |
| Goroutine stack stopped at network read/write | Check network call location and timeout configuration |
| Goroutine stack stopped at database or RPC call | Check external dependency call location |
| Long syscall block time in trace | Use `go tool trace` to inspect syscall block |
| Goroutine count grows but CPU is not high | Check whether many goroutines wait on I/O |

Troubleshooting commands:

```bash
curl -o goroutine.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"

curl -o trace.out "http://localhost:6060/debug/pprof/trace?seconds=5"
go tool trace trace.out
```

---

### 3.14 select Waits Forever

`select` is often used to wait for channels, context cancellation, timers, and similar events. When all cases cannot proceed and there is no default branch, the current goroutine blocks.

Common pattern:

```go
func waitForever(ch <-chan int) {
	select {
	case <-ch:
		return
	}
}
```

Troubleshooting:

| Symptom | Method |
| --- | --- |
| Goroutine stack stopped at `select` | Check the channel or context corresponding to each case |
| Goroutine does not exit after context cancellation | Check whether select contains `<-ctx.Done()` |
| Timer branch does not trigger | Check timer creation, reset, and stop paths |
| Channel branch does not trigger | Check sender, closer, and buffer capacity |

---

## 4. Standard Troubleshooting Workflow

### 4.1 Confirm Goroutine Count First

```bash
# If the application exports metrics, query the goroutine count metric.
# If not, expose runtime.NumGoroutine() in logs or diagnostics endpoints.
```

Judgment:

| Result | Next Step |
| --- | --- |
| Count is stable | Focus on local blocking, race, panic, or external I/O |
| Count keeps growing | Capture goroutine profiles and compare growing stacks |
| Count periodically grows and falls | Investigate business cycles, scheduled tasks, connection pools, or queue consumers |
| Count suddenly spikes | Check loop creation, request storms, message backlog, or external call blocking |

---

### 4.2 Capture Goroutine Profile

```bash
curl -o goroutine.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"
```

Analysis dimensions:

| Dimension | Content |
| --- | --- |
| Number of identical stacks | Which type of goroutine is most numerous |
| Blocking point | channel, WaitGroup, Mutex, I/O, select |
| Creation point | Business path where `go func` is located |
| Whether context is included | Whether cancellation signal is observed |
| Whether concentrated in one API or task | Whether related to business traffic entry |

---

### 4.3 Enable Block / Mutex Profile

```go
func enableBlockingDiagnostics() {
	// Enable block profiling.
	runtime.SetBlockProfileRate(1)

	// Enable mutex profiling.
	runtime.SetMutexProfileFraction(1)
}
```

```bash
go tool pprof http://localhost:6060/debug/pprof/block
go tool pprof http://localhost:6060/debug/pprof/mutex
```

Applicable problems:

| Profile | Scenario |
| --- | --- |
| block | Synchronization blocking on channel, select, WaitGroup, Cond, and similar primitives |
| mutex | Mutex / RWMutex lock contention |

---

### 4.4 Capture Trace

```bash
curl -o trace.out "http://localhost:6060/debug/pprof/trace?seconds=5"
go tool trace trace.out
```

Applicable problems:

| Problem | Trace Purpose |
| --- | --- |
| Too many goroutines created | Observe creation events |
| Goroutines runnable for a long time but not running | Observe scheduling latency |
| Syscall blocking | Observe syscall block |
| GC affects latency | Observe GC and goroutine execution timeline |
| Complex task chains | Observe goroutine unblock relationships |

---

### 4.5 Run Static and Dynamic Checks

```bash
go vet ./...
go test -race ./...
```

Mapping:

| Command | Finds |
| --- | --- |
| `go vet` | suspicious constructs such as lostcancel, copylocks, loopclosure, waitgroup |
| `go test -race` | data races that actually occur at runtime |
| `go run -race` | race detection during local execution |
| `go build -race` | binary built with race detector |

---

## 5. Common Error Summary

| No. | Error Type | Main Symptom | Main Troubleshooting Method |
| -: | --- | --- | --- |
| 1 | Abnormally increasing goroutines / leak | Count keeps increasing, does not fall after request ends | `runtime.NumGoroutine`, goroutine profile, context checks |
| 2 | Process-level deadlock | `all goroutines are asleep - deadlock` | `GOTRACEBACK=all`, goroutine stack, block profile |
| 3 | Channel receive blocks forever | goroutine stopped at `<-ch` | goroutine stack, sender check |
| 4 | Channel send blocks forever | goroutine stopped at `ch <- v` | goroutine stack, buffer/receiver check |
| 5 | nil channel blocks | send/receive never continues | channel initialization path check |
| 6 | send on closed channel | panic | panic stack, race detector |
| 7 | close closed channel | panic | panic stack, closer check |
| 8 | close nil channel | panic | channel initialization path check |
| 9 | WaitGroup missing Done | `Wait` blocks forever | goroutine stack, `go vet` |
| 10 | WaitGroup Add/Wait race | occasional wait abnormality | `go vet -waitgroup`, code path check |
| 11 | WaitGroup counter negative | panic | panic stack, Add/Done count check |
| 12 | Mutex not released | goroutine stopped at `Lock` | goroutine stack, mutex profile |
| 13 | Locks waiting on each other | multiple goroutines wait on each other | goroutine stack, mutex profile |
| 14 | Lock object copied | abnormal lock state | `go vet -copylocks` |
| 15 | Data Race | nondeterministic result, race report | `go test -race` |
| 16 | Loop variable closure capture | goroutine uses wrong variable value | `go vet -loopclosure`, race detector |
| 17 | context cancel not called | context children, timers, or goroutines not released | `go vet -lostcancel`, goroutine profile |
| 18 | goroutine does not listen for cancellation | task still runs after request cancellation | goroutine stack, context check |
| 19 | main exits early | async task not completed | main lifecycle check, synchronization wait |
| 20 | panic inside goroutine | process panic or task exits abnormally | `GOTRACEBACK=all`, panic stack |
| 21 | unbounded goroutine creation | count grows rapidly with input | goroutine profile, trace |
| 22 | external I/O blocking | goroutine stopped in network, RPC, DB call | goroutine stack, trace |
| 23 | select waits forever | goroutine stopped at select | goroutine stack, case condition check |
| 24 | Cond wait not woken | goroutine stopped at `Cond.Wait` | goroutine stack, block profile |
| 25 | channel close semantics misuse | receive zero value causes business misjudgment | check `value, ok := <-ch` usage |

---

## 6. Conclusion

Goroutine troubleshooting can be summarized into five categories of objective evidence:

1. Count evidence: `runtime.NumGoroutine()`.
2. Stack evidence: `runtime.Stack`, `/debug/pprof/goroutine?debug=2`.
3. Blocking evidence: block profile, mutex profile.
4. Timeline evidence: `runtime/trace`, `go tool trace`.
5. Code evidence: `go vet`, race detector, panic stack.

For abnormally increasing goroutines, direct evidence is the goroutine count trend and repeated stacks. For deadlocks, direct evidence is the runtime fatal message and the blocking stacks of all goroutines. For channel, WaitGroup, Mutex, context, data race, and similar problems, Go official documentation provides the corresponding semantic descriptions, runtime tools, or static checking entry points.

## References

[1] The Go language specification explains that a `go` statement starts an independently executing goroutine, and the current execution flow does not wait for it to finish; it also states that after `main` returns, the program exits and does not wait for other non-main goroutines. ([Go][1])

[2] Official Go diagnostics documentation explains that `runtime.NumGoroutine` can be used to monitor goroutine count and detect goroutine leaks; `runtime.Stack` can output the current and all goroutine stacks. ([Go][2])

[3] Official `net/http/pprof` documentation explains that this package exposes `/debug/pprof/` profiling entry points; official Go diagnostics documentation lists uses of profiles such as goroutine, heap, threadcreate, block, and mutex. ([Go Packages][3])

[4] `runtime.SetBlockProfileRate` and `runtime.SetMutexProfileFraction` enable block and mutex profiles; official `runtime/trace` documentation explains that trace captures events such as goroutine creation, blocking, unblocking, system calls, and GC. ([Go Packages][4])

[5] Official `context` documentation explains the role of `CancelFunc`, and that failing to call `CancelFunc` leaks child contexts and their children; the channel returned by `Done()` is closed on cancellation. ([Go Packages][5])

[6] Official `sync.WaitGroup` documentation explains its counter, `Add`, `Done`, and `Wait` semantics, and that a negative counter panics. ([Go Packages][6])

[7] Official Go Data Race Detector documentation defines data races and explains that `go test -race`, `go run -race`, and `go build -race` can be used for detection; reports include conflicting access stacks and goroutine creation stacks. ([Go][7])

[8] Official `go vet` documentation explains that it checks suspicious constructs in Go source code; related analyzers include `waitgroup`, `copylocks`, `loopclosure`, and `lostcancel`. ([Go Packages][8])

[9] The Go language specification explains channel semantics including blocking, nil channels, closed channels, send, receive, and close. ([Go][1])

[10] Go runtime source and runtime documentation include diagnostic basis such as `all goroutines are asleep - deadlock!`, `GOTRACEBACK`, `debug.SetTraceback`, and SIGQUIT stack dumps. ([Go][9])

[11] The Go language specification explains that after `panic`, the current function stops executing, deferred functions execute in last-in-first-out order, and the panic propagates along the call stack until recovered or the program terminates. ([Go][1])

[1]: https://go.dev/ref/spec "The Go Programming Language Specification - The Go Programming Language"
[2]: https://go.dev/doc/diagnostics "Diagnostics - The Go Programming Language"
[3]: https://pkg.go.dev/net/http/pprof "pprof package - net/http/pprof - Go Packages"
[4]: https://pkg.go.dev/runtime "runtime package - runtime - Go Packages"
[5]: https://pkg.go.dev/context "context package - context - Go Packages"
[6]: https://pkg.go.dev/sync "sync package - sync - Go Packages"
[7]: https://go.dev/doc/articles/race_detector "Data Race Detector - The Go Programming Language"
[8]: https://pkg.go.dev/cmd/vet "vet command - cmd/vet - Go Packages"
[9]: https://go.dev/src/runtime/proc.go?utm_source=chatgpt.com "runtime/proc.go"
