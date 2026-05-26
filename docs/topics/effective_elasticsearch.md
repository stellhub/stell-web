---
title: Engineering Practices for Storing Application Logs in Elasticsearch at Very Large Enterprises
category: Search Infrastructure
summary: A systematic guide to storing application logs in Elasticsearch at very large enterprises, covering data streams, index templates, ILM, ECS, mappings, exception stacks, duplicate-log aggregation, multi-tenancy, high-traffic applications, and very long log handling.
tags:
  - Elasticsearch
  - Application Logs
  - Data Streams
  - ILM
  - ECS
readingDirection: Read this when designing an enterprise log platform, governing Elasticsearch log indexes, handling exception storms, planning multi-tenant isolation, or optimizing log storage cost.
outline: deep
---

# Engineering Practices for Storing Application Logs in Elasticsearch at Very Large Enterprises

## Overview

A systematic guide to storing application logs in Elasticsearch at very large enterprises, covering data streams, index templates, ILM, ECS, mappings, exception stacks, duplicate-log aggregation, multi-tenancy, high-traffic applications, and very long log handling.

## Abstract

In very large enterprises, application logs are continuously written, time-series-oriented, structurally complex, tenant-sensitive, prone to exception bursts, often highly repetitive, and cost-sensitive at storage scale. Elasticsearch documentation defines a data stream as an abstraction for append-only time-series data such as logs, events, and metrics. Index Lifecycle Management can automate rollover, retention, and deletion for log-oriented time-series indexes. Based on Elasticsearch and Elastic Common Schema documentation, this article discusses index creation, field types, document structure, exception-stack storage, duplicate-log aggregation, multi-tenant isolation, high-traffic application governance, and very long log handling when Elasticsearch is used as an application-log store in very large enterprises. ([Elastic][1])

**Keywords**: Elasticsearch; application logs; Data Stream; ILM; ECS; multi-tenancy; exception logs; log aggregation; very long logs

---

## 1. Introduction

Application logs are typical time-series event data. Elastic documentation states that data streams are suitable for logs, events, metrics, and other continuously generated data. A data stream is backed by multiple backing indexes while exposing one logical named resource to users. Each document in a data stream must contain an `@timestamp` field, mapped as `date` or `date_nanos`; if the index template does not explicitly declare it, Elasticsearch maps `@timestamp` as the default `date` field. ([Elastic][1])

Therefore, an enterprise log platform should not default to "manually creating a normal index every day." Its baseline model should be **data stream + index template + lifecycle policy + explicit mapping**. The goals are to control field growth, shard count, hot/cold storage cost, aggregatable query fields, searchable exception stacks, tenant isolation, and traffic separation for high-volume applications.

---

## 2. Index Creation Model

### 2.1 Prefer Data Streams Instead of Bare Indexes

Application logs usually contain timestamps, are written primarily through indexing requests, and rarely update or delete historical documents. Elasticsearch documentation lists data stream requirements and fit criteria: the data contains a timestamp field, primarily receives indexing requests, only occasionally needs updates or deletes, and usually does not explicitly specify `_id`; if `_id` is specified, first-write-wins semantics should be acceptable. ([Elastic][1])

The baseline naming model for application logs should be:

```text
logs-<dataset>-<namespace>
```

Examples:

```text
logs-order-service-prod
logs-payment-service-prod
logs-gateway-access-prod
logs-bigapp-access-prod
```

| Part | Meaning | Example |
| --- | --- | --- |
| `logs` | Data type | Logs |
| `<dataset>` | Log dataset, usually an application, module, or log type | `order-service`, `gateway-access` |
| `<namespace>` | Environment, tenant, region, or isolation domain | `prod`, `tenant-a`, `sg-prod` |

Elastic APM documentation also explains that data streams fit append-only time-series data such as logs, metrics, and traces, and that they reduce the number of fields per index, provide finer-grained data control, support flexible naming, and require fewer ingest permissions. ([Elastic][2])

### 2.2 Index Templates Should Declare Settings, Mappings, and Lifecycle

