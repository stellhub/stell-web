# Goroutine 问题排查：官方依据、观测入口与常见错误清单

## 1. 概念边界

Go 语言规范将 `go` 语句描述为启动一个独立并发执行的控制线程，即 goroutine。该 goroutine 与当前 goroutine 运行在同一地址空间中。调用 `go f()` 后，函数调用会在新的 goroutine 中开始执行，当前程序执行流程不会等待该函数完成。当函数返回时，该 goroutine 终止。[1]

因此，在 Go 程序中排查 goroutine 问题时，核心对象不是操作系统线程本身，而是 goroutine 的数量、生命周期、阻塞位置、调度关系、同步关系、共享内存访问关系以及取消传播关系。

Go 语言规范还说明：当 `main` 函数返回时，程序退出，不会等待其他非 main goroutine 完成。[1] 因此，“goroutine 未执行完成”与“main 提前退出”属于生命周期问题。

---

## 2. 官方文档对应的排查入口

### 2.1 goroutine 数量观测

`runtime.NumGoroutine()` 返回当前存在的 goroutine 数量。Go 官方诊断文档说明，该指标可用于监控 goroutine 数量，并用于检测 goroutine 泄漏。[2]

常见使用方式：

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

排查用途：

| 现象               | 观测方式                           |
| ---------------- | ------------------------------ |
| goroutine 数量持续上升 | 周期性记录 `runtime.NumGoroutine()` |
| 压测结束后数量不回落       | 比较压测前、压测中、压测后的数量               |
| 某接口调用后数量增加       | 在接口入口、出口、异步任务启动点记录数量           |
| 线上周期性增长          | 将 goroutine 数量作为运行时指标上报        |

---

### 2.2 goroutine 堆栈抓取

`runtime.Stack(buf, true)` 可以将当前 goroutine 以及其他 goroutine 的堆栈写入缓冲区。[2]

示例：

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

排查用途：

| 堆栈信息                                     | 对应问题                                   |
| ---------------------------------------- | -------------------------------------- |
| 大量 goroutine 停在同一 channel receive        | 接收端等待数据、发送端未发送、channel 未关闭、nil channel |
| 大量 goroutine 停在同一 channel send           | 发送端阻塞、接收端不足、buffer 满、nil channel       |
| 大量 goroutine 停在 `sync.(*WaitGroup).Wait` | `Done` 未执行、`Add`/`Wait` 顺序错误、计数器未归零    |
| 大量 goroutine 停在 `sync.(*Mutex).Lock`     | 锁竞争、锁未释放、锁顺序导致互相等待                     |
| 大量 goroutine 停在 I/O 调用                   | 网络、文件、系统调用或外部依赖阻塞                      |
| 大量 goroutine 停在 `select`                 | 等待多个事件，但所有 case 均未就绪                   |

---

### 2.3 `net/http/pprof`

`net/http/pprof` 官方文档说明，该包通过 HTTP 暴露运行时 profiling 数据，数据格式可被 `pprof` 工具读取。导入该包的副作用会注册 `/debug/pprof/` 下的 HTTP handler。[3]

最小接入方式：

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

常用命令：

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

Go 官方诊断文档列出的 profile 包括：

| profile        | 官方描述对应的排查对象           |
| -------------- | --------------------- |
| `goroutine`    | 当前所有 goroutine 的堆栈    |
| `heap`         | 堆内存分配                 |
| `threadcreate` | 操作系统线程创建              |
| `block`        | goroutine 在同步原语上阻塞的位置 |
| `mutex`        | 锁竞争位置                 |
| `profile`      | CPU profile           |
| `trace`        | 执行追踪                  |

其中，block profile 默认未开启，需要调用 `runtime.SetBlockProfileRate`；mutex profile 默认未开启，需要调用 `runtime.SetMutexProfileFraction`。[3][4]

---

### 2.4 `runtime/trace`

`runtime/trace` 官方文档说明，执行 trace 会捕获 goroutine 创建、阻塞、解除阻塞、系统调用进入、系统调用退出、系统调用阻塞、GC 事件、堆大小变化、处理器启动与停止等事件。[4]

