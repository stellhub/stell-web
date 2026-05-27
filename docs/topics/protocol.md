---
title: "Custom Application Protocols over TCP: Kafka, Redis, and MySQL as Case Studies"
category: "Network Protocols"
summary: "Using Kafka, Redis, and MySQL as examples, this article explains why infrastructure systems design custom application protocols on top of TCP and what that buys them in performance, semantics, and long-term evolution."
tags:
  - "TCP"
  - "Custom Protocol"
  - "Kafka"
  - "Redis"
  - "MySQL"
  - "gRPC"
readingDirection: "Read this when evaluating transport choices for infrastructure software, comparing HTTP or gRPC with custom protocols, or designing a high-performance middleware wire protocol."
outline: deep
---

# Custom Application Protocols over TCP: Kafka, Redis, and MySQL as Case Studies

## Overview

Using Kafka, Redis, and MySQL as examples, this article explains why infrastructure systems design custom application protocols on top of TCP and what that buys them in performance, semantics, and long-term evolution.

## Abstract

In high-performance middleware, databases, message queues, and cache systems, many products do not use HTTP, REST, or gRPC as their internal communication protocol. Instead, they define their own application protocol on top of TCP. Strictly speaking, this is not a "custom TCP protocol." It is a **custom application protocol built over TCP**. TCP provides reliable, ordered, connection-oriented byte-stream transport, while systems such as Kafka, Redis, and MySQL define their own message framing, request-response model, command semantics, version negotiation, error codes, batch transfer rules, authentication flow, and extension points on top of that byte stream.

The central argument of this article is: **a custom application protocol over TCP is not an exercise in cleverness. It is a way to bind the network protocol tightly to the system's data model, performance goals, and evolution strategy.** For infrastructure software such as Kafka, Redis, and MySQL, HTTP and gRPC are mature and powerful, but they still carry generic RPC or Web semantics. Message queues, caches, and databases often need a communication model that maps more directly to their own domain concepts. That is where custom protocols show their value: lower protocol overhead, faster parsing, better support for batching and pipelining, clearer domain semantics, more control over connection lifecycle, finer-grained compatibility management, and more stable long-term evolution for multi-language clients.

**Keywords:** TCP, custom protocol, Kafka Protocol, Redis RESP, MySQL Protocol, HTTP, gRPC, binary protocol, application protocol

---

## 1. Concept Clarification: This Is Not Custom TCP, but a Custom Application Protocol over TCP

Engineers often say "custom TCP protocol," but that phrase is imprecise. TCP is a transport-layer protocol. It provides a reliable byte stream, but it does not understand concepts such as "request," "response," "command," "SQL," "message," "partition," or "offset." What gets customized in practice is the **application-layer protocol that runs on top of TCP**.

In other words, system designers usually do not modify TCP itself. They define elements such as:

```text
TCP connection
  ↓
application message boundary
  ↓
protocol header
  ↓
request type / command type
  ↓
sequence number / correlation id
  ↓
protocol version
  ↓
authentication metadata
  ↓
business payload
  ↓
error code / response structure
```

For example, the official Kafka protocol documentation explicitly describes Kafka as a **binary protocol over TCP**. All APIs are defined as request-response message pairs, and each message carries an explicit length boundary. A Kafka client opens a socket connection, writes requests continuously, and reads the corresponding responses. Kafka also emphasizes long-lived TCP connections so the handshake cost is amortized. ([Apache Kafka][1])

So when this article discusses a "custom TCP protocol," what it really means is:

> design an application-layer protocol on top of TCP that is optimized for the semantics of a specific system

This distinction matters. If the problem is misunderstood as "reinvent TCP," the design direction is already wrong. The real engineering value lies in **defining a data exchange model above TCP that matches the needs of the target system**.

---

## 2. Why Build a Custom Application Protocol over TCP?

My judgment is that **a custom protocol becomes reasonable only when the abstraction cost of a general-purpose protocol starts to hurt the system's primary goals**. For most ordinary business systems, HTTP or gRPC is good enough. But for infrastructure software such as Kafka, Redis, and MySQL, a custom protocol is often the natural choice.

