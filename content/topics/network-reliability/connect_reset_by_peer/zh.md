# Connection reset by peer：TCP RST、连接生命周期与工程排查体系研究

## 摘要

`Connection reset by peer` 是网络编程中常见的连接异常。它通常对应 POSIX/Linux 中的 `ECONNRESET`，含义是当前进程正在使用某条 TCP 连接时，对端或中间网络设备通过 TCP RST 报文强制重置了连接。Linux `errno(3)` 将 `ECONNRESET` 描述为 “Connection reset”，`send(2)` 中也明确列出 `ECONNRESET` 的错误说明为 “Connection reset by peer”。([man7.org][1])

从 TCP 协议角度看，连接结束有两类基本路径：一类是正常 FIN 握手关闭；另一类是 abort/reset，即发送一个或多个 RST 报文并立即丢弃连接状态。RFC 9293 明确说明，TCP 连接可以通过正常 FIN 握手终止，也可以通过 RST abort 终止；如果本地 TCP 连接因远端 FIN 或 RST 关闭，本地应用必须能得知它是正常关闭还是异常中止。([IETF Datatracker][2])

本文围绕 `Connection reset by peer` 展开，重点回答三个问题：它在 TCP 三次握手、数据传输、四次挥手中的哪个阶段出现；它由哪些原因引起；如何在工程系统中定位和解决。

**关键词**：Connection reset by peer；ECONNRESET；TCP RST；三次握手；四次挥手；idle timeout；keepalive；注册中心；长连接

---

## 1. 背景：为什么工程系统中经常看到 Connection reset by peer

在微服务、注册中心、网关、RPC、HTTP 连接池、gRPC stream、WebSocket、服务发现 watch 等场景中，应用通常不会每次请求都新建 TCP 连接，而是复用长连接或连接池。连接一旦长期存在，就会受到更多因素影响：

```text
客户端超时
服务端重启
连接池复用失效连接
LB / Nginx / Envoy / NAT idle timeout
TLS / HTTP 协议不匹配
应用层主动关闭
慢客户端
服务端过载
TCP keepalive 失败
```

这些因素中，有些会走正常 FIN 关闭，有些会触发 RST。应用看到 RST 时，常见表现就是：

```text
Connection reset by peer
java.net.SocketException: Connection reset
java.io.IOException: Connection reset by peer
read: connection reset by peer
write: connection reset by peer
ECONNRESET
WSAECONNRESET
```

IBM MQ 文档也指出，`ECONNRESET` 在不同平台有不同返回码，例如 Linux 上常见为 `104`，Windows 上对应 `WSAECONNRESET 10054`。([IBM][3])

---

## 2. TCP RST 的协议语义

TCP 报文头中有多个控制标志位，例如 SYN、ACK、FIN、RST。SYN 用于连接建立，FIN 用于正常关闭，RST 用于重置连接。

RFC 9293 对 RST 的生成规则有明确描述：一般原则是，当一个 TCP endpoint 收到一个明显不属于当前连接的 segment 时，会发送 RST；如果连接不存在，即处于 CLOSED 状态，那么除了收到另一个 RST 之外，收到任何进入 segment 都会回复 reset。([IETF Datatracker][2])

RST 的语义可以理解为：

```text
FIN：
  我这边没有更多数据要发送了，但连接可以按 TCP 状态机正常收尾。

RST：
  这条连接立即作废，连接状态可以丢弃，未完成的数据不再保证交付。
```

Cloudflare 对 TCP reset 的解释也符合这一点：RESET 信号中，一方发送 RST 报文，要求另一方立即关闭连接并丢弃连接状态；RESET 通常用于不可恢复错误。([The Cloudflare Blog][4])

因此，`Connection reset by peer` 不是普通的“对端关了连接”，而是“对端强制重置了连接”。

---

## 3. Connection reset by peer 在 TCP 生命周期中的位置

TCP 生命周期可以简化为三个阶段：

```text
连接建立阶段：
  三次握手

数据传输阶段：
  ESTABLISHED

连接关闭阶段：
  四次挥手 / 半关闭 / TIME_WAIT
```

RST 可以出现在这些阶段中的多个位置，但应用最终看到的错误形式会有所不同。

---

