# Research on Go Microservice Framework Design: Mainstream Frameworks, Package Structure, Middleware Extension, and OpenTelemetry Observability

## Abstract

The design goal of a Go microservice framework should not be equivalent to reimplementing the HTTP protocol stack or the RPC protocol stack. It should build a unified engineering framework on top of mature components such as the Go standard library, Gin, gRPC-Go, and OpenTelemetry. Spring Boot documentation defines its goal as creating standalone, production-grade Spring applications and reducing configuration cost through opinionated configuration for the Spring platform and third-party libraries. Based on this idea, the core value of a Go Boot framework should be reflected in unified bootstrap, unified configuration, unified lifecycle, unified HTTP/gRPC entry points, unified middleware chains, unified error models, unified starter mechanisms, unified SDK adapters, and a unified observability system. The Go standard library `net/http` already provides HTTP client/server implementations, and gRPC-Go already provides a high-performance RPC runtime, metadata, and interceptor extension mechanisms. Therefore, Go Boot should not rewrap HTTP or RPC starting from the `net` package. It should use Gin + gRPC-Go as the first-stage transport foundation, while preserving the ability to replace them with Hertz, Chi, Echo, or Kitex in the future through an adapter mechanism. The OpenTelemetry-based observability system should center on `context.Context` propagation, traces, metrics, logs, baggage, and the OpenTelemetry Collector, and should cover entry requests, internal calls, database access, cache access, message queues, and downstream RPC calls.

## Keywords

Go Boot; Golang; Microservice Framework; Gin; gRPC-Go; Starter; Middleware; OpenTelemetry; Observability; Engineering Framework

## 1. Introduction

Official Go documentation defines Go as an open source programming language for building simple, secure, and scalable systems. The Go standard library already provides foundational capabilities such as HTTP client/server, Context, structured logging, module dependency management, and internal package isolation. Based on these capabilities, Go applications can directly build HTTP services and command-line programs. However, in enterprise microservice scenarios, using only the standard library does not automatically form a complete engineering system. Microservice applications usually also need configuration loading, application lifecycle management, logging, metrics, distributed tracing, error codes, rate limiting, authentication, service registration and discovery, dependency injection, SDK initialization, health checks, graceful shutdown, and code generation.

Spring Boot's design can serve as a reference for Go Boot. Spring Boot documentation states that Spring Boot is used to create standalone, production-grade Spring applications and starts applications with less configuration through opinionated configuration for the Spring platform and third-party libraries. Its auto-configuration mechanism configures Spring applications based on dependencies already present on the classpath. A starter combines auto-configuration code and commonly used dependencies. Go does not have Java classpath scanning, annotation scanning, or a runtime Bean container. Therefore, Go Boot cannot mechanically copy Spring Boot's implementation. It should copy its engineering goals: reduce repetitive configuration, unify the startup method, unify dependency assembly, and unify production-grade governance capabilities.

Therefore, Go Boot's design focus is not to reimplement an HTTP router, HTTP server, or RPC runtime, but to establish a unified engineering framework on top of mature foundations. The HTTP layer can use Gin as the first-stage adapter target, because Gin documentation defines it as a high-performance HTTP web framework suitable for building REST APIs, web applications, and microservices. The RPC layer can use gRPC-Go, because gRPC-Go is the Go implementation of gRPC, and gRPC documentation provides mechanisms such as metadata, interceptors, health checking, and OpenTelemetry metrics. Go Boot should treat Gin and gRPC-Go as replaceable adapters, rather than exposing them as strong dependencies to the business layer.

## 2. Design Goals and Boundaries

Go Boot aims to provide an engineering experience similar to Spring Boot, but its implementation must fit Go's language characteristics. Go Boot should provide the following capabilities:

```text
1. Unified App Bootstrap
2. Unified Configuration
3. Unified Lifecycle
4. Unified HTTP and gRPC Transport
5. Unified Middleware and Interceptor Chain
6. Unified Error Model
7. Unified Logging, Metrics and Tracing
8. Unified Service Discovery and Registry
9. Unified SDK Starter Mechanism
10. Unified Code Generation and Project Layout
```

