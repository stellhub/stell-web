# 高可用分布式限流系统设计：从单机令牌桶到异步配额分配模型

## 摘要

限流是服务端系统在高并发、流量突增、资源竞争和滥用访问场景下常用的流量治理机制。其目标是在给定时间窗口内控制请求、连接或资源消耗速率，使后端服务、数据库、缓存、第三方依赖和共享基础设施维持在可承载范围内。单机限流通过本地计数器、本地令牌桶或漏桶算法在单个进程、节点或网关实例内完成快速判定，具备低延迟、低依赖和故障隔离特征，但在多实例负载均衡不均衡时会产生全局配额误差。分布式限流通过共享计数器、全局限流服务或配额协调服务在多个实例之间协调限流决策，能够降低单机限流在负载不均情况下的误差，但会引入额外的集中式依赖、远程调用链路和限流服务端热点。由于限流本身面向超高 QPS 场景，精确同步的每请求全局计数会把业务请求压力线性转移到限流后端，导致 Redis、缓存集群或数据库后端面临单热点 key、单分片写入、远程调用放大和可用性风险。公开官方文档中的主流实现表明，大规模分布式限流通常采用本地粗粒度限流、全局细粒度限流、配额预分配、周期上报、异步重平衡、边缘限流、分区限流和故障降级相结合的架构。该设计以牺牲严格精确性为代价，换取高可用性、抗热点能力和系统整体保护能力。

**关键词**：分布式限流；全局限流；令牌桶；漏桶；配额分配；高可用；热点治理；服务端保护

## 1 引言

在微服务、API 网关、服务网格、边缘网络和云原生架构中，单个后端资源通常会被多个客户端、多个服务实例或多个入口节点共同访问。当请求速率超过后端资源的处理能力时，过量请求会造成排队延迟上升、线程池耗尽、连接池耗尽、数据库压力放大、缓存雪崩、下游服务级联故障或恶意流量消耗资源。官方文档中对限流的定义通常集中在“控制一定时间内的请求数量”以及“防止过载、抵御滥用、保障公平使用和实现配额权益”等方面。例如，Envoy Gateway 将 rate limiting 描述为在定义时间段内控制入站请求数量的技术，可用于业务配额、系统稳定性、防止过载和防御拒绝服务攻击；NGINX 文档将请求速率限制用于防止 DDoS 或防止上游服务器被过多并发请求压垮；AWS API Gateway 文档将 throttling 与 quotas 用于帮助 API 避免被过多请求压垮；Google Cloud Armor 文档将 rate-based rules 用于保护应用免受大量请求冲击，并避免单个客户端耗尽应用资源。[1][2][3][4]

限流并非仅适用于公网 API。其典型场景包括：公网 API 网关限流、登录和验证码接口防爆破、爬虫和恶意客户端抑制、租户级 API 配额、内部服务之间的调用保护、数据库和缓存前置保护、消息消费速率控制、第三方 API 调用额度保护、按用户身份或 API key 的用量控制，以及在服务网格中对某个路由、服务、实例或后端集群执行流量保护。

## 2 限流对象与算法基础

限流对象可以是请求、连接、字节、令牌、业务成本或抽象 quota unit。限流维度可以是 IP、用户、租户、API key、路由、方法、服务名、地域、设备指纹、请求头、Cookie、业务标签或多个维度的组合。限流算法通常包括固定窗口、滑动窗口、漏桶和令牌桶。不同算法对应不同的时间窗口精度、突发流量吸收能力、状态存储成本和计算复杂度。

令牌桶在云厂商 API 网关中较常见。AWS API Gateway 官方文档说明其使用 token bucket algorithm 执行 throttling，其中 token 代表一次请求，系统根据请求提交的速率和突发限制进行判断。NGINX 请求速率限制文档说明其方法基于 leaky bucket algorithm。Apache APISIX 的 `limit-count` 插件文档说明其使用 fixed window algorithm，在给定时间间隔内限制请求数量，超过配额的请求会被拒绝。[3][4][5]