## 4. 三次握手阶段中的 RST

TCP 三次握手的正常流程是：

```text
Client                                      Server

SYN ------------------------------->       SYN-RECEIVED

SYN + ACK <-------------------------       

ACK ------------------------------->       ESTABLISHED
```

RFC 9293 将三次握手描述为建立连接的过程，并给出了基本握手示例：一端发送 SYN，对端返回 SYN+ACK，发起方再返回 ACK 后双方进入 ESTABLISHED。([IETF Datatracker][2])

在三次握手阶段，RST 可能出现在这些情况：

### 4.1 服务端端口没有监听

客户端发送 SYN 后，如果目标主机存在但目标端口没有进程监听，内核通常会回复 RST。客户端应用层常见错误更可能是：

```text
Connection refused
ECONNREFUSED
```

这属于连接建立失败，不一定表现为 `Connection reset by peer`。

### 4.2 半连接或握手状态异常

如果连接处于 `SYN-SENT`、`SYN-RECEIVED` 等非同步状态，收到不可接受的 ACK 或不匹配的 segment，协议允许发送 RST。RFC 9293 明确区分了非同步状态，包括 `LISTEN`、`SYN-SENT`、`SYN-RECEIVED`，并说明在这些状态中收到不合法 ACK 等情况时会发送 reset。([IETF Datatracker][2])

### 4.3 服务端 accept 前后主动 abort

服务端内核已经完成部分握手，但应用层、代理层、安全策略、backlog、协议检测等原因拒绝该连接，也可能导致 RST。

工程上可能表现为：

```text
connect 成功后立刻读写失败
TLS handshake 期间 reset
HTTP 请求刚发出就 reset
```

### 4.4 阶段结论

三次握手阶段会出现 RST，但严格来说，**典型的 `Connection reset by peer` 更多发生在连接已经建立之后的读写阶段**。如果 RST 直接响应初始 SYN，应用更常见的是 `Connection refused`。如果连接刚进入或接近 `ESTABLISHED` 后被重置，应用才更容易看到 `Connection reset by peer`。

---

## 5. ESTABLISHED 数据传输阶段中的 RST

`ESTABLISHED` 是 TCP 正常传输数据的状态。RFC 9293 将它描述为开放连接状态，在该状态下收到的数据可以交付给用户。([IETF Datatracker][2])

这个阶段是 `Connection reset by peer` 最常见的位置。

典型流程是：

```text
Client                                      Server

连接已建立 ESTABLISHED

DATA ------------------------------>       Server

                    Server 发送 RST

RST <-------------------------------

Client read/write:
  ECONNRESET / Connection reset by peer
```

在这个阶段，任何一方只要强制关闭连接，另一方后续读写就可能看到 reset。

---

## 6. 四次挥手阶段中的 RST

TCP 正常四次挥手大致是：

```text
主动关闭方                                  被动关闭方

FIN ------------------------------->       CLOSE-WAIT

ACK <-------------------------------

                         应用关闭后发送 FIN

FIN <-------------------------------       LAST-ACK

ACK ------------------------------->       CLOSED
```

RFC 9293 的正常关闭序列中，主动关闭方发送 FIN 后进入 `FIN-WAIT-1`，收到 ACK 后进入 `FIN-WAIT-2`，再等待对端 FIN，最后进入 `TIME-WAIT`；对端收到 FIN 后进入 `CLOSE-WAIT`，应用关闭后发送 FIN 并进入 `LAST-ACK`。([IETF Datatracker][2])

RST 和四次挥手的关系是：

```text
正常关闭：
  FIN / ACK / FIN / ACK

异常关闭：
  RST 替代正常 FIN 收尾，连接状态立即丢弃
```

也就是说，`Connection reset by peer` 并不是四次挥手本身的正常结果。它通常表示在四次挥手之前、过程中或之后，某一方没有按正常 FIN 流程关闭，而是通过 RST abort 了连接。

常见例子：

```text
客户端发送请求后超时，直接关闭连接；
服务端稍后写响应，发现对端已 reset。

服务端正在关闭，但发送缓冲区仍有未发送数据；
应用使用 abortive close；
对端读写时报 reset。

连接已进入半关闭状态；
另一方继续写入不符合当前状态的数据；
可能触发 reset。
```

