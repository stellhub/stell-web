## Abstract

gRPC Java does not attach business methods directly to Netty `ChannelHandler`s. Instead, it builds a set of RPC-semantic abstractions on top of Netty, including **Stub, Channel, Transport, Stream, Call, Interceptor, Listener/Observer**. The core fact behind this design is that gRPC defines a "remote procedure call model based on an interface definition language", while Netty provides an "asynchronous event-driven network I/O model". The official grpc-java README divides the library into three layers: Stub, Channel, and Transport. The Transport layer is responsible for "putting and taking bytes off the wire", and the Netty-based HTTP/2 transport is the main transport implementation. ([GitHub][1])

Therefore, gRPC Java's goal in wrapping Netty is not to simplify Netty Handler programming. Its goal is to convert **HTTP/2 byte streams, frames, connections, flow control, headers/trailers, and DATA frames** into upper-level semantics such as **RPC methods, request messages, response messages, status codes, metadata, cancellation, deadlines, and streaming callbacks**. The official gRPC protocol documentation also shows that bidirectional gRPC message streams map to HTTP/2 streams; Call Header and Initial Metadata map to HTTP/2 headers; Payload Message is encoded as a length-prefixed gRPC frame and then split into HTTP/2 frames; Status and Trailing Metadata map to HTTP/2 trailers. ([GitHub][2])

---

## 1. Introduction

The foundation of gRPC is not an HTTP API style, but an RPC style. The official concept documentation explains that developers start from service definitions in `.proto` files. gRPC uses Protocol Buffer compiler plugins to generate client and server code. The client calls remote methods through local stubs; the server implements the corresponding service methods; the gRPC infrastructure decodes requests, executes service methods, and encodes responses. ([gRPC][3])

The public grpc-java API documentation further describes the basic Java model: gRPC is based on a client-server RPC model; a client creates a `Channel` connected to a server; RPCs are initiated by the client and answered by the server; both sides half-close after sending messages; the RPC completes when the server closes. The client usually calls the server through a generated stub, while the server exposes service implementations through `ServerBuilder`. ([grpc.github.io][4])

This leads to a factual structural conclusion: **the core object in gRPC Java is not the Netty Channel, but the RPC Call; the Netty Channel is only the lower-level I/O carrier of one Transport implementation.**

---

## 2. Basic Design Principles of gRPC

### 2.1 Interface First: `.proto` Is the Service Contract

The official gRPC concept documentation explains that developers use a language-neutral RPC service description, and gRPC generates client and server interfaces. The server implements the interface, and the client invokes the remote service through the corresponding interface. By default, gRPC uses Protocol Buffers as the IDL for describing service interfaces and message structures. ([GitHub][2])

This determines that grpc-java's upper-level abstractions must revolve around `MethodDescriptor`, Stub, Marshaller, and ServiceDescriptor rather than Netty byte buffers. Netty knows bytes, events, connections, and pipelines; gRPC needs to know "which service, which method, request type, response type, call type, metadata, and status code".

### 2.2 RPC Lifecycle: One Call Is a Bidirectional Message Stream

The official gRPC CONCEPTS document defines a gRPC call as a bidirectional message stream initiated by the client. The client-to-server direction contains a mandatory `Call Header`, optional `Initial-Metadata`, and zero or more `Payload Messages`; the server-to-client direction contains optional `Initial-Metadata`, zero or more `Payload Messages`, and ends with mandatory `Status` plus optional `Status-Metadata`. ([GitHub][2])

This is why gRPC Java uses many callback/listener/observer APIs internally. An RPC is not always a synchronous "request -> response" function call. It can be unary, server streaming, client streaming, or bidirectional streaming. The official documentation explains that in bidirectional streaming RPCs, the client stream and server stream are independent, and both sides can read and write messages in any order. ([gRPC][3])

### 2.3 HTTP/2 Is the Transport Mapping, Not the Business API