## 3 单机限流：能力边界与误差来源

单机限流是指限流状态保存在单个进程、单个代理、单个网关实例或单个服务节点内，限流判定不依赖外部共享状态。Envoy 官方文档将 local rate limiting 称为 non-distributed rate limiting，并说明 Envoy 支持 L4 连接级本地限流和 HTTP 请求级本地限流。Envoy HTTP local rate limit filter 使用 token bucket；当没有 token 时，默认返回 429。NGINX 也支持基于共享内存区域在同一 NGINX 实例内按 key 统计连接数或请求速率。[2][6][7]

单机限流解决的问题包括以下几类。第一，它能在本节点快速拒绝超额请求，避免请求继续进入业务线程池、连接池或后端依赖。第二，它不需要远程限流服务，限流判断延迟低。第三，它在限流服务、Redis 或数据库不可用时不会额外扩大故障面。第四，它可以吸收瞬时突发流量，作为后续全局限流之前的粗粒度保护层。

单机限流的问题在于其状态只在本实例内可见。在多副本部署中，如果每个实例独立维护本地限流桶，则全局行为依赖负载均衡结果。设全局目标配额为 `L`，实例数为 `N`，每个实例本地配额设为 `L/N`。当流量均匀分布时，全局放行量接近 `L`。当流量不均匀时，热实例可能提前耗尽本地配额并拒绝请求，而冷实例仍有剩余配额，导致全局放行量小于目标配额。若每个实例均配置为完整配额 `L`，则全局理论放行上限会扩大到 `N × L`。Envoy Gateway 官方文档给出相同现象：本地限流是每个 Envoy 实例独立执行；如果两个 Envoy 副本分别限制 50 次/分钟，总体上可能允许 100 次/分钟；三个副本时，理论最大值会随副本数放大。[8]

因此，单机限流的误差来自两个方向：一是副本数导致总配额被放大，二是负载均衡不均导致部分实例拒绝请求而其他实例配额闲置。该误差在长连接、HTTP/2、gRPC、客户端连接复用、四层负载均衡不均衡、地域流量倾斜和热点租户集中访问时会更加明显。

## 4 分布式限流：全局一致性与新增故障点

分布式限流的核心目标是在多个网关、代理或服务实例之间共享限流状态，使多个入口节点共同遵守同一个全局配额。Envoy 官方文档说明 global rate limiting 在特定场景下是合适方案，尤其是大量下游主机转发到少量上游主机且平均请求延迟较低时；Envoy 提供两类全局限流实现：每连接或每 HTTP 请求限流检查，以及基于配额、周期负载上报、在多个 Envoy 实例之间公平共享全局限额的实现。[9]

每请求式全局限流的典型实现是代理在请求路径上调用外部 Rate Limit Service。Envoy HTTP rate limit filter 会在路由或虚拟主机存在匹配限流配置时调用 rate limit service，每个匹配配置会产生 descriptor 并发送给限流服务；如果任一 descriptor 超限，则返回 429。Istio 官方任务文档也说明，Envoy 支持 global 和 local 两种限流；global rate limiting 使用全局 gRPC rate limiting service 为整个 mesh 提供限流，local rate limiting 用于按服务实例限制请求速率。[9][10]

分布式限流解决了单机限流在负载均衡不均衡时的全局配额误差。全局限流服务可以按租户、API、路由、IP、服务或组合 descriptor 维护统一计数，使不同入口实例不再只依赖本地状态。然而，分布式限流也引入了新的故障点。Envoy 的 HTTP rate limit filter 存在 `failure_mode_deny` 配置：当限流服务未响应时，若该配置为 true，Envoy 在限流服务通信失败时不允许流量通过；若发生调用错误且配置为 true，会返回错误。Kong Gateway 文档说明，当 Redis strategy 下 Kong 节点与 Redis 断开时会回退到 local rate limiting，此时节点之间不能同步计数，用户可能执行超过限制的请求。Apache APISIX 的 `limit-count` 插件提供 `allow_degradation` 配置，表示当插件或依赖不可用时允许 APISIX 在没有该插件的情况下继续处理请求。[11][12][5]