RFC 9293 明确说明，TCP 连接可以通过 FIN 正常关闭，也可以通过 RST abort，此时连接状态会立即被丢弃。([IETF Datatracker][2])

---

## 7. 生命周期定位表

| TCP 阶段       | TCP 状态                           | 是否可能出现 RST | 应用常见表现                     | 说明                                |
| ------------ | -------------------------------- | ---------: | -------------------------- | --------------------------------- |
| 三次握手前        | CLOSED / LISTEN                  |         可能 | `ECONNREFUSED` 更常见         | 目标端口无监听时，常见 SYN 后收到 RST           |
| 三次握手中        | SYN-SENT / SYN-RECEIVED          |         可能 | connect 失败、TLS/HTTP 初始失败   | 非法 ACK、旧 SYN、策略拒绝等可触发 RST         |
| 握手刚完成        | ESTABLISHED 初期                   |         常见 | `Connection reset by peer` | 连接刚建立后被代理、服务端、协议检查重置              |
| 数据传输中        | ESTABLISHED                      |        最常见 | read/write 报 `ECONNRESET`  | 对端强制关闭、代理 reset、连接池复用失效           |
| 正常关闭中        | FIN-WAIT-1/2、CLOSE-WAIT、LAST-ACK |         可能 | EOF、Broken pipe、reset 均可能  | 正常 FIN 应产生 EOF；异常 abort 才产生 reset |
| TIME_WAIT 相关 | TIME-WAIT                        |         可能 | 通常表现为连接异常或被内核丢弃            | 旧报文、端口复用、非法 segment 可触发复杂行为       |

---

## 8. 产生 Connection reset by peer 的原因分类与解决办法

`Connection reset by peer` 的根因不能只从异常文本判断。它只说明“本端收到了对端或中间设备的 RST”，并不直接说明为什么 RST 被发送。下面按工程场景分类。

---

## 9. 应用主动异常关闭连接

### 9.1 典型原因

```text
对端进程崩溃
服务进程被 kill -9
容器被强制停止
服务滚动发布时直接杀连接
应用代码直接 close
应用设置 SO_LINGER=0 导致 abortive close
```

其中 `SO_LINGER=0` 是典型的 abortive close 方式，应用 close socket 时可能直接发送 RST，而不是走 FIN。

### 9.2 典型现象

```text
发布、重启、扩缩容期间 reset 暴涨
客户端正在请求，服务端突然重启
服务端日志没有完整响应记录
客户端 read 报 Connection reset by peer
```

### 9.3 解决办法

```text
优雅停机，先摘流量，再停止接收新连接
等待已有请求完成
长连接场景发送 graceful close / GOAWAY
避免无必要的 SO_LINGER=0
容器 terminationGracePeriodSeconds 设置合理
服务端关闭前清理订阅和连接状态
```

---

## 10. 客户端提前超时或取消请求

### 10.1 典型原因

```text
客户端 read timeout 太短
调用方超时取消
用户刷新页面
浏览器关闭连接
上游网关取消请求
RPC deadline 到期
客户端熔断器主动放弃
```

### 10.2 典型现象

服务端仍在处理请求，但客户端已经断开。服务端写响应时出现：

```text
Connection reset by peer
Broken pipe
client prematurely closed connection
```

### 10.3 解决办法

```text
客户端超时时间要覆盖合理服务端处理时间
服务端对慢请求做限时和降级
服务端写失败后清理资源，不要继续重试写同一连接
对客户端取消请求的日志降级，不要全部打 ERROR
RPC 使用 deadline，并在服务端感知 cancellation
```

---

## 11. idle timeout 与 keepalive 配置不匹配

### 11.1 典型原因

长连接上长时间没有业务数据，中间设备或服务端认为连接空闲：

```text
LB idle timeout
Nginx keepalive_timeout / proxy_read_timeout
Envoy stream_idle_timeout / idle_timeout
NAT idle timeout
防火墙连接表超时
服务端连接 idle timeout
客户端连接池 idle timeout
```

Cloudflare 对 TCP timeout 的说明中提到，timeout 表示连接在没有数据或确认报文时还能保持活跃的最大时间；Keep-Alive 可以用于让空闲连接保持打开。([The Cloudflare Blog][4])

