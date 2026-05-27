## Abstract

Improving system throughput by 10x is usually not about one magical parameter. It is about **removing fixed overhead across the entire path**: fewer requests, fewer system calls, fewer memory copies, less random I/O, less RTT waiting, and less repeated serialization and deserialization. This is not just anecdotal engineering advice. Redis documentation explicitly states that pipelining reduces RTT wait and lowers system call overhead by handling multiple commands in a single `read()` or `write()`, and that throughput can eventually reach 10x the non-pipeline baseline. Apache Kafka documentation also summarizes high-throughput design around batching, sequential I/O, page cache, a common binary message format, and zero-copy. ([Redis][1]) ([Apache Kafka][2])

This article examines throughput optimization across six directions: **batching, fewer copies, sequential I/O, zero-copy, pipelining, and less serialization/deserialization**. The central conclusion is: **throughput optimization is about turning a system that handles items one by one, waits one round trip at a time, copies one payload at a time, flushes one write at a time, and encodes one hop at a time into a system built around batched transfer, asynchronous pipelines, contiguous memory, sequential writes, zero-copy forwarding, and boundary-only encoding.**

**Keywords:** throughput optimization, batching, zero-copy, sequential I/O, pipeline, serialization, network communication, Kafka, Redis, gRPC, Linux

---

## 1. Problem Definition: Why Throughput Stalls

A typical low-throughput system often looks like this:

```text
for each request:
    JSON serialize
    write socket
    wait response
    read response
    JSON deserialize
    random write disk
    flush
```

In this model, the bottleneck is often not business logic. It is the accumulated fixed costs:

```text
per-request RTT
per-request system call
user/kernel context switching
user/kernel memory copy
small network packets
random disk I/O
repeated serialization/deserialization
frequent allocation and GC
```

So the first rule of throughput optimization is:

```text
do not optimize algorithms first
eliminate fixed cost on each message first
```

Kafka's design documentation states this very directly: once disk access patterns are optimized, the two major inefficiencies are **too many small I/O operations** and **too many byte copies**. Kafka addresses this with a message-set batch format so that network requests, disk appends, and consumer fetches all operate on large sequential chunks. ([Apache Kafka][2])

The optimization path in this article can be summarized as:

```text
small request -> large batch
synchronous wait -> asynchronous pipeline
random write -> sequential append
multiple copies -> fewer copies / zero-copy
text protocol -> binary protocol
decode/re-encode at every hop -> encode/decode only at the boundary
```

---

## 2. The Overall Model: Turn a "Single-Message System" into a "Data-Flow System"

Throughput optimization cannot look at only one layer. A request usually passes through:

```text
business object
  ↓ serialization
user-space buffer
  ↓ write/send
kernel socket buffer
  ↓ TCP/IP
NIC
  ↓ network
server-side kernel buffer
  ↓ read/recv
server-side user-space buffer
  ↓ deserialization
business processing
  ↓ storage / forwarding / downstream call
```

At every layer, the system may pay for copies, system calls, waiting, allocation, protocol parsing, and context switching. A real 10x throughput gain must cut across the entire path:

| Optimization Direction | Goal |
| --- | --- |
| Batching | Reduce request count, system calls, and packet count |
| Fewer copies | Reduce user-space memory copies, buffer concatenation, and object copies |
| Sequential I/O | Replace random reads and writes with append-only or large sequential access |
| Zero-copy | Avoid repeated transfer between user space and kernel space |
| Pipeline | Reduce RTT waiting and keep requests in flight |
| Less serialization/deserialization | Avoid rebuilding objects and re-encoding at every hop |

The following sections expand each direction.

---

## 3. Step One: Batching, Turn Small Requests into Large Blocks

### 3.1 Why Batching Improves Throughput So Much

Batching is usually the first throughput optimization worth doing. The reason is simple: handling 1 message and handling 100 messages do not cost 100 times the same fixed overhead.

A network request usually includes:

```text
system call cost
TCP/IP stack cost
network RTT
request header cost
server scheduling cost
log write cost
response processing cost
```

If every message is sent independently, these fixed costs are paid 100 times. If 100 messages are packed into a batch, most of the fixed cost happens only once.