A data stream depends on a matching index template. Official documentation states that a data stream requires a matching index template containing mappings, settings, and the ILM policy used by the backing indexes. ([Elastic][1])

A log index template should include at least:

```json
{
  "index_patterns": ["logs-*-*"],
  "data_stream": {},
  "template": {
    "settings": {
      "index.lifecycle.name": "logs-hot-warm-cold-delete",
      "index.mapping.total_fields.limit": 1000,
      "index.mapping.ignore_above": 8191,
      "index.refresh_interval": "10s",
      "number_of_shards": 3,
      "number_of_replicas": 1
    },
    "mappings": {
      "dynamic": false,
      "properties": {
        "@timestamp": { "type": "date" },
        "message": { "type": "match_only_text" },
        "log.level": { "type": "keyword" },
        "log.logger": { "type": "keyword" },
        "service.name": { "type": "keyword" },
        "service.version": { "type": "keyword" },
        "service.environment": { "type": "keyword" },
        "host.name": { "type": "keyword" },
        "trace.id": { "type": "keyword" },
        "span.id": { "type": "keyword" },
        "event.dataset": { "type": "keyword" },
        "event.hash": { "type": "keyword" },
        "error.type": { "type": "keyword" },
        "error.message": { "type": "match_only_text" },
        "error.stack_trace": { "type": "wildcard" },
        "labels": { "type": "flattened" },
        "attributes": { "type": "flattened" }
      }
    }
  }
}
```

This configuration has three important constraints.

First, `dynamic: false` prevents unknown fields in logs from automatically expanding the mapping. Elasticsearch allows dynamic mapping by default, adding new fields to the mapping when they are written. Documentation refers to uncontrolled field growth as mapping explosion and notes that too many fields can slow search, increase JVM memory pressure, and lengthen startup time. ([Elastic][3])

Second, `index.mapping.total_fields.limit` limits the number of mapped fields in an index. The default is `1000`; increasing it may cause performance degradation and memory problems. ([Elastic][4])

Third, collections with uncertain keys, such as `labels` and `attributes`, should use `flattened`. Documentation explains that `flattened` maps an entire object as a single field when the object contains many or unknown unique keys, thereby avoiding mapping explosion caused by many distinct field mappings. ([Elastic][5])

---

## 3. Lifecycle and Shard Strategy

### 3.1 Lifecycle Management

Log data should be managed through ILM or data stream lifecycle. Elasticsearch documentation explains that ILM can automatically manage time-series indexes such as logs and metrics, including rollover, archiving historical indexes, and deleting expired indexes. ([Elastic][6])

A typical policy is:

```json
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_primary_shard_size": "50gb",
            "max_age": "1d"
          }
        }
      },
      "warm": {
        "min_age": "3d",
        "actions": {
          "forcemerge": {
            "max_num_segments": 1
          }
        }
      },
      "cold": {
        "min_age": "14d",
        "actions": {}
      },
      "delete": {
        "min_age": "30d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

The goal is not to force exactly one index per day. Instead, rollover switches the backing index when size or age conditions are reached. The data stream documentation also recommends using ILM to roll over the write index automatically when it reaches the specified age or size. ([Elastic][1])

### 3.2 Shard Count Control

Large enterprise log systems should avoid both too many shards and excessively large shards. Elastic documentation states that every index, shard, segment, and field has overhead; time-series data fits data streams and ILM; deleting entire indexes is also more efficient than deleting documents individually because it releases filesystem resources immediately. ([Elastic][7])

Therefore, retention should delete backing indexes through lifecycle policies instead of using `delete_by_query` against historical logs. Row-by-row deletion leaves deleted documents until segment merge releases resources, whereas deleting an index releases filesystem resources directly. ([Elastic][7])

---

## 4. Field-Type Design

### 4.1 Fields That Should Be Keyword

Elastic documentation states that `keyword` is used for structured content such as IDs, email addresses, hostnames, status codes, ZIP codes, and tags. Keyword fields are commonly used for sorting, aggregations, and term-level queries, and should not be used for full-text search. ([Elastic][8])

Application logs should map the following fields as `keyword` or another aggregatable type:

| Field | Type | Reason |
| --- | --- | --- |
| `service.name` | `keyword` | Service filtering and aggregation |
| `service.version` | `keyword` | Version filtering |
| `service.environment` | `keyword` | Environment filtering |
| `tenant.id` | `keyword` | Multi-tenant isolation and filtering |
| `app.id` | `keyword` | Application-level aggregation |
| `log.level` | `keyword` | Log-level filtering |
| `log.logger` | `keyword` | Logger/class-level filtering |
| `host.name` | `keyword` | Host filtering |
| `host.ip` | `ip` or `keyword` | IP search or exact filtering |
| `trace.id` | `keyword` | Exact trace lookup |
| `span.id` | `keyword` | Exact span lookup |
| `transaction.id` | `keyword` | Exact request-chain lookup |
| `event.dataset` | `keyword` | Dataset isolation |
| `event.hash` | `keyword` | Duplicate-log identification |
| `error.type` | `keyword` | Exception-type aggregation |
| `error.code` | `keyword` | Error-code aggregation |
| `http.request.method` | `keyword` | HTTP method filtering |
| `http.response.status_code` | `short` or `integer` | Status-code aggregation and range statistics |
| `url.path` | `keyword` | API path aggregation |
| `kubernetes.namespace` | `keyword` | Kubernetes namespace filtering |
| `kubernetes.pod.name` | `keyword` | Pod-level filtering |

`text` and `keyword` have different meanings. Elasticsearch documentation explains that `text` fields are analyzed for full-text search, while `keyword` strings remain unchanged for filtering and sorting. ([Elastic][9])

### 4.2 Message Field

`message` is the primary field for log display and full-text search, and should not be a plain `keyword`. For log bodies, prefer:

```json
"message": {
  "type": "match_only_text"
}
```

ECS uses `match_only_text` for `error.message`, which stores error messages. ([Elastic][10])

For short fields that need both full-text search and exact aggregation, use multi-fields:

```json
"request.path": {
  "type": "text",
  "fields": {
    "keyword": {
      "type": "keyword",
      "ignore_above": 1024
    }
  }
}
```

Elasticsearch documentation states that multi-fields allow the same string field to be indexed in different ways, for example as `text` for full-text search and as `keyword` for sorting or aggregation. ([Elastic][9])

### 4.3 Uncertain Labels and Business Extension Fields

Business logs often contain dynamic fields:

```json
{
  "attributes": {
    "userId": "10001",
    "orderId": "A123",
    "experimentGroup": "B",
    "customKeyFromBusiness": "value"
  }
}
```

These fields should not expand into unlimited mapping fields. Elastic documentation states that `flattened` maps an entire object as one field and is suitable for objects with many or unknown unique keys. ([Elastic][5])

Business custom key-value pairs should therefore go into:

```json
"labels": { "type": "flattened" },
"attributes": { "type": "flattened" }
```

They should not be promoted to top-level fields one key at a time.

---

## 5. Log Document Structure

### 5.1 Documents Should Follow ECS Semantics

Elastic Common Schema is Elastic's official common field specification for storing logs, metrics, and other event data in Elasticsearch. ECS specifies field names, Elasticsearch data types, descriptions, and example usage. ([Elastic][11])

An application log document may use this structure:

```json
{
  "@timestamp": "2026-05-25T01:23:45.678Z",
  "message": "Create order failed, orderId=10001",
  "log": {
    "level": "ERROR",
    "logger": "com.stellhub.order.OrderService",
    "origin": {
      "file": {
        "name": "OrderService.java",
        "line": 128
      },
      "function": "createOrder"
    }
  },
  "service": {
    "name": "order-service",
    "version": "1.3.7",
    "environment": "prod"
  },
  "event": {
    "dataset": "order-service.error",
    "kind": "event",
    "category": ["application"],
    "type": ["error"],
    "hash": "f35a9b2e..."
  },
  "trace": {
    "id": "4bf92f3577b34da6a3ce929d0e0e4736"
  },
  "span": {
    "id": "00f067aa0ba902b7"
  },
  "tenant": {
    "id": "tenant-a"
  },
  "error": {
    "type": "java.lang.NullPointerException",
    "message": "Cannot invoke \"User.getId()\" because user is null",
    "stack_trace": "java.lang.NullPointerException: Cannot invoke ..."
  },
  "labels": {
    "region": "sg",
    "az": "sg-a",
    "cluster": "prod-01"
  },
  "attributes": {
    "orderId": "10001",
    "bizCode": "CREATE_ORDER"
  }
}
```

In ECS, `event` fields describe the context of log or metric events, and log events must contain the event time. ([Elastic][12]) ECS `log.*` fields describe the logging mechanism or log transport information, such as `log.level`, `log.logger`, and `log.origin.file.line`. ([Elastic][13])

### 5.2 Writes Should Use the Bulk API

High-throughput log writes should not call Elasticsearch one document at a time. The Bulk API can execute multiple `index`, `create`, `delete`, or `update` actions in one request, reducing overhead and significantly improving indexing speed. ([Elastic][14])

Elastic performance documentation also states that bulk requests usually perform better than single-document index requests. The best bulk size should be benchmarked by increasing from 100 to 200 to 400 documents until indexing speed reaches a plateau. ([Elastic][15])

---

## 6. Exception-Stack Storage

Exception logs should be split into structured fields and a raw stack-trace field. In ECS, `error.code` is a keyword error code, `error.id` is a keyword unique error identifier, `error.message` is a `match_only_text` error message, and `error.stack_trace` is a plain-text stack trace represented as `wildcard`. ([Elastic][10])

Therefore, an exception log should not be stored only as one large string:

```json
{
  "message": "Exception in thread ..."
}
```

A better structure is:

```json
{
  "message": "Create order failed",
  "error": {
    "type": "java.lang.NullPointerException",
    "message": "Cannot invoke \"User.getId()\" because user is null",
    "stack_trace": "java.lang.NullPointerException: Cannot invoke ...\n\tat ..."
  }
}
```

| Field | Purpose |
| --- | --- |
| `error.type` | Aggregate by exception class |
| `error.message` | Full-text search over exception messages |
| `error.stack_trace` | Search stack content |
| `event.hash` | Merge identical exceptions |
| `log.origin.file.name` | Locate source file |
| `log.origin.file.line` | Locate source line |
| `trace.id` | Connect to tracing |

Exception-stack fields should not be stored as ordinary `keyword`. `keyword` is for structured exact values, while `wildcard` is documented as suitable for unstructured machine-generated content with large values or high cardinality. ([Elastic][8])

---

## 7. Aggregating Large Numbers of Duplicate Logs

### 7.1 Identifying Duplicate Logs

Large numbers of duplicate logs should be identified through a stable fingerprint. The Elasticsearch ingest fingerprint processor calculates a hash from document fields and writes it into a target field; documentation describes it as useful for content fingerprinting. ([Elastic][16])

A log platform can generate `event.hash` from fields such as:

```text
tenant.id
service.name
service.environment
log.level
log.logger
error.type
normalized.message
normalized.stack_trace.top_frame
```

The complete `message` or `stack_trace` should not be used directly as fingerprint input because it may contain high-variance values such as order IDs, user IDs, trace IDs, and timestamps. Normalize first:

```text
Create order failed, orderId=10001
Create order failed, orderId=10002
```

Normalize to:

```text
Create order failed, orderId=<num>
```

Then calculate the fingerprint.

### 7.2 Aggregated Document Model

After duplicate logs are aggregated, two document types can be produced.

The first type is a raw sample log:

```json
{
  "@timestamp": "2026-05-25T01:00:01.000Z",
  "event.kind": "event",
  "event.hash": "abc123",
  "message": "Create order failed, orderId=10001",
  "error.stack_trace": "...",
  "sampled": true
}
```

The second type is an aggregate log:

```json
{
  "@timestamp": "2026-05-25T01:00:00.000Z",
  "event.kind": "metric",
  "event.hash": "abc123",
  "service.name": "order-service",
  "log.level": "ERROR",
  "error.type": "java.lang.NullPointerException",
  "log.pattern": "Create order failed, orderId=<num>",
  "first_seen": "2026-05-25T01:00:00.000Z",
  "last_seen": "2026-05-25T01:00:59.999Z",
  "occurrence_count": 184920,
  "sample_message": "Create order failed, orderId=10001",
  "sample_stack_trace": "java.lang.NullPointerException..."
}
```

This model separates diagnostic samples from statistical counts, avoiding massive writes of identical documents during exception storms.

### 7.3 Should Massive Identical Logs in the Same Time Window Be Filtered and Aggregated?

Large numbers of identical logs in the same time window should be aggregated before being written into Elasticsearch, instead of being corrected later through query aggregation. There are three reasons.

First, Elasticsearch data streams are append-only time-series write models. Official documentation states that data streams cannot directly update or delete existing documents; updates or deletes must address the backing index directly or use update-by-query/delete-by-query. ([Elastic][1])

Second, if the business expects later writes with the same `_id` to overwrite earlier writes, documentation explicitly says frequent writes with the same `_id` and last-write-wins expectations should use an index alias plus write index rather than a data stream. ([Elastic][17])

Third, pre-ingest aggregation directly reduces bulk write volume, segment growth, disk usage, merge pressure, and query load. Elasticsearch documentation already states that bulk write performance and shard/indexing strategy strongly affect indexing speed. ([Elastic][15])

Therefore, the log collection path should aggregate windows in a Kafka consumer, Flink job, Logstash Aggregate filter, custom OpenTelemetry Collector processor, or dedicated log aggregation service before writing to Elasticsearch.

---

## 8. Filtering and Aggregating Large Numbers of Identical Exceptions

Large numbers of identical exceptions should not write full stack traces unconditionally for every occurrence. A better model is:

```text
exception normalization -> fingerprint -> time-window aggregation -> sample retention -> count write -> alert trigger
```

Recommended retained information:

| Information | Handling |
| --- | --- |
| First exception | Keep in full |
| Most recent exception | Keep in full |
| Per-window count | Write as aggregate |
| Example `trace.id` | Keep several samples |
| Full stack trace | Keep samples; do not repeat for every duplicate exception |
| `occurrence_count` | Aggregate field |
| `first_seen` / `last_seen` | Aggregate fields |

This is not simply "dropping exceptions." It converts duplicate exceptions into a **sample + count + time-window** data structure. For diagnosis, writing one million identical stack traces does not provide one million times more information. It mainly increases storage, write, and query costs. The diagnostic information comes from samples; scale information comes from counts.

---

## 9. Multi-Tenant Handling

### 9.1 Tenant Fields

Multi-tenant log documents must include tenant fields:

```json
{
  "tenant": {
    "id": "tenant-a",
    "name": "Tenant A"
  }
}
```

`tenant.id` should be `keyword` for filtering, aggregation, and access control. `keyword` is officially suitable for structured content such as IDs, hostnames, status codes, and tags, and is commonly used for term-level queries, aggregations, and sorting. ([Elastic][8])

### 9.2 Tenant Isolation Models

| Model | Suitable Scenario | Example |
| --- | --- | --- |
| Shared data stream + `tenant.id` filter | Many tenants, small per-tenant log volume, cost-sensitive | `logs-app-prod` |
| Data stream split by large tenant | Large tenants with high volume or stronger isolation needs | `logs-app-tenant-a` |
| Dedicated cluster | Strong compliance, security, or resource isolation requirements | Dedicated ES cluster |

In very large enterprises, creating many independent indexes for every small tenant should be avoided. Every index, shard, segment, and field has overhead, as shard-sizing documentation explains. ([Elastic][7])

The default model should be shared data stream + `tenant.id` field + permission filter + large-tenant split. Dedicated isolation should be reserved for top tenants, large customers, and strong compliance cases.

---

## 10. Special Handling for High-Traffic Applications

Gateways, recommendation systems, advertising systems, search systems, and core payment paths should not share one data stream with ordinary application logs. They should be split independently:

```text
logs-gateway-access-prod
logs-gateway-error-prod
logs-search-access-prod
logs-search-slowlog-prod
logs-payment-error-prod
```

Split principles:

| Split Dimension | Reason |
| --- | --- |
| Separate access logs and error logs | Different query patterns, retention periods, and field structures |
| Independent data streams for high-traffic applications | Prevent write hotspots from affecting ordinary applications |
| Independent slow-log data streams | Longer query value and diagnostic value |
| Independent audit logs | Different retention and compliance requirements |
| Independent debug logs | Short lifecycle and high write volume |

Elasticsearch data tier documentation explains that tiers balance performance, cost, and accessibility, and that nodes in the same tier should have the same hardware profile to avoid hot spotting. ([Elastic][18])

High-traffic applications should therefore use independent lifecycle policies, rollover conditions, shard counts, and hot/cold strategies:

```text
Ordinary application error logs: retain 30 days
Ordinary application info logs: retain 7 days
Gateway access logs: hot tier 1 day, cold tier 7 days
Payment error logs: hot tier 7 days, total retention 90 days
Audit logs: dedicated cluster or independent data stream, long retention
```

---

## 11. Very Long Log Handling

### 11.1 Very Long Fields Should Not Be Fully Indexed as Keyword

The `ignore_above` documentation states that strings longer than the configured threshold are not indexed or stored, but remain in `_source` if `_source` is enabled. This setting can also help avoid Lucene term byte-length limits. ([Elastic][19])

Very long logs should follow these rules:

```text
Searchable summary fields: indexed in Elasticsearch
Complete raw text: kept in _source or external object storage
Exact aggregation fields: set ignore_above
Exception stacks: stored in error.stack_trace, not keyword
```

### 11.2 Recommended Structure

```json
{
  "message": "Large response body detected",
  "message_truncated": true,
  "message_length": 983421,
  "message_preview": "first 4096 chars...",
  "message_hash": "sha256:...",
  "log": {
    "original": "complete log, kept in object storage if needed"
  },
  "external": {
    "storage": "s3",
    "object_key": "logs/2026/05/25/abc123.log"
  }
}
```

| Type | Handling |
| --- | --- |
| Very long `message` | Truncate display field and retain hash |
| Very long exception stack | Keep first N lines, root-cause frames, hash, and samples |
| Very long request/response body | Do not write full text into ES by default; use object storage |
| Very long business attributes | Put into `flattened` or external storage |
| Very long keyword values | Set `ignore_above` |
| Raw audit requirement | Store in object storage; keep only index metadata in ES |

---

## 12. Query and Aggregation Constraints

Log platforms commonly use terms aggregation for Top N statistics on `service.name`, `log.level`, `error.type`, and `event.hash`. Elasticsearch documentation states that `terms` aggregation should not be run on `text` fields by default; use a `keyword` subfield instead. Enabling `fielddata` significantly increases memory usage. ([Elastic][20])

Therefore, all fields that need Top N, grouping, filtering, or sorting must be explicitly mapped as `keyword`, numeric, `ip`, `boolean`, or other aggregatable types, not `text`.

Deep pagination also needs limits. Elasticsearch documentation says not to use `from` and `size` for deep pages because every shard must load the requested page and all preceding pages, which can significantly increase memory and CPU usage. By default, `from` and `size` cannot page past 10,000 results; use `search_after` beyond that. ([Elastic][21])

---

## 13. Standard Implementation Plan

### 13.1 Index Template Standard

| Item | Recommendation |
| --- | --- |
| Storage model | Data stream |
| Naming | `logs-<dataset>-<namespace>` |
| Time field | `@timestamp: date` |
| Dynamic fields | `dynamic: false` |
| Custom key-value data | `flattened` |
| Field limit | Keep the default or adjust `index.mapping.total_fields.limit` cautiously |
| Very long strings | Set `index.mapping.ignore_above` |
| Lifecycle | ILM or data stream lifecycle |
| Deletion strategy | Delete indexes/backing indexes, not documents one by one |

### 13.2 Field Standard

| Field Category | Type |
| --- | --- |
| IDs, enums, statuses, names | `keyword` |
| Log body | `match_only_text` |
| Exception message | `match_only_text` |
| Exception stack | `wildcard` |
| Time | `date` or `date_nanos` |
| Counts, durations, sizes | `long`, `double` |
| HTTP status code | `short` or `integer` |
| IP | `ip` |
| Dynamic business labels | `flattened` |

### 13.3 Write Path Standard

```text
Application logs
  -> Agent / OTel Collector / Logstash / custom collector
  -> parsing and ECS normalization
  -> PII masking
  -> message / stack_trace normalization
  -> fingerprint generation into event.hash
  -> duplicate-log window aggregation
  -> Bulk API write to Elasticsearch data stream
  -> ILM automatic rollover / warm / cold / delete