### 11.2 典型现象

```text
reset 时间点非常固定，例如 60s、90s、300s
服务长期无实例变更时 watch 连接断开
HTTP 连接池空闲一段时间后首次请求失败
客户端复用旧连接后立即 reset
```

### 11.3 解决办法

核心原则：

```text
heartbeatInterval < idleTimeout
clientReadTimeout > heartbeatInterval
clientConnectionPoolMaxIdleTime < serverKeepAliveTimeout
```

例如注册中心 watch：

```yaml
watch:
  heartbeatInterval: 20s
  heartbeatTimeout: 10s
  idleTimeout: 60s
  clientReadTimeout: 90s
```

对于 TCP keepalive 和 `TCP_USER_TIMEOUT`，Linux `tcp(7)` 说明 `TCP_USER_TIMEOUT` 只在同步状态下生效，包括 `ESTABLISHED`、`FIN-WAIT-1`、`FIN-WAIT-2`、`CLOSE-WAIT`、`CLOSING`、`LAST-ACK`；并且和 `SO_KEEPALIVE` 一起使用时，`TCP_USER_TIMEOUT` 会覆盖 keepalive 用于判断 keepalive 失败后何时关闭连接。([man7.org][5])

---

## 12. 连接池复用已经失效的连接

### 12.1 典型原因

```text
服务端已经关闭空闲连接
LB 已经清理连接
客户端连接池仍认为连接可用
下一次请求复用该连接
写请求或读响应时收到 RST
```

### 12.2 典型现象

```text
低频请求更容易出现
空闲一段时间后的首个请求失败
重试后成功
同一个连接池偶发 Connection reset
```

### 12.3 解决办法

```text
客户端连接池 maxIdleTime 小于服务端 keepAliveTimeout
开启连接存活检测
对幂等请求允许一次安全重试
服务端和代理 keepalive timeout 对齐
避免长时间保留空闲连接
```

示例：

```text
服务端 keepAliveTimeout = 60s
客户端连接池 maxIdleTime = 50s
```

不推荐：

```text
服务端 60s 关闭空闲连接
客户端连接池 300s 才回收连接
```

---

## 13. 协议不匹配

### 13.1 典型原因

```text
HTTP 请求打到 HTTPS 端口
HTTPS 请求打到 HTTP 端口
gRPC 请求经过只支持 HTTP/1.1 的代理
HTTP/2 preface 错误
TLS SNI 不匹配
TLS 版本或 cipher 不匹配
证书校验失败
明文协议打到 TLS listener
```

### 13.2 典型现象

```text
连接刚建立就 reset
TLS handshake 期间失败
curl 显示 connection reset
服务端应用层没有请求日志
代理日志中出现 protocol error
```

### 13.3 解决办法

```text
确认 URL scheme：http / https
确认端口：80 / 443 / gRPC 端口
确认代理是否支持 HTTP/2
确认 TLS 证书、SNI、ALPN
抓包查看 ClientHello、ServerHello、RST 位置
查看 Nginx / Envoy / Ingress 日志
```

---

## 14. 服务端过载或资源耗尽

### 14.1 典型原因

```text
fd 耗尽
accept 队列满
线程池耗尽
事件循环阻塞
内存不足
容器 OOM
CPU 打满
发送缓冲区积压
慢客户端拖垮服务端
连接数超过限制
```

### 14.2 典型现象

```text
reset 与流量高峰相关
服务端延迟升高
错误率和 CPU / 内存 / fd 使用率相关
Nginx / Envoy 出现 upstream reset
服务进程重启或 OOM kill
```

### 14.3 解决办法

```text
扩容服务端
提高 fd limit
优化线程池和事件循环
设置 accept backlog 和 somaxconn
增加限流和熔断
隔离慢客户端
给每个连接设置发送队列上限
降低单连接订阅数量
按 app / tenant / zone 分片
```

排查命令：

```bash
# Check socket summary
ss -s

# Check TCP connections
ss -antp | grep <port>

# Check process fd usage
ls /proc/<pid>/fd | wc -l

# Check system fd limit
cat /proc/sys/fs/file-max

# Check process limit
ulimit -n

# Check kernel logs
dmesg -T | tail -100
```