由此可以得到一个客观约束：分布式限流在提升全局配额一致性的同时，必须处理外部限流服务、共享存储、网络调用、超时、故障降级和数据一致性之间的权衡。若选择 fail-closed，限流服务故障可能阻断正常请求；若选择 fail-open 或 local fallback，全局限流精度会下降。

## 5 精确同步全局计数的容量约束

限流通常发生在超高 QPS 场景。若每个业务请求都同步访问一个全局计数后端，则限流后端的请求量与被保护业务的请求量同阶。Envoy 文档明确说明，每连接或每 HTTP 请求的全局限流会对每个新连接或每个新请求调用 rate limit service。Envoy 的参考实现是 Go/gRPC 服务，读取限流配置后生成 cache key 并访问 Redis cache 返回判定结果。[9][13]

当全局计数采用 Redis、缓存集群或数据库实现时，精确同步计数会形成以下约束。第一，所有放行或拒绝判断都依赖远程状态读写，限流系统本身会成为请求链路上的同步依赖。第二，同一个全局限流 key 对应的所有请求必须作用于同一个逻辑计数对象，热点租户、热点 API 或全局总量 key 会形成热点。第三，Redis Cluster 虽然可以通过 slot 将 key 分布到多个节点，但官方文档说明一个 key 不会被拆分到多个节点；每个 master 节点服务 16384 个 hash slot 的子集，稳定状态下单个 hash slot 由单个节点服务。Redis 官方文档也提供 hotkeys tracking，用于识别在跟踪期间消耗较高 CPU 时间或网络字节比例的 key。[14][15]

因此，使用 Redis 或任意高性能数据库实现“每请求、强一致、全局精确”的限流，并不能消除热点写入和中心化依赖问题。它只是把业务请求压力转换为限流存储压力。对于极高 QPS、少数热点 key 或全局总配额场景，精确同步计数的瓶颈会集中在限流服务、网络链路、Redis 分片、数据库分区或单个热点 key 上。

## 6 可用性优先的异步配额模型

大规模分布式限流通常不以“每个请求都远程精确计数”为唯一目标，而是以“保护系统可用性”为主要目标。多个官方文档均说明了限流精确性与分布式架构之间的张力。AWS API Gateway 文档说明 throttles 和 quotas 以 best-effort 方式应用，应被视为目标值而不是有保证的请求上限；usage plan 的 throttling 和 quotas 也不是 hard limits，客户端在某些情况下可能超过配额。Azure API Management 文档说明，由于 throttling 架构的分布式性质，rate limiting 从不完全准确，配置允许请求数与实际请求数的差异会随请求量、速率、后端延迟等因素变化。Google Cloud Armor 文档说明其强制执行的 rate limits 是 approximate，可能与配置阈值并不严格一致，并建议 rate limiting 用于 abuse mitigation 或维护应用和服务可用性，而不是严格配额或许可要求。Cloudflare 文档说明 rate limiting rules 并不是为了允许精确数量的请求到达源站，计数器更新存在最高几秒延迟，且其计数器默认按数据中心范围维护。Fastly 文档说明其 rate counters 设计目标是快速统计高流量，而不是精确计数，并区分 anti-abuse rate limiting 与 resource rate limiting。[3][16][17][18][19][20]

异步配额模型的基本思想是将“实时获取和计算配额”从请求同步路径中移出。Envoy Rate Limit Quota Service 协议提供了一个典型模型：数据面将请求归入 quota bucket，周期性向 RLQS 上报请求负载；RLQS 汇总多个数据面实例的使用报告，并向每个实例分发 Rate Limit Assignment；当配额变化时，RLQS 主动推送新的 assignment；Envoy filter 根据本地收到的 quota assignment 执行请求判定。该模式将每请求远程计数改为周期性用量上报和本地配额消耗，减少全局限流服务在超高 QPS 下的同步压力。[21]

