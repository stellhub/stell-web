---
title: "Elasticsearch Internals: Lucene Storage, Cluster Coordination, and Replication Mechanisms"
category: "Search Infrastructure"
summary: "A systematic analysis of Elasticsearch internals, including Lucene storage, inverted indexes, Doc Values, BKD Tree, FST, segments, translog, cluster coordination, Zen2, and primary-backup shard replication."
tags:
  - "Elasticsearch"
  - "Lucene"
  - "Inverted Index"
  - "Zen2"
  - "PacificA"
readingDirection: "Read this when studying why Elasticsearch is not a generic KV store, where Lucene query efficiency comes from, how shard replication consistency works, or how Zen2 coordination and read/write paths behave."
outline: deep
---

# Elasticsearch Internals: Lucene Storage, Cluster Coordination, and Replication Mechanisms

## Overview

A systematic analysis of Elasticsearch internals, including Lucene storage, inverted indexes, Doc Values, BKD Tree, FST, segments, translog, cluster coordination, Zen2, and primary-backup shard replication.

## Abstract

Elasticsearch is a distributed search and analytics engine built on Apache Lucene. Its core capability is not generic KV storage, but a data system formed by Lucene shard indexes, inverted indexes, columnar Doc Values, BKD Tree, FST term dictionaries, transaction logs, and shard replica replication. Elasticsearch consistency is divided into two layers: cluster metadata consistency is maintained by the cluster coordination subsystem, while document data replication is maintained by a primary-backup model inspired by PacificA. Before 7.0, Elasticsearch used Zen Discovery. After 7.0, it was rebuilt as Zen2. It did not directly adopt Raft; instead, it implemented a new coordination protocol while preserving Elasticsearch's cluster-state publishing model, rolling upgrades, and shard-management semantics. Elasticsearch read and write flows revolve around coordinating nodes, primary shards, replica shards, Lucene segments, translog, and refresh/flush mechanisms. The official Elasticsearch documentation states that it is based on Apache Lucene and is used to search, index, store, and analyze data in near real time; Lucene Core is a Java library that provides indexing and search capabilities. ([elastic.co][1])

**Keywords:** Elasticsearch; Lucene; inverted index; FST; PacificA; Zen Discovery; Zen2; mmap; translog; segment

---

## 1. Introduction

Elasticsearch internals cannot be simplified as "KV storage written in Java". The basic data organization unit in Elasticsearch is the index; an index is split into shards; each shard is a self-contained Apache Lucene index; data inside a shard consists of immutable segments. Elasticsearch uses primary shards and replica shards to form replication groups. Replicas provide not only redundancy, but can also serve read requests. ([elastic.co][2])

Therefore, the Elasticsearch storage model is more accurately described as a "distributed Lucene index storage system". It is built for full-text search, structured filtering, aggregation, sorting, and near-real-time search, rather than for a generic lookup model that maps a single key directly to a value. Lucene package documentation explains that an inverted index consists of postings, and the term dictionary maps each Term to an ordered document list containing that term. This differs from traditional KV storage that locates values directly by key. ([Apache Lucene][3])

---

## 2. Why the Underlying Storage Has High Query Efficiency

### 2.1 Inverted Index: From "Document to Term" to "Term to Document"

The core access path for text fields in Elasticsearch comes from Lucene inverted indexes. An inverted index maintains a unique ordered term list and, for each term, a list of documents containing that term. During query execution, the engine first locates the term and then reads postings, rather than scanning all documents. Elastic documentation explains field indexing by stating that an inverted index uses a unique ordered term list to look up search terms and immediately obtain the document list containing the term. ([elastic.co][4])

Lucene's postings file format further separates document IDs, term frequency, positions, payloads, offsets, and related information. The `.doc` file contains the document list, frequencies, and skip data for a term. Document IDs are encoded as d-gaps and use block packed and VInt encoding. This structure reduces storage space and allows query executors to skip irrelevant document ranges. ([Apache Lucene][5])

### 2.2 Doc Values: Columnar Structure for Sorting and Aggregation

Full-text search mainly depends on inverted indexes, but sorting, aggregation, script access, and related scenarios depend on another structure: Doc Values. Elastic official documentation states that Doc Values are on-disk data structures built at index time. They store the same field values as `_source`, but in a columnar way, making them more efficient for sorting and aggregation. ([elastic.co][4])