---

## 15. 中间代理、负载均衡、防火墙或 NAT 主动 reset

### 15.1 典型原因

```text
LB idle timeout
Nginx upstream timeout
Envoy stream idle timeout
防火墙策略拒绝
安全设备注入 RST
NAT 表项过期
Service Mesh sidecar 重启
Ingress reload
四层负载均衡连接迁移
```

### 15.2 典型现象

```text
应用两端都认为自己没主动关闭
RST 源 IP 是代理或 LB
只在经过某条链路时发生
直连服务端不复现
代理日志中出现 upstream reset / downstream reset
```

### 15.3 解决办法

```text
对齐客户端、服务端、LB、代理 idle timeout
长连接启用 heartbeat / ping
检查 Nginx proxy_read_timeout、keepalive_timeout
检查 Envoy idle_timeout、stream_idle_timeout
检查云 LB idle timeout
检查 NAT / 防火墙连接跟踪超时
滚动发布 sidecar 时做 drain
```

---

## 16. TCP keepalive 失败或网络半开

### 16.1 典型原因

```text
一端断电
网络单向中断
NAT 表项消失
对端主机不可达
长时间无流量导致连接半开
TCP keepalive 探测失败
TCP_USER_TIMEOUT 到期
```

TCP keepalive 和 `TCP_USER_TIMEOUT` 的效果与连接状态相关。Linux `tcp(7)` 明确说明 `TCP_USER_TIMEOUT` 只在同步状态生效，且与 `SO_KEEPALIVE` 同时使用时会影响 keepalive 失败后的关闭判断。([man7.org][5])

### 16.2 典型现象

```text
连接长时间无数据后失败
跨机房、跨公网更容易出现
客户端或服务端认为连接还在，实际链路已断
下一次读写时报 reset 或 timeout
```

### 16.3 解决办法

```text
使用应用层 heartbeat
合理开启 TCP keepalive
设置 TCP_USER_TIMEOUT
跨 NAT / LB 场景确保 heartbeat 小于中间链路 idle timeout
客户端重连使用指数退避 + jitter
服务端检测半开连接并清理订阅关系
```

---

## 17. 注册中心 watch 场景下的典型根因

结合注册中心服务端与客户端 watch 通信，最常见的 reset 路径是：

```text
客户端 watch 一批应用实例
被订阅应用长时间没有实例变化
连接上没有业务事件
服务端或 LB idle timeout 触发
连接被关闭或 reset
客户端继续 read/write
出现 Connection reset by peer
```

这个问题的正确治理方式不是“让 idle timeout 正常发生”，而是区分业务事件和连接活性事件：

```text
实例没变化：
  不推送 instance change event

连接仍有效：
  发送 heartbeat / ping

连接异常：
  keepalive timeout 后关闭并重连
```

推荐模型：

```text
长连接 watch
+ 应用层 heartbeat
+ 协议层 keepalive
+ revision 增量恢复
+ 慢客户端治理
+ graceful reconnect
```

如果实例变化实时性要求不高，可以使用 long polling 或周期拉取，而不是伪装成长连接却依赖 idle timeout 断开。

---

## 18. 排查方法体系

### 18.1 第一步：确认 reset 出现在谁的日志里

```text
客户端报 reset：
  可能是服务端、LB、Nginx、Envoy、防火墙 reset

服务端报 reset：
  可能是客户端、客户端侧代理、LB、NAT reset
```

注意：`peer` 是 TCP 连接的直接对端，不一定是业务上的最终客户端或最终服务端。

---

### 18.2 第二步：确认异常发生在 read、write 还是 connect

```text
connect 阶段：
  重点看三次握手、端口监听、LB、TLS、协议不匹配

read 阶段：
  对端可能已经 reset，当前正在读取时发现

write 阶段：
  对端可能已经断开，本端继续写导致异常
```

Linux `send(2)` 明确列出 `ECONNRESET` 可能作为发送错误返回，含义是连接被 peer reset。([man7.org][6])

---

### 18.3 第三步：看时间点是否吻合 timeout

如果 reset 总是在固定时间附近发生：

```text
30s
60s
75s
90s
300s
350s
600s
```