The official gRPC protocol documentation explains that the abstract gRPC protocol is concretely carried by HTTP/2: gRPC bidirectional streams map to HTTP/2 streams; headers are compressed with HPACK; payload messages are serialized as length-prefixed gRPC frames and then split into HTTP/2 frames; status and trailing metadata are sent through HTTP/2 trailing headers. ([GitHub][2])

The HTTP/2 protocol layer supports multiplexing, header compression, flow control, and related capabilities. The HTTP/2 RFC states that HTTP/2 uses header field compression and allows multiple concurrent exchanges on the same connection to use network resources more efficiently and reduce perceived latency. ([IETF HTTP Working Group][5])

Therefore, the Netty-based grpc-java wrapper must handle:

| gRPC abstraction | HTTP/2/Netty counterpart |
| --- | --- |
| RPC Call | HTTP/2 stream |
| Metadata | HTTP/2 headers / trailers |
| Request / Response message | Length-prefixed gRPC message over DATA frames |
| Status | `grpc-status` trailer |
| Deadline / cancellation | gRPC call control + HTTP/2 stream control |
| Flow control | HTTP/2 flow control |
| Interceptor | RPC call-chain extension point |
| Netty Handler | I/O events, HTTP/2 frames, connection-level handling |

---

## 3. grpc-java's Three-Layer Model

The official grpc-java README divides the library into three layers: Stub, Channel, and Transport. The Stub layer is intended for most developers and provides type-safe bindings. The Channel layer is an abstraction above Transport handling, suitable for interception and decoration, and exposes more behavior than Stub. The Transport layer performs network byte sending and receiving, and its interfaces are abstracted enough to allow different pluggable implementations. ([GitHub][1])

### 3.1 Stub Layer

Stub is the main entry point for business developers. The Java basics documentation explains that Java clients can create blocking/synchronous stubs or non-blocking/asynchronous stubs; asynchronous stubs return responses asynchronously, and some streaming calls can only be used through asynchronous stubs. ([gRPC][6])

The `io.grpc.stub` package documentation explains that client stub classes are implementations of `AbstractStub`, and RPC methods internally use `ClientCalls` to interact with the call layer. Asynchronous stub RPC methods receive a `StreamObserver responseObserver`; for client-streaming or bidirectional-streaming calls, they also return a `requestObserver`. ([grpc.github.io][7])

### 3.2 Channel Layer

Channel is the client-side abstraction of a remote endpoint. The grpc-java Javadoc states that a client creates a `Channel`, generated stubs wrap that channel, and stubs are the primary way for clients to interact with servers. ([grpc.github.io][4])

The Channel layer is suitable for decoration and interception. The grpc-java README explicitly says that the Channel layer is suitable for application frameworks to handle cross-cutting concerns such as logging, monitoring, and auth. ([GitHub][1])

### 3.3 Transport Layer

The Transport layer is responsible for the actual byte sending and receiving. The grpc-java README explicitly states that the Transport layer "does the heavy lifting of putting and taking bytes off the wire", and that the Transport API belongs to gRPC internal APIs, whose API stability is weaker than the `io.grpc` core API. ([GitHub][1])

An older grpc-java README also explicitly states that Transport is modeled as `Stream` factories; the difference between server stream and client stream interfaces encodes their different semantics around cancellation and error reporting. ([android.googlesource.com][8])

This explains why grpc-java does not directly expose Netty Handlers: Transport must be pluggable. The transports listed in the official README include Netty, OkHttp, in-process, Binder, and others. Netty is only one implementation. ([GitHub][1])

---

## 4. Main Netty-Based Abstractions in gRPC Java

### 4.1 Netty Transport: The Main HTTP/2 Transport Implementation

The grpc-java README explicitly states that the Netty-based HTTP/2 transport is the main transport implementation based on Netty. `grpc-netty-shaded` is usually preferred over using the direct Netty transport, because it reduces dependency management work and makes upgrades easier. ([GitHub][1])

This shows that grpc-java's wrapping of Netty mainly happens at the Transport layer, not at the Stub or Channel layer. Application code usually does not see the Netty pipeline. It sees `ManagedChannel`, Stub, `ServerBuilder`, `StreamObserver`, `ClientInterceptor`, and `ServerInterceptor`.