### 2.1 To Reduce Protocol Overhead

HTTP was designed for Web resource access. It naturally carries semantics such as method, path, headers, status code, content type, cookie, and cache control. gRPC is far better than REST for service-to-service communication, but it still runs on top of HTTP/2. The gRPC protocol specification explains that request headers are transmitted through HTTP/2 `HEADERS` and `CONTINUATION` frames and include fields such as `:method`, `:scheme`, `:path`, `content-type`, `grpc-timeout`, and `grpc-encoding`. ([grpc.github.io][2])

These mechanisms are powerful, but many of those fields are not the core concern for Kafka, Redis, or MySQL.

When Kafka produces data, what actually matters is:

```text
topic
partition
acks
timeout
record batch
compression
producer id
sequence number
transaction marker
```

When Redis executes a command, what matters is:

```text
command
key
arguments
reply type
pipeline order
push message
```

When MySQL serves a query, what matters is:

```text
handshake
capability flags
authentication
command type
SQL payload
result set
column metadata
row data
OK packet
ERR packet
```

These domain concepts can be expressed through HTTP, but that introduces an extra translation layer:

```text
Kafka ProduceRequest -> HTTP POST /produce
Redis GET key       -> HTTP GET /redis/key
MySQL query         -> HTTP POST /query
```

That may be acceptable for a business-facing gateway, but for infrastructure software it is unnecessary. A custom protocol can model the domain objects directly and eliminate irrelevant fields, irrelevant parsing work, and irrelevant abstractions.

---

### 2.2 To Gain Stable, Explicit, Low-Cost Message Framing

TCP is a byte-stream protocol. It does not preserve message boundaries. That means the application protocol must solve problems such as:

```text
what if one read() returns only half a message?
what if one read() returns several messages together?
how large is the payload?
how do we know where one message ends?
```

The common patterns are:

```text
1. fixed-length header + payload length
2. delimiter-based framing such as CRLF
3. TLV / VarInt / frame-based encoding
```

Kafka uses a length-delimited binary protocol. The Kafka documentation states that every message is size-delimited and built from a set of primitive types. Even the `BYTES` type is encoded as a length followed by raw bytes. ([Apache Kafka][1])

Redis RESP is another classic example. RESP uses the first byte to indicate the data type, and a bulk string is encoded as `$<length>\r\n<data>\r\n`. The official Redis documentation explains that RESP uses length prefixes for bulk data, which avoids scanning payloads for special characters and avoids escape processing. ([Redis][3])

MySQL also uses a clearly defined packet structure. The MySQL packet documentation states that client and server exchange data as packets, and each packet header includes a 3-byte payload length and a 1-byte sequence id, with a maximum payload of 16 MB. ([MySQL Developer Zone][4])

This is one of the main advantages of a custom protocol:

> you can design message boundaries to fit your own data model and I/O model

---

### 2.3 To Let the Protocol Directly Serve the Core Domain Model

HTTP and gRPC are powerful because they are general, but that also means they do not naturally understand the domain model of a particular infrastructure system.

Kafka is not fundamentally about "calling a remote method." It is about:

```text
topic
partition
replica
leader broker
offset
record batch
consumer group
fetch position
transaction
idempotent producer
metadata discovery
```

Kafka's protocol directly embeds those concepts into its requests and responses. The Kafka documentation explains that a client must find the leader broker for a given topic partition. If the request goes to the wrong broker, the client gets a `NotLeaderForPartition` error. Clients obtain cluster, topic, partition, leader, and broker host or port information through the metadata API. ([Apache Kafka][1])

That is not ordinary RPC semantics. It is the protocol surface of a distributed log system.

Redis follows the same principle. RESP is not a generic JSON transport. It is built around the Redis command model: the client sends an array of bulk strings, where the first bulk string is usually the command name and the rest are arguments, and the server replies with a RESP value. ([Redis][3])

MySQL makes this even more obvious. The MySQL protocol is not just "call executeSQL remotely." It models the lifecycle of a database connection: server greeting, client response, authentication, capability negotiation, command phase, query response, result set, error packet, and OK packet. The packet documentation describes the packet header and sequence id, while the HandshakeV10 documentation describes SSL capability, `SSLRequest`, `HandshakeResponse`, and related connection-phase behavior. ([MySQL Developer Zone][4]) ([MySQL Developer Zone][5])