This shows that Elasticsearch does not have a single underlying storage structure. After the same document enters Lucene, it forms multiple physical structures according to field types and query requirements: inverted indexes for term queries, Doc Values for columnar access, BKD Tree for numeric and spatial point queries, and stored fields for returning field content.

### 2.3 BKD Tree: Space Partitioning for Numeric, Date, and Geo Point Data

Lucene's BKDWriter documentation states that BKD Tree recursively builds a block KD-tree, partitioning N-dimensional points into smaller rectangular spaces until the number of points in each leaf block does not exceed a threshold. This structure serves range queries and spatial queries over point data such as numeric values, dates, IPs, and geographic coordinates. ([Apache Lucene][6])

Therefore, Elasticsearch query efficiency comes from "pre-built access paths", not runtime scanning of JSON documents. Text queries, aggregation/sorting, and range queries land on different Lucene data structures.

### 2.4 Segments and Near-Real-Time Search

Lucene searches over segments. Elasticsearch documentation explains that new documents first enter the in-memory indexing buffer and are then written into a new segment. The segment is first written to the filesystem cache, at which point it can be searched, and is later flushed to disk. A document usually has near-real-time behavior from write to searchable visibility, instead of every write immediately performing an expensive Lucene commit. ([elastic.co][7])

Lucene commit is costly, so Elasticsearch uses the translog to record each index/delete operation. Official documentation states that all index/delete operations are written to the translog after being processed by the internal Lucene index and before the acknowledgement response. If a crash occurs, acknowledged operations that are not yet included in the latest Lucene commit are recovered from the translog. A flush performs a Lucene commit and starts a new translog generation. ([elastic.co][8])

---

## 3. Consistency Guarantees: Cluster Coordination and Shard Replication

Elasticsearch consistency can be divided into two categories. One is cluster metadata consistency, such as master election, cluster-state publishing, and index metadata changes. The other is document data consistency, such as write replication between primary shards and replica shards.

### 3.1 Cluster Metadata Consistency

Elastic's official engineering article explains that an Elasticsearch cluster has an elected master node. The master handles cluster-state updates and publishes the updated cluster state to other nodes. Cluster-state updates require quorum acknowledgement from master-eligible nodes to prevent two separate node groups from both believing they have the master, which could lead to data loss. The official recommendation is generally to deploy three master-eligible nodes to tolerate the loss of one. ([elastic.co][9])

### 3.2 Objective Characteristics of Zen Discovery before 7.0

Before 7.0, Elasticsearch used Zen Discovery. Zen Discovery used `discovery.zen.*` settings, among which `minimum_master_nodes` was the key configuration for preventing split brain. After 7.0, these settings were removed or renamed. Elastic's official article explains that Zen Discovery used conservative timeouts and waiting strategies to avoid data loss caused by misconfiguration. As a result, after a master failure, the cluster could be unavailable for several critical seconds. ([elastic.co][9])

The objective facts about Zen Discovery can be summarized as follows: in earlier versions, it handled master discovery, election, and cluster-state publishing; it reduced split-brain risk through settings such as `minimum_master_nodes`; but this setting had to be configured correctly by users, and misconfiguration could cause data loss. Before 7.0, there were also unsafe recovery paths, such as recovering after losing more than half of the master-eligible nodes, or allocating a stale shard copy as primary. After 7.0, Elasticsearch tends to remain unavailable rather than automatically performing unsafe recovery. ([elastic.co][9])

### 3.3 Why Zen2 after 7.0 Did Not Directly Adopt Raft

The cluster coordination subsystem after 7.0 is often called Zen2. Elastic's official article states that the new system removed `minimum_master_nodes`, automatically maintains the voting configuration, uses a simple majority as quorum, and typically completes master election within one second. ([elastic.co][9])

Zen2 did not directly adopt Raft. The reasons explained by Elastic include: standard Raft and Paxos are usually modeled around operation logs, while the natural coordination object in Elasticsearch is cluster state; Elasticsearch cluster-state updates naturally support batching; standard algorithms have limitations around membership changes, while Elasticsearch must support cluster scale-out and scale-in; and Elasticsearch also needed rolling upgrade capability from 6.x to 7.x. The official article also states that Elastic once implemented a prototype close to Raft, but full integration required large changes, so it ultimately chose to build a new protocol that better fit Elasticsearch's cluster-state publishing model. ([elastic.co][9])

