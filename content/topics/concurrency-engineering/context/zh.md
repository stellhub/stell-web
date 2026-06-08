# 深入 Go `context` 机制：定义、问题域、使用方式、注意事项与典型场景

## 1. `context` 是什么

Go 标准库中的 `context` 包定义了 `Context` 类型。该类型用于在 API 边界和进程边界之间携带三类信息：deadline、cancellation signal，以及 request-scoped values。[S1]

`Context` 是一个接口，核心方法包括：

```go
type Context interface {
	Deadline() (deadline time.Time, ok bool)
	Done() <-chan struct{}
	Err() error
	Value(key any) any
}
```

`Deadline` 返回当前上下文所代表的工作应被取消的时间点；没有设置 deadline 时，`ok` 为 `false`。`Done` 返回一个只读 channel，当该上下文所代表的工作应被取消时，该 channel 会被关闭。`Err` 在 `Done` 尚未关闭时返回 `nil`；在 `Done` 已关闭后返回非空错误，错误值通常为 `context.Canceled` 或 `context.DeadlineExceeded`。`Value` 根据 key 返回与当前上下文关联的值，没有关联值时返回 `nil`。[S2]

因此，`Context` 本身不是业务数据容器，也不是 goroutine 管理器。它是跨函数、跨 goroutine、跨 API 调用链传递“取消、超时、截止时间、请求级值”的标准机制。[S1][S2]

## 2. `context` 解决了什么问题

在服务端程序中，一个请求通常会触发多层函数调用，也可能启动多个 goroutine，并继续访问数据库、缓存、RPC 服务或 HTTP 下游服务。当请求被取消、超时，或者客户端连接断开时，这些正在执行的下游操作需要收到同一个取消信号，从而停止不再需要的工作。[S6]

`context` 解决的问题可以概括为四类。

第一，传递取消信号。`WithCancel` 会从父 `Context` 派生出子 `Context`，并返回一个 `CancelFunc`。调用该 `CancelFunc` 会关闭子 context 的 `Done` channel；如果父 context 的 `Done` channel 被关闭，子 context 的 `Done` channel 也会被关闭。[S3]

第二，传递超时和截止时间。`WithDeadline` 会生成带 deadline 的派生 context；`WithTimeout` 等价于基于当前时间加 timeout 创建 deadline。当 deadline 到达或 timeout 经过后，派生 context 会被取消。[S3]

第三，形成调用链上的取消传播。官方文档说明：进入服务器的请求应创建 `Context`，发往服务器的出站调用应接受 `Context`，中间函数调用链必须传播该 `Context`，也可以用 `WithCancel`、`WithDeadline`、`WithTimeout`、`WithValue` 创建派生 context。一个 context 被取消时，由它派生出的所有 context 也会被取消。[S1]

第四，携带请求级值。`WithValue` 返回一个指向父 context 的派生 context，并在派生 context 中关联指定 key 与 value。但官方文档限定：context values 只应用于跨进程、跨 API 传递的 request-scoped data，不应用于给函数传递可选参数。[S4]

## 3. 核心机制：父子关系、取消传播与错误语义

`Context` 的使用通常从一个根 context 开始。`context.Background()` 返回一个非空、空 context；它不会被取消，没有值，也没有 deadline。官方文档说明，它通常用于 `main` 函数、初始化、测试，以及作为进入请求的顶层 context。[S4]

当当前函数不知道应使用哪个 context，或者周围函数尚未改造为接收 `Context` 参数时，可以使用 `context.TODO()`。它同样返回非空、空 context。[S4]