The key observation is:

> the greatest value of a custom protocol is not simply that it is faster; it is that the protocol itself becomes part of the system model

---

## 3. When Should You Build a Custom Application Protocol over TCP?

My view is that a custom protocol is justified only in a limited set of scenarios. Otherwise, HTTP or gRPC is usually the safer choice.

### 3.1 High-Throughput, Low-Latency, Long-Lived Connection Systems

Typical examples include:

```text
message queues: Kafka, Pulsar, RocketMQ
cache systems: Redis, Memcached
databases: MySQL, PostgreSQL
RPC frameworks: Dubbo, Thrift, internal RPC stacks
service-mesh data planes
real-time push systems
gateways and edge proxies
game servers
market data systems
```

These systems usually share several characteristics:

```text
very frequent requests
long-lived connections
stable payload structure
protocol parsing cost is sensitive
many clients
the server needs tight control over memory and I/O
batching, pipelining, or asynchronous response is required
```

If a system handles only a few tens of thousands of calls per day, the protocol overhead of HTTP or gRPC is rarely the main problem. But if a broker, cache node, or database node processes hundreds of thousands or millions of requests per second, then every additional header parse, object allocation, or generic abstraction becomes a real cost.

---

### 3.2 The Protocol Must Encode Domain Semantics Deeply

If your communication model naturally includes concepts such as the following, a custom protocol becomes much more attractive:

```text
partition
offset
cursor
sequence id
transaction marker
batched records
streaming fetch
subscription push
authentication plugins
capability negotiation
custom error codes
compression marker
idempotency marker
retry semantics
```

Kafka is the classic case. It is not generic RPC. It needs to express produce, fetch, metadata, offset, group, transaction, and API version semantics as a cohesive message-queue model. The Kafka documentation also emphasizes batching: both produce and fetch APIs operate on groups of messages rather than single messages, and a single produce or fetch request may span multiple topics and partitions. ([Apache Kafka][1])

If HTTP is forced onto that model, the result becomes awkward:

```http
POST /topics/{topic}/partitions/{partition}/records
POST /consumer-groups/{group}/offsets
POST /metadata
POST /fetch
```

It may look REST-like on the surface, but it is really just Kafka semantics embedded inside HTTP.

My practical rule is:

> once you start simulating another protocol through HTTP paths and headers, you probably need a custom protocol instead

---

### 3.3 Long-Term Compatibility, Multi-Language Clients, and Rolling Upgrades

Once a protocol is published for infrastructure software, compatibility becomes very expensive to break. Kafka is a strong example. The Kafka documentation explains that Kafka uses an API key together with an API version to identify the following message schema. A new client can talk to an old broker, and an old client can talk to a new broker. The client should choose the highest API version supported by both sides. ([Apache Kafka][1])

This sort of version negotiation fits naturally inside a custom protocol rather than as an external convention around HTTP.

A custom protocol can define mechanisms such as:

```text
magic number
protocol version
api version
feature flags
capability negotiation
extension fields
tagged fields
deprecated marker
client name / client version
server feature list
```

MySQL follows a similar pattern through capability flags. Client and server use capability bits to indicate whether they support or want to enable features such as SSL, authentication methods, and connection attributes. The HandshakeV10 documentation states that if the client supports SSL and sets the corresponding capability, it sends an `SSLRequest`, then the server establishes the SSL layer and waits for subsequent packets. ([MySQL Developer Zone][5])

That kind of protocol evolution support is crucial for middleware and database systems.

---

### 3.4 Full Control of Connection Lifecycle and I/O Model

HTTP/1.1, HTTP/2, and gRPC all come with their own connection model, stream model, multiplexing rules, headers, trailers, and flow control. For normal business services, that is usually an advantage. But for low-level infrastructure systems, those generic rules may become a constraint.