The boundaries of Go Boot must also be clear. Go Boot should not reimplement TCP, HTTP/1.1, HTTP/2, TLS, the gRPC protocol, Protobuf encoding/decoding, or underlying connection pools. The Go standard library `net/http` already provides HTTP client/server implementations. gRPC-Go already provides high-performance RPC framework capabilities. Go Boot should stand on top of these capabilities and provide unified assembly and governance abstractions.

Therefore, the recommended first-stage foundation for Go Boot is:

```text
HTTP Transport : Gin
RPC Transport  : gRPC-Go
Core Framework : Go Boot Core
Telemetry      : OpenTelemetry-Go
Logging        : slog interface + zap/slog adapter
Registry       : etcd / Consul / Nacos adapter
Config         : file / env / config center adapter
SDK Starters   : mysql / redis / kafka / otel / grpc client / http client
```

Here, Gin and gRPC-Go are transport-layer implementations. Go Boot Core is the framework body. OpenTelemetry-Go is the observability API/SDK. Different middleware and infrastructure SDKs are assembled into applications through starters.

## 3. Overall Architecture Design

Go Boot's overall architecture uses a layered model of "stable core layer, adapted transport layer, externalized starters, and transparent business layer".

```text
                         ┌──────────────────────────┐
                         │      Business Service     │
                         │ handler / service / repo  │
                         └─────────────┬────────────┘
                                       │
                         ┌─────────────▼────────────┐
                         │        Go Boot Core       │
                         │ app / config / lifecycle  │
                         │ middleware / errors / log │
                         │ telemetry / metadata      │
                         └─────────────┬────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
┌───────▼────────┐            ┌────────▼────────┐            ┌────────▼────────┐
│ Gin Adapter    │            │ gRPC-Go Adapter │            │ Starter Manager │
│ HTTP transport │            │ RPC transport   │            │ SDK auto setup  │
└───────┬────────┘            └────────┬────────┘            └────────┬────────┘
        │                              │                              │
┌───────▼────────┐            ┌────────▼────────┐            ┌────────▼────────┐
│ net/http       │            │ gRPC runtime    │            │ Third-party SDK │
│ HTTP server    │            │ HTTP/2 + proto  │            │ redis/mysql/mq  │
└────────────────┘            └─────────────────┘            └─────────────────┘
                                       │
                         ┌─────────────▼────────────┐
                         │   OpenTelemetry Layer     │
                         │ trace / metrics / logs    │
                         │ baggage / propagation     │
                         └─────────────┬────────────┘
                                       │
                         ┌─────────────▼────────────┐
                         │ OpenTelemetry Collector   │
                         │ receive/process/export    │
                         └──────────────────────────┘
```

This architecture contains three key facts.

First, the business layer does not directly depend on Gin's `gin.Context`, nor does it directly depend on the low-level details of gRPC calls. Business functions should receive `context.Context` and explicit request/response types.

Second, Go Boot Core does not directly depend on SDKs such as Redis, Kafka, MySQL, Nacos, Prometheus, or Jaeger. The core layer only defines interfaces. Concrete SDKs are integrated through starters and adapters.

Third, OpenTelemetry runs through HTTP, gRPC, databases, caches, message queues, and downstream clients. The framework should be responsible for unified context propagation, span creation, metric collection, and structured log correlation.

## 4. Go Boot Core Package Structure Design

Go Boot's core packages should remain stable and lightweight. Public APIs should be placed under `pkg` or the module root. Implementation details that should not be imported externally should be placed under `internal`. Go 1.4 Release Notes state that the Go toolchain restricts external packages from importing code under the `internal` directory, so `internal` can be used to isolate framework implementation details.

Recommended structure:

```text
go-boot/
├── go.mod
├── README.md
├── cmd/
│   └── goboot/
│       └── main.go
├── internal/
│   ├── bootstrap/
│   ├── configloader/
│   ├── errorsx/
│   ├── metadatax/
│   ├── reflectx/
│   ├── shutdown/
│   └── testkit/
├── boot/
│   ├── app.go
│   ├── option.go
│   ├── module.go
│   ├── starter.go
│   └── context.go
├── config/
│   ├── config.go
│   ├── source.go
│   ├── loader.go
│   └── watcher.go
├── lifecycle/
│   ├── lifecycle.go
│   └── hook.go
├── transport/
│   ├── server.go
│   ├── endpoint.go
│   ├── http/
│   │   ├── router.go
│   │   ├── handler.go
│   │   └── adapter.go
│   └── grpc/
│       ├── server.go
│       ├── client.go
│       └── adapter.go
├── middleware/
│   ├── middleware.go
│   ├── chain.go
│   ├── selector.go
│   ├── recovery/
│   ├── tracing/
│   ├── metrics/
│   ├── accesslog/
│   ├── timeout/
│   ├── ratelimit/
│   ├── auth/
│   └── validation/
├── errors/
│   ├── code.go
│   ├── error.go
│   └── mapper.go
├── metadata/
│   ├── metadata.go
│   ├── propagation.go
│   └── keys.go
├── log/
│   ├── logger.go
│   ├── field.go
│   └── context.go
├── telemetry/
│   ├── telemetry.go
│   ├── trace.go
│   ├── metric.go
│   ├── log.go
│   └── resource.go
├── registry/
│   ├── registry.go
│   ├── service.go
│   └── resolver.go
├── starter/
│   ├── manager.go
│   ├── condition.go
│   └── health.go
└── adapters/
    ├── gin/
    ├── grpcgo/
    ├── otel/
    ├── slog/
    ├── zap/
    ├── redis/
    ├── mysql/
    ├── kafka/
    ├── etcd/
    ├── consul/
    └── nacos/
```

Core package responsibilities:

| Package | Responsibility |
| --- | --- |
| `boot` | Application creation, module registration, starter registration, unified startup |
| `config` | Configuration sources, configuration loading, configuration watching, configuration binding |
| `lifecycle` | Startup hooks, shutdown hooks, graceful shutdown |
| `transport/http` | HTTP abstraction without exposing Gin details |
| `transport/grpc` | gRPC abstraction without exposing low-level call details to the business layer |
| `middleware` | Unified middleware model, chain orchestration, selectors |
| `errors` | Unified error codes, error objects, HTTP/gRPC error mapping |
| `metadata` | Propagation of request id, trace id, tenant, auth, and canary identifiers |
| `log` | Unified logging interface and context fields |
| `telemetry` | Trace, metric, log, and resource abstractions |
| `registry` | Service registration, service discovery, instance metadata |
| `starter` | Starter lifecycle, conditional assembly, health checks |
| `adapters` | Third-party framework and SDK adapters |

This structure reflects one principle: **the framework core only defines capability boundaries, while concrete SDKs are implemented by adapters.**

## 5. App and Starter Mechanism Design

Spring Boot starters combine auto-configuration code and typical dependencies. Go Boot can use an explicit starter mechanism to achieve a similar effect. Because Go does not have classpath scanning or annotation-based auto-assembly, Go Boot starters should use explicit registration, conditional enabling, and lifecycle hooks.

### 5.1 App Model

```go
package boot

import "context"

type App struct {
	name     string
	modules  []Module
	starters []Starter
	servers  []Server
}

type Option func(*App)

func New(opts ...Option) *App {
	app := &App{}
	for _, opt := range opts {
		opt(app)
	}
	return app
}

func (a *App) Register(mods ...Module) {
	a.modules = append(a.modules, mods...)
}

func (a *App) Run(ctx context.Context) error {
	return nil
}
```

The App is responsible for unified startup. Business services only need to register modules and starters. They do not need to repeatedly initialize Gin, gRPC, OpenTelemetry, Redis, MySQL, Kafka, registries, and logging components in every service.

### 5.2 Starter Model

```go
package boot

import "context"

type Starter interface {
	Name() string
	Condition(ctx StarterContext) bool
	Init(ctx context.Context, app *App) error
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
}

type StarterContext interface {
	Config() Config
	Registry() Registry
	Logger() Logger
}
```

Starter responsibilities include:

```text
1. Read configuration
2. Create SDK client
3. Register lifecycle hooks
4. Register health indicator
5. Register metrics
6. Inject component into container
7. Close resource on shutdown
```

For example, a Redis starter:

```text
redis.Starter()
├── read config: redis.addr / redis.password / redis.pool
├── create redis client
├── ping for health check
├── register pool metrics
├── inject Redis client
└── close client on shutdown
```