Kafka documentation explicitly points out that batching amortizes network round-trip cost across multiple messages and converts small random writes into large linear writes. That creates larger network packets, larger sequential disk operations, and contiguous memory regions, which is exactly where order-of-magnitude gains come from. ([Apache Kafka][2])

Redis documentation reaches the same conclusion: pipelining lets clients send multiple commands without waiting for a response after each one, thereby reducing RTT. The server can then handle multiple commands through one `read()` and multiple responses through one `write()`. Throughput rises almost linearly with pipeline depth until it approaches 10x the baseline. ([Redis][1])

### 3.2 Best Practices for Batching

Batching should not be controlled only by record count. It should be constrained by four dimensions:

```text
max.batch.records
max.batch.bytes
max.linger.ms
max.buffer.memory
```

Kafka Producer configuration is a good example. Kafka documentation states that `batch.size` controls how many records for the same partition the producer tries to combine into fewer requests. Small batches reduce throughput. `linger.ms` allows the producer to wait for more records so it can form larger batches. `buffer.memory` caps the total memory available for buffered unsent records. ([Apache Kafka][3])

A practical strategy is:

```text
low-latency business:
    linger.ms = 1 ms to 5 ms
    medium batch size
    strict p99 latency control

high-throughput logs / telemetry / MQ:
    linger.ms = 5 ms to 50 ms
    larger batch size
    prioritize compression ratio and network utilization

offline sync / file transfer:
    large batch size
    bounded by max.request.size and memory ceiling
```

Kafka documentation also notes that compression works on the full batch, so more batching often improves compression ratio. Kafka supports gzip, snappy, lz4, and zstd. ([Apache Kafka][3])

### 3.3 Anti-Patterns in Batching

Batching is not "the bigger the better." Typical mistakes include:

```text
increase batch.size without controlling linger.ms
chase throughput without watching p99/p999 latency
no memory ceiling, so backlog grows into OOM
retrying an entire huge batch after failure and amplifying blast radius
mixing tenants or priorities in the same batch
```

My judgment is that **batching should be the first priority in throughput tuning, but it must be constrained by latency budget and error budget**. If the current system sends one item at a time synchronously, batching and pipelining usually produce the biggest return first.

---

## 4. Step Two: Fewer Copies, Reduce Memory Movement and Buffer Concatenation

### 4.1 Why Copy Overhead Destroys Throughput

A common inefficient pattern in network code is:

```text
headerBytes = encodeHeader()
bodyBytes = encodeBody()
packet = new byte[headerBytes.length + bodyBytes.length]
copy headerBytes to packet
copy bodyBytes to packet
socket.write(packet)
```

This looks simple but introduces:

```text
extra allocation
extra array copy
GC pressure
CPU cache miss
copy from user space to kernel space
```

Kafka design documentation identifies excessive byte copying as one of the central inefficiencies in high-throughput systems. Kafka solves this by letting producer, broker, and consumer share a standard binary message format, so the broker does not need to deserialize and rewrite data in the middle of the path. ([Apache Kafka][2])

### 4.2 Use Direct Memory and Long-Lived Buffers

Java's `ByteBuffer` documentation explains that direct buffers allow the JVM to perform native I/O directly wherever possible, avoiding copies to intermediate buffers before or after native I/O calls. But direct buffers are more expensive to allocate and free, so they should mainly be used for large, long-lived buffers involved in native I/O, and only when they deliver measurable gains. ([Oracle Docs][4])

So the practical guidance is:

```text
small objects and short-lived operations:
    do not blindly use direct buffer

large network reads and writes:
    use direct buffer
    use buffer pools
    avoid repeated allocate/free

high-throughput services:
    reuse buffers
    reuse encoders and decoders
    avoid repeatedly concatenating byte arrays
```

### 4.3 Use Scatter/Gather I/O

Linux `readv` and `writev` provide scatter/gather I/O. `readv` reads into multiple buffers, and `writev` writes from multiple buffers in one operation. That means an application can keep header, metadata, and payload in separate buffers and write them out once, instead of copying them into one temporary array first. ([man7.org][5])

Recommended model:

```text
header buffer
metadata buffer
payload buffer
        ↓
writev(fd, [header, metadata, payload])
```

Not recommended:

```text
copy header + metadata + payload into new byte[]
        ↓
write(fd, mergedBytes)
```