优先排查：

```text
LB idle timeout
Nginx / Envoy idle timeout
客户端 read timeout
服务端 keepalive timeout
连接池 maxIdleTime
NAT / 防火墙超时
```

---

### 18.4 第四步：抓包确认 RST 由谁发送

```bash
# Capture all TCP reset packets
sudo tcpdump -i eth0 -nn 'tcp[tcpflags] & tcp-rst != 0'

# Capture packets for a specific peer
sudo tcpdump -i eth0 -nn host <peer_ip> and tcp

# Capture a specific port
sudo tcpdump -i eth0 -nn port <port> and tcp
```

判断方式：

```text
RST 源 IP 是客户端：
  客户端或客户端侧代理主动 reset

RST 源 IP 是服务端：
  服务端或服务端侧代理主动 reset

RST 源 IP 是 LB / proxy：
  中间设备 reset
```

如果开启 TLS，仅抓包也能看到 TCP RST、FIN、SYN、ACK，但看不到加密后的应用内容。

---

### 18.5 第五步：查看连接状态

```bash
# Show TCP connection states
ss -antp

# Count states
ss -ant | awk 'NR>1 {print $1}' | sort | uniq -c

# Socket summary
ss -s
```

重点观察：

```text
CLOSE-WAIT 很多：
  对端已关闭，本端应用没有及时 close

TIME-WAIT 很多：
  短连接或主动关闭较多，不一定是故障

SYN-RECV 很多：
  握手阶段压力或半连接队列问题

ESTABLISHED 很多且发送队列积压：
  慢客户端或网络拥塞

FIN-WAIT-2 很多：
  对端没有继续完成关闭
```

---

### 18.6 第六步：查看代理和网关日志

Nginx 常见线索：

```text
recv() failed (104: Connection reset by peer)
upstream prematurely closed connection
client prematurely closed connection
```

Envoy 常见线索：

```text
upstream reset before response started
downstream reset
stream idle timeout
connection termination
local reset
remote reset
```

gRPC 常见线索：

```text
UNAVAILABLE
RST_STREAM
GOAWAY
keepalive timeout
transport is closing
```

这些日志往往比应用层异常更接近 RST 的来源。

---

### 18.7 第七步：关联发布、重启、资源指标

检查：

```bash
# Process restart / OOM
dmesg -T | grep -i -E 'killed|oom|segfault'

# Container restart
kubectl get pod -o wide
kubectl describe pod <pod>
kubectl logs <pod> --previous

# CPU / memory
top
free -m

# fd usage
ls /proc/<pid>/fd | wc -l
```

如果 reset 与发布窗口、OOM、CPU 打满、fd 耗尽高度相关，优先从服务稳定性和优雅停机治理。

---

## 19. 原因、现象、排查与解决办法汇总表

| 类别               | 典型原因                        | 常见现象            | 排查手段              | 解决办法                                  |
| ---------------- | --------------------------- | --------------- | ----------------- | ------------------------------------- |
| 服务端重启            | 发布、崩溃、OOM、kill -9           | 发布期间 reset 暴涨   | dmesg、容器事件、服务日志   | 优雅停机、摘流量、drain                        |
| 客户端取消            | 超时、用户中断、RPC deadline        | 服务端写响应时报 reset  | 服务端日志、调用链超时       | 调整 timeout，感知 cancellation            |
| idle timeout     | LB/NAT/代理清理空闲连接             | 固定时间后 reset     | 对比 timeout、抓包     | heartbeat < idleTimeout               |
| 连接池复用旧连接         | 服务端已关，客户端仍复用                | 空闲后首次请求失败       | 连接池日志、tcpdump     | client maxIdleTime < server keepalive |
| 协议不匹配            | HTTP/HTTPS、HTTP1/HTTP2、gRPC | 刚连接即 reset      | curl、openssl、代理日志 | 修正 scheme、端口、ALPN、TLS                 |
| 服务端过载            | fd、backlog、线程池、CPU          | 高峰期 reset       | ss、top、dmesg、监控   | 扩容、限流、队列保护                            |
| 代理 reset         | Nginx、Envoy、LB 策略           | 直连正常，过代理异常      | 代理日志、RST 源 IP     | 对齐代理 timeout，调整策略                     |
| 防火墙/NAT          | 连接跟踪过期、策略拒绝                 | 跨网络出现           | tcpdump、网络设备日志    | keepalive、网络策略调整                      |
| TCP keepalive 失败 | 半开连接、网络中断                   | 长连接静默后失败        | keepalive 配置、抓包   | 应用心跳、TCP_USER_TIMEOUT                 |
| 慢客户端             | 不消费推送，发送队列积压                | 服务端内存升高、写失败     | send queue、连接维度指标 | 限制队列、踢慢客户端                            |
| SO_LINGER=0      | abortive close              | close 后对端 reset | 代码审查、抓包           | 避免不必要的 RST close                      |
| 安全策略             | WAF、ACL、非法报文                | 特定请求 reset      | 安全设备日志            | 修正规则、修正报文                             |