从根 context 或上游传入的 context，可以派生出新的 context：

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
```

`WithCancel` 返回的 child context 指向 parent context，但有新的 `Done` channel。当返回的 `cancel` 被调用，或者 parent 的 `Done` channel 被关闭时，child 的 `Done` channel 会关闭。[S3]

`CancelFunc` 的语义是通知操作放弃工作。它不会等待工作真正停止；它可以被多个 goroutine 同时调用；第一次调用之后，后续调用不产生效果。[S2]

对带 deadline 或 timeout 的 context，即使操作提前完成，也应调用返回的 cancel 函数。官方文档说明，取消该 context 会释放与它关联的资源；不调用 `CancelFunc` 会导致 child 及其 children 泄漏，直到 parent 被取消。[S1][S3]

`Err` 用于读取取消原因。如果 `Done` 尚未关闭，`Err` 返回 `nil`；如果 deadline 到达，`Err` 返回 `DeadlineExceeded`；如果由于其他原因取消，`Err` 返回 `Canceled`。[S2]

Go 还提供了带取消原因的 API。`WithCancelCause` 返回 `CancelCauseFunc`，调用时可以传入一个 error 作为 cause；`context.Cause(ctx)` 可以取回该取消原因。如果没有指定 cause，`Cause(ctx)` 返回与 `ctx.Err()` 相同的值；如果 context 尚未取消，`Cause(ctx)` 返回 `nil`。[S5]

## 4. 基本使用方式

### 4.1 函数签名中显式传递 `Context`

使用 context 的函数应显式接收 `context.Context` 参数。官方文档给出的形式是：

```go
func DoSomething(ctx context.Context, arg Arg) error {
	// Use ctx for cancellation, deadlines, and request-scoped values.
	return nil
}
```

该参数应作为第一个参数，通常命名为 `ctx`。[S1]

调用链中不应在中间层丢弃 context。上游传入的 context 应继续传递给下游 HTTP、数据库、RPC 或其他可取消操作。[S1]

### 4.2 使用 `WithTimeout` 控制操作耗时

```go
func QueryWithTimeout(ctx context.Context, db *sql.DB, id int64) error {
	ctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel() // Release resources when the operation completes.

	row := db.QueryRowContext(ctx, "SELECT name FROM users WHERE id = ?", id)

	var name string
	if err := row.Scan(&name); err != nil {
		return err
	}

	return nil
}
```

这里的 `WithTimeout` 会基于父 context 派生出一个带超时的 context。`QueryRowContext` 接收该 context 后，数据库操作可以在超时、取消或上游取消时结束。[S3][S8]

### 4.3 在 goroutine 中监听 `Done`

```go
func Stream(ctx context.Context, out chan<- int) error {
	for i := 0; ; i++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case out <- i:
			// Value sent successfully.
		}
	}
}
```

`Done` 的用途是放在 `select` 中作为取消信号。官方文档中的示例也使用 `select` 同时等待业务发送和 `ctx.Done()`。[S2]

### 4.4 在 HTTP 客户端中传递 context

```go
func Fetch(ctx context.Context, client *http.Client, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	return client.Do(req)
}
```

`net/http` 官方文档说明，创建带 context 的请求应使用 `NewRequestWithContext`；对于出站 client request，context 控制整个请求及其响应的生命周期，包括获取连接、发送请求、读取响应头和响应体。[S9]

### 4.5 在 HTTP 服务端使用请求 context

```go
func Handler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	select {
	case <-ctx.Done():
		http.Error(w, ctx.Err().Error(), http.StatusRequestTimeout)
		return
	default:
		// Continue request processing.
	}

	w.WriteHeader(http.StatusOK)
}
```

`Request.Context()` 返回请求的 context。对于进入服务端的请求，当客户端连接关闭、HTTP/2 请求被取消，或者 `ServeHTTP` 返回时，该 context 会被取消。[S9]

### 4.6 使用 `WithValue` 携带请求级值

`WithValue` 可用于携带跨 API 边界传播的请求级值，例如 trace id、认证主体、请求范围内的用户对象等。但它不应用作函数可选参数的传递方式。[S4]

官方文档说明，context key 必须是 comparable 类型；不应使用 `string` 或其他内置类型作为 key，以避免不同包之间发生 key 冲突。定义 context key 的包通常应使用未导出的 key 类型，并提供类型安全的访问函数。[S4]

```go
package requestmeta