### 4.2 Netty Channel / Pipeline / Handler Are Internal Transport Mechanisms

The official Netty `ChannelPipeline` Javadoc explains that `ChannelPipeline` is a list of `ChannelHandler`s used to handle or intercept inbound events and outbound operations of a `Channel`. Each Channel automatically creates its own pipeline. I/O events are handled by inbound or outbound handlers and propagated to adjacent handlers through methods such as `ChannelHandlerContext.fireChannelRead` and `write`. ([netty.io][9])

grpc-java's Netty implementation uses these Handlers as internal HTTP/2 transport event processing mechanisms. grpc-java source search results show that `NettyClientHandler` is the client-side Netty handler for GRPC processing, and notes that all event handlers execute in the Netty Channel thread context. ([GitHub][10]) `NettyServerHandler` is similarly described as the server-side Netty handler for GRPC processing, with all event handlers also running in the Netty Channel thread context. ([GitHub][11])

This forms two callback layers:

```text
Business-layer callbacks:
  StreamObserver / ClientCall.Listener / ServerCall.Listener

gRPC Transport layer:
  ClientStream / ServerStream / TransportState / WriteQueue

Netty I/O layer:
  ChannelPipeline / ChannelHandler / EventLoop / ByteBuf / HTTP/2 frame
```

### 4.3 Wrapping HTTP/2 Headers into gRPC Metadata and Methods

`NettyServerHandler` source snippets show that after the server receives headers, it checks path, content-type, and HTTP method. The path is stripped of the leading `/` to obtain the fully qualified method name. Headers are converted into `Metadata`; then `StatsTraceContext`, `NettyServerStream.TransportState`, and `NettyServerStream` are created. ([android.googlesource.com][12])

This means the Netty layer sees HTTP/2 headers:

```text
:path: /package.Service/Method
:method: POST
content-type: application/grpc
te: trailers
custom metadata...
```

The corresponding gRPC semantics are:

```text
method = package.Service/Method
metadata = Metadata
stream = ServerStream
call = ServerCall
handler = ServerCallHandler
service method invocation
```

---

## 5. Relationship between Interceptor and Netty Handler

### 5.1 Both Look Like Interception Chains, but They Belong to Different Layers

Netty `ChannelPipeline` is a `ChannelHandler` chain for handling inbound events and outbound operations of a Channel. ([netty.io][9]) gRPC Interceptor is an extension point at the RPC call layer. The official gRPC Interceptors documentation explains that Interceptors are suitable for generic functionality that is independent of specific RPC methods and applies to all or most RPCs, such as metadata handling, logging, fault injection, caching, metrics, policy enforcement, server-side authentication, and server-side authorization. ([gRPC][13])

Their relationship is:

| Comparison item | gRPC Interceptor | Netty ChannelHandler |
| --- | --- | --- |
| Layer | gRPC Call / Channel / ServerCall layer | Netty I/O / ChannelPipeline layer |
| Processing object | RPC method, Metadata, CallOptions, ServerCall, ClientCall, messages, Status | ByteBuf, HTTP/2 frame, Channel event, write/read/flush |
| Typical use | Auth, logging, metrics, metadata, policy, request/response rewriting | Codec, TLS, HTTP/2 frame, connection events, backpressure, flush |
| Lifecycle granularity | Per-call | Per-channel / per-connection |
| Suitable for managing TCP/TLS | No | Yes |
| Oriented to business RPC semantics | Yes | No, unless conversion has already happened inside the transport |

The official gRPC Interceptors documentation explicitly states that interceptors are per-call. They are not suited to managing TCP connections, configuring TCP ports, or configuring TLS. ([gRPC][13])

Therefore, **a gRPC Interceptor is not a replacement for a Netty Handler, nor is it a simple wrapper around a Netty Handler. It is an RPC interceptor located on top of the Channel/ServerCall abstraction.**

### 5.2 Position of ClientInterceptor