### 4.4 A Practical Checklist for Lower Copy Overhead

| Scenario | Recommended Practice |
| --- | --- |
| Java network I/O | Use direct buffers for large I/O and combine with pooling |
| Protocol encoding | Separate header and body, use gather write |
| Gateway forwarding | Do not parse body that the gateway does not need |
| MQ broker | Preserve binary message format and avoid middle-layer deserialization |
| Log collection | Batch-encode multiple log lines and avoid per-line allocation |
| File transfer | Use `sendfile` or `transferTo` |
| Compression | Compress at batch level, not per record |

NGINX documentation reflects the same idea. For example, `client_body_in_single_buffer on` is recommended when `$request_body` is used, in order to save copy operations. ([Nginx][6])

---

## 5. Step Three: Sequential I/O, Replace Random Access with Append-Only Patterns

### 5.1 Why Sequential I/O Is Critical

Disk performance is most sensitive to random access. Kafka documentation explicitly argues that modern operating systems treat file systems very well through page cache, read-ahead, and write-behind, and it cites a classic comparison where linear writes reach around 600 MB/s while random writes fall to around 100 KB/s, a gap of roughly 6000x. ([Apache Kafka][2])

Kafka's core design is an append-only log. Producers append messages, and consumers fetch large linear chunks. That lets the system exploit page cache and sequential I/O fully. ([Apache Kafka][2])

### 5.2 Best Practices for Sequential I/O

High-throughput systems should prefer:

```text
append-only log
partitioned sequential write
batch flush
segment files
sequential scan
page cache
background compaction
```

And avoid:

```text
random update per message
fsync per message
frequent small-file creation
synchronous random reads and writes
many scattered index writes
```

An example before and after:

Before:

```text
insert message
update status
update index
fsync
```

After:

```text
append message to log
append index entry
batch flush
background compact / checkpoint
```

### 5.3 Sequential I/O and Page Cache

Kafka documentation emphasizes that the operating system can automatically use free memory as page cache and combine small logical writes through write-behind. Holding too much application-level cache inside the JVM may instead increase object inflation and GC pressure. ([Apache Kafka][2])

So my judgment is: **for log-oriented, message-oriented, or event-oriented systems, do not start by designing a complex in-process caching layer. Start by designing a sequential-log layout that is page-cache friendly.**

### 5.4 Large-File Sending Scenarios

NGINX documentation describes how Linux can combine AIO, `directio`, `sendfile`, and thread pools for file transmission. With AIO and `sendfile` enabled together, files above the `directio` threshold can use AIO, while smaller or uncached files can use `sendfile`. ([Nginx][6])

That suggests the following engineering strategy:

```text
small files / hot files:
    page cache + sendfile

large files / cold files:
    AIO / directio / thread pool
    avoid blocking worker threads

log streams / MQ:
    append-only + page cache + sequential fetch
```

---

## 6. Step Four: Zero-Copy, Avoid Repeated User-Space Transfers

### 6.1 What Zero-Copy Solves

The traditional file-to-network path is:

```text
disk -> kernel page cache -> user buffer -> kernel socket buffer -> NIC
```

That path incurs multiple copies and multiple system calls. The Linux `sendfile()` man page states that `sendfile()` copies data between file descriptors inside the kernel, making it more efficient than `read()` plus `write()` that require user-space movement. ([man7.org][7])

Java's `FileChannel.transferTo` documentation also states that this can be more efficient than a user-space copy loop because many operating systems can transfer bytes directly from file-system cache to the target channel without an actual copy. ([Oracle Docs][8])

### 6.2 Kafka's Zero-Copy Model

Kafka documentation explains that if file-to-socket transfer is implemented through `read()` and `write()`, the data path includes multiple copies and system calls. With `sendfile`, the operating system can transmit page-cache data directly to the network, avoiding repeated copying. When consumers replay data, and the data is already warm in page cache, this zero-copy path allows fetch performance close to network limits. ([Apache Kafka][2])

This is one important reason Kafka can still be high-throughput even after persistence:

```text
producer append log
        ↓
page cache
        ↓
consumer fetch via sendfile
        ↓
network
```

### 6.3 `MSG_ZEROCOPY`: Not Suitable for Every Scenario