The goal of a Go Boot starter is not to hide all configuration, but to standardize configuration, initialization, health checks, metrics, and shutdown logic.

## 6. HTTP and gRPC Transport Layer Design

### 6.1 Do Not Rewrap the Protocol Stack from Bare `net`

Go Boot should not start from `net.Listener` to implement the HTTP protocol. The reason is that Go's standard library `net/http` already provides HTTP client/server implementations and supports server, client, HTTP/2, and related capabilities. If Go Boot rewraps from the `net` layer, it would need to handle connection management, protocol parsing, headers, bodies, keep-alive, timeout, TLS, HTTP/2, and compatibility again. This is not the core goal of Go Boot.

Therefore, the HTTP layer should use the following first-stage design:

```text
Gin Adapter -> net/http
```

The RPC layer should use:

```text
gRPC-Go Adapter -> gRPC runtime
```

Future extensions can include:

```text
HTTP Adapter:
- Gin
- Chi
- Echo
- Hertz
- net/http router

RPC Adapter:
- gRPC-Go
- Kitex
```

### 6.2 HTTP Abstraction

The business layer should not directly depend on `gin.Context`. Go Boot should provide its own Router and Handler abstractions:

```go
package http

import "context"

type Handler[Req any, Resp any] func(ctx context.Context, req *Req) (*Resp, error)

type Router interface {
	GET(path string, h any, mws ...any)
	POST(path string, h any, mws ...any)
	PUT(path string, h any, mws ...any)
	DELETE(path string, h any, mws ...any)
	Group(prefix string, opts ...GroupOption) Router
}
```

The Gin adapter is responsible for converting `gin.Context` into `context.Context`, binding request parameters, calling the Go Boot Handler, handling responses, and mapping errors.

```text
HTTP Request
    ↓
Gin Engine
    ↓
Gin Adapter
    ↓
Go Boot Middleware Chain
    ↓
Business Handler(ctx, req)
    ↓
Response Encoder
```

This design avoids binding business code to Gin.

### 6.3 gRPC Abstraction

The gRPC layer should be based directly on gRPC-Go. gRPC documentation states that interceptors can implement common behavior across multiple RPC methods, such as logging, authentication, and metrics. Metadata can be used to pass authentication credentials, tracing information, and custom headers in RPC. Therefore, Go Boot should centrally manage the gRPC server, client, unary interceptor, stream interceptor, and metadata propagation.

```go
package grpc

type Server interface {
	Register(desc any, impl any)
	Start() error
	Stop() error
}

type ClientFactory interface {
	NewClient(target string, opts ...ClientOption) (any, error)
}
```

The gRPC entry chain is:

```text
gRPC Request
    ↓
gRPC-Go Server
    ↓
Unary / Stream Interceptor
    ↓
Go Boot Middleware Chain
    ↓
Business Service
    ↓
Error Mapper
```

## 7. Unified Middleware and Interceptor Design

HTTP middleware and gRPC interceptors have different forms, but the same semantics: execute cross-cutting logic before and after business handling. Go Boot should define a unified middleware model and then let different transport adapters convert it.

```go
package middleware

import "context"

type Handler func(ctx context.Context, req any) (any, error)

type Middleware func(next Handler) Handler

func Chain(mws ...Middleware) Middleware {
	return func(final Handler) Handler {
		for i := len(mws) - 1; i >= 0; i-- {
			final = mws[i](final)
		}
		return final
	}
}
```

Recommended default middleware order:

```text
1. RequestID
2. Metadata
3. Tracing
4. Metrics
5. AccessLog
6. Recovery
7. Timeout
8. RateLimit
9. CircuitBreaker
10. Auth
11. Validation
12. Handler
```

This order means: establish request identity and metadata first, then establish tracing and metrics; record access logs and protect against panics; then handle timeout, rate limiting, circuit breaking, authentication, and validation; finally enter business handling.

### 7.1 Selector Mechanism

Different APIs need different middleware strategies. For example, health check APIs should not execute complex authentication. Admin APIs need audit logs. External APIs need rate limiting and signatures. Internal gRPC calls need metadata and deadline propagation. Therefore, Go Boot should provide selectors.