The `ClientInterceptor` Javadoc states that it intercepts outgoing calls before they are dispatched by a `Channel`. Implementations can add cross-cutting behavior to Channels and stubs, such as logging/monitoring, adding metadata, and request/response rewriting. ([grpc.github.io][14])

The client path can be abstracted as:

```text
Generated Stub
  -> ClientCalls
    -> ClientInterceptor chain
      -> Channel.newCall(method, callOptions)
        -> ClientCall
          -> ClientTransport.newStream(...)
            -> NettyClientStream
              -> NettyClientHandler
                -> HTTP/2 HEADERS/DATA frames
```

An Interceptor sees `MethodDescriptor`, `CallOptions`, `Metadata`, and `ClientCall`. A Netty Handler sees HTTP/2 headers/data/trailers frames and channel events.

### 5.3 Position of ServerInterceptor

The `ServerInterceptor` Javadoc states that it intercepts incoming calls before they are dispatched by `ServerCallHandler`. Implementations can add cross-cutting behavior to server-side calls, such as enforcing authentication credentials, logging/monitoring, and delegating calls. ([grpc.github.io][15])

The server path can be abstracted as:

```text
Socket / TCP
  -> Netty EventLoop
    -> Netty ChannelPipeline
      -> NettyServerHandler
        -> HTTP/2 headers/data/trailers parsing
          -> ServerTransportListener.streamCreated(...)
            -> ServerCall
              -> ServerInterceptor chain
                -> ServerCallHandler.startCall(...)
                  -> Generated service implementation
                    -> StreamObserver.onNext/onCompleted/onError
```

---

## 6. Why gRPC Java Uses Many callback/listener/observer APIs

### 6.1 The Network Is Asynchronous, while the RPC Model Supports Both Sync and Async

The gRPC CONCEPTS documentation explains that synchronous RPC is closest to the procedure-call abstraction that RPC aims for. But networks are inherently asynchronous, and in many scenarios it is useful to start an RPC without blocking the current thread. In most languages, gRPC provides both synchronous and asynchronous forms. ([GitHub][2])

This explains the basic reason multiple callback interfaces exist in grpc-java: **the lower-level I/O is asynchronous, and RPC semantics also support streaming messages, so the API needs to express events such as receiving headers, messages, completion status, and readiness to send more at some future time.**

### 6.2 ClientCall.Listener Represents Client Receive Events

The `ClientCall.Listener` Javadoc states that it is a callback object for receiving server metadata, response messages, and completion status. Its methods include `onHeaders`, `onMessage`, `onClose`, and `onReady`. `onMessage` may be called zero or more times, depending on whether the response is empty, single-message, or streaming; `onReady` indicates that the `ClientCall` may be able to send more messages without excessive internal buffering. ([grpc.github.io][16])

This corresponds to the HTTP/2/gRPC receive direction:

```text
HTTP/2 response HEADERS
  -> ClientCall.Listener.onHeaders(metadata)

HTTP/2 DATA frames -> gRPC message deframe -> RespT
  -> ClientCall.Listener.onMessage(response)

HTTP/2 trailing HEADERS with grpc-status
  -> ClientCall.Listener.onClose(status, trailers)

HTTP/2 flow-control writable / buffer state
  -> ClientCall.Listener.onReady()
```

### 6.3 StreamObserver Represents Application-Level Streaming Send and Receive

The `io.grpc.stub` package documentation states that asynchronous stub methods receive a `StreamObserver responseObserver`; client-streaming or bidirectional-streaming methods return a `requestObserver`. ([grpc.github.io][7])

Therefore, `StreamObserver` is an abstraction closer to the user API than `ClientCall.Listener`. It can be understood as:

```text
Application API:
  StreamObserver<RespT>.onNext(response)
  StreamObserver<RespT>.onError(error)
  StreamObserver<RespT>.onCompleted()

Call layer:
  ClientCall.Listener.onMessage(...)
  ClientCall.Listener.onClose(...)

Transport layer:
  ClientStreamListener
  ServerStreamListener

Netty layer:
  ChannelInboundHandler.channelRead(...)
  HTTP/2 frame listener
```