Linux kernel documentation explains that `MSG_ZEROCOPY` provides copy avoidance for socket send operations and currently supports TCP, UDP, and VSOCK. But the same documentation also makes it clear that zero-copy is not free. It trades byte-copy cost for page pinning, page accounting, and completion notification overhead, and it usually becomes worthwhile only when write size exceeds about 10 KB. ([Linux Kernel][9])

So `MSG_ZEROCOPY` should be used only when:

```text
buffers are large
throughput is high
the application can manage buffer lifetime
the application can handle completion notifications
the implementation complexity is acceptable
```

It is usually not suitable for:

```text
small-packet RPC
short-lived buffers
business code that cannot guarantee the buffer remains unchanged until completion
ordinary microservices that value simplicity and stability
```

### 6.4 Different Types of Zero-Copy

| Type | Typical Technology | Typical Scenario |
| --- | --- | --- |
| File to socket | `sendfile`, `FileChannel.transferTo` | static files, log segments, message replay |
| User buffer to socket | `MSG_ZEROCOPY` | large TCP or UDP send |
| Receive-side zero-copy | io_uring zero-copy receive | high-performance network receive |
| Serialization zero-copy | FlatBuffers | directly reading serialized bytes |

The `io_uring` man page describes it as a Linux-specific asynchronous I/O interface that uses shared ring buffers between user and kernel space to reduce overhead. Linux kernel documentation also explains that io_uring zero-copy receive can remove the kernel-to-user copy in the receive path so packets land directly in user-space memory. ([man7.org][10]) ([Linux Kernel][11])

### 6.5 Zero-Copy Anti-Patterns

Zero-copy should not be treated as a universal answer. Typical anti-patterns include:

```text
forcing MSG_ZEROCOPY on small packets
assuming sendfile always works well in TLS paths
insisting on zero-copy even when payload must be parsed or rewritten
reusing memory before send completion
replacing ordinary write logic with complex zero-copy paths without benchmarking
```

Kafka documentation also explicitly says Kafka does not use `sendfile` for SSL traffic because most SSL libraries still operate in user space and Kafka does not support kernel-space SSL sendfile. ([Apache Kafka][2])

So the rule is simple:

```text
if data is only forwarded and does not need business parsing:
    prefer zero-copy

if data must be parsed, modified, authenticated, or redacted:
    prefer fewer copies, not forced zero-copy
```

---

## 7. Step Five: Pipeline, Keep Requests In Flight

### 7.1 Pipeline Eliminates RTT Waiting

Redis documentation uses an extreme example to show the effect of RTT: if client-to-server RTT is 250 ms, then even if the server can process 100k requests per second, a client that waits for every response before sending the next request can issue only about 4 requests per second. Redis pipelining allows the client to send multiple commands continuously and read the responses afterward, dramatically increasing throughput. ([Redis][1])

That reveals an important fact:

```text
high throughput is not just about each request being faster
it is about not leaving the connection idle while waiting
```

### 7.2 The Difference Between Batching and Pipelining

Batching means:

```text
many business messages -> one request
```

Pipelining means:

```text
many requests -> send continuously without waiting for each response
```

The two can be combined:

```text
batch request 1
batch request 2
batch request 3
all in flight
responses received asynchronously
```

### 7.3 HTTP/2 and gRPC: Multiplexing as Pipeline

The HTTP/2 RFC states that HTTP/2 introduces a frame and stream layer that allows multiple concurrent open streams on one connection, with frames from different streams interleaved. ([IETF][12])

gRPC performance best practices recommend reusing stubs and channels. For long-lived data flow, streaming RPC can avoid the cost of repeatedly creating RPCs, HTTP/2 requests, and handlers. gRPC documentation also reminds users that every HTTP/2 connection has a concurrent stream limit, and excess RPCs will queue at the client. In high-load or long-lived-stream cases, one can use separate channels or a channel pool for hot paths. ([gRPC][13])

So good gRPC throughput practice is:

```text
reuse channels
reuse stubs
use async or non-blocking stubs
use streaming RPC when needed
monitor concurrent stream limits
use channel pools in very high-load paths
do not create a new channel for each request
```

### 7.4 Best Practices for Pipelining