import "context"

type traceIDKey struct{}

func NewContext(ctx context.Context, traceID string) context.Context {
	return context.WithValue(ctx, traceIDKey{}, traceID)
}

func TraceIDFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(traceIDKey{}).(string)
	return v, ok
}
```

## 5. 使用注意事项

### 5.1 不要把 `Context` 存进结构体

官方文档说明：不要把 `Context` 存储在 struct 类型中，而应显式传递给每个需要它的函数。[S1]

Go Blog 的 `Contexts and structs` 文章进一步说明，将 context 作为参数传递时，调用者可以为每一次调用分别设置 deadline、取消信号和 metadata；而把 context 放入 struct 会使调用者难以按单次调用控制生命周期。[S7]

### 5.2 不要传递 `nil Context`

官方文档说明，即使函数允许，也不要传递 nil context；如果还不清楚应使用哪个 context，应传递 `context.TODO()`。[S1]

### 5.3 `CancelFunc` 应在所有控制路径上被调用

`WithCancel`、`WithDeadline`、`WithTimeout` 会返回派生 context 和 `CancelFunc`。调用 `CancelFunc` 会取消 child 及其 children，移除 parent 对 child 的引用，并停止相关 timer；不调用会导致 child 及其 children 泄漏，直到 parent 被取消。官方文档还说明，`go vet` 会检查 `CancelFunc` 是否在所有控制流路径上被使用。[S1]

### 5.4 `Context` 的取消不是强制中断

`CancelFunc` 只通知操作放弃工作，不等待工作停止。被调用方需要在合适位置监听 `ctx.Done()`、检查 `ctx.Err()`，或调用支持 context 的 API。未监听 context 的阻塞操作不会因为上游调用了 cancel 而自动返回。[S2]

### 5.5 `Context` 可以被多个 goroutine 同时使用

官方文档说明，同一个 context 可以传递给运行在不同 goroutine 中的函数；context 可被多个 goroutine 同时安全使用。[S1]

### 5.6 `WithValue` 只用于请求级数据

context values 只用于跨进程和 API 边界传播的 request-scoped data，不用于函数可选参数。对于普通函数参数，应通过函数签名显式传递。[S1][S4]

### 5.7 `WithoutCancel` 会切断父 context 的取消传播

`context.WithoutCancel(parent)` 返回一个指向 parent 的派生 context，但 parent 被取消时该派生 context 不会被取消。该 context 没有 deadline，`Err` 返回 nil，`Done` channel 为 nil，`Cause` 返回 nil。[S5]

## 6. 典型使用场景

### 6.1 HTTP 服务端请求链路

在 HTTP 服务端中，`r.Context()` 是请求级 context 的入口。该 context 可向下传递给业务服务、数据库访问、RPC 客户端和日志追踪逻辑。客户端连接关闭、HTTP/2 请求取消或 handler 返回时，该 context 会被取消。[S9]

### 6.2 HTTP 客户端请求

HTTP 客户端请求可通过 `http.NewRequestWithContext` 绑定 context。对于出站请求，context 控制从获取连接到读取响应体的整个生命周期。[S9]

### 6.3 数据库查询、事务和写操作

`database/sql` 中存在接收 context 的方法，例如 `QueryContext`、`ExecContext`、`BeginTx`、`QueryRowContext` 等。官方数据库文档说明，context 可用于在客户端连接关闭或操作耗时超过预期时取消数据库操作；事务示例也说明，接收 context 的 `Tx` 方法可使函数执行及数据库操作在运行过久或客户端连接关闭时被取消。[S8]

### 6.4 RPC、远程 API 与跨服务调用

Go Blog 说明，context 通常用于库直接或间接与远程服务器交互的场景，例如数据库、API 等。它可以跨 API 边界和进程边界传递 deadline、caller cancellation 与 request-scoped values。[S7]

### 6.5 并发流水线和 goroutine 退出

Go Blog 的 pipelines cancellation 文章说明，当下游不再接收数据时，需要一种方式通知上游 goroutine 停止发送。关闭 channel 可以通知未知数量的 goroutine 停止。`Context.Done()` 正是使用 channel 关闭作为取消信号的标准形式之一。[S10]

## 7. 总结

`context.Context` 是 Go 标准库中用于跨调用链传播 deadline、取消信号和请求级值的标准接口。它通过父子派生关系传播取消，通过 `Done` 暴露取消信号，通过 `Err` 暴露取消结果，通过 `Value` 传递请求级数据。使用时，context 应作为函数第一个参数显式传递；不应存入 struct；不应传递 nil；从 `WithCancel`、`WithDeadline`、`WithTimeout` 派生出的 context 应调用返回的 cancel 函数；`WithValue` 只应用于请求级数据，不应用于函数可选参数。[S1][S2][S3][S4][S7]

## 参考文档

[S1] Go 官方 `context` 包概览：`Context` 用于携带 deadline、取消信号和请求级值；请求链路应传播 context；派生 context 会随父 context 取消；官方列出“不存入 struct、不要传 nil、Value 只用于请求级数据”等规则。([Go Packages][1])

[S2] Go 官方 `Context` 接口说明：`Deadline`、`Done`、`Err`、`Value` 的语义，以及 `CancelFunc` 不等待工作停止、可并发调用、后续调用无效果。([Go Packages][1])

[S3] Go 官方 `WithCancel`、`WithDeadline`、`WithTimeout` 文档：派生 context、关闭 `Done`、释放资源、超时与 deadline 行为。([Go Packages][1])

[S4] Go 官方 `Background`、`TODO`、`WithValue` 文档：根 context、占位 context、request-scoped values、key 类型规则。([Go Packages][1])

[S5] Go 官方 `Cause`、`AfterFunc`、`WithoutCancel` 文档：取消原因、取消后触发函数、切断父 context 取消传播。([Go Packages][1])

[S6] Go Blog《Go Concurrency Patterns: Context》：请求取消或超时时，处理该请求的 goroutine 应尽快退出；context 用于跨 API 边界传递请求级值、取消信号和 deadline。([Go][2])

[S7] Go Blog《Contexts and structs》：context 常作为函数第一个参数；不应存入 struct；作为参数传递可保持每次调用的 deadline、取消和 metadata 作用域清晰。([Go][3])

[S8] Go 官方数据库文档：`context.Context` 可取消数据库操作；`QueryContext`、事务方法等可在运行过久或客户端连接关闭时取消。([Go][4])

[S9] Go 官方 `net/http` 文档：`NewRequestWithContext`、`Request.Context()` 的语义；出站请求 context 控制请求和响应生命周期；入站请求 context 在连接关闭、HTTP/2 取消或 `ServeHTTP` 返回时取消。([Go Packages][5])

[S10] Go Blog《Pipelines and cancellation》：并发流水线中需要通知上游 goroutine 停止；关闭 channel 可通知未知数量的 goroutine。([Go][6])

[1]: https://pkg.go.dev/context "context package - context - Go Packages"
[2]: https://go.dev/blog/context "Go Concurrency Patterns: Context - The Go Programming Language"
[3]: https://go.dev/blog/context-and-structs "Contexts and structs - The Go Programming Language"
[4]: https://go.dev/doc/database/cancel-operations "Canceling in-progress operations - The Go Programming Language"
[5]: https://pkg.go.dev/net/http "http package - net/http - Go Packages"
[6]: https://go.dev/blog/pipelines "Go Concurrency Patterns: Pipelines and cancellation - The Go Programming Language"
