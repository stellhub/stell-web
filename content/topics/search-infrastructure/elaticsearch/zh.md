# Elasticsearch 底层架构：Lucene 存储、集群协调与复制机制分析

## 摘要

Elasticsearch 是构建在 Apache Lucene 之上的分布式搜索与分析引擎，其核心能力不是通用 KV 存储，而是以 Lucene 分片索引、倒排索引、列式 Doc Values、BKD Tree、FST 词典索引、事务日志与分片副本复制共同组成的数据系统。Elasticsearch 的一致性机制分为两层：集群元数据一致性由集群协调子系统维护，文档数据复制由基于 PacificA 思想的 primary-backup 模型维护。7.0 之前使用 Zen Discovery，7.0 之后重构为 Zen2，并未直接采用 Raft，而是在保留 Elasticsearch 集群状态发布模型、滚动升级与分片管理语义的前提下实现新的协调协议。Elasticsearch 的读写流程围绕协调节点、主分片、副本分片、Lucene segment、translog 与 refresh/flush 机制展开。Elasticsearch 官方文档明确说明它基于 Apache Lucene，并用于近实时地搜索、索引、存储和分析数据；Lucene Core 是 Java 库，提供索引与搜索能力。([elastic.co][1])

**关键词：** Elasticsearch；Lucene；倒排索引；FST；PacificA；Zen Discovery；Zen2；mmap；translog；segment

---

## 1. 引言

Elasticsearch 的底层架构不能被简化为“Java 编写的 KV 存储”。Elasticsearch 的基本数据组织单元是 index；index 被切分为 shard；每个 shard 是一个自包含的 Apache Lucene index；shard 内部的数据由不可变 segment 组成。Elasticsearch 使用 primary shard 与 replica shard 形成复制组，replica 不仅提供冗余，也可以承担读请求。([elastic.co][2])

因此，Elasticsearch 的存储模型更准确地说是“分布式 Lucene 索引存储系统”：它面向全文检索、结构化过滤、聚合、排序和近实时搜索构建，而不是面向单一 key 到 value 的通用查找模型构建。Lucene 的包文档说明，倒排索引由 postings 组成，term dictionary 将 Term 映射到包含该 term 的有序文档列表；这与传统 KV 存储按 key 直接定位 value 的模型不同。([Apache Lucene][3])

---

## 2. 底层存储为何具备高查询效率

### 2.1 倒排索引：从“文档查词”转为“词查文档”

Elasticsearch 对文本字段的核心访问路径来自 Lucene 倒排索引。倒排索引维护唯一有序 term 列表，并为每个 term 维护出现该 term 的文档列表；查询时先定位 term，再读取 postings，而不是扫描全部文档。Elastic 文档在解释字段索引时明确说明，倒排索引用唯一有序 term 列表查找搜索词，并立即获得包含该词的文档列表。([elastic.co][4])

Lucene 的 postings 文件格式进一步将文档 ID、词频、位置、payload、offset 等信息拆分存储；`.doc` 文件包含包含某个 term 的文档列表、频率和 skip data，文档 ID 以 d-gap 方式编码，并使用 block packed 与 VInt 编码。该结构减少了存储空间，并允许查询执行器跳过不相关文档区间。([Apache Lucene][5])

### 2.2 Doc Values：面向排序和聚合的列式结构

全文检索主要依赖倒排索引，但排序、聚合、脚本访问等场景依赖另一类结构：Doc Values。Elastic 官方文档说明，Doc Values 是索引时构建的磁盘数据结构，保存与 `_source` 相同的字段值，但采用列式方式，因此对排序和聚合更高效。([elastic.co][4])

这说明 Elasticsearch 的底层不是单一存储结构。相同文档进入 Lucene 后，会根据字段类型和查询需求形成多种物理结构：倒排索引用于 term 查询，Doc Values 用于列式访问，BKD Tree 用于数值和空间点查询，stored fields 用于返回字段内容。

### 2.3 BKD Tree：数值、日期、地理点的空间划分

Lucene 的 BKDWriter 文档说明，BKD Tree 会递归构造 block KD-tree，将 N 维点划分到更小的矩形空间，直到每个叶子块中的点数量不超过阈值。该结构服务于数值、日期、IP、地理坐标等点数据的范围查询和空间查询。([Apache Lucene][6])