排查用途：

| 问题              | trace 观察点                        |
| --------------- | -------------------------------- |
| goroutine 创建过多  | goroutine creation 事件            |
| goroutine 长时间阻塞 | blocking / unblocking 事件         |
| 外部调用耗时          | syscall enter / exit / block 事件  |
| 调度延迟            | goroutine runnable 到 running 的时间 |
| GC 对延迟的影响       | GC 事件与 goroutine 执行时间线           |

测试阶段可使用：

```bash
go test -trace=trace.out ./...
go tool trace trace.out
```

运行中服务可使用：

```bash
curl -o trace.out "http://localhost:6060/debug/pprof/trace?seconds=5"
go tool trace trace.out
```

---

### 2.5 `go vet`

`go vet` 官方文档说明，该工具检查 Go 源码中可疑结构。其检查项包括 `lostcancel`、`copylocks`、`loopclosure`、`waitgroup` 等。[8]

常用命令：

```bash
go vet ./...
```

与 goroutine 相关的典型检查项：

| vet 检查项       | 对应问题                                                                             |
| ------------- | -------------------------------------------------------------------------------- |
| `lostcancel`  | `context.WithCancel`、`context.WithTimeout`、`context.WithDeadline` 返回的 cancel 未调用 |
| `copylocks`   | `sync.Mutex`、`sync.WaitGroup` 等锁相关对象被复制                                          |
| `loopclosure` | goroutine 闭包引用循环变量                                                               |
| `waitgroup`   | `WaitGroup.Add` 在 goroutine 内部调用，可能与 `Wait` 产生竞态                                 |

---

### 2.6 Race Detector

Go 官方 race detector 文档说明：当两个 goroutine 并发访问同一变量，且至少一个访问是写操作时，如果不存在同步约束，则发生 data race。[7]

常用命令：

```bash
go test -race ./...
go run -race ./cmd/app
go build -race ./cmd/app
```

race detector 报告包含发生冲突的访问堆栈，以及相关 goroutine 的创建堆栈。[7]

注意事项：

| 官方事实                           | 排查含义                    |
| ------------------------------ | ----------------------- |
| race detector 只检测运行时实际发生的 race | 需要通过测试或运行流量覆盖相关路径       |
| race detector 会带来额外内存和执行时间开销   | 生产环境常驻启用需要单独评估          |
| 报告包含 goroutine 创建栈             | 可定位共享变量被哪些 goroutine 访问 |

---

## 3. Goroutine 常见错误与排查手段

### 3.1 goroutine 异常增多 / goroutine leak

现象：

| 现象                  | 表现                                             |
| ------------------- | ---------------------------------------------- |
| goroutine 数量持续增加    | `runtime.NumGoroutine()` 曲线单调上升或周期性抬升          |
| 请求结束后 goroutine 不释放 | 压测停止后 goroutine 数量不回落                          |
| 相同堆栈重复出现            | `pprof/goroutine?debug=2` 中大量 goroutine 停在相同位置 |
| 内存同步增长              | goroutine 数量上升伴随堆内存、栈内存、timer 或上下文对象增长         |

官方依据：

* `runtime.NumGoroutine()` 返回当前存在的 goroutine 数量。[2]
* `goroutine` profile 报告当前所有 goroutine 的堆栈。[3]
* `context` 文档说明，不调用 `CancelFunc` 会泄漏子 context 及其子节点，直到父 context 被取消。[5]

排查步骤：

```bash
# 1. 记录当前 goroutine 堆栈。
curl -o goroutine_1.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"

# 2. 间隔一段时间后再次记录。
curl -o goroutine_2.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"

# 3. 对比重复增长的堆栈。
diff -u goroutine_1.txt goroutine_2.txt
```

代码检查点：