The Kafka documentation recommends persistent connections so the cost of TCP handshake is amortized. It also notes that a client usually does not need a pool of multiple connections to the same broker. Kafka guarantees that requests on one TCP connection are processed in send order and responses are returned in that same order. Clients can use non-blocking I/O and request pipelining to improve throughput. ([Apache Kafka][1])

Redis also supports pipelining. The Redis documentation explains that clients can send multiple requests without waiting for each reply and collect the replies later. ([Redis][3])

These are protocol properties that are tightly coupled to the connection model. A custom protocol can define details such as:

```text
whether multiple in-flight requests are allowed on one connection
whether responses must be returned in order
whether pipelining is supported
whether server push is supported
whether a subscription mode exists
whether the protocol is half-duplex or full-duplex
how authentication state is tracked
how protocol switching works
how throttling, connection eviction, and close behavior work
```

Many of these details become awkward if they have to be layered on top of HTTP or gRPC.

---

## 4. What Are the Benefits of a Custom TCP Application Protocol?

### 4.1 Controllable Performance: Fewer Bytes, Less Parsing, Fewer Allocations

A custom protocol can naturally use:

```text
fixed-length fields
length prefix
binary integers
compact enums
batched payload
zero-copy-friendly layout
direct memory mapping
less string parsing
fewer header maps
```

Kafka's primitive types use explicit binary encodings such as `INT16`, `INT32`, `INT64`, `UUID`, and `BYTES`. ([Apache Kafka][1])

RESP, despite being human-readable, still achieves high efficiency. The Redis documentation emphasizes that bulk strings use a length prefix, so the implementation does not need to scan for special characters or escape sequences and can approach binary-protocol performance. ([Redis][3])

That is why Redis did not choose JSON over HTTP. JSON adds:

```text
repeated field names
string escaping
number parsing
structure scanning
extra object allocation
no natural binary blob representation
```

Redis instead uses a representation such as:

```text
*2\r\n$3\r\nGET\r\n$3\r\nkey\r\n
```

which is much closer to the Redis domain model than:

```http
POST /redis
Content-Type: application/json

{"command":"GET","key":"key"}
```

---

### 4.2 Native Support for Batch Transfer

Kafka makes this point especially clear. It does not model each message as an independent RPC. It encourages batches. The documentation states that both produce and fetch APIs work on sequences of messages and can span multiple topics and partitions in one request. ([Apache Kafka][1])

That matters because the cost of a message queue includes:

```text
system calls
network packets
broker request scheduling
disk append
page cache
replication
consumer fetch
compression / decompression
```

If every message were turned into an individual HTTP or gRPC request, overall throughput would collapse under the cost of that granularity.

Kafka's protocol can directly express:

```text
ProduceRequest
  topic A
    partition 0
      record batch
    partition 1
      record batch
  topic B
    partition 3
      record batch
```

That is not a generic method call. It is a batch-oriented data exchange model specific to a log system.

---

### 4.3 More Precise Error Codes and State Machines

HTTP has a general-purpose status-code model:

```text
200 OK
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
500 Internal Server Error
503 Service Unavailable
```

Kafka needs to express errors such as:

```text
NotLeaderForPartition
UnknownTopicOrPartition
OffsetOutOfRange
CoordinatorNotAvailable
RebalanceInProgress
UnsupportedVersion
TopicAuthorizationFailed
```

MySQL needs to express:

```text
OK packet
ERR packet
EOF packet
ResultSet packet
AuthSwitchRequest
AuthMoreData
LocalInFileRequest
```

Redis needs reply variants such as:

```text
simple string
bulk string
integer
array
map
push
simple error
bulk error
null
```

RESP directly models error as a protocol data type. The Redis documentation states that a simple error reply begins with `-`, and clients should treat it as an exceptional response. ([Redis][3])

That is much cleaner than forcing everything into "HTTP 200 with an `errorCode` field in JSON."

---

### 4.4 Better Protocol Evolution

A custom protocol can make evolution a first-class concept:

```text
version
feature flag
capability flag
extension field
reserved field
tagged field
optional field
deprecated field
```

Kafka's API version model is a good example. The documentation explains that an API key and an API version, both 16-bit integers, together identify the following message schema, and the broker returns the response in the protocol shape expected by that version. ([Apache Kafka][1])