```

---

## 14. Conclusion

When very large enterprises use Elasticsearch to store application logs, the central problem is not simply "writing logs into Elasticsearch." It is establishing a controlled data model. Official documentation already defines data streams as suitable for continuously generated time-series data such as logs, ILM as a way to automate rollover, retention, and deletion, ECS as a field naming and type specification, and `keyword`, `text`, `wildcard`, and `flattened` as field families with clear boundaries. ([Elastic][1])

Based on these facts, the best practice can be summarized as follows: use data streams for log writes; use index templates to fix mappings and settings; use ECS to normalize document structure; map aggregatable fields as keyword; map log bodies and exception messages as text-search fields; map exception stacks as wildcard; map dynamic business fields as flattened; perform fingerprinting and window aggregation before writing duplicate logs and exception storms; combine shared data streams with large-tenant splits for multi-tenancy; create independent data streams and lifecycle policies for high-traffic applications; and handle very long logs with truncation, hashes, samples, and external object storage.

The key judgment is: **Elasticsearch should store searchable, aggregatable, diagnosable data, not every raw byte stream without constraints.**

[1]: https://www.elastic.co/docs/manage-data/data-store/data-streams "Data streams | Elastic Docs"
[2]: https://www.elastic.co/docs/solutions/observability/apm/data-streams?utm_source=chatgpt.com "APM data streams | Elastic Docs"
[3]: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/dynamic "dynamic | Elasticsearch Reference"
[4]: https://www.elastic.co/docs/reference/elasticsearch/index-settings/mapping-limit "Mapping limit settings | Elasticsearch Reference"
[5]: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/flattened "Flattened field type | Elasticsearch Reference"
[6]: https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management "Index lifecycle management (ILM) in Elasticsearch | Elastic Docs"
[7]: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards "Size your shards | Elastic Docs"
[8]: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/keyword "Keyword type family | Elasticsearch Reference"
[9]: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/field-data-types "Field data types | Elasticsearch Reference"
[10]: https://www.elastic.co/docs/reference/ecs/ecs-error "Error fields | Elastic Common Schema (ECS)"
[11]: https://www.elastic.co/docs/reference/ecs "Elastic Common Schema (ECS) reference | Elastic Common Schema (ECS)"
[12]: https://www.elastic.co/docs/reference/ecs/ecs-event "Event fields | Elastic Common Schema (ECS)"
[13]: https://www.elastic.co/docs/reference/ecs/ecs-log "Log fields | Elastic Common Schema (ECS)"
[14]: https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-bulk "Bulk index or delete documents  Elasticsearch API documentation"
[15]: https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/indexing-speed "Tune for indexing speed | Elastic Docs"
[16]: https://www.elastic.co/docs/reference/enrich-processor/fingerprint-processor "Fingerprint processor | Elasticsearch Reference"
[17]: https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management/tutorial-time-series-without-data-streams "Manage time series data without data streams | Elastic Docs"
[18]: https://www.elastic.co/docs/manage-data/lifecycle/data-tiers "Elasticsearch data tiers: hot, warm, cold, and frozen storage explained | Elastic Docs"
[19]: https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/ignore-above?utm_source=chatgpt.com "ignore_above | Elasticsearch Reference"
[20]: https://www.elastic.co/docs/reference/aggregations/search-aggregations-bucket-terms-aggregation "Terms aggregation | Elasticsearch Reference"
[21]: https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results "Paginate search results | Elasticsearch Reference"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/effective_elasticsearch)