| 检查点                             | 对应问题                    |
| ------------------------------- | ----------------------- |
| `go func()` 是否在循环、请求、消息消费中无限制创建 | goroutine 创建速率超过退出速率    |
| goroutine 是否监听 `ctx.Done()`     | 上游取消后异步任务是否能退出          |
| `CancelFunc` 是否在所有控制路径调用        | context 子节点和 timer 是否释放 |
| channel 是否存在永不关闭或永不发送           | goroutine 是否永久阻塞        |
| ticker 是否 `Stop`                | 周期任务资源是否释放              |
| 外部 I/O 是否有超时                    | 网络、数据库、RPC 调用是否长期阻塞     |

---

### 3.2 进程级死锁

现象：

```text
fatal error: all goroutines are asleep - deadlock!
```

Go runtime 源码中存在该 fatal 信息。当所有 goroutine 均处于不可继续运行的状态时，runtime 会触发该错误。[10]

常见触发形态：

| 形态                                             | 示例                                    |
| ---------------------------------------------- | ------------------------------------- |
| main goroutine 等待 channel receive，但没有任何 sender | `<-ch`                                |
| main goroutine 等待 channel send，但没有任何 receiver  | `ch <- v`                             |
| 所有 goroutine 都等待同一个 WaitGroup                  | `wg.Wait()`                           |
| goroutine 之间锁顺序互相等待                            | A 持有 lock1 等 lock2，B 持有 lock2 等 lock1 |
| nil channel send / receive                     | `var ch chan int; <-ch`               |

排查步骤：

```bash
# Reproduce with all goroutine traceback.
GOTRACEBACK=all ./app
```

或在运行中抓取：

```bash
curl -o goroutine.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"
```

判断方式：

| 堆栈状态                          | 判断方向                          |
| ----------------------------- | ----------------------------- |
| 全部停在 channel send / receive   | channel 通信双方不完整               |
| 全部停在 `WaitGroup.Wait`         | WaitGroup 计数器未归零              |
| 多个 goroutine 分别停在不同锁的 `Lock`  | 锁顺序或锁释放路径问题                   |
| goroutine 停在 nil channel 相关代码 | nil channel 未初始化或 select 逻辑错误 |

---

### 3.3 channel send / receive 永久阻塞

官方依据：

* channel 提供并发 goroutine 间通信机制。[9]
* unbuffered channel 的通信只有在 sender 与 receiver 都准备好时才能完成。[9]
* nil channel 永远不会 ready。[9]
* send 到 nil channel 会永久阻塞。[9]
* receive from nil channel 会永久阻塞。[9]

错误形态：

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

排查手段：

| 手段              | 作用                                      |
| --------------- | --------------------------------------- |
| goroutine stack | 找出阻塞在 send 还是 receive                   |
| block profile   | 找出 goroutine 阻塞在同步原语的位置                 |
| trace           | 查看 goroutine blocking 与 unblocking 的时间线 |
| 代码审查            | 检查 channel 初始化、关闭、发送方、接收方、buffer 容量     |

命令：

```bash
go tool pprof http://localhost:6060/debug/pprof/block
curl -o trace.out "http://localhost:6060/debug/pprof/trace?seconds=5"
go tool trace trace.out
```

---

### 3.4 send on closed channel / close closed channel / close nil channel

官方依据：

* send 到已经关闭的 channel 会 panic。[9]
* close 已经关闭的 channel 会 panic。[9]
* close nil channel 会 panic。[9]
* receive 已关闭且已无剩余值的 channel，会立即返回该元素类型零值。[9]

错误形态：

```go
func sendClosedChannel() {
	ch := make(chan int)
	close(ch)

	// This panics because the channel is already closed.
	ch <- 1
}
```

排查手段：

| 现象                               | 排查方式                                      |
| -------------------------------- | ----------------------------------------- |
| `panic: send on closed channel`  | 查看 panic stack，定位发送方                      |
| `panic: close of closed channel` | 查看 panic stack，定位重复关闭方                    |
| `panic: close of nil channel`    | 检查 channel 初始化路径                          |
| 偶发 panic                         | 使用 `go test -race` 检查 send / close 是否并发发生 |

Race Detector 官方文档中包含“unsynchronized send and close operations”的典型案例。[7]