| Scenario | Best Practice |
| --- | --- |
| Redis | Use pipeline, but cap commands per batch so the response queue does not grow too large |
| Kafka Producer | Use async send, batch, linger, and in-flight request control |
| gRPC | Reuse channels, use async stubs, and move to streaming when appropriate |
| HTTP/2 | Use multiplexing, but monitor stream queues and flow control |
| Database write | Batch writes, asynchronous write, and prepared statement reuse |
| Log reporting | Local buffer + async flush + backpressure |

Kafka Producer configuration includes `max.in.flight.requests.per.connection`, which controls the maximum number of unacknowledged requests allowed on a single connection. Kafka documentation also notes that without idempotence, a value greater than 1 can cause reordering during retries. ([Apache Kafka][3])

So the essence of pipelining is not "infinite concurrency." It is:

```text
bounded in-flight requests
backpressure
timeout control
ordering constraints
retry boundaries
```

---

## 8. Step Six: Reduce Serialization and Deserialization Work

### 8.1 JSON Is Not Ideal for a High-Throughput Internal Data Plane

In an internal high-throughput path, if every hop does:

```text
bytes -> JSON object -> business object -> JSON bytes
```

throughput will suffer badly. A better design is:

```text
parse once at the boundary
move binary inside
intermediate hops do not parse payload they do not care about
decode at the edge when necessary
```

Protocol Buffers documentation describes protobuf as a language-neutral, platform-neutral structured data serialization mechanism. It is similar to JSON but smaller and faster, and uses generated code for cross-language access. Its advantages include compact storage, fast parsing, multi-language support, and generated classes for better performance. ([protobuf.dev][14])

### 8.2 The Right Boundary for Protobuf

Protobuf works very well for ordinary RPC and service-to-service communication. But the official documentation also states that it is not suited for very large messages above a few megabytes. Protobuf assumes the whole message can fit in memory, which can lead to multiple copies and memory spikes, and protobuf messages are not compressed by themselves. ([protobuf.dev][14])

So the right practice is:

```text
ordinary RPC:
    use Protobuf

large files / large payloads:
    use object storage, file transfer, chunked transfer, or streaming

high-throughput logs:
    use batched Protobuf / Avro / binary formats
    combine with batch compression

very large messages:
    do not stuff them into one protobuf message
```

### 8.3 FlatBuffers: Zero-Copy Serialization for Read-Mostly Data

FlatBuffers documentation explains that it is a high-performance cross-platform serialization library created by Google for games and performance-critical software. It allows applications to access serialized data without first parsing or unpacking it into intermediary objects, and it is memory efficient because only one buffer is needed and extra heap allocation is avoided. ([FlatBuffers][15])

FlatBuffers fits:

```text
read-mostly data
large objects that are read frequently
low-GC environments
cross-language scenarios
middle layers that read only a small subset of fields
```

It is not always ideal for:

```text
frequently mutated objects
complex business-domain modeling
teams heavily invested in the Protobuf ecosystem
RPC frameworks that expect Protobuf-first integration
```

### 8.4 Reduce Repeated Serialization in gRPC

gRPC Java performance documentation notes that `GenericStub` can send raw gRPC `ByteBuffer`s directly. If the same payload must be sent multiple times, it can be serialized once into a `ByteBuffer` and then reused for multiple sends, avoiding repeated serialization. ([gRPC][13])

This is especially important for gateways, proxies, broadcast paths, and fan-out systems:

```text
if the same payload goes to many downstreams:
    serialize once
    retain bytes
    fan-out bytes

do not:
    rebuild business objects per downstream
    reserialize per downstream
```

### 8.5 Best Practices for Lower Serialization Overhead

| Scenario | Recommended Practice |
| --- | --- |
| Internal RPC | Protobuf or gRPC |
| High-throughput event flow | Batched binary encoding plus batch compression |
| Middle proxy | Do not parse payload that the proxy does not need |
| Fan-out path | Serialize once, send bytes many times |
| Large read-mostly objects | FlatBuffers |
| Very large payload | Chunking, streaming, object storage, or zero-copy file path |
| Cross-language protocol | Use schema-first design, avoid dynamic stringly typed maps |

My judgment is that **heavy internal JSON usage is one of the most common reasons microservice throughput stays low**. JSON is excellent for public APIs and debugging, but it is a poor default protocol for a high-throughput internal data plane.

