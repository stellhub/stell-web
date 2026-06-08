# Deep Dive into Go `context`: Definition, Problem Domain, Usage, Caveats, and Typical Scenarios

## 1. What `context` Is

The `context` package in the Go standard library defines the `Context` type. This type is used to carry three kinds of information across API boundaries and process boundaries: deadlines, cancellation signals, and request-scoped values. [S1]

`Context` is an interface whose core methods are:

```go
type Context interface {
	Deadline() (deadline time.Time, ok bool)
	Done() <-chan struct{}
	Err() error
	Value(key any) any
}
```

`Deadline` returns the time when the work represented by the current context should be canceled; if no deadline is set, `ok` is `false`. `Done` returns a receive-only channel that is closed when the work represented by this context should be canceled. `Err` returns `nil` before `Done` is closed; after `Done` is closed, it returns a non-nil error, usually `context.Canceled` or `context.DeadlineExceeded`. `Value` returns the value associated with the current context for a key, or `nil` if no value is associated. [S2]

Therefore, `Context` itself is not a business data container, nor is it a goroutine manager. It is the standard mechanism for passing cancellation, timeout, deadline, and request-scoped values across functions, goroutines, and API call chains. [S1][S2]

## 2. What Problems `context` Solves

In server-side programs, one request usually triggers multiple layers of function calls, may start multiple goroutines, and may continue to access databases, caches, RPC services, or downstream HTTP services. When the request is canceled, times out, or the client connection is closed, these downstream operations need to receive the same cancellation signal so they can stop work that is no longer needed. [S6]

The problems solved by `context` can be summarized into four categories.

First, it propagates cancellation signals. `WithCancel` derives a child `Context` from a parent `Context` and returns a `CancelFunc`. Calling that `CancelFunc` closes the child context's `Done` channel. If the parent context's `Done` channel is closed, the child context's `Done` channel is also closed. [S3]

Second, it propagates timeouts and deadlines. `WithDeadline` creates a derived context with a deadline; `WithTimeout` is equivalent to creating a deadline based on the current time plus a timeout. When the deadline arrives or the timeout elapses, the derived context is canceled. [S3]

Third, it forms cancellation propagation across the call chain. Official documentation explains that incoming requests to a server should create a `Context`, outgoing calls to servers should accept a `Context`, and the chain of function calls between them must propagate that `Context`. Derived contexts can also be created with `WithCancel`, `WithDeadline`, `WithTimeout`, and `WithValue`. When a context is canceled, all contexts derived from it are also canceled. [S1]

Fourth, it carries request-scoped values. `WithValue` returns a derived context that points to the parent context and associates a specified key with a value in the derived context. But official documentation limits its use: context values should only be used for request-scoped data that crosses process and API boundaries, not for passing optional parameters to functions. [S4]

## 3. Core Mechanism: Parent-Child Relationships, Cancellation Propagation, and Error Semantics

`Context` usage usually starts from a root context. `context.Background()` returns a non-nil empty context. It is never canceled, has no values, and has no deadline. Official documentation explains that it is typically used by the `main` function, initialization, tests, and as the top-level context for incoming requests. [S4]

When the current function does not know which context to use, or surrounding functions have not yet been changed to receive `Context` parameters, `context.TODO()` can be used. It also returns a non-nil empty context. [S4]