因此，Elasticsearch 的查询效率来自“预构建的访问路径”，而不是运行时扫描 JSON 文档。文本查询、聚合排序、范围查询分别落在不同 Lucene 数据结构上。

### 2.4 Segment 与近实时搜索

Lucene 的搜索单位是 segment。Elasticsearch 文档说明，新文档首先进入内存 indexing buffer，然后写入新的 segment；该 segment 会先写入文件系统缓存，此时即可被搜索，随后再被 flush 到磁盘。文档从写入到可搜索通常具有近实时特征，而不是每次写入都立即执行昂贵的 Lucene commit。([elastic.co][7])

Lucene commit 的成本较高，因此 Elasticsearch 使用 translog 记录每个 index/delete 操作。官方文档说明，所有 index/delete 操作在内部 Lucene index 处理之后、确认响应之前都会写入 translog；如果发生崩溃，已经确认但尚未包含在最近 Lucene commit 中的操作会从 translog 恢复。flush 则执行 Lucene commit，并启动新的 translog generation。([elastic.co][8])

---

## 3. 一致性保障：集群协调与分片复制

Elasticsearch 的一致性可以分为两类：一类是集群元数据一致性，例如 master 选举、cluster state 发布、索引元数据变更；另一类是文档数据一致性，例如主分片与副本分片之间的写入复制。

### 3.1 集群元数据一致性

Elastic 官方工程文章说明，Elasticsearch 集群有一个被选举出的 master node，master 负责处理集群状态更新，并将更新后的 cluster state 发布到其他节点。集群状态更新需要 master-eligible 节点的 quorum 确认，以避免两个独立节点组同时认为自己拥有 master，从而导致数据丢失。官方建议一般部署三个 master-eligible 节点，以容忍其中一个节点丢失。([elastic.co][9])

### 3.2 7.0 以前 Zen Discovery 的客观特征

7.0 以前，Elasticsearch 使用 Zen Discovery。Zen Discovery 使用 `discovery.zen.*` 相关配置，其中 `minimum_master_nodes` 是防止 split-brain 的关键配置项；7.0 之后这些设置被移除或重命名。Elastic 官方文章说明，Zen Discovery 为避免配置错误导致数据丢失，会采用保守的超时和等待策略；结果是在 master 故障后，集群可能在关键的数秒内不可用。([elastic.co][9])

Zen Discovery 的可归纳事实包括：它在早期版本中承担了 master 发现、选举和 cluster state 发布职责；它通过 `minimum_master_nodes` 这类配置降低 split-brain 风险；但该配置需要用户正确设置，配置错误可能导致数据丢失。7.0 以前还存在一些不安全恢复路径，例如在丢失半数以上 master-eligible 节点后进行恢复，或者将 stale shard copy 分配为 primary；7.0 之后 Elasticsearch 倾向于保持不可用，而不是自动执行不安全恢复。([elastic.co][9])

### 3.3 7.0 以后 Zen2 未直接采用 Raft 的原因

7.0 之后的集群协调子系统通常被称为 Zen2。Elastic 官方文章说明，新系统取消了 `minimum_master_nodes`，自动维护 voting configuration，使用简单多数作为 quorum，并使 master 选举通常在一秒内完成。([elastic.co][9])

Zen2 没有直接采用 Raft。Elastic 官方解释的原因包括：标准 Raft 和 Paxos 通常围绕操作日志建模，而 Elasticsearch 的协调对象天然是 cluster state；Elasticsearch 的 cluster state 更新天然支持 batching；标准算法对成员变更存在限制，而 Elasticsearch 需要支持集群扩缩容；同时 Elasticsearch 需要从 6.x 到 7.x 的滚动升级能力。官方文章还说明，Elastic 曾实现过接近 Raft 的原型，但完整集成所需改动很大，最终选择构建更贴合 Elasticsearch cluster state 发布模型的新协议。([elastic.co][9])

---

## 4. 分片数据同步：PacificA 模型与 ISR 语义比较