---

## 9. How the Six Optimizations Combine

A real 10x gain usually comes from a combination of techniques rather than a single change.

### 9.1 Before Optimization

```text
business object
  ↓ JSON serialize
small request write
  ↓ wait RTT
server read
  ↓ JSON deserialize
random DB / file write
  ↓ synchronous flush
response
```

### 9.2 After Optimization

```text
business object
  ↓ Protobuf / FlatBuffers
batch aggregation
  ↓ writev / async send
multiple in-flight pipeline requests
  ↓ server-side batch read
append-only sequential log
  ↓ page cache
sendfile / transferTo fan-out
  ↓ batch-compressed response
client-side batch processing
```

The mapping is:

| Bottleneck | Optimization |
| --- | --- |
| one RTT per message | pipeline |
| one syscall per message | batching, `writev` |
| one network packet per message | batching, compression |
| multiple user-space copies | direct buffer, buffer pool, scatter/gather |
| multiple file-to-network copies | `sendfile`, `transferTo` |
| random disk writes | append-only, sequential I/O |
| encode/decode at every hop | boundary-only encoding, binary passthrough |
| excessive JSON parsing | Protobuf / FlatBuffers |
| weak compression on tiny messages | batch-level compression |

Kafka's architecture is exactly such a combination. Batch message format, sequential log, page cache, zero-copy, end-to-end batch compression, async producer, and pull-based consumer work together to create high-throughput behavior. ([Apache Kafka][2])

---

## 10. A Practical Rollout Path

### 10.1 First: Measure Before You Guess

Build a baseline before optimization:

```text
QPS / TPS
MB/s
p50 / p95 / p99 / p999 latency
CPU utilization
CPU cycles per byte
GC allocation rate
system call count
network packet size
ratio of sequential to random disk I/O
page cache hit rate
time spent in serialization
time spent in copy overhead
```

Any optimization without a baseline is mostly guesswork.

### 10.2 Second: Prioritize Batching and Pipelining

If the current system sends requests synchronously one by one, the first priority should be:

```text
increase batching
increase async pipelining
reduce RTT waiting
reduce request count
reduce syscall count
```

Both Redis and Kafka documentation show how large the impact can be: Redis pipelining reduces RTT and system calls and can reach 10x baseline throughput, while Kafka batching turns small I/O into large packets, sequential disk access, and contiguous memory processing. ([Redis][1]) ([Apache Kafka][2])

### 10.3 Third: Replace Text Protocols and Repeated Encode/Decode Work

If CPU is heavily consumed by JSON parsing, reflection, object conversion, or string handling, move first to:

```text
Protobuf
FlatBuffers
schema-first binary protocol
serialize once
pass-through bytes
```

Protocol Buffers documentation explicitly states that protobuf is smaller and faster than JSON and works cross-language through generated code. FlatBuffers documentation emphasizes direct access to serialized data without parse/unpack overhead. ([protobuf.dev][14]) ([FlatBuffers][15])

### 10.4 Fourth: Change the Storage Path to Sequential I/O

If the write path includes many random writes, fsync per message, or many small files, refactor toward:

```text
append-only log
batch flush
segment files
background compaction
sequential scan
```

Kafka documentation already demonstrates how this design uses page cache, read-ahead, and write-behind while avoiding the catastrophic cost of random I/O. ([Apache Kafka][2])

### 10.5 Fifth: Use Zero-Copy in Forwarding Paths

If the system has file download, log replay, message fan-out, or static resource distribution, prefer:

```text
sendfile
FileChannel.transferTo
page cache
zero-copy fan-out
```

Both Linux `sendfile()` and Java `FileChannel.transferTo` documentation make it clear that they can avoid user-space data movement compared with the classic read/write loop. ([man7.org][7]) ([Oracle Docs][8])

### 10.6 Sixth: Establish Backpressure

Every high-throughput system needs backpressure. Otherwise batching and pipelining will only accelerate collapse.

You must set:

```text
maximum queue length
maximum batch bytes
maximum in-flight requests
maximum buffer memory
request timeout
retry budget
drop policy
degradation policy
rate-limiting policy
```