A new context can be derived from a root context or an upstream context:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
```

The child context returned by `WithCancel` points to the parent context, but has a new `Done` channel. When the returned `cancel` is called, or when the parent's `Done` channel is closed, the child's `Done` channel is closed. [S3]

The semantics of `CancelFunc` are to notify operations to abandon work. It does not wait for the work to actually stop. It can be called concurrently by multiple goroutines. After the first call, subsequent calls have no effect. [S2]

For contexts with deadlines or timeouts, the returned cancel function should be called even if the operation completes early. Official documentation explains that canceling the context releases resources associated with it. Failing to call `CancelFunc` leaks the child and its children until the parent is canceled. [S1][S3]

`Err` is used to read the cancellation result. If `Done` is not yet closed, `Err` returns `nil`. If the deadline is reached, `Err` returns `DeadlineExceeded`. If the context is canceled for another reason, `Err` returns `Canceled`. [S2]

Go also provides APIs with cancellation causes. `WithCancelCause` returns a `CancelCauseFunc`, which can be called with an error as the cause. `context.Cause(ctx)` can retrieve that cancellation cause. If no cause is specified, `Cause(ctx)` returns the same value as `ctx.Err()`. If the context has not been canceled, `Cause(ctx)` returns `nil`. [S5]

## 4. Basic Usage

### 4.1 Explicitly Pass `Context` in Function Signatures

Functions that use context should explicitly receive a `context.Context` parameter. The form shown in official documentation is:

```go
func DoSomething(ctx context.Context, arg Arg) error {
	// Use ctx for cancellation, deadlines, and request-scoped values.
	return nil
}
```

This parameter should be the first parameter and is usually named `ctx`. [S1]

The context should not be discarded in the middle of the call chain. The context passed from upstream should continue to be passed to downstream HTTP, database, RPC, or other cancelable operations. [S1]

### 4.2 Use `WithTimeout` to Control Operation Duration

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

Here, `WithTimeout` derives a context with a timeout from the parent context. After `QueryRowContext` receives this context, the database operation can end when the timeout expires, the context is canceled, or the upstream context is canceled. [S3][S8]

### 4.3 Listen to `Done` in Goroutines

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

The purpose of `Done` is to be used in `select` as a cancellation signal. Official documentation examples also use `select` to wait for both business sends and `ctx.Done()`. [S2]

### 4.4 Pass context in HTTP Clients

```go
func Fetch(ctx context.Context, client *http.Client, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	return client.Do(req)
}
```

The official `net/http` documentation explains that `NewRequestWithContext` should be used to create requests with context. For outgoing client requests, the context controls the entire lifetime of the request and response, including obtaining a connection, sending the request, and reading the response headers and body. [S9]

### 4.5 Use Request Context in HTTP Servers

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

`Request.Context()` returns the request context. For incoming server requests, this context is canceled when the client connection closes, the HTTP/2 request is canceled, or `ServeHTTP` returns. [S9]

### 4.6 Use `WithValue` for Request-Scoped Values

`WithValue` can be used to carry request-scoped values propagated across API boundaries, such as trace ID, authenticated principal, or request-scoped user object. But it should not be used to pass optional function parameters. [S4]

Official documentation explains that context keys must be comparable types. Built-in types such as `string` should not be used as keys, to avoid key collisions between different packages. Packages that define context keys should usually use unexported key types and provide type-safe accessor functions. [S4]

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

## 5. Usage Caveats

### 5.1 Do Not Store `Context` in Structs

Official documentation states: do not store `Context` inside a struct type; instead, pass it explicitly to each function that needs it. [S1]

The Go Blog article "Contexts and structs" further explains that when context is passed as a parameter, the caller can set deadlines, cancellation signals, and metadata separately for each call. Storing context in a struct makes it difficult for the caller to control lifecycle per call. [S7]

### 5.2 Do Not Pass a `nil Context`

Official documentation states that a nil context should not be passed, even if a function permits it. If it is still unclear which context should be used, pass `context.TODO()`. [S1]

### 5.3 `CancelFunc` Should Be Called on All Control Paths

`WithCancel`, `WithDeadline`, and `WithTimeout` return a derived context and a `CancelFunc`. Calling `CancelFunc` cancels the child and its children, removes the parent's reference to the child, and stops related timers. Failing to call it leaks the child and its children until the parent is canceled. Official documentation also explains that `go vet` checks whether `CancelFunc` is used on all control-flow paths. [S1]

### 5.4 Context Cancellation Is Not Forced Interruption

`CancelFunc` only notifies operations to abandon work; it does not wait for work to stop. Callees need to listen to `ctx.Done()`, check `ctx.Err()`, or call APIs that support context at suitable points. Blocking operations that do not observe context will not automatically return simply because upstream called cancel. [S2]

### 5.5 `Context` Can Be Used Concurrently by Multiple Goroutines

Official documentation states that the same context can be passed to functions running in different goroutines, and context is safe for simultaneous use by multiple goroutines. [S1]

### 5.6 `WithValue` Is Only for Request-Scoped Data

Context values are only for request-scoped data crossing process and API boundaries, not for optional function parameters. Ordinary function parameters should be passed explicitly through function signatures. [S1][S4]

### 5.7 `WithoutCancel` Cuts Off Parent Cancellation Propagation

`context.WithoutCancel(parent)` returns a derived context that points to the parent, but the derived context is not canceled when the parent is canceled. This context has no deadline, `Err` returns nil, its `Done` channel is nil, and `Cause` returns nil. [S5]

## 6. Typical Usage Scenarios

### 6.1 HTTP Server Request Chains

In HTTP servers, `r.Context()` is the entry point for request-scoped context. This context can be passed downstream to business services, database access, RPC clients, and logging/tracing logic. When the client connection closes, an HTTP/2 request is canceled, or the handler returns, this context is canceled. [S9]

### 6.2 HTTP Client Requests

HTTP client requests can bind context through `http.NewRequestWithContext`. For outgoing requests, context controls the entire lifecycle from obtaining a connection to reading the response body. [S9]

### 6.3 Database Queries, Transactions, and Writes

`database/sql` provides methods that accept context, such as `QueryContext`, `ExecContext`, `BeginTx`, and `QueryRowContext`. Official database documentation explains that context can be used to cancel database operations when the client connection is closed or when an operation takes longer than expected. Transaction examples also explain that `Tx` methods accepting context allow function execution and database operations to be canceled when they run too long or when the client connection closes. [S8]

### 6.4 RPC, Remote APIs, and Cross-Service Calls

The Go Blog explains that context is commonly used in libraries that directly or indirectly interact with remote servers, such as databases and APIs. It can pass deadlines, caller cancellation, and request-scoped values across API and process boundaries. [S7]

### 6.5 Concurrent Pipelines and Goroutine Exit

The Go Blog article on pipeline cancellation explains that when downstream no longer receives data, there needs to be a way to notify upstream goroutines to stop sending. Closing a channel can notify an unknown number of goroutines to stop. `Context.Done()` is one of the standard forms of using channel closing as a cancellation signal. [S10]

## 7. Summary

`context.Context` is the standard interface in the Go standard library for propagating deadlines, cancellation signals, and request-scoped values across call chains. It propagates cancellation through parent-child derivation relationships, exposes cancellation signals through `Done`, exposes cancellation results through `Err`, and passes request-scoped data through `Value`. When used, context should be explicitly passed as the first function parameter; it should not be stored in structs; nil should not be passed; contexts derived from `WithCancel`, `WithDeadline`, and `WithTimeout` should call the returned cancel function; `WithValue` should only be used for request-scoped data, not optional function parameters. [S1][S2][S3][S4][S7]

## References

[S1] Official Go `context` package overview: `Context` carries deadlines, cancellation signals, and request-scoped values; request chains should propagate context; derived contexts are canceled with their parent; official rules include "do not store in structs," "do not pass nil," and "Value is only for request-scoped data." ([Go Packages][1])

[S2] Official Go `Context` interface documentation: semantics of `Deadline`, `Done`, `Err`, and `Value`, and `CancelFunc` not waiting for work to stop, being concurrently callable, and subsequent calls having no effect. ([Go Packages][1])

[S3] Official Go `WithCancel`, `WithDeadline`, and `WithTimeout` documentation: derived contexts, closing `Done`, releasing resources, timeout and deadline behavior. ([Go Packages][1])

[S4] Official Go `Background`, `TODO`, and `WithValue` documentation: root context, placeholder context, request-scoped values, and key type rules. ([Go Packages][1])

[S5] Official Go `Cause`, `AfterFunc`, and `WithoutCancel` documentation: cancellation causes, functions triggered after cancellation, and cutting off parent context cancellation propagation. ([Go Packages][1])

[S6] Go Blog "Go Concurrency Patterns: Context": when a request is canceled or times out, goroutines handling that request should exit quickly; context passes request-scoped values, cancellation signals, and deadlines across API boundaries. ([Go][2])

[S7] Go Blog "Contexts and structs": context is commonly the first function parameter; it should not be stored in structs; passing it as a parameter keeps deadline, cancellation, and metadata scope clear for each call. ([Go][3])

[S8] Official Go database documentation: `context.Context` can cancel database operations; `QueryContext`, transaction methods, and similar APIs can cancel when operations run too long or client connections close. ([Go][4])

[S9] Official Go `net/http` documentation: semantics of `NewRequestWithContext` and `Request.Context()`; outgoing request context controls the request and response lifecycle; incoming request context is canceled when the connection closes, HTTP/2 cancels, or `ServeHTTP` returns. ([Go Packages][5])

[S10] Go Blog "Pipelines and cancellation": concurrent pipelines need to notify upstream goroutines to stop; closing a channel can notify an unknown number of goroutines. ([Go][6])

[1]: https://pkg.go.dev/context "context package - context - Go Packages"
[2]: https://go.dev/blog/context "Go Concurrency Patterns: Context - The Go Programming Language"
[3]: https://go.dev/blog/context-and-structs "Contexts and structs - The Go Programming Language"
[4]: https://go.dev/doc/database/cancel-operations "Canceling in-progress operations - The Go Programming Language"
[5]: https://pkg.go.dev/net/http "http package - net/http - Go Packages"
[6]: https://go.dev/blog/pipelines "Go Concurrency Patterns: Pipelines and cancellation - The Go Programming Language"