---

## 4. Shard Data Synchronization: PacificA Model and ISR Semantics Compared

Elasticsearch official documentation explicitly states that its data replication model is based on a primary-backup model and references the PacificA paper. Each replication group contains one primary shard and multiple replica shards. All index/delete/update operations must first go to the primary. The primary validates the operation, executes it locally, and then forwards it in parallel to in-sync replicas. Only after all in-sync replicas execute successfully and respond does the primary acknowledge the client. ([elastic.co][10])

Here, the "synchronization protocol" is not the name of an external network protocol independent of Elasticsearch. It is Elasticsearch's internal shard replication protocol: the coordinating node routes the request to the primary of the target replication group; the primary executes and forwards it to replicas; replicas acknowledge; the primary returns the result. The key constraint of this model is that acknowledged writes must exist in all in-sync shard copies. ([elastic.co][10])

Kafka and Elasticsearch both have common semantics around "leader/primary + in-sync replica set + write acknowledgement", but they are not the same implementation. In Kafka official materials, `acks=all` means the leader waits for the full ISR set to acknowledge the write; `min.insync.replicas` constrains the minimum number of synchronized replicas. Elasticsearch official documentation uses the term "in-sync copies", and its replicated object is a Lucene shard operation, while Kafka replicates partition log records. ([Apache Wiki][11])

| Dimension | Elasticsearch | Kafka |
| --- | --- | --- |
| Primary role | Primary shard | Partition leader |
| Replica set | In-sync shard copies | ISR |
| Write acknowledgement | Primary waits for all in-sync replicas to execute successfully | `acks=all` waits for ISR acknowledgement |
| Replicated object | Document write operation, Lucene shard state | Partition log record |
| Theory source | PacificA primary-backup model | Leader-follower log replication |

Therefore, "Kafka and Elasticsearch both have ISR-style semantics" is factual. But "they use exactly the same ISR mechanism" is not accurate. Elasticsearch has different terminology, replicated objects, failure handling, and Lucene commit model from Kafka.

---

## 5. How FST Compresses Prefixes

Lucene's BlockTree Terms Dictionary splits the term dictionary and terms index into files such as `.tim`, `.tmd`, and `.tip`. The `.tip` file is the terms index and contains one FST per field. This FST maps term prefixes to term blocks on disk. Official documentation explains that the FST does not store all complete terms; it maps term prefixes to disk blocks containing that prefix. If the prefix path for a query term does not exist, Lucene can determine that the term does not exist without a disk seek. ([Apache Lucene][12])

A minimal example follows. Assume the dictionary contains `car`, `cat`, `dog`, and `dot`:

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

This diagram expresses two facts. First, common prefixes are stored only once: `car` and `cat` share `c -> a`, while `dog` and `dot` share `d -> o`. Second, the output of the FST is not document content, but a term block file position or block pointer. The actual terms are still stored in `.tim` blocks. Lucene's BlockTree also assigns terms into variable-length blocks with shared prefixes, and the terms index forms a prefix trie whose leaves point to term blocks. ([Apache Lucene][13])

---

## 6. Lucene and Disk Interaction: Directory, Filesystem Cache, and mmap

Lucene accesses index files through the `Directory` abstraction. Lucene official documentation explains that the `store` package defines the Directory abstraction, representing a named collection of files. Writes use `IndexOutput`, reads use `IndexInput`, and `FSDirectory` is generally recommended because it can effectively use the operating-system disk cache. ([Apache Lucene][14])

Elasticsearch's index store defaults to the `fs` type, which selects the most suitable filesystem implementation. The current default is usually `hybridfs`. Elastic official documentation explains that `mmapfs` maps files into memory, while `hybridfs` mixes NIOFSDirectory and MMapDirectory according to file type. Currently, the term dictionary, norms, and doc values usually use mmap, while other files use NIOFSDirectory. ([elastic.co][15])

Lucene's `MMapDirectory` documentation states that it is a filesystem-based Directory implementation that uses mmap for reading and `FSIndexOutput` for writing. mmap consumes virtual address space equal to the size of the mapped file. ([Apache Lucene][16])