```go
package middleware

type Operation struct {
	Transport string
	Service   string
	Method    string
	Path      string
	Tags      map[string]string
}

type Matcher func(op Operation) bool

type Selector struct {
	Match Matcher
	Use   []Middleware
}
```

Selectors can be used for:

```text
/healthz        -> skip auth, skip access audit
/admin/*        -> auth + audit + rate limit
/public/*       -> signature + rate limit
grpc internal   -> metadata + timeout + tracing
mq consumer     -> tracing + metrics + retry + dead letter
```

## 8. Error Model and Protocol Mapping

Go Boot should define a unified error object and then map it to HTTP status, gRPC status, and business error codes. The unified error model should include:

```text
code
message
reason
details
cause
retryable
http_status
grpc_status
```

Example structure:

```go
package errors

type Error struct {
	Code       string
	Message    string
	Reason     string
	Details    map[string]string
	Retryable  bool
	Cause      error
}
```

HTTP mapping example:

```text
INVALID_ARGUMENT -> 400
UNAUTHORIZED     -> 401
FORBIDDEN        -> 403
NOT_FOUND        -> 404
CONFLICT         -> 409
RATE_LIMITED     -> 429
INTERNAL         -> 500
UNAVAILABLE      -> 503
```

gRPC mapping example:

```text
INVALID_ARGUMENT -> codes.InvalidArgument
UNAUTHORIZED     -> codes.Unauthenticated
FORBIDDEN        -> codes.PermissionDenied
NOT_FOUND        -> codes.NotFound
CONFLICT         -> codes.Aborted
RATE_LIMITED     -> codes.ResourceExhausted
INTERNAL         -> codes.Internal
UNAVAILABLE      -> codes.Unavailable
```

A unified error model can ensure that HTTP, gRPC, MQ, and task scheduling share consistent error semantics.

## 9. Configuration and Lifecycle Design

### 9.1 Configuration Layer

Go Boot's configuration layer should support:

```text
file
environment variables
command line flags
remote config center
dynamic watch
typed binding
validation
```

Example configuration structure:

```yaml
app:
  name: user-service
  env: prod
  version: 1.0.0

server:
  http:
    addr: ":8080"
  grpc:
    addr: ":9090"

telemetry:
  otlp:
    endpoint: "otel-collector:4317"

redis:
  addr: "redis:6379"
```

The configuration loading order should be explicit. A common priority is:

```text
default config < file config < env variables < command line flags < remote override
```

### 9.2 Lifecycle Layer

Lifecycle management is used to manage the startup and shutdown of servers, clients, SDKs, and background workers. Go Boot should provide startup hooks and shutdown hooks:

```go
package lifecycle

import "context"

type Hook struct {
	OnStart func(context.Context) error
	OnStop  func(context.Context) error
}
```

Lifecycle order should be deterministic:

```text
Start:
1. load config
2. init logger
3. init telemetry
4. init starters
5. init transports
6. register services
7. start servers
8. register instance

Stop:
1. mark instance not ready
2. stop accepting new requests
3. drain in-flight requests
4. stop servers
5. close SDK clients
6. flush telemetry
7. close logger
```

## 10. SDK Adapter and Starter Package Design

SDK integration should not be written directly in business services, nor should it be placed into Go Boot Core. SDKs should enter the framework through a combination of `adapters` and `starter`.

Recommended structure:

```text
adapters/
├── otel/
│   ├── starter.go
│   ├── provider.go
│   ├── propagator.go
│   └── shutdown.go
├── gin/
│   ├── server.go
│   ├── router.go
│   └── middleware.go
├── grpcgo/
│   ├── server.go
│   ├── client.go
│   └── interceptor.go
├── redis/
│   ├── starter.go
│   ├── client.go
│   ├── health.go
│   └── metrics.go
├── mysql/
│   ├── starter.go
│   ├── db.go
│   ├── health.go
│   └── metrics.go
├── kafka/
│   ├── starter.go
│   ├── producer.go
│   ├── consumer.go
│   └── middleware.go
└── registry/
    ├── etcd/
    ├── consul/
    └── nacos/
```

Dependency direction:

```text
business service
      ↓
go boot interfaces
      ↓
starter / adapter
      ↓
third-party sdk
```

The core framework should not directly expose third-party SDK types as core interfaces; otherwise, the framework API will be bound to external SDK versions.