MySQL takes a capability-flag approach. Client and server negotiate support for SSL, authentication plugins, connection attributes, and similar features. ([MySQL Developer Zone][5])

That is far more systematic than inventing private HTTP headers such as:

```http
X-Protocol-Version: 3
X-Feature-A: true
X-Client-Capabilities: ...
```

It is not that such headers are impossible. It is that once you depend on many private headers, you are already building a custom protocol on top of HTTP.

---

### 4.5 Less Dependence on General-Purpose Frameworks

For infrastructure systems, the protocol is part of the ecosystem boundary. Kafka, Redis, and MySQL all require many multi-language clients. If the core protocol depends on a specific RPC framework, the ecosystem becomes harder to extend.

If Kafka had adopted gRPC as its internal protocol from the start, every client would need a gRPC runtime, an HTTP/2 stack, and a protobuf-centric toolchain. That is acceptable in Java, Go, or C++, but it raises the barrier for more constrained environments, proxy implementations, packet analyzers, compatibility layers, and minimal clients.

With a custom protocol, any language that can open a TCP socket and implement the codec can build a client. Redis RESP is especially good at this. The Redis documentation explicitly positions RESP as the wire protocol clients should implement. ([Redis][3])

That reflects a fundamental difference:

```text
business RPC: optimize for development efficiency
infrastructure protocol: optimize for ecosystem stability, cross-language implementation, and long-term compatibility
```

---

## 5. Why Doesn't Kafka Simply Use HTTP or gRPC?

This is the core question of the article. My conclusion is clear:

> Kafka is not a good fit for HTTP or gRPC as its core broker protocol, because Kafka is fundamentally a protocol for partitioned logs, batch messages, offsets, metadata discovery, broker routing, version negotiation, and high-throughput I/O rather than a generic service-method invocation model

### 5.1 Kafka's Core Unit Is a Partitioned Log Operation, Not an RPC Method

The gRPC abstraction is:

```text
Service.Method(Request) -> Response
```

Kafka's abstraction is closer to:

```text
Produce(topic, partition, record batch)
Fetch(topic, partition, offset, max bytes)
Metadata(topic)
OffsetCommit(group, topic, partition, offset)
FindCoordinator(group/transactional id)
```

These operations can certainly be wrapped as RPC methods, but Kafka's performance depends on:

```text
batched records
cross-partition produce / fetch
compressed record batch
long-lived connection reuse
non-blocking I/O
protocol-level error codes
metadata-driven broker routing
api-version compatibility
```

Those are Kafka's own protocol strengths, not the default strengths of gRPC.

---

### 5.2 Kafka Requires Strong Batching Semantics

The Kafka documentation explicitly states that its API encourages batching. Produce and fetch are designed around sequences of messages rather than single messages, and one produce or fetch request may cover multiple topics and partitions. ([Apache Kafka][1])

Yes, gRPC could technically wrap a batch:

```proto
rpc Produce(ProduceRequest) returns (ProduceResponse);
```

But then gRPC becomes just an outer shell, while the real Kafka semantics still have to be defined inside the protobuf message. The stack turns into:

```text
HTTP/2 frame
  gRPC message
    Kafka ProduceRequest
      topic / partition / record batch
```

Kafka today is simply:

```text
TCP
  Kafka frame
    Kafka ProduceRequest
      topic / partition / record batch
```

One less layer means one less parser, one less dependency, and one less set of behavioral constraints.

---

### 5.3 Kafka Needs Broker and Partition-Aware Routing

Kafka does not allow every request to go to any broker. The client must know which broker is currently the leader for a specific topic partition and send produce or fetch requests to that broker. The Kafka documentation explains that clients use metadata requests to discover broker, topic, partition, and leader information, and refresh metadata when errors or socket failures indicate it is stale. ([Apache Kafka][1])

That model differs from the common HTTP load-balancing model.

HTTP or gRPC usually assumes:

```text
client -> load balancer -> any healthy backend
```

Kafka works more like:

```text
client -> metadata -> partition leader broker
```