### 6.4 The Number of Callbacks Comes from the Four RPC Shapes

The official gRPC core concepts documentation lists four RPC types: unary, server streaming, client streaming, and bidirectional streaming. Server-streaming RPC maps one request to a response stream; client-streaming RPC maps a request stream to one response; in bidirectional streaming RPCs, the two streams are independent and both sides can read and write messages in any order. ([gRPC][3])

This means the Java API cannot express all cases with a single synchronous return value. It must express:

```text
headers received
0..N messages received
0..N messages sent
local half close
remote half close
trailers/status received
cancellation
deadline exceeded
flow-control readiness
exception
```

So callback/listener/observer APIs are not decorative design. They are the direct mapping of asynchronous streaming RPC semantics.

---

## 7. Internal Execution Flow of a Unary RPC

The following flow describes the abstract path for grpc-java with Netty transport.

### 7.1 Client Starts the Call

```text
1. User calls a generated blocking/async/future stub method
2. Stub locates the RPC method definition through the MethodDescriptor generated from proto
3. Stub creates a ClientCall through ClientCalls
4. ClientInterceptor chain intercepts the outgoing call before Channel dispatch
5. ManagedChannel selects a transport through name resolver / load balancer / subchannel
6. ClientTransport creates a ClientStream
7. NettyClientStream writes metadata and request message into the transport
8. NettyClientHandler writes HTTP/2 HEADERS and DATA in the Netty EventLoop
```

The official `ClientInterceptor` Javadoc supports step 4: it intercepts outgoing calls before they are dispatched by Channel. ([grpc.github.io][14]) The grpc-java README supports the layering facts in steps 5-8: Channel sits above Transport, Transport is responsible for byte I/O, and Netty transport is the main HTTP/2 transport. ([GitHub][1])

### 7.2 Network Transfer

```text
HTTP/2 HEADERS:
  :method = POST
  :path = /package.Service/Method
  content-type = application/grpc
  te = trailers
  custom metadata...

HTTP/2 DATA:
  gRPC length-prefixed message bytes

HTTP/2 END_STREAM:
  After sending a unary request, the client half-closes
```

The gRPC protocol documentation states that payload messages are serialized as length-prefixed gRPC frames and carried by HTTP/2 frames. The client uses the `END_STREAM` flag on the last DATA frame to indicate the end of its message stream. ([GitHub][2])

### 7.3 Server Receives and Dispatches

```text
1. Netty EventLoop reads socket data
2. Netty HTTP/2 codec parses HEADERS/DATA frames
3. NettyServerHandler validates path / content-type / method
4. Headers are converted into gRPC Metadata
5. ServerStream / TransportState is created
6. gRPC Server transport creates ServerCall
7. ServerInterceptor chain executes
8. ServerCallHandler.startCall dispatches to the generated service method
9. Business implementation reads request and writes response
```

`NettyServerHandler` source snippets show that it validates path, content-type, and method, converts headers into `Metadata`, and then creates `NettyServerStream.TransportState` and `NettyServerStream`. ([android.googlesource.com][12]) The `ServerInterceptor` Javadoc supports step 7: it intercepts incoming calls before they are dispatched by `ServerCallHandler`. ([grpc.github.io][15])

### 7.4 Server Responds

```text
1. Service implementation calls responseObserver.onNext(response)
2. gRPC marshals the response message into bytes
3. NettyServerStream writes HTTP/2 response DATA
4. Service implementation calls responseObserver.onCompleted()
5. gRPC writes trailers containing grpc-status
6. HTTP/2 trailing HEADERS carries END_STREAM
```

The gRPC over HTTP/2 protocol specifies that a response contains Response-Headers, zero or more length-prefixed messages, and Trailers. `grpc-status` must be sent in Trailers, even when the status is OK. ([GitHub][17])

### 7.5 Client Completes the Call

```text
1. NettyClientHandler receives response HEADERS
2. They are converted into Metadata, triggering ClientCall.Listener.onHeaders
3. DATA frames are received, deframed, and unmarshaled into RespT
4. ClientCall.Listener.onMessage is triggered
5. Trailers are received and grpc-status is parsed
6. ClientCall.Listener.onClose is triggered
7. Async stub maps this into StreamObserver.onNext/onCompleted/onError
8. Blocking stub waits for the result and returns or throws
```