在该模型中，精确度损失来自上报周期、配额下发延迟、实例间负载变化、配额 TTL、故障时使用最后一次 assignment 或预设 fallback 值等因素。可用性收益来自请求路径本地化、远程调用降频、限流服务端负载平滑和故障降级空间增加。

## 7 主流厂商与开源组件的实现模式

公开官方文档中的主流实现可以归纳为以下几类。

第一类是本地限流。NGINX 使用共享内存区域在单实例内按 key 统计连接或请求速率，并基于漏桶限制请求。Envoy local rate limit filter 使用本地 token bucket，在没有 token 时返回 429。该模式适合节点级保护、突发吸收和低依赖场景。[2][6][7]

第二类是外部全局限流服务。Envoy 通过 gRPC Rate Limit Service 执行全局限流，参考实现使用 Go/gRPC 和 Redis backend。Istio 通过 EnvoyFilter 接入 Envoy 的 global rate limit HTTP filter，并以 Envoy 提供的 Go + Redis 参考实现作为示例。Envoy Gateway 的 global rate limit 任务文档也要求配置 Redis 作为 rate limit backend。[9][10][13][22]

第三类是本地与全局组合。Envoy 文档说明 local rate limiting 可以和 global rate limiting 结合使用，以降低全局限流服务负载；本地 token bucket 可以吸收可能压垮全局限流服务的大突发流量。Envoy Gateway 文档也说明 local limit 先在每个 Envoy 实例执行，global limit 再由共享 rate limit service 执行，一个请求必须通过两层检查才会放行。[8][9]

第四类是网关插件的多策略计数。Apache APISIX `limit-count` 插件支持 `local`、`redis` 和 `redis-cluster` 策略；local 将计数器保存在本地内存，redis 和 redis-cluster 将计数器保存在 Redis 或 Redis Cluster 中，并可让多个 APISIX 节点共享配额。Kong Gateway 的高级限流插件支持 Redis strategy，并在 Redis 断连时回退到本地限流。[5][12]

第五类是云厂商托管限流。AWS API Gateway 使用 token bucket，并支持 account-level、stage-level、method-level 和 usage plan 维度的 throttling 与 quotas，但将其定义为 best-effort 目标而非严格上限。Azure API Management 提供 `rate-limit` 和 `rate-limit-by-key` policy，并明确说明分布式 throttling 架构下限流并不完全准确。Google Cloud Armor 提供 throttle 和 rate-based ban，并支持按 ALL、IP、HTTP_HEADER、XFF_IP、Cookie、HTTP_PATH、SNI、REGION_CODE、JA3/JA4 等 key 聚合请求，但其文档说明跨 region 和内部路由会影响准确性。Cloudflare WAF rate limiting rules 按特征组合维护计数器，但默认不支持全网全局计数器。Fastly Edge Rate Limiting 提供 ratecounter 和 penaltybox，其 ratecounter 用于快速统计高流量而非精确计数。[3][16][17][18][19][20]

上述实现显示，大规模限流的工程形态并不是单一的“Redis 精确计数器”，而是由本地限流、全局限流、共享存储、异步上报、边缘限流、近似计数、故障降级和多级保护共同组成。

## 8 超大流量下的热点与大量连接治理

当超大流量应用接入分布式限流时，限流服务端会面临两类热点。第一类是计数热点，即大量请求集中到同一个限流 key、同一个 Redis slot、同一个数据库分区或同一个全局配额对象。第二类是连接热点，即大量代理、网关或客户端与少数限流服务实例建立长连接，导致连接数、HTTP/2 stream、gRPC subchannel、连接池和服务端线程模型产生不均衡。

计数热点的标准治理方式包括：

1. **本地粗限流前置**。在进入全局限流服务前，每个代理实例先使用本地 token bucket 或漏桶吸收突发流量。Envoy 官方文档明确说明，本地 token bucket 可以吸收可能压垮全局限流服务的大突发流量，从而形成“本地粗粒度 + 全局细粒度”的两阶段限流。[9]