---

### 3.5 WaitGroup 使用错误

官方依据：

* `sync.WaitGroup` 是用于等待一组任务完成的计数信号量。[6]
* `Add` 会向 WaitGroup 计数器增加 delta。[6]
* 计数器变为负数会 panic。[6]
* `Done` 等价于 `Add(-1)`。[6]
* `Wait` 会阻塞直到计数器归零。[6]
* `go vet` 的 `waitgroup` analyzer 会检测在新 goroutine 内调用 `WaitGroup.Add` 的误用。[8]

常见错误：

| 错误                            | 现象                                        |
| ----------------------------- | ----------------------------------------- |
| `Add(1)` 后缺少 `Done()`         | `Wait()` 永久阻塞                             |
| `Done()` 调用次数多于 `Add()`       | `panic: sync: negative WaitGroup counter` |
| 在 goroutine 内部调用 `Add()`      | `Add` 可能与 `Wait` 并发产生竞态                   |
| 复制 WaitGroup                  | 多个副本计数器不一致                                |
| goroutine panic 后未执行 `Done()` | `Wait()` 阻塞                               |

错误示例：

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

排查手段：

```bash
go vet ./...
```

运行时排查：

```bash
curl -o goroutine.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"
```

堆栈判断：

| 堆栈                                        | 含义                            |
| ----------------------------------------- | ----------------------------- |
| `sync.(*WaitGroup).Wait`                  | 当前 goroutine 等待计数器归零          |
| `panic: sync: negative WaitGroup counter` | `Done` 或 `Add(-1)` 次数超过 `Add` |
| 多个 goroutine 停在 `Wait`                    | 计数器未归零或任务退出路径异常               |

---

### 3.6 Mutex / RWMutex / Cond 相关阻塞

Go 官方诊断文档说明：

* block profile 显示 goroutine 在同步原语上阻塞的位置。
* mutex profile 报告锁竞争。
* block profile 默认未开启，需要 `runtime.SetBlockProfileRate`。
* mutex profile 默认未开启，需要 `runtime.SetMutexProfileFraction`。[3][4]

排查手段：

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

常见错误：

| 错误           | 现象                       | 排查方式                            |
| ------------ | ------------------------ | ------------------------------- |
| 加锁后未解锁       | goroutine 停在 `Lock`      | goroutine stack + mutex profile |
| 锁顺序不一致       | 多个 goroutine 互相等待        | goroutine stack                 |
| 持锁执行慢 I/O    | mutex profile 显示长时间竞争    | mutex profile + trace           |
| 复制包含锁的结构体    | 锁状态被复制                   | `go vet -copylocks`             |
| Cond 等待条件未满足 | goroutine 停在 `Cond.Wait` | goroutine stack                 |

---

### 3.7 Data Race

官方依据：

Go 官方文档定义：当两个 goroutine 并发访问同一变量，并且至少一个访问是写操作时，如果不存在同步关系，则发生 data race。[7]

常见形态：

| 错误                       | 示例                                     |
| ------------------------ | -------------------------------------- |
| goroutine 闭包共享循环变量       | 多个 goroutine 读写同一循环变量                  |
| map 并发读写                 | 一个 goroutine 写 map，另一个 goroutine 读 map |
| 全局变量未加锁                  | 多 goroutine 读写 package-level 变量        |
| channel send 与 close 未同步 | 一个 goroutine send，另一个 goroutine close  |
| 基础类型变量并发读写               | bool、int、指针等直接读写                       |

排查命令：

```bash
go test -race ./...
go run -race ./cmd/app
go build -race ./cmd/app
```

报告读取重点：

| 报告字段                     | 用途               |
| ------------------------ | ---------------- |
| conflicting access stack | 定位冲突读写位置         |
| goroutine creation stack | 定位 goroutine 启动点 |
| read/write 标识            | 判断哪个路径写入共享变量     |
| file:line                | 定位源码行            |

---

### 3.8 循环变量闭包捕获