The `ClientCall.Listener` Javadoc clearly states that `onHeaders` indicates response headers have been received, `onMessage` indicates a response message has been received, and `onClose` indicates the call has been closed with status and trailers. ([grpc.github.io][16])

---

## 8. Internal Execution Flow of a Bidirectional Streaming RPC

The fundamental difference between bidirectional streaming RPC and unary RPC is that both the request direction and response direction allow 0..N messages, and the two streams are independent. The official documentation explains that in bidirectional streaming RPCs, client-side and server-side stream processing is application-specific. The two streams are independent, so clients and servers can read and write in any order. ([gRPC][3])

Its execution model is:

```text
Client:
  requestObserver = asyncStub.bidiCall(responseObserver)

Send direction:
  requestObserver.onNext(req1)
    -> ClientCall.sendMessage
      -> ClientStream.writeMessage
        -> Netty write DATA

  requestObserver.onNext(req2)
    -> Netty write DATA

  requestObserver.onCompleted()
    -> ClientCall.halfClose
      -> HTTP/2 END_STREAM on client-to-server direction

Receive direction:
  Netty read DATA
    -> ClientCall.Listener.onMessage
      -> responseObserver.onNext(respN)

  Netty read trailers
    -> ClientCall.Listener.onClose
      -> responseObserver.onCompleted/onError
```

The server has a similar structure:

```text
Server method parameter:
  StreamObserver<ResponseT> responseObserver

Server method return value:
  StreamObserver<RequestT> requestObserver

Receive request:
  requestObserver.onNext(reqN)

Send response:
  responseObserver.onNext(respN)

Completion:
  requestObserver.onCompleted()
  responseObserver.onCompleted()
```

This shows that the bidirectional presence of `StreamObserver` is not accidental. It is the Java API expression of two independent bidirectional message streams.

---

## 9. Why gRPC Java Does Not Let Business Code Use Netty Handler Directly

Based on the official sources above, four reasons can be derived from the factual relationships.

### 9.1 gRPC Needs Cross-Language Consistent RPC Semantics

The official gRPC documentation states that developers start from language-neutral service definitions, and gRPC generates clients and server interfaces in different languages. ([GitHub][2]) If Java business code directly depended on Netty Handler, the Java implementation would expose transport-layer details and break gRPC's cross-language interface model.

### 9.2 gRPC Transport Is Pluggable

The grpc-java README explicitly lists multiple transports: Netty, OkHttp, in-process, and Binder. ([GitHub][1]) If the application layer directly binds to Netty Handler, the same Stub/Channel API cannot keep working across different Transports.

### 9.3 Netty Handler Processes I/O Events, Not RPC Semantics

Netty `ChannelPipeline` handles inbound/outbound I/O events and operations. ([netty.io][9]) gRPC Interceptor handles per-call generic RPC logic, and the official documentation explicitly says interceptors are not suited to managing TCP connections, TCP ports, or TLS. ([gRPC][13])

Therefore, their boundary is clear:

```text
Netty Handler:
  connection-level / frame-level / byte-level / I/O-event-level

gRPC Interceptor:
  call-level / method-level / Metadata / Status / Message-level
```

### 9.4 gRPC Completion Status Depends on Trailers, Not a Normal HTTP Response Body

The gRPC over HTTP/2 protocol specifies that `grpc-status` is sent in trailers, and even OK status must be sent in trailers. ([GitHub][17]) This means "response DATA has been received" is not equivalent to "the RPC completed successfully". gRPC Java must combine response headers, messages, trailers, and status into a complete RPC lifecycle at the transport layer, and then trigger `onClose` upward.

---

## 10. Conclusion

gRPC Java's Netty-based wrapping can be summarized as:

```text
Netty provides asynchronous I/O and HTTP/2 frame processing;
grpc-java Transport converts HTTP/2 frames into gRPC streams;
Channel abstracts transport streams into RPC calls;
Stub abstracts RPC calls into type-safe Java methods;
Interceptor provides cross-cutting extensions at the call level;
Listener/Observer uses callbacks to express asynchronous, streaming, completion, and flow-control events.
```

More precisely, gRPC Java is not "using Netty Handler to implement business RPC". It is "using Netty to implement an HTTP/2 Transport, and then implementing gRPC call/stream/status/metadata/stub/interceptor semantics on top of that Transport". This is also the essential difference between Interceptor and Netty Handler: **Interceptor belongs to the RPC call chain, while Handler belongs to the network I/O event chain.**

For Java engineering practice, the boundary should be very clear:

```text
Authentication, tenant, traceId, metrics, logging, rate-limit policy, metadata handling:
  Use gRPC Interceptor

Connection parameters, TLS, HTTP/2 keepalive, frames, ByteBuf, EventLoop, pipeline:
  Belong to Netty transport / builder configuration

Business request/response:
  Use generated Stub + StreamObserver

Do not push business RPC semantics down into Netty Handler;
do not use Interceptor to solve TCP/TLS/HTTP2 frame-level problems.
```

[1]: https://github.com/grpc/grpc-java "GitHub - grpc/grpc-java: The Java gRPC implementation. HTTP/2 based RPC"
[2]: https://github.com/grpc/grpc/blob/master/CONCEPTS.md "grpc/CONCEPTS.md at master"
[3]: https://grpc.io/docs/what-is-grpc/core-concepts/?utm_source=chatgpt.com "Core concepts, architecture and lifecycle"
[4]: https://grpc.github.io/grpc-java/javadoc/io/grpc/package-summary.html "io.grpc (grpc-all 1.81.0 API)"
[5]: https://httpwg.org/specs/rfc7540.html?utm_source=chatgpt.com "RFC 7540 - Hypertext Transfer Protocol Version 2 (HTTP/2)"
[6]: https://grpc.io/docs/languages/java/basics/?utm_source=chatgpt.com "Basics tutorial | Java"
[7]: https://grpc.github.io/grpc-java/javadoc/io/grpc/stub/package-summary.html?utm_source=chatgpt.com "Package io.grpc.stub"
[8]: https://android.googlesource.com/platform/external/grpc-grpc-java/%2B/b9d1bb8b8badaea5bbf5da74ab4b552ffde29524/README.md "gRPC-Java - An RPC library and framework"
[9]: https://netty.io/4.0/api/io/netty/channel/ChannelPipeline.html "ChannelPipeline (Netty API Reference (4.0.56.Final))"
[10]: https://github.com/grpc/grpc-java/blob/master/netty/src/main/java/io/grpc/netty/NettyClientHandler.java?utm_source=chatgpt.com "NettyClientHandler.java"
[11]: https://github.com/grpc/grpc-java/blob/master/netty/src/main/java/io/grpc/netty/NettyServerHandler.java?utm_source=chatgpt.com "NettyServerHandler.java"
[12]: https://android.googlesource.com/platform/external/grpc-grpc-java/%2B/4d84fe10a43381259238fa11d5fa04d35647e5e7/netty/src/main/java/io/grpc/netty/NettyServerHandler.java?utm_source=chatgpt.com "netty/src/main/java/io/grpc/netty/NettyServerHandler.java"
[13]: https://grpc.io/docs/guides/interceptors/ "Interceptors | gRPC"
[14]: https://grpc.github.io/grpc-java/javadoc/io/grpc/ClientInterceptor.html "ClientInterceptor (grpc-all 1.81.0 API)"
[15]: https://grpc.github.io/grpc-java/javadoc/io/grpc/ServerInterceptor.html "ServerInterceptor (grpc-all 1.81.0 API)"
[16]: https://grpc.github.io/grpc-java/javadoc/io/grpc/ClientCall.Listener.html "ClientCall.Listener (grpc-all 1.81.0 API)"
[17]: https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md "grpc/doc/PROTOCOL-HTTP2.md at master"