2. **异步配额预分配**。将全局配额拆成分配给各数据面实例的本地 quota assignment。实例在本地消费配额，周期性上报实际用量，由服务端重新平衡。Envoy RLQS 即采用数据面周期上报、服务端汇总并下发 assignment 的模型。[21]

3. **按限流维度拆分 key**。使用租户、API、路由、地域、调用方、用户、请求头或业务标签作为限流 key，使不同业务实体落到不同计数对象。Cloudflare、Google Cloud Armor、APISIX 和 Envoy RLS 均支持按不同 key、characteristics 或 descriptor 进行聚合。[5][13][18][19]

4. **热点 key 虚拟分片**。对于天然全局的热点 key，可将单一逻辑 key 拆成多个虚拟 bucket，由本地实例或入口节点按 hash 写入不同 bucket，再通过异步聚合获得近似全局用量。该设计以精确度和实时性为代价换取写入扩散能力。Redis Cluster 文档中“单个 key 不会跨节点拆分”的事实决定了热点 key 需要在应用层拆分，而不能仅依赖 Redis Cluster 自动消除单 key 热点。[14][15]

5. **分地域、分单元、分集群限流**。将全局配额按 region、availability zone、cell 或集群预切分，使限流判定在局部完成。Google Cloud Armor 文档说明其 rate limit threshold 在每个关联 backend 或 region 中独立执行，Cloudflare 也说明计数器默认按数据中心维护；这些实现体现了边缘或地域分区的限流方式。[18][19]

连接热点的标准治理方式包括：

1. **限流服务水平扩展并启用客户端负载均衡**。gRPC 官方文档说明，load balancing 用于将请求分布到多个服务器，避免某个服务器过载；默认 `pick_first` 策略不会真正负载均衡，而 `round_robin` 会连接到解析得到的所有地址，并在每个 RPC 上轮转后端。对于 RLS 这类高频 gRPC 服务，客户端侧 round_robin 或 xDS/Envoy 负载均衡可以避免大量 RPC 固定落到单个服务实例。[23]

2. **使用 L7 负载均衡策略**。Envoy 支持 pluggable load balancing policy，包括 weighted round robin、client-side weighted round robin、weighted least request、ring hash、Maglev 和 random。对于限流服务端，least request、weighted round robin 或基于负载报告的 client-side weighted round robin 可用于降低实例间请求不均衡。[24]

3. **使用服务发现和 EndpointSlice 动态更新后端集合**。Kubernetes Service 为一组 Pod 提供稳定访问入口，EndpointSlice 记录当前支撑 Service 的 Pod 集合，service proxy 将流量路由到后端。该机制可用于暴露多副本 RLS，但对长连接协议仍需结合 gRPC 客户端负载均衡或 L7 代理，避免少量长连接固定到少数后端。[25]

4. **连接池、超时与熔断隔离**。全局限流服务必须设置短超时、连接池容量、错误统计和故障策略。Envoy rate limit filter 默认存在 timeout 配置，并支持 `failure_mode_deny`、`status_on_error`、runtime fractional enforcement 等字段。该机制允许系统在限流服务慢、错、不可达时执行 fail-open、fail-closed 或按比例降级。[11]

5. **边缘限流与源站前置削峰**。Cloudflare、Fastly、Google Cloud Armor 等边缘侧限流能力可以在请求到达源站或内部服务网格前执行粗粒度过滤。边缘限流的文档通常明确其计数并非全局严格精确，但它能降低源站和内部限流服务需要处理的原始请求量。[18][19][20]

## 9 分布式限流系统参考架构

一个面向超高 QPS 的分布式限流系统可以采用以下分层结构。

第一层为边缘限流层，部署在 CDN、WAF、云负载均衡或公网 API 网关侧，按 IP、地理位置、设备指纹、路径、Header、Cookie 或 API key 进行粗粒度限流。该层用于减少恶意流量、爬虫、爆破和异常突发对内部系统的冲击。

第二层为本地实例限流层，部署在 Envoy、NGINX、APISIX、Kong、应用 sidecar 或服务进程内。该层以本地 token bucket、leaky bucket 或固定窗口计数器执行快速判定，保护本实例线程池、连接池和下游依赖，同时降低全局限流服务压力。