`go vet` 的 `loopclosure` analyzer 官方文档说明：在 Go 1.22 之前，循环变量生命周期可能导致闭包观察到错误的变量值；从 Go 1.22 开始，循环变量生命周期发生变化。[8]

Go 官方 race detector 文档也列出循环变量并发访问的典型 data race 示例。[7]

错误形态：

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

兼容旧语义的写法：

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

排查命令：

```bash
go vet ./...
go test -race ./...
```

---

### 3.9 context 未取消 / 取消信号未传播

官方依据：

`context` 官方文档说明：

* `Context` 携带 deadline、cancellation signal 和 request-scoped values。
* `CancelFunc` 会取消子 context 及其子 context，移除父 context 对子 context 的引用，并停止关联 timer。
* 未调用 `CancelFunc` 会泄漏子 context 及其子节点，直到父 context 被取消。
* `Done()` 返回一个 channel，该 channel 在相关工作需要取消时关闭。[5]

错误形态：

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

问题点：`CancelFunc` 未保存、未调用。

排查方式：

```bash
go vet ./...
```

其中 `lostcancel` 检查项用于发现 cancel 未调用的问题。[8]

运行时排查：

| 现象                        | 排查方式                                          |
| ------------------------- | --------------------------------------------- |
| 请求结束后 goroutine 仍存在       | 查看 goroutine stack 是否等待 channel、I/O、timer     |
| pprof 中存在大量相同业务 goroutine | 检查是否监听 `ctx.Done()`                           |
| 定时器资源增长                   | 检查 `WithTimeout` / `WithDeadline` 是否调用 cancel |
| 下游调用不退出                   | 检查 context 是否向下游传递                            |

---

### 3.10 main 提前退出导致 goroutine 未完成

官方依据：

Go 语言规范说明：程序执行从初始化 main package 开始，然后调用 `main` 函数；当该函数返回时，程序退出，不会等待其他非 main goroutine 完成。[1]

错误形态：

```go
func main() {
	go func() {
		// This goroutine may not finish before main returns.
		doWork()
	}()
}
```

现象：

| 现象        | 判断方式                     |
| --------- | ------------------------ |
| 日志未完整输出   | main 返回前进程已退出            |
| 异步任务未执行完成 | goroutine 生命周期没有被等待      |
| 测试偶发失败    | 测试函数返回时异步 goroutine 仍在运行 |

排查方式：

| 手段                   | 作用                            |
| -------------------- | ----------------------------- |
| 添加退出日志               | 判断 main 是否先返回                 |
| 使用 WaitGroup 或其他同步机制 | 使 main 等待任务完成                 |
| 使用 `go test -race`   | 检查异步 goroutine 是否访问测试结束后的共享状态 |

---

### 3.11 goroutine 内 panic

Go 语言规范说明：调用 `panic` 后，当前函数执行停止，延迟函数按照后进先出顺序执行；如果没有 recover，panic 会继续传播。[11]

常见现象：

| 现象                  | 排查方式                                        |
| ------------------- | ------------------------------------------- |
| 进程退出并输出 panic stack | 根据 stack 定位 panic goroutine                 |
| panic 发生在异步任务内      | 查看 goroutine creation stack 或业务启动点          |
| WaitGroup 等待不返回     | goroutine panic 后未执行 `Done` 或 recovery 路径异常 |

排查命令：

```bash
GOTRACEBACK=all ./app
```

也可在程序中设置：

```go
func init() {
	// Print all goroutine stacks when an unrecovered panic occurs.
	debug.SetTraceback("all")
}
```

---

### 3.12 无限制 goroutine 创建

现象：

| 现象                              | 表现                                |
| ------------------------------- | --------------------------------- |
| goroutine 数量与请求数、消息数或任务数同步增长    | `runtime.NumGoroutine()` 随输入量线性增长 |
| goroutine profile 中大量启动点相同      | `go func` 位于循环、请求处理、消息消费等路径       |
| trace 中 goroutine creation 事件密集 | 短时间创建大量 goroutine                 |

排查方式：