Elasticsearch 官方文档明确说明，其数据复制模型基于 primary-backup 模型，并引用 PacificA 论文。每个 replication group 包含一个 primary shard 和若干 replica shard；所有 index/delete/update 操作必须先到 primary；primary 验证操作后在本地执行，然后并行转发给 in-sync replicas；所有 in-sync replicas 成功执行并响应后，primary 才向客户端确认。([elastic.co][10])

这里的“同步协议”不是独立于 Elasticsearch 的外部网络协议名称，而是 Elasticsearch 内部 shard replication protocol：协调节点将请求路由到目标 replication group 的 primary，primary 执行并转发到副本，副本确认后 primary 返回结果。该模型的关键约束是：已确认写入必须存在于所有 in-sync shard copies 中。([elastic.co][10])

Kafka 与 Elasticsearch 都存在“leader/primary + in-sync 副本集合 + 写入确认”的共同语义，但二者不是同一个实现。Kafka 官方资料中，`acks=all` 表示 leader 等待完整 ISR 集合确认写入；`min.insync.replicas` 用于约束最小同步副本数。Elasticsearch 官方文档使用的是 “in-sync copies” 表述，并且其复制对象是 Lucene shard operation，而 Kafka 的复制对象是 partition log record。([Apache Wiki][11])

| 维度   | Elasticsearch                      | Kafka                           |
| ---- | ---------------------------------- | ------------------------------- |
| 主角色  | Primary shard                      | Partition leader                |
| 副本集合 | In-sync shard copies               | ISR                             |
| 写入确认 | Primary 等待所有 in-sync replicas 成功执行 | `acks=all` 等待 ISR 确认            |
| 复制对象 | 文档写入操作、Lucene shard 状态             | 分区日志记录                          |
| 理论来源 | PacificA primary-backup 模型         | Leader-follower log replication |

因此，“Kafka 和 Elasticsearch 都有 ISR 风格语义”是事实；“二者使用完全相同的 ISR 机制”不是准确表述。Elasticsearch 的术语、复制对象、失败处理、Lucene 提交模型均不同于 Kafka。

---

## 5. FST 如何压缩前缀

Lucene 的 BlockTree Terms Dictionary 将 term dictionary 和 terms index 拆分为 `.tim`、`.tmd`、`.tip` 等文件。其中 `.tip` 是 terms index，包含每个字段一个 FST；该 FST 将 term prefix 映射到磁盘上的 term block。官方文档说明，FST 不是保存所有完整 term，而是将 term prefix 映射到包含该 prefix 的磁盘 block；如果查询 term 的 prefix 路径不存在，Lucene 可以在不发生磁盘 seek 的情况下判断该 term 不存在。([Apache Lucene][12])

最小示例如下，假设词典包含 `car`、`cat`、`dog`、`dot`：

```text
terms:
  car, cat, dog, dot

FST prefix index:

          [root]
          /    \
        c        d
        |        |
        a        o
        |        |
     output   output
     fp=10    fp=42

.tim term blocks:

  fp=10 -> block_ca: [car, cat]
  fp=42 -> block_do: [dog, dot]
```

该图表达两个事实。第一，公共前缀只保存一次：`car` 与 `cat` 共享 `c -> a`，`dog` 与 `dot` 共享 `d -> o`。第二，FST 的输出不是文档内容，而是 term block 的文件位置或 block 指针；真正的 term 仍在 `.tim` block 中。Lucene 的 BlockTree 还会将 term 分配到共享前缀的可变长度 block 中，terms index 形成一个 prefix trie，叶子指向 term block。([Apache Lucene][13])

---

## 6. Lucene 与磁盘交互：Directory、filesystem cache 与 mmap

Lucene 通过 `Directory` 抽象访问索引文件。Lucene 官方文档说明，`store` 包定义了 Directory 抽象，表示一个命名文件集合，写入通过 `IndexOutput`，读取通过 `IndexInput`；`FSDirectory` 通常被推荐，因为它能有效利用操作系统磁盘缓存。([Apache Lucene][14])

Elasticsearch 的 index store 默认由 `fs` 类型选择最合适的文件系统实现；当前默认通常是 `hybridfs`。Elastic 官方文档说明，`mmapfs` 会把文件映射到内存，`hybridfs` 会根据文件类型混合使用 NIOFSDirectory 与 MMapDirectory；当前 term dictionary、norms、doc values 通常使用 mmap，其他文件使用 NIOFSDirectory。([elastic.co][15])