In other words, the Kafka client itself participates in protocol-level routing. Generic HTTP or gRPC load-balancing semantics do not naturally express leader-based partition routing.

---

### 5.4 Kafka Needs Protocol-Level Version Compatibility

Kafka has difficult upgrade scenarios:

```text
old client -> new broker
new client -> old broker
rolling broker upgrade
staged client SDK upgrade
cross-version cluster
gradual field introduction
```

Kafka handles this through API version negotiation. The documentation states that new and old clients and brokers remain compatible in both directions, and clients choose the highest API version supported on both sides. ([Apache Kafka][1])

gRPC and protobuf also have compatibility mechanisms, but Kafka needs compatibility at the Kafka API level, not only at the field level. A client needs to know which Kafka APIs, versions, fields, and errors a broker supports. That belongs naturally inside Kafka's own protocol.

---

## 6. Why Does Redis Use RESP Instead of HTTP or gRPC?

Redis is another very clear example. Its protocol goals are not "enterprise RPC." They are:

```text
simple
fast
human-readable
easy to implement in clients
pipeline-friendly
able to represent multiple reply types
```

The official Redis documentation explicitly describes RESP as the wire protocol between Redis clients and the Redis server and says that it was designed as a balance of implementation simplicity, fast parsing, and human readability. ([Redis][3])

### 6.1 Redis Has a Very Simple Command Model and Does Not Need HTTP

Redis commands are naturally:

```text
COMMAND key arg1 arg2 ...
```

RESP expresses that model directly:

```text
*2\r\n$3\r\nGET\r\n$3\r\nfoo\r\n
```

If HTTP were used, the same thing might become:

```http
POST /redis
Content-Type: application/json

{
  "command": "GET",
  "args": ["foo"]
}
```

For Redis, that is obvious over-design.

Redis is an in-memory database. Many commands finish in microseconds. If protocol parsing and object creation cost more than the command itself, the design is upside down.

---

### 6.2 RESP Balances Readability and Performance

RESP is not purely binary, but it is carefully designed. It uses the first byte to indicate type:

```text
+ simple string
- error
: integer
$ bulk string
* array
% map
> push
```

RESP bulk strings use length prefixes and can carry arbitrary binary data. The official Redis documentation points out that this design avoids scanning payloads for special characters and avoids escape handling, so performance can approach binary protocols while implementation remains easier than many binary formats. ([Redis][3])

That is the signature of a good protocol design:

```text
not blind binary encoding
but a balanced design across performance, readability, and implementation complexity
```

---

### 6.3 Redis Pipelining Needs a Lightweight Protocol

Redis supports pipelining: the client can send multiple commands first and read the responses later. The Redis documentation explicitly says Redis requests can be pipelined. ([Redis][3])

Pipelining is crucial for Redis because single commands are very fast and network RTT can become the real bottleneck. RESP's simple request-response structure fits pipelining perfectly:

```text
C: GET a
C: GET b
C: INCR c

S: value-of-a
S: value-of-b
S: integer-result
```

HTTP/1.1 pipelining was notoriously problematic. HTTP/2 supports multiplexing but brings frames, streams, and flow control. Redis does not need that complexity. It needs a protocol that is **simple, ordered, low-cost, and easy to implement**.

That is why RESP is such a good fit for Redis.

---

## 7. Why Does MySQL Use Its Own Protocol Instead of HTTP or gRPC?

Database protocols differ even more strongly from ordinary RPC. MySQL is not just:

```text
execute(sql) -> result
```

It involves:

```text
connection handshake
protocol version
server greeting
authentication challenge
authentication plugin
SSL switch
capability flags
default database
character set
prepared statement
query command
result-set metadata
row data
OK / ERR packet
transaction state
session state
```

The MySQL documentation explains that client and server exchange data as packets, and each packet header contains the payload length and sequence id. ([MySQL Developer Zone][4])

The HandshakeV10 documentation further explains that when the client supports SSL and enables the related capability flag, it sends an `SSLRequest`, after which the server establishes the SSL layer and waits for the next client packet. ([MySQL Developer Zone][5])

That means the MySQL protocol is itself a database connection state machine.