```bash
curl -o goroutine.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"

curl -o trace.out "http://localhost:6060/debug/pprof/trace?seconds=5"
go tool trace trace.out
```

代码检查点：

| 检查点                | 说明                       |
| ------------------ | ------------------------ |
| `go func` 是否在无界循环中 | goroutine 创建数量是否受输入控制    |
| 异步任务是否存在退出条件       | goroutine 是否能在任务完成或取消后退出 |
| 任务队列是否有容量边界        | 创建速率是否可能超过处理速率           |
| 是否监听 `ctx.Done()`  | 上游取消后 goroutine 是否退出     |

---

### 3.13 goroutine 阻塞在外部 I/O 或 syscall

`runtime/trace` 官方文档说明，trace 会捕获系统调用进入、退出以及阻塞事件。[4]

常见现象：

| 现象                            | 排查方式                                |
| ----------------------------- | ----------------------------------- |
| goroutine stack 停在网络读写        | 查看网络调用位置、超时配置                       |
| goroutine stack 停在数据库或 RPC 调用 | 查看外部依赖调用位置                          |
| trace 中 syscall block 时间长     | 使用 `go tool trace` 查看 syscall block |
| goroutine 数量增长但 CPU 不高        | 检查是否大量 goroutine 等待 I/O             |

排查命令：

```bash
curl -o goroutine.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"

curl -o trace.out "http://localhost:6060/debug/pprof/trace?seconds=5"
go tool trace trace.out
```

---

### 3.14 select 永久等待

select 常见于等待 channel、context cancellation、timer 等事件。当所有 case 均不可继续，且没有 default 分支时，当前 goroutine 会阻塞。

常见形态：

```go
func waitForever(ch <-chan int) {
	select {
	case <-ch:
		return
	}
}
```

排查方式：

| 现象                          | 排查方式                            |
| --------------------------- | ------------------------------- |
| goroutine stack 停在 `select` | 查看每个 case 对应的 channel 或 context |
| context 取消后 goroutine 不退出   | 检查 select 是否包含 `<-ctx.Done()`   |
| timer 分支未触发                 | 检查 timer 创建、reset、stop 路径       |
| channel 分支未触发               | 检查发送方、关闭方、buffer 容量             |

---

## 4. 标准排查流程

### 4.1 先确认 goroutine 数量

```bash
# If the application exports metrics, query the goroutine count metric.
# If not, expose runtime.NumGoroutine() in logs or diagnostics endpoints.
```

判断：

| 结果         | 下一步                          |
| ---------- | ---------------------------- |
| 数量稳定       | 排查重点转向局部阻塞、race、panic、外部 I/O |
| 数量持续增长     | 抓取 goroutine profile 并比较增长堆栈 |
| 数量周期性增长后回落 | 结合业务周期、定时任务、连接池、队列消费排查       |
| 数量突然暴涨     | 检查循环创建、请求风暴、消息堆积、外部调用阻塞      |

---

### 4.2 抓取 goroutine profile

```bash
curl -o goroutine.txt "http://localhost:6060/debug/pprof/goroutine?debug=2"
```

分析维度：

| 维度           | 内容                                 |
| ------------ | ---------------------------------- |
| 相同堆栈数量       | 哪类 goroutine 数量最多                  |
| 阻塞点          | channel、WaitGroup、Mutex、I/O、select |
| 创建点          | `go func` 所在业务路径                   |
| 是否包含 context | 是否监听 cancellation signal           |
| 是否集中在某接口或任务  | 是否与业务流量入口相关                        |

---

### 4.3 启用 block / mutex profile

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

适用问题：

| profile | 适用场景                                |
| ------- | ----------------------------------- |
| block   | channel、select、WaitGroup、Cond 等同步阻塞 |
| mutex   | Mutex / RWMutex 锁竞争                 |

---

### 4.4 抓取 trace

```bash
curl -o trace.out "http://localhost:6060/debug/pprof/trace?seconds=5"
go tool trace trace.out
```

适用问题：