Lucene 的 `MMapDirectory` 文档说明，它是基于文件系统的 Directory 实现，读取时使用 mmap，写入时使用 `FSIndexOutput`；mmap 会消耗与被映射文件大小相等的虚拟地址空间。([Apache Lucene][16])

因此，“Lucene 是否使用 mmap”的准确表述是：Lucene 提供 MMapDirectory；Elasticsearch 默认的 hybridfs 会对部分文件类型使用 mmap，而不是所有文件无条件使用 mmap。

---

## 7. Elasticsearch 写入流程

Elasticsearch 写入流程可抽象为以下阶段。

**第一，客户端请求进入协调节点。** 任意节点都可以成为 coordinating node。协调节点根据 index、document id 或 routing 计算目标 shard，并将写入转发到该 replication group 的 primary shard。

**第二，primary shard 执行 primary stage。** Primary 验证写入请求，例如结构、字段映射、版本约束等；验证通过后，primary 在本地执行写入，并将操作并行转发给当前 in-sync replicas。官方文档说明，primary stage 与 replica stage 是顺序执行的：先路由到 primary，primary 本地执行并转发，replica 执行成功后响应 primary。([elastic.co][10])

**第三，写入进入 Lucene 与 translog。** Lucene 内部处理 index/delete 后，Elasticsearch 在返回确认前写入 translog。由于 Lucene commit 昂贵，Elasticsearch 不会每次请求都执行完整 commit；已确认但尚未进入最近 commit 的操作可以依靠 translog 恢复。([elastic.co][8])

**第四，replica stage 完成后返回确认。** 当所有 in-sync replicas 都成功执行该操作并返回给 primary 后，primary 向客户端确认。该流程体现了 PacificA primary-backup 模型。([elastic.co][10])

**第五，refresh 使数据近实时可见。** 新写入先进入 indexing buffer，随后生成新的 segment，并先进入 filesystem cache；此时 segment 可被搜索。Elastic 文档说明，Elasticsearch 具有近实时搜索特征，文档从写入到可搜索通常约为 1 秒。([elastic.co][7])

```text
Client
  |
  v
Coordinating Node
  |
  v
Primary Shard
  |-- local Lucene indexing
  |-- translog append
  |-- forward operation in parallel
  v
Replica Shards
  |
  v
Primary receives replica acknowledgements
  |
  v
Client acknowledgement
```

---

## 8. Elasticsearch 读取流程

读取流程根据请求类型分为 get-by-id 与 search 两类。官方文档说明，对于读取请求，primary-backup 模型会使同一 replication group 内的 shard copies 保持相同，除了正在进行中的操作外；因此单个 in-sync copy 即可服务读取。协调节点会解析请求涉及的 shard，并为每个 shard replication group 选择一个 active copy，默认使用 adaptive replica selection，然后发送 shard-level read request，最后合并结果并返回客户端。([elastic.co][10])

搜索请求通常具有 scatter/gather 特征。Elastic 的节点角色文档说明，搜索请求以两个阶段执行：scatter 阶段将请求转发到持有所需数据的数据节点；gather 阶段由协调节点将每个数据节点的结果规约为全局结果集。([elastic.co][17])

```text
Client
  |
  v
Coordinating Node
  |
  |-- resolve target indices and shards
  |-- choose primary or replica copy
  |-- scatter shard-level query
  v
Data Nodes / Shard Copies
  |
  |-- execute Lucene query locally
  |-- return top hits / aggregations partial result
  v
Coordinating Node
  |
  |-- reduce / merge
  v
Client
```

Elasticsearch 读路径具备一个重要限制：官方文档说明，读请求可能在写入尚未确认前看到变更；在网络隔离场景下，如果旧 primary 尚未意识到自己已被隔离，也可能产生 dirty read。Elasticsearch 通过 primary 定期与 master 交互来降低这类风险。([elastic.co][10])

---

## 9. 结论