---

## 20. 工程处理原则

### 20.1 不要只看异常文本

`Connection reset by peer` 只说明收到了 RST，不说明 RST 的业务原因。必须结合：

```text
RST 源 IP
TCP 状态
异常发生阶段
timeout 时间点
代理日志
发布记录
资源指标
```

### 20.2 不要把所有 reset 都当成严重故障

客户端取消请求、浏览器刷新、调用方超时、滚动发布期间的少量 reset，在服务端日志中很常见。它们应该被正确分类，避免污染错误告警。

### 20.3 长连接必须有心跳

对注册中心 watch、gRPC stream、WebSocket、服务治理通道来说，不能依赖业务事件保活。业务无变更时，也应该通过 heartbeat 或 ping 维持连接活性。

### 20.4 对幂等请求可以做有限重试

连接池复用旧连接导致的 reset，通常可以对幂等请求做一次快速重试。但非幂等请求必须谨慎，避免重复提交。

### 20.5 服务端写失败要清理上下文

对于注册中心 watch：

```text
写 heartbeat 失败
写实例变更失败
收到 reset
```

服务端都应该清理该连接对应的订阅关系，避免内存泄露和无效 fanout。

---

## 21. 结论

`Connection reset by peer` 的本质是 TCP 连接被对端或中间网络设备通过 RST 强制重置。它可能发生在三次握手阶段、数据传输阶段和四次挥手相关状态中，但最常见的位置是连接已经建立后的读写阶段。

在三次握手阶段，如果 SYN 收到 RST，应用更常见的是连接被拒绝；在 ESTABLISHED 阶段，对端应用、代理、LB、NAT、服务端重启、连接池复用失效连接等都可能导致 reset；在四次挥手阶段，正常路径应是 FIN，而不是 RST，RST 通常表示 abortive close 或异常中止。

工程排查的核心不是猜测，而是定位 RST 来源。最有效的方法是结合 tcpdump、ss、应用日志、代理日志、timeout 配置、发布记录和资源指标。对于注册中心、RPC、WebSocket、gRPC stream 等长连接系统，合理设计 heartbeat、keepalive、idle timeout、连接池 maxIdleTime、revision 恢复和慢客户端治理，是减少 `Connection reset by peer` 的关键。

最终可以归纳为一句话：

```text
FIN 是正常告别，RST 是强制中止；
Connection reset by peer 不是根因，而是 TCP 告诉应用：对端已经用 RST 放弃了这条连接。
```

[1]: https://man7.org/linux/man-pages/man3/errno.3.html "errno(3) - Linux manual page"
[2]: https://datatracker.ietf.org/doc/html/rfc9293 "RFC 9293 - Transmission Control Protocol (TCP)"
[3]: https://www.ibm.com/docs/ja/ibm-mq/9.3.x?topic=problems-channel-failure-return-code-econnreset-tcpip "TCP/IP の戻りコード ECONNRESET によるチャネル障害"
[4]: https://blog.cloudflare.com/ja-jp/tcp-resets-timeouts/ "TCPのリセットとタイムアウトに関するインサイトをCloudflare Radarに取り込む"
[5]: https://man7.org/linux/man-pages/man7/tcp.7.html "tcp(7) - Linux manual page"
[6]: https://man7.org/linux/man-pages/man2/send.2.html "send(2) - Linux manual page"