| 问题                          | trace 作用                |
| --------------------------- | ----------------------- |
| goroutine 创建过多              | 观察创建事件                  |
| goroutine 长时间 runnable 但未运行 | 观察调度延迟                  |
| syscall 阻塞                  | 观察 syscall block        |
| GC 影响延迟                     | 观察 GC 与 goroutine 执行时间线 |
| 任务链路复杂                      | 观察 goroutine unblock 关系 |

---

### 4.5 执行静态与动态检查

```bash
go vet ./...
go test -race ./...
```

对应关系：

| 命令               | 发现问题                                             |
| ---------------- | ------------------------------------------------ |
| `go vet`         | lostcancel、copylocks、loopclosure、waitgroup 等可疑结构 |
| `go test -race`  | 运行时真实发生的数据竞争                                     |
| `go run -race`   | 在本地运行过程中检测 race                                  |
| `go build -race` | 构建带 race detector 的二进制                           |

---

## 5. 常见错误总表

| 编号 | 错误类型                   | 主要现象                                   | 主要排查手段                                              |
| -: | ---------------------- | -------------------------------------- | --------------------------------------------------- |
|  1 | goroutine 异常增多 / 泄漏    | 数量持续上升、请求结束不回落                         | `runtime.NumGoroutine`、goroutine profile、context 检查 |
|  2 | 进程级死锁                  | `all goroutines are asleep - deadlock` | `GOTRACEBACK=all`、goroutine stack、block profile     |
|  3 | channel receive 永久阻塞   | goroutine 停在 `<-ch`                    | goroutine stack、channel 发送方检查                       |
|  4 | channel send 永久阻塞      | goroutine 停在 `ch <- v`                 | goroutine stack、buffer/receiver 检查                  |
|  5 | nil channel 阻塞         | send/receive 永久不继续                     | channel 初始化路径检查                                     |
|  6 | send on closed channel | panic                                  | panic stack、race detector                           |
|  7 | close closed channel   | panic                                  | panic stack、关闭方检查                                   |
|  8 | close nil channel      | panic                                  | channel 初始化路径检查                                     |
|  9 | WaitGroup 缺少 Done      | `Wait` 永久阻塞                            | goroutine stack、`go vet`                            |
| 10 | WaitGroup Add/Wait 竞态  | 偶发等待异常                                 | `go vet -waitgroup`、代码路径检查                          |
| 11 | WaitGroup 计数为负         | panic                                  | panic stack、Add/Done 次数检查                           |
| 12 | Mutex 未释放              | goroutine 停在 `Lock`                    | goroutine stack、mutex profile                       |
| 13 | 锁顺序互等                  | 多 goroutine 互相等待                       | goroutine stack、mutex profile                       |
| 14 | 复制锁对象                  | 锁状态异常                                  | `go vet -copylocks`                                 |
| 15 | Data Race              | 非确定性结果、race 报告                         | `go test -race`                                     |
| 16 | 循环变量闭包捕获               | goroutine 使用错误变量值                      | `go vet -loopclosure`、race detector                 |
| 17 | context cancel 未调用     | context 子节点、timer 或 goroutine 不释放      | `go vet -lostcancel`、goroutine profile              |
| 18 | goroutine 未监听取消信号      | 请求取消后任务仍运行                             | goroutine stack、context 检查                          |
| 19 | main 提前退出              | 异步任务未完成                                | main 生命周期检查、同步等待                                    |
| 20 | goroutine 内 panic      | 进程 panic 或任务异常退出                       | `GOTRACEBACK=all`、panic stack                       |
| 21 | 无限制 goroutine 创建       | 数量随输入量快速增长                             | goroutine profile、trace                             |
| 22 | 外部 I/O 阻塞              | goroutine 停在网络、RPC、DB 调用               | goroutine stack、trace                               |
| 23 | select 永久等待            | goroutine 停在 select                    | goroutine stack、case 条件检查                           |
| 24 | Cond 等待未唤醒             | goroutine 停在 `Cond.Wait`               | goroutine stack、block profile                       |
| 25 | channel close 语义误用     | receive 到零值导致业务误判                      | 检查 receive 的 `value, ok := <-ch` 使用                 |