Therefore, the accurate statement about whether Lucene uses mmap is: Lucene provides MMapDirectory; Elasticsearch's default hybridfs uses mmap for some file types, not unconditionally for all files.

---

## 7. Elasticsearch Write Flow

The Elasticsearch write flow can be abstracted into the following stages.

**First, the client request enters a coordinating node.** Any node can become a coordinating node. The coordinating node calculates the target shard based on index, document ID, or routing, and forwards the write to the primary shard of the replication group.

**Second, the primary shard executes the primary stage.** The primary validates the write request, such as structure, field mapping, and version constraints. After validation succeeds, the primary executes the write locally and forwards the operation in parallel to the current in-sync replicas. Official documentation states that the primary stage and replica stage are executed sequentially: route to the primary first; the primary executes locally and forwards; replicas execute successfully and respond to the primary. ([elastic.co][10])

**Third, the write enters Lucene and translog.** After Lucene internally processes index/delete, Elasticsearch writes to the translog before returning acknowledgement. Since Lucene commit is expensive, Elasticsearch does not execute a full commit for every request. Acknowledged operations that have not yet entered the latest commit can be recovered through the translog. ([elastic.co][8])

**Fourth, the replica stage completes and acknowledgement is returned.** After all in-sync replicas successfully execute the operation and return to the primary, the primary acknowledges the client. This flow reflects the PacificA primary-backup model. ([elastic.co][10])

**Fifth, refresh makes data near-real-time visible.** New writes first enter the indexing buffer, then generate a new segment that first enters the filesystem cache. At this point, the segment can be searched. Elastic documentation states that Elasticsearch has near-real-time search characteristics, and documents usually become searchable about 1 second after being written. ([elastic.co][7])

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

## 8. Elasticsearch Read Flow

The read flow can be divided into get-by-id and search request types. Official documentation explains that for read requests, the primary-backup model keeps shard copies in the same replication group identical except for operations currently in progress. Therefore, a single in-sync copy can serve a read. The coordinating node parses the shards involved in the request and selects an active copy for each shard replication group, using adaptive replica selection by default, then sends shard-level read requests and finally merges results for the client. ([elastic.co][10])

Search requests usually have scatter/gather characteristics. Elastic's node role documentation explains that search requests execute in two phases: the scatter phase forwards requests to data nodes holding the required data; the gather phase has the coordinating node reduce each data node's results into a global result set. ([elastic.co][17])

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

The Elasticsearch read path has an important limitation: official documentation states that a read request may see a change before the write is acknowledged. In network isolation scenarios, if an old primary has not yet realized it has been isolated, a dirty read may also occur. Elasticsearch reduces this risk by having the primary periodically interact with the master. ([elastic.co][10])

---

## 9. Conclusion

Elasticsearch's foundation is not KV storage, but a distributed index system based on Lucene. Its query efficiency comes from a combination of structures such as inverted indexes, FST term indexes, postings block encoding, Doc Values, BKD Tree, filesystem cache, mmap/hybridfs, and immutable segments. Its consistency mechanism is not a single protocol: cluster metadata is maintained by the Zen/Zen2 cluster coordination mechanism, while shard data is maintained by a PacificA-based primary-backup replication model. Before 7.0, Zen Discovery relied on settings such as `minimum_master_nodes` and used conservative timeouts. After 7.0, Zen2 automatically maintains the voting configuration and did not directly adopt Raft, due to Elasticsearch's cluster-state-centered publishing model, membership changes, batching, and rolling-upgrade requirements. Elasticsearch and Kafka both have write acknowledgement semantics around in-sync replica sets, but they are not the same implementation.

## References

1. Elastic Docs: Elasticsearch Reference, Index fundamentals, Near real-time search, Reading and writing documents. ([elastic.co][1])
2. Apache Lucene official documentation: Lucene Core, Index package, BlockTree Terms Dictionary, Lucene90 Postings Format, MMapDirectory. ([Apache Lucene][18])
3. Elastic official engineering article: Elasticsearch 7.0 cluster coordination and Zen2 design. ([elastic.co][9])
4. Elastic Docs: Index store settings, Translog, Doc values. ([elastic.co][15])

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

## Chinese Reference

- [Read the original Chinese article](/zh/topics/elaticsearch)