## 11. OpenTelemetry Full-Link Observability Design

OpenTelemetry documentation defines OTel as a vendor-neutral open source observability framework for instrumenting, generating, collecting, and exporting telemetry data, including traces, metrics, and logs. OpenTelemetry Go documentation states that the Go implementation is used to generate and collect metrics, logs, and traces. Go Boot should use OpenTelemetry as its default observability standard.

### 11.1 Context Propagation

The official Go `context` documentation states that Context is used to carry deadlines, cancellation signals, and request-scoped values across API boundaries and process boundaries. All Go Boot entry points and downstream calls must receive and propagate `context.Context`.

Propagation chain:

```text
HTTP Headers / gRPC Metadata / MQ Headers
        ↓
extract trace context + baggage + metadata
        ↓
context.Context
        ↓
middleware chain
        ↓
business handler
        ↓
inject into outgoing HTTP / gRPC / MQ
```

### 11.2 Trace Design

Go Boot should create or propagate spans at the following locations:

```text
HTTP server request
gRPC server request
HTTP client request
gRPC client request
SQL query
Redis command
Kafka produce
Kafka consume
background task
```

Entry spans should include:

```text
service.name
service.version
deployment.environment
http.method
http.route
rpc.service
rpc.method
net.peer.name
error.type
status.code
```

Business code should not manually pass trace ID strings. It should pass `context.Context`.

### 11.3 Metric Design

Go Boot should provide unified metrics:

```text
server_requests_total
server_request_duration_seconds
server_inflight_requests
server_errors_total
client_requests_total
client_request_duration_seconds
client_errors_total
db_client_duration_seconds
cache_client_duration_seconds
mq_consume_duration_seconds
mq_consume_lag
rate_limiter_dropped_total
circuit_breaker_state
```

Metric label cardinality must be controlled. Fields that can be used as labels include:

```text
service
env
zone
transport
method
route
status_code
error_code
```

Fields such as `user_id`, `order_id`, full URL, full SQL, and trace ID should not be used directly as metric labels.

### 11.4 Log Design

Official Go `slog` documentation states that structured logging uses key-value pairs for parsing, filtering, searching, and analysis. Go Boot log fields should be standardized as:

```text
timestamp
level
message
service.name
service.version
deployment.environment
trace_id
span_id
request_id
tenant_id
operation
http.method
http.route
rpc.service
rpc.method
status_code
error_code
latency_ms
caller
```

Access logs are generated uniformly by AccessLog middleware. Business logs use the framework logger to extract trace ID, span ID, request ID, and tenant ID from context.

### 11.5 Collector Deployment

OpenTelemetry Collector documentation states that the Collector provides a vendor-neutral implementation for receiving, processing, and exporting telemetry data, and reduces the need to run multiple agents or collectors. Go Boot should export to the Collector through OTLP by default, and the Collector can then forward data to Prometheus, Jaeger, Tempo, Loki, Elastic, or commercial backends.

Recommended chain:

```text
Go Boot Service
  ├── OTel TracerProvider
  ├── OTel MeterProvider
  └── OTel LoggerProvider
          ↓ OTLP/gRPC or OTLP/HTTP
OpenTelemetry Collector
  ├── receivers: otlp
  ├── processors: batch, memory_limiter, resource
  └── exporters: prometheus, otlp, jaeger, loki, elastic
          ↓
Observability Backend
```

Go Boot should not bind to a specific observability backend. It should bind to the OpenTelemetry API/SDK and the OTLP protocol.

## 12. Code Generation and Business Project Structure

Go Boot should provide a `goboot` CLI to generate projects, HTTP handlers, gRPC services, configuration templates, and starter templates.

Command examples:

```bash
goboot new user-service
goboot add http user
goboot add grpc user
goboot add starter redis
goboot gen
```

Generated business project structure:

```text
user-service/
├── cmd/
│   └── server/
│       └── main.go
├── api/
│   ├── http/
│   │   └── user.yaml
│   └── proto/
│       └── user.proto
├── configs/
│   ├── application.yaml
│   ├── application-dev.yaml
│   └── application-prod.yaml
├── internal/
│   ├── handler/
│   │   └── user_handler.go
│   ├── service/
│   │   └── user_service.go
│   ├── repository/
│   │   └── user_repo.go
│   ├── domain/
│   │   └── user.go
│   └── module/
│       └── module.go
└── go.mod
```