Elasticsearch 的底层不是 KV 存储，而是基于 Lucene 的分布式索引系统。它的查询效率来自倒排索引、FST term index、postings block encoding、Doc Values、BKD Tree、filesystem cache、mmap/hybridfs 与 immutable segment 等结构组合。它的一致性机制不是单一协议：集群元数据由 Zen/Zen2 集群协调机制维护，分片数据由基于 PacificA 的 primary-backup 复制模型维护。7.0 之前的 Zen Discovery 依赖 `minimum_master_nodes` 等配置并使用保守超时；7.0 之后 Zen2 自动维护 voting configuration，并未直接采用 Raft，原因与 Elasticsearch 以 cluster state 为核心的发布模型、成员变更、批处理和滚动升级需求有关。Elasticsearch 与 Kafka 都存在 in-sync 副本集合的写入确认语义，但二者不是同一实现。

## 参考资料

1. Elastic Docs：Elasticsearch Reference、Index fundamentals、Near real-time search、Reading and writing documents。([elastic.co][1])
2. Apache Lucene 官方文档：Lucene Core、Index package、BlockTree Terms Dictionary、Lucene90 Postings Format、MMapDirectory。([Apache Lucene][18])
3. Elastic 官方工程文章：Elasticsearch 7.0 集群协调与 Zen2 设计说明。([elastic.co][9])
4. Elastic Docs：Index store settings、Translog、Doc values。([elastic.co][15])

[1]: https://www.elastic.co/docs/reference/elasticsearch "Elasticsearch | Elasticsearch Reference"
[2]: https://www.elastic.co/docs/manage-data/data-store/index-basics "Index fundamentals | Elastic Docs"
[3]: https://lucene.apache.org/core/10_1_0/core/org/apache/lucene/index/package-summary.html "org.apache.lucene.index (Lucene 10.1.0 core API)"
[4]: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/doc-values "doc_values | Elasticsearch Reference"
[5]: https://lucene.apache.org/core/9_7_0/core/org/apache/lucene/codecs/lucene90/Lucene90PostingsFormat.html "Lucene90PostingsFormat (Lucene 9.7.0 core API)"
[6]: https://lucene.apache.org/core/8_6_0/core/org/apache/lucene/util/bkd/BKDWriter.html "BKDWriter (Lucene 8.6.0 API)"
[7]: https://www.elastic.co/docs/manage-data/data-store/near-real-time-search "Near real-time search | Elastic Docs"
[8]: https://www.elastic.co/docs/reference/elasticsearch/index-settings/translog "Translog settings | Elasticsearch Reference"
[9]: https://www.elastic.co/blog/a-new-era-for-cluster-coordination-in-elasticsearch "A new era for cluster coordination in Elasticsearch | Elastic Blog"
[10]: https://www.elastic.co/docs/deploy-manage/distributed-architecture/reading-and-writing-documents "Reading and writing documents | Elastic Docs"
[11]: https://cwiki.apache.org/confluence/display/KAFKA/KIP-926%3A%2Bintroducing%2Backs%3Dmin.insync.replicas%2Bconfig?utm_source=chatgpt.com "KIP-926: introducing acks=min.insync.replicas config"
[12]: https://lucene.apache.org/core/9_0_0/core/org/apache/lucene/codecs/lucene90/blocktree/Lucene90BlockTreeTermsWriter.html "Lucene90BlockTreeTermsWriter (Lucene 9.0.0 core API)"
[13]: https://lucene.apache.org/core/10_1_0/core/org/apache/lucene/codecs/lucene90/blocktree/Lucene90BlockTreeTermsReader.html "Lucene90BlockTreeTermsReader (Lucene 10.1.0 core API)"
[14]: https://lucene.apache.org/core/10_0_0/core/index.html "Overview (Lucene 10.0.0 core API)"
[15]: https://www.elastic.co/docs/reference/elasticsearch/index-settings/store "Index store settings | Elasticsearch Reference"
[16]: https://lucene.apache.org/core/10_2_0/core/org/apache/lucene/store/MMapDirectory.html "MMapDirectory (Lucene 10.2.0 core API)"
[17]: https://www.elastic.co/docs/deploy-manage/distributed-architecture/clusters-nodes-shards/node-roles?utm_source=chatgpt.com "Node roles"
[18]: https://lucene.apache.org/ "Apache Lucene - Welcome to Apache Lucene"