---

## 6. 结论

Goroutine 问题排查可以归纳为五类客观证据：

1. 数量证据：`runtime.NumGoroutine()`。
2. 堆栈证据：`runtime.Stack`、`/debug/pprof/goroutine?debug=2`。
3. 阻塞证据：block profile、mutex profile。
4. 时间线证据：`runtime/trace`、`go tool trace`。
5. 代码证据：`go vet`、race detector、panic stack。

对于 goroutine 异常增多，直接证据是 goroutine 数量趋势与重复堆栈。对于死锁，直接证据是 runtime fatal 信息和所有 goroutine 的阻塞堆栈。对于 channel、WaitGroup、Mutex、context、data race 等问题，Go 官方文档均提供了对应的语义说明、运行时工具或静态检查入口。

## 参考资料

[1] Go 语言规范说明 `go` 语句会启动一个独立并发执行的 goroutine，当前执行流程不会等待它完成；同时，`main` 返回后程序退出，不等待其他非 main goroutine。([Go][1])

[2] Go 官方诊断文档说明 `runtime.NumGoroutine` 可用于监控 goroutine 数量并检测 goroutine leak；`runtime.Stack` 可输出当前及全部 goroutine 堆栈。([Go][2])

[3] `net/http/pprof` 官方文档说明该包暴露 `/debug/pprof/` profiling 入口；Go 官方诊断文档列出了 goroutine、heap、threadcreate、block、mutex 等 profile 的用途。([Go Packages][3])

[4] `runtime.SetBlockProfileRate`、`runtime.SetMutexProfileFraction` 用于开启 block 与 mutex profile；`runtime/trace` 官方文档说明 trace 会捕获 goroutine 创建、阻塞、解除阻塞、系统调用、GC 等事件。([Go Packages][4])

[5] `context` 官方文档说明 `CancelFunc` 的作用，以及未调用 `CancelFunc` 会泄漏子 context 及其子节点；`Done()` 返回的 channel 会在取消时关闭。([Go Packages][5])

[6] `sync.WaitGroup` 官方文档说明其计数、`Add`、`Done`、`Wait` 的语义，以及计数器为负数会 panic。([Go Packages][6])

[7] Go 官方 Data Race Detector 文档定义了 data race，并说明可用 `go test -race`、`go run -race`、`go build -race` 检测；报告包含冲突访问堆栈与 goroutine 创建堆栈。([Go][7])

[8] `go vet` 官方文档说明其会检查 Go 源码中的可疑结构；相关 analyzer 包括 `waitgroup`、`copylocks`、`loopclosure`、`lostcancel`。([Go Packages][8])

[9] Go 语言规范说明 channel 的阻塞、nil channel、closed channel、send、receive、close 等语义。([Go][1])

[10] Go runtime 源码与运行时文档包含 `all goroutines are asleep - deadlock!`、`GOTRACEBACK`、`debug.SetTraceback`、`SIGQUIT` stack dump 等诊断依据。([Go][9])

[11] Go 语言规范说明 `panic` 后当前函数执行停止，defer 按后进先出执行，panic 会沿调用栈传播，直到被 recover 或导致程序终止。([Go][1])

[1]: https://go.dev/ref/spec "The Go Programming Language Specification - The Go Programming Language"
[2]: https://go.dev/doc/diagnostics "Diagnostics - The Go Programming Language"
[3]: https://pkg.go.dev/net/http/pprof "pprof package - net/http/pprof - Go Packages"
[4]: https://pkg.go.dev/runtime "runtime package - runtime - Go Packages"
[5]: https://pkg.go.dev/context "context package - context - Go Packages"
[6]: https://pkg.go.dev/sync "sync package - sync - Go Packages"
[7]: https://go.dev/doc/articles/race_detector "Data Race Detector - The Go Programming Language"
[8]: https://pkg.go.dev/cmd/vet "vet command - cmd/vet - Go Packages"
[9]: https://go.dev/src/runtime/proc.go?utm_source=chatgpt.com "runtime/proc.go"