Business entry example:

```go
package main

import (
	"context"

	"github.com/acme/go-boot/boot"
	"github.com/acme/go-boot/adapters/gin"
	"github.com/acme/go-boot/adapters/grpcgo"
	"github.com/acme/go-boot/adapters/otel"
	"github.com/acme/go-boot/adapters/redis"

	"user-service/internal/module"
)

func main() {
	app := boot.New(
		boot.WithName("user-service"),
		boot.WithStarter(otel.Starter()),
		boot.WithStarter(redis.Starter()),
		boot.WithTransport(gin.HTTPServer()),
		boot.WithTransport(grpcgo.Server()),
	)

	app.Register(module.UserModule())

	if err := app.Run(context.Background()); err != nil {
		panic(err)
	}
}
```

This entry reflects Go Boot's design goal: business services do not repeatedly assemble HTTP server, gRPC server, OpenTelemetry, Redis, and lifecycle logic.

## 13. Implementation Roadmap

Go Boot can be implemented in four phases.

### 13.1 Phase 1: Boot Core

The first phase implements the minimum viable framework:

```text
App
Option
Module
Starter
Lifecycle
Config
Logger
Error
HTTP adapter
gRPC adapter
```

The goal is to complete unified startup and unified shutdown.

### 13.2 Phase 2: Unified Middleware

The second phase implements:

```text
Tracing
Metrics
AccessLog
Recovery
Timeout
RateLimit
Auth
Validation
Selector
```

The goal is to let HTTP and gRPC use the same middleware semantics.

### 13.3 Phase 3: Starter Ecosystem

The third phase implements:

```text
otel starter
redis starter
mysql starter
kafka starter
registry starter
config center starter
grpc client starter
http client starter
```

The goal is to remove infrastructure initialization and governance logic from business code.

### 13.4 Phase 4: Code Generation and Standardization

The fourth phase implements:

```text
goboot new
goboot add http
goboot add grpc
goboot add starter
goboot gen
```

The goal is to form a unified project structure, unified API templates, unified configuration templates, and unified test templates.

## 14. Conclusion

The goal of Go Boot is not to replace `net/http`, Gin, or gRPC-Go, but to form a Spring Boot-like engineering framework on top of mature foundations. Based on official documentation, the Go standard library already provides HTTP client/server capabilities, gRPC-Go already provides high-performance RPC, metadata, and interceptors, and OpenTelemetry already provides a vendor-neutral system for collecting and exporting traces, metrics, and logs. Therefore, Go Boot's core design should focus on unified bootstrap, unified configuration, unified lifecycle, unified middleware, unified error model, unified starters, unified SDK adapters, and a unified observability system.

For HTTP and gRPC selection, the first stage should use Gin + gRPC-Go. Gin acts as the HTTP adapter, and gRPC-Go acts as the RPC adapter. The business layer only depends on Go Boot's Router, Handler, Middleware, and Service abstractions. The framework core does not directly depend on specific SDKs; concrete implementations are injected through adapters and starters. This design can quickly form a usable framework while preserving the ability to replace the HTTP/RPC foundation in the future.

The OpenTelemetry-based observability system should be a foundational capability of Go Boot, not an optional add-on. All entry requests, downstream calls, database access, cache access, and message queue access should propagate trace context, baggage, and request metadata through `context.Context`, and export telemetry data to different backends through the Collector. With this structure, Go Boot can form a framework system that fits Go language characteristics, targets production microservice environments, and has extensibility and engineering consistency.

## References

[1] Spring Boot Reference Documentation.
[2] Official Go `net/http` documentation.
[3] Official Go `context` documentation.
[4] Official Go `log/slog` documentation.
[5] Go 1.4 Release Notes: internal packages.
[6] Gin official documentation.
[7] gRPC-Go official documentation.
[8] gRPC Interceptors official documentation.
[9] gRPC Metadata official documentation.
[10] gRPC Health Checking official documentation.
[11] OpenTelemetry official documentation.
[12] OpenTelemetry Go official documentation.
[13] OpenTelemetry Collector official documentation.