### 7.1 Database Connections Are Stateful

HTTP is naturally oriented toward stateless request-response interaction. Stateful behavior can be layered on top through cookies, sessions, or connection pools, but that is not the core design goal of HTTP.

MySQL connections are inherently stateful:

```text
current user
current database
current charset
current transaction
current prepared statement
current session variables
current connection attributes
current authentication state
```

If HTTP or gRPC were used to model that state, the system would need extra session ids, tokens, or context mapping. That only adds complexity.

The MySQL protocol can instead bind the session directly to the TCP connection:

```text
TCP connection = database session
```

That is a natural fit.

---

### 7.2 Database Result Sets Need Specialized Representation

SQL results are not naturally represented as generic JSON. They contain:

```text
column count
column metadata
column name
schema
table
type
flags
decimals
row data
EOF / OK
warning count
server status
```

If all of this is encoded as JSON, there is a lot of redundancy:

```json
[
  {"id": 1, "name": "a", "age": 18},
  {"id": 2, "name": "b", "age": 20}
]
```

Every row repeats the column names, and the type metadata is not compact. Database protocols usually send column metadata once and then stream rows, which is much more efficient for large result sets.

That makes a custom packet protocol the sensible design choice.

---

### 7.3 Database Protocols Need Capability Negotiation and Extensible Authentication

MySQL capability flags are a core part of protocol evolution. Client and server use those flags to negotiate support for SSL, authentication plugins, connection attributes, and related features. ([MySQL Developer Zone][5])

If the same mechanism were forced into HTTP or gRPC, it would become a pile of custom headers or metadata while the real connection state machine still had to be implemented separately. At that point, a dedicated database protocol is cleaner.

---

## 8. The Relationship Between Custom Protocols and HTTP or gRPC: Not Replacement, but Boundary

This article should make one judgment explicit:

> for ordinary business-service calls, prefer HTTP or gRPC; for high-frequency internal infrastructure protocols, consider a custom TCP application protocol

### Suitable Scenarios for HTTP or REST

```text
public APIs
admin backends
low-frequency business interfaces
browser access
debuggability first
gateway-centric governance
third-party integration
CRUD-oriented resource models
```

### Suitable Scenarios for gRPC

```text
internal microservice calls
strong schema
multi-language SDKs
bidirectional streaming
service governance
cloud-native ecosystem
need HTTP/2 capabilities
the team does not want to maintain a low-level protocol
```

The gRPC protocol definition describes a protocol carried on HTTP/2 framing with request headers, length-prefixed messages, and trailers. ([grpc.github.io][2]) That means gRPC is already a mature high-performance RPC solution. Ordinary business systems usually gain nothing from reinventing that layer.

### Suitable Scenarios for a Custom TCP Protocol

```text
database protocols
cache protocols
message-queue protocols
high-performance RPC frameworks
real-time push protocols
game protocols
market-data protocols
service-mesh data-plane protocols
edge-proxy internal protocols
```

The right decision criteria are not "can we write Netty code?" They are:

```text
is the protocol itself part of the product's core capability?
does a general-purpose protocol introduce obvious extra cost?
does the system need to express complex domain semantics?
does it require extreme control over connection and I/O?
does it need long-term cross-language compatibility?
does it need a large client ecosystem?
can the team afford long-term protocol maintenance?
```

If most of those answers are yes, a custom protocol is worth serious consideration.

---

## 9. The Cost of a Custom Protocol

A custom protocol is not free. At minimum, it adds the following costs:

```text
protocol design cost
codec implementation cost
multi-language SDK cost
compatibility testing cost
packet-capture debugging cost
security review cost
documentation maintenance cost
protocol fuzz-testing cost
rolling-upgrade cost
ecosystem adaptation cost
```

The strengths of HTTP and gRPC are exactly the opposite:

```text
mature ecosystem
rich tooling
good observability support
strong gateway support
strong proxy support
mature security model
easy debugging
lower learning cost
```

That is why ordinary business systems should not casually invent their own protocol. Many teams end up building something like:

```text
length + JSON
```

and then they keep adding:

```text
request id
timeout
retry
auth
tracing
compression
version
error code
schema
IDL
SDK
load balancing
health check
```

At that point they are simply rebuilding a weaker version of gRPC.

The cases where a custom protocol really makes sense are cases like Kafka, Redis, and MySQL, where the protocol is tightly bound to the system kernel and long-term protocol stewardship is part of the product itself.

---

## 10. How Should a Good Custom TCP Application Protocol Be Designed?

If you are going to design one, I suggest starting with at least the following structure.

### 10.1 Basic Frame Layout

```text
+----------------+----------------+----------------+----------------+
| magic          | version        | header length  | body length    |
+----------------+----------------+----------------+----------------+
| request id / correlation id                                      |
+------------------------------------------------------------------+
| command / api key                                                |
+------------------------------------------------------------------+
| flags                                                            |
+------------------------------------------------------------------+
| header extensions                                                |
+------------------------------------------------------------------+
| body                                                             |
+------------------------------------------------------------------+
```

### 10.2 Required Fields

```text
magic number        // identify protocol
protocol version    // protocol evolution
request id          // match request and response
command / api key   // operation type
flags               // compression, encryption, tracing, etc.
body length         // solve TCP stream boundary
status / error code // response status
```

### 10.3 Recommended Capabilities

```text
version negotiation
capability negotiation
heartbeat
authentication
authorization
compression
batching
pipeline
backpressure
server push
graceful close
structured error code
tracing context
client name / version
extension fields
```

### 10.4 Mistakes You Must Avoid

```text
no length field, relying on read() count to detect message boundaries
no version field
no request id
error handling only through plain strings
missing protocol documentation
client and server implementations guessing each other
no fuzz testing
no compatibility testing
no packet inspection tooling
no maximum packet-size limit
no slow-client protection
no authentication state machine
```

The first mistake is especially serious. TCP is a byte stream. One `read()` call is never a valid way to decide where a message ends.

---

## 11. Conclusion

The essence of a custom TCP application protocol is to turn the protocol from a generic communication shell into a structural part of the system model itself.

Kafka uses a custom binary protocol because it must serve partitioned logs, broker routing, metadata, batching, fetch semantics, offsets, API versions, and high-throughput long-lived connections. Redis uses RESP because it needs a protocol that is simple, fast, readable, low-cost to parse, and naturally aligned with its command model and pipelining behavior. MySQL uses its own protocol because database sessions are stateful and require handshake, authentication, capability negotiation, result-set metadata, row encoding, and session state management.

HTTP and gRPC are excellent general-purpose protocols, but they are not always the right fit for the internal core protocol of infrastructure systems. My final judgment is:

> **ordinary business systems should not casually invent their own protocol; high-performance infrastructure systems should seriously evaluate a custom protocol**
>
> use HTTP or gRPC when the protocol is merely a transport shell; build a custom TCP application protocol when the protocol itself is part of the system model, performance path, and ecosystem boundary

The real benefit of these protocols, as shown by Kafka, Redis, and MySQL, is not just "faster." It is:

```text
closer to the domain model
lower protocol overhead
stronger connection control
better batching
clearer state machine
more stable protocol evolution
better fit for a multi-language client ecosystem
more suitable as a long-term infrastructure boundary
```

That is why serious middleware and database systems so often end up with their own wire protocols.

[1]: https://kafka.apache.org/42/design/protocol "Protocol | Apache Kafka"
[2]: https://grpc.github.io/grpc/core/md_doc__p_r_o_t_o_c_o_l-_h_t_t_p2.html "GRPC Core: gRPC over HTTP2"
[3]: https://redis.io/docs/latest/develop/reference/protocol-spec/ "Redis serialization protocol specification | Docs"
[4]: https://dev.mysql.com/doc/dev/mysql-server/8.0.46/page_protocol_basic_packets.html?utm_source=chatgpt.com "MySQL Packets"
[5]: https://dev.mysql.com/doc/dev/mysql-server/9.5.0/page_protocol_connection_phase_packets_protocol_handshake_v10.html?utm_source=chatgpt.com "MySQL: Protocol::HandshakeV10"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/protocol)