第三层为全局配额协调层，按租户、服务、路由、API key、业务资源或组合 descriptor 维护逻辑配额。对于中低 QPS 或需要较强一致性的规则，可采用每请求式 RLS + Redis/Redis Cluster。对于超高 QPS、热点 key 或负载明显不均的规则，应采用 quota lease、周期上报和配额下发模型，使数据面在本地执行判定，并将全局协调降频到秒级或更长周期。

第四层为异步聚合与审计层，接收日志、metrics、限流命中统计和配额消耗报告，用于补偿计算、报表、告警、租户用量审计、规则调优和长期 quota 管理。该层不在请求同步路径上执行强依赖判定。

第五层为故障降级层，定义限流服务不可用、Redis 不可用、配额 assignment 过期、配置中心不可用、跨地域网络分区等情况下的行为。常见策略包括 fail-open、fail-closed、继续使用最后一次配额、本地默认配额、按比例拒绝、只启用边缘和本地限流、禁用非核心高成本接口等。

该架构的核心约束是：同步路径只保留必要的本地判定；全局协调通过异步上报、配额预分配和周期性重平衡完成；精度由业务场景决定，反滥用和服务保护场景优先保证可用性，计费、许可和强配额场景需要额外审计、补偿和低速强一致校验。

## 10 结论

限流的意义在于控制请求、连接或资源消耗速率，以保护后端服务和共享资源免受过载、滥用和突发流量影响。单机限流解决了本节点快速保护问题，但在多实例负载均衡不均衡时存在全局配额误差。分布式限流解决了多实例共享配额问题，但引入外部限流服务、共享存储和网络调用作为新的故障点。由于限流本身面向超高 QPS 场景，精确同步的每请求全局计数会把业务请求压力线性转移到限流后端，并在 Redis、数据库或缓存集群中形成热点 key 和单分片瓶颈。主流官方实现显示，大规模限流系统普遍接受一定近似性，通过本地限流、全局限流、异步配额、周期上报、边缘削峰、分区执行、热点拆分和故障降级共同实现服务端保护。对于超大流量应用，分布式限流的设计重点不是追求绝对精确计数，而是在明确误差边界的条件下维持系统可用性、降低热点、保护核心依赖并避免限流系统自身成为新的瓶颈。

## 参考文献

[1] Envoy Gateway Rate Limiting 官方文档。
[2] NGINX Limiting Access to Proxied HTTP Resources 官方文档。
[3] AWS API Gateway Throttle requests 官方文档。
[4] Google Cloud Armor Rate limiting overview 官方文档。
[5] Apache APISIX limit-count 插件官方文档。
[6] Envoy Local rate limiting 官方文档。
[7] Envoy HTTP local rate limit filter 官方文档。
[8] Envoy Gateway Local 与 Global Rate Limiting 官方文档。
[9] Envoy Global rate limiting 官方文档。
[10] Istio Enabling Rate Limits using Envoy 官方文档。
[11] Envoy HTTP rate limit filter / proto 官方文档。
[12] Kong Rate Limiting Advanced 插件官方文档。
[13] Envoy Ratelimit Go/gRPC reference implementation 官方仓库。
[14] Redis Cluster specification 官方文档。
[15] Redis HOTKEYS 官方文档。
[16] AWS API Gateway usage plans 官方文档。
[17] Azure API Management rate-limit policy 官方文档。
[18] Google Cloud Armor rate limiting overview / Envoy integration 官方文档。
[19] Cloudflare WAF rate limiting rules / request rate calculation 官方文档。
[20] Fastly Rate limiting 官方文档。
[21] Envoy Rate Limit Quota Service / Rate Limit Quota filter 官方文档。
[22] Envoy Gateway Global Rate Limit 官方文档。
[23] gRPC Custom Load Balancing Policies 官方文档。
[24] Envoy Supported load balancers 官方文档。
[25] Kubernetes Service / EndpointSlice 官方文档。