The HTTP/2 RFC also reminds implementers that receivers must continue reading and processing frames. Otherwise flow control can cause deadlock. It also notes that priority policy matters and poor prioritization can hurt performance. ([IETF][12])

---

## 11. An Executable Optimization Template

Below is a generic template for a high-throughput path:

```text
Client
  ├─ local queue
  ├─ batch by size/time
  ├─ Protobuf encode once
  ├─ optional batch compression
  ├─ async send
  └─ bounded in-flight

Network
  ├─ keepalive connection
  ├─ HTTP/2 multiplexing or custom TCP pipeline
  ├─ writev / direct buffer
  └─ backpressure

Server
  ├─ batch receive
  ├─ minimal decode
  ├─ append-only log
  ├─ page cache
  ├─ async processing
  └─ batch response

Fan-out / Replay
  ├─ transferTo / sendfile
  ├─ no reserialize
  └─ compressed batch passthrough
```

Suggested tuning direction:

```text
batch.size:
    start from 32 KB or 64 KB and benchmark

linger.ms:
    start from 1 ms to 5 ms and observe p99

max.in.flight:
    start from 2 to 5 and adjust with ordering semantics

buffer.memory:
    must be bounded to avoid unbounded backlog

compression:
    for logs, events, and MQ, prefer batch compression

serialization:
    for internal paths, prefer Protobuf
    for large read-mostly objects, evaluate FlatBuffers

I/O:
    for log-like systems, prefer append-only
    for file forwarding, prefer sendfile or transferTo
```

---

## 12. Conclusion

"Improve throughput by 10x" is not mysterious, but it is only realistic when the bottleneck truly comes from small requests, small I/O, repeated copies, too much RTT waiting, random writes, and repeated encode/decode work. Redis documentation provides a clear example where pipelining reaches 10x the baseline throughput. Kafka documentation systematically shows how batching, sequential I/O, page cache, zero-copy, and binary message formats combine into a high-throughput system. ([Redis][1]) ([Apache Kafka][2])

The final judgment of this article is:

```text
first priority: batching + pipeline
second priority: reduce serialization/deserialization
third priority: sequential I/O
fourth priority: fewer copies
fifth priority: zero-copy
sixth priority: end-to-end backpressure
```

The most important sentence is:

```text
do not make the system work by request
make it work by data flow
```

When a system moves from per-request handling to batched streaming, from JSON object flow to binary data flow, from random I/O to sequential I/O, and from read/write copy loops to zero-copy forwarding, a 10x throughput gain becomes a realistic engineering goal instead of a slogan.

[1]: https://redis.io/docs/latest/develop/using-commands/pipelining/ "Redis pipelining | Docs"
[2]: https://kafka.apache.org/42/design/design/ "Design | Apache Kafka"
[3]: https://kafka.apache.org/41/configuration/producer-configs/ "Producer Configs | Apache Kafka"
[4]: https://docs.oracle.com/en/java/javase/11/docs/api/java.base/java/nio/ByteBuffer.html "ByteBuffer (Java SE 11 & JDK 11)"
[5]: https://man7.org/linux/man-pages/man2/readv.2.html "readv(2) - Linux manual page"
[6]: https://nginx.org/en/docs/http/ngx_http_core_module.html "Module ngx_http_core_module"
[7]: https://man7.org/linux/man-pages/man2/sendfile.2.html "sendfile(2) - Linux manual page"
[8]: https://docs.oracle.com/en/java/javase/24/docs/api/java.base/java/nio/channels/FileChannel.html "FileChannel (Java SE 24 & JDK 24)"
[9]: https://docs.kernel.org/networking/msg_zerocopy.html "MSG_ZEROCOPY - The Linux Kernel documentation"
[10]: https://man7.org/linux/man-pages/man7/io_uring.7.html "io_uring(7) - Linux manual page"
[11]: https://docs.kernel.org/networking/iou-zcrx.html "io_uring zero copy Rx"
[12]: https://datatracker.ietf.org/doc/html/rfc9113 "RFC 9113 - HTTP/2"
[13]: https://grpc.io/docs/guides/performance/ "Performance Best Practices | gRPC"
[14]: https://protobuf.dev/overview/ "Overview | Protocol Buffers Documentation"
[15]: https://flatbuffers.dev/ "FlatBuffers Docs"
