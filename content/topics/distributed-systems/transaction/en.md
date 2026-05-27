## Abstract

Microservice architecture splits a business system into multiple autonomous services. Each service usually owns its own data model, database, and release lifecycle. This improves service autonomy, technology-stack flexibility, and fault isolation, but also turns cross-service data consistency from a single-database ACID transaction problem into a distributed consistency problem. In early engineering practice, some teams tried to migrate the monolithic database transaction model into microservices, using XA or 2PC protocols to guarantee cross-service strong consistency. However, the coordinator, participants, Prepare, Commit/Rollback, and related mechanisms of 2PC/XA introduce resource holding, suspended transactions, coordinator dependency, and call-chain coupling. Modern microservice governance usually no longer treats traditional distributed transactions as the default approach. Instead, it prefers domain-boundary design, local transactions, idempotency, message-driven workflows, reconciliation and compensation, Saga, and TCC to achieve acceptable consistency models.

**Keywords**: microservices; distributed transactions; XA; 2PC; Saga; TCC; eventual consistency; local message table; idempotency; domain-driven design

---

## 1. Introduction

In a monolithic application, multiple business operations often share one database instance and one transaction context, so they can directly rely on database transactions for atomicity, consistency, isolation, and durability. After a system enters microservice architecture, services are split into multiple autonomous units, and data is distributed along service boundaries. Microsoft microservice data guidance states that each microservice manages its own data, so data integrity and consistency become key challenges in microservice architecture. Its .NET microservice architecture guide also emphasizes that every microservice must own its domain data and logic and be deployed independently within its autonomous lifecycle. ([Microsoft Learn][1])

Traditional XA/2PC attempts to restore strong monolithic transaction semantics across multiple resource managers. MySQL documentation describes XA global transactions as using two-phase commit: in the first phase, all branches are asked to enter a prepared state; in the second phase, commit or rollback is executed based on the first-phase result. PostgreSQL documentation similarly explains that 2PC is implemented through commands such as `PREPARE TRANSACTION`, `COMMIT PREPARED`, and `ROLLBACK PREPARED`, and is used by external transaction management systems to coordinate multiple distributed systems. ([MySQL Developer Zone][2])

Therefore, the core question is not whether distributed transactions have value. The real question is whether traditional strong-consistency distributed transactions are suitable as the default consistency mechanism for microservice systems. From modern microservice governance practice, the answer is usually no.

---

## 2. Mechanism Basics of Traditional Distributed Transactions

The basic XA/2PC model consists of a transaction manager and multiple resource managers. The transaction manager coordinates the global transaction, while each resource manager executes its own local transaction branch. Two-phase commit usually has two phases.

The first phase is the **Prepare phase**. The coordinator asks all participants to prepare for commit. MySQL documentation explains that in this phase, each resource manager usually needs to record the branch transaction's actions into stable storage and report whether it can commit to the transaction manager. ([MySQL Developer Zone][2])

The second phase is the **Commit/Rollback phase**. If all participants prepare successfully, the coordinator tells each participant to commit. If any participant fails, the coordinator tells each participant to roll back. PostgreSQL documentation states that the state of a prepared transaction is stored on disk and later completed through `COMMIT PREPARED` or `ROLLBACK PREPARED`. ([PostgreSQL][3])

In theory, this mechanism provides atomic commit capability across resources. Its cost is that all participants must maintain recoverable state until the global transaction completes, and they depend on the coordinator to advance the final decision. PostgreSQL documentation also recommends that prepared transactions normally be committed or rolled back as soon as possible after an external transaction manager confirms that other databases are also prepared. If there is no external transaction manager to track and promptly close prepared transactions, `max_prepared_transactions` should preferably be set to 0 to prevent forgotten prepared transactions from causing problems. ([PostgreSQL][3])

---

## 3. Main Conflicts Between Traditional 2PC/XA and Microservice Architecture

### 3.1 Performance Bottleneck: The Global Commit Path Extends Resource Holding Time

2PC splits one business operation into Prepare and Commit/Rollback coordination phases. Compared with a single-database local transaction, it adds cross-network communication, transaction-state persistence, coordinator scheduling, and participant waiting time. Database transactions themselves rely on locks or version control to maintain isolation. Microsoft SQL Server documentation also states that improper transaction management in multi-user systems often causes contention and performance problems, and that applications must control transactions effectively as concurrent users increase. ([Microsoft Learn][4])

In a high-concurrency microservice path, if order, inventory, points, payment, and other services all enter the same XA/2PC global transaction, any slow service, database, or network node extends the completion time of the whole global transaction. Prepared transactions cannot be suspended indefinitely. PostgreSQL documentation requires them to be committed or rolled back quickly and recommends disabling prepared transactions when no transaction manager exists, precisely because leftover prepared transactions cause later problems. ([PostgreSQL][3])

Thus, the main performance issue of traditional 2PC/XA in high-concurrency microservices is not one slow SQL statement. It is that **the slowest participant in the global path determines the resource release time of the entire operation**. Local jitter becomes global latency, and a single slow query can reduce cross-service throughput.

### 3.2 Availability Conflict: One Abnormal Participant Can Affect the Entire Global Transaction

Microservice architecture emphasizes service autonomy and fault isolation. Azure microservice architecture documentation defines microservices as a set of small autonomous services, each self-contained and implementing one business capability within a bounded context. ([Microsoft Learn][5])

2PC/XA aims to make multiple resources commit or roll back together within one global transaction. This mechanism naturally requires all participants to cooperate inside the global transaction boundary. If one participant is unavailable, times out, or has an uncertain commit result, the global transaction enters waiting, recovery, or manual intervention paths. This structurally conflicts with the microservice goal of isolating failure impact through service boundaries.

More precisely, 2PC/XA is not impossible in microservices. But it binds multiple autonomous services back into one strongly coupled commit unit. The more services, the longer the chain, and the more heterogeneous resources involved, the closer global transaction availability becomes to the product of all participant availabilities rather than the availability of one service.

### 3.3 Data Autonomy Conflict: The Database-Per-Service Principle Is Weakened

Microservice data governance usually emphasizes "Database per Service." Microservices.io describes it as each service holding private persistent data, which may be private tables, a private schema, or an independent database server. ([microservices.io][6])

If multiple microservices share a commit boundary through a global transaction coordinator, their physical databases may remain independent, but business execution is already coupled across services. Services no longer cooperate only through APIs, events, or contracts. They are bound together by the global transaction lifecycle. This weakens service autonomy and turns service decomposition into a "distributed monolith" at runtime: code, databases, and deployments are distributed, but failure domains and commit paths remain tightly coupled.

### 3.4 Operational Complexity: Prepared Transactions Require External Governance

A prepared transaction is not an ordinary local transaction. PostgreSQL documentation explains that `PREPARE TRANSACTION` is not a normal command for applications or interactive sessions. It is intended for external transaction managers that coordinate atomic commits across multiple databases or transactional resources. ([PostgreSQL Japan][7])

This means XA/2PC is not just a development framework problem. It is an operations and governance problem. The system must have a transaction coordinator, transaction logs, timeout recovery, suspended transaction scanning, participant recovery, idempotent commit/rollback, monitoring alerts, and manual repair procedures. Without these capabilities, traditional distributed transactions shift from a consistency guarantee into a source of recovery complexity.

---

## 4. How Modern Microservice Governance Eliminates or Avoids Distributed Transactions

The baseline strategy of modern microservice governance is not to wrap every cross-service operation in a global transaction. It first reduces the probability of needing a distributed transaction, then chooses a more suitable consistency mechanism for remaining cases.

### 4.1 Reduce Cross-Service Write Transactions Through DDD and Service Boundaries

Azure microservice architecture documentation states that microservices should implement one business capability around a bounded context, and that each microservice manages its own domain data and logic. ([Microsoft Learn][5])

For transaction governance, this means service boundaries should not be split only by technical modules. They should be split by business invariants and consistency boundaries. Strong consistency constraints should be kept inside the same aggregate, service, and local transaction as much as possible. For example, order state transitions, order detail writes, and order creation records belong to the same order aggregate and should not be split across multiple services and then stitched back together through distributed transactions.

The practical effect is that strong consistency needs are compressed into local transaction boundaries, while cross-service collaboration becomes event notification, state synchronization, read-model updates, or compensation workflows.

### 4.2 Use Local Transactions, Idempotency, and Distributed Locks for Single-Sided Consistency

For inventory reservation, coupon claiming, duplicate-submit prevention, task claiming, and similar single-sided operations, many scenarios do not need XA/2PC. A more common approach is to use a local transaction inside one service, then control concurrency through idempotency keys, unique indexes, request IDs, state machines, and distributed locks when necessary.

Redis documentation provides a distributed lock algorithm based on Redis, aiming to provide mutual exclusion for shared resource access in distributed environments. ([Redis][8])

But a distributed lock is not a replacement for a distributed transaction. It protects a critical section or avoids duplicate concurrent execution, but it does not automatically roll back multiple service databases. In engineering practice, locks must be used together with idempotency. Azure API design guidance states that idempotent operations can be called multiple times without producing additional side effects after the first call, and that idempotency is an important resilience strategy for safe upstream retries. AWS Builders' Library also discusses how Amazon uses idempotent APIs to make retries safer. ([Microsoft Learn][9])

Therefore, the governance focus for single-sided operations is not introducing a global transaction. It is this: local transactions change state, unique constraints prevent duplication, idempotency keys make retries safe, and distributed locks only control the concurrency window when shared resource competition truly exists.

### 4.3 Use Local Message Tables or Transactional Outbox for Database-and-Message Dual Writes

In asynchronous cross-service collaboration, a common problem is "database write succeeds but message send fails" or "message send succeeds but database rolls back." AWS Prescriptive Guidance defines the Transactional Outbox pattern as a way to solve the dual-write problem between database writes and message/event notification in distributed systems. The pattern writes business data and an outbox event in the same database transaction, then uses an independent publisher to deliver the event asynchronously. ([AWS Documentation][10])

The key is not making all services commit synchronously. The key is ensuring that **the local service's state change and event record are completed atomically in one local transaction**. Downstream services achieve eventual consistency through message consumption, idempotent processing, retry, and compensation. This approach suits scenarios where order creation notifies points, risk control, marketing, search indexes, log analysis, and data warehouses without requiring synchronous strong consistency.

### 4.4 Use Reconciliation Systems and Manual Fallback for Final-Final Consistency

In finance, payment, e-commerce, logistics, and similar domains, even Saga, TCC, local message tables, and transactional messages cannot eliminate all exceptions. Network partitions, duplicate messages, unknown timeouts, missing third-party callbacks, manual refunds, and system replays can all create state differences. Therefore, reconciliation systems are not low-level fallback. They are part of eventual consistency architecture.

Reconciliation systems usually compare business records, state machines, audit logs, fund ledgers, inventory ledgers, and payment-channel statements periodically, then route differences that cannot be fixed automatically into manual tickets or operations workflows. This corresponds to "eventual eventual consistency": online paths converge automatically as much as possible, while offline or near-real-time reconciliation detects and fixes residual exceptions.

---

## 5. Necessary Scenarios for Distributed Transactions Today

Although modern microservice governance usually avoids traditional distributed transactions as the default, not every cross-service consistency problem can be simply made asynchronous. In core finance, payments, account balances, inventory reservation, points deduction, and complex e-commerce checkout, business consequences directly involve assets, fulfillment, and user rights. The system cannot rely only on "fix it later if it fails."

A typical path is:

```text
User checkout and payment path:
1. Order service: create order
2. Points service: deduct points
3. Warehouse service: reserve inventory
4. Payment service: deduct account balance
```

These services usually cannot be simply merged into one monolith because they carry different domain capabilities, data models, permission boundaries, scaling needs, and release lifecycles. But if points are deducted, inventory reservation fails, and payment state is unknown, the system must provide deterministic compensation, freezing, rollback, unfreezing, retry, or manual handling.

Therefore, in these scenarios, transaction governance does not mean returning to traditional XA/2PC. It means choosing flexible distributed transactions within business-acceptable boundaries. Apache Seata documentation states that Seata provides AT, TCC, Saga, and XA transaction models to build a one-stop distributed transaction solution. ([Seata][11])

---

## 6. Flexible Distributed Transaction Patterns: Saga and TCC

### 6.1 Saga: Long Transactions Split Into Local Transactions and Compensating Transactions

Azure Architecture Center defines Saga as a design pattern for maintaining data consistency in distributed systems. A Saga consists of a sequence of local transactions. Each service completes its own local transaction and triggers the next step through events or messages. If one step fails, compensating transactions undo the completed steps. ([Microsoft Learn][12])

Microservices.io defines Saga similarly: a Saga is a sequence of local transactions, where each local transaction updates the database and publishes a message or event to trigger the next local transaction. If a local transaction fails due to a business rule, a series of compensating transactions undo previously completed changes. ([microservices.io][13])

In an e-commerce checkout scenario, Saga can look like this:

```text
Create order succeeds
-> Deduct points succeeds
-> Reserve inventory fails
-> Trigger compensation: return points
-> Trigger compensation: cancel order
```

Saga is suitable for long processes, cross-system workflows, asynchronous execution, and manual intervention. Its drawback is that each participating service must provide explicit compensation actions, and compensation is not a database rollback. It is a reverse business operation. For example, "return points" is not undoing SQL; it is creating a points refund record.

### 6.2 TCC: Try, Confirm, and Cancel for Business Reservation

TCC splits a business action into Try, Confirm, and Cancel phases. Try reserves resources, Confirm commits them, and Cancel releases them. Compared with Saga, TCC is more intrusive to business interfaces but has clearer resource semantics. It suits account-balance freezing, inventory freezing, quota occupation, and other scenarios that reserve first and confirm later.

For payment account deduction:

```text
Try: freeze 100 yuan in the account
Confirm: convert the frozen amount into actual deduction
Cancel: release the frozen amount
```

Seata's official site lists TCC as one of its supported transaction modes and states that Seata supports TCC mode, which can be mixed with AT mode for greater flexibility. Its feature list also describes Saga as an effective solution for long transactions. ([Seata][14])

TCC's main advantage is that it does not hold database-level global transaction locks for a long time. It implements a controllable intermediate state through business resource freezing. Its cost is that business teams must implement three sets of interfaces and handle empty rollback, idempotency, suspension, timeout cancelation, and state-machine consistency.

---

## 7. A Layered Transaction Model Under Current Microservice Governance

Modern microservice transaction governance can be abstracted into three layers:

```text
       /\
      /  \      1. Top layer: flexible distributed transactions
     /    \        Saga / TCC / Seata
    /      \       Suitable for finance, payment, account, inventory, and other core paths
   /________\
  /          \   2. Middle layer: message-driven eventual consistency
 /            \     Local message table / Transactional Outbox / best-effort notification
/______________\    Suitable for most asynchronous cross-service decoupling scenarios

Foundation: domain boundaries, local transactions, idempotency, duplicate prevention, state machines, reconciliation
Goal: eliminate distributed transaction demand first instead of introducing global transactions by default
```

This layering explains why traditional 2PC/XA is no longer suitable as the default solution in microservices. It sits at the strong-consistency top layer, but early practice mistakenly applied it to many problems that could have been solved through boundary refactoring, asynchronous messaging, idempotent retry, reconciliation, and compensation.

---

## 8. Engineering Selection Principles

From an engineering governance perspective, choose cross-service consistency mechanisms in this order.

First, determine whether the strong consistency constraint can be moved back into a single service's local transaction through domain refactoring. If yes, adjust the service or aggregate boundary first.

Second, determine whether the problem is only single-sided resource concurrency control. If yes, prefer local transactions, unique constraints, idempotency keys, state machines, and distributed locks when necessary, instead of introducing a global transaction.

Third, determine whether asynchronous eventual consistency is acceptable. If yes, prefer Transactional Outbox, local message tables, reliable messages, consumer idempotency, retry, and compensation.

Fourth, determine whether the scenario involves assets, fulfillment, or user rights and requires a deterministic recovery path. If yes, choose Saga or TCC, and design a state machine, compensation action, idempotency mechanism, timeout handling, and reconciliation system for every step.

Fifth, determine whether XA/2PC is truly necessary. If it is used, confirm that the database, transaction manager, participant recovery, prepared transaction cleanup, monitoring alerts, timeout strategy, and manual repair SOP are all available. Otherwise, XA/2PC's consistency benefit will be offset by runtime complexity.

---

## 9. Conclusion

Traditional distributed transactions have not disappeared, but they are no longer the default center of microservice consistency governance. XA/2PC provides cross-resource atomic commit through global coordination, but this capability depends on all participants preparing, committing, or rolling back together inside a global transaction boundary. That model has structural tension with microservice autonomy, private databases, fault isolation, and independent scaling.

The main line of modern microservice governance is to first reduce cross-service strong consistency needs through DDD and service-boundary design, then cover most business scenarios with local transactions, idempotency, duplicate prevention, message tables, Transactional Outbox, reconciliation, and manual fallback. Only in core paths such as finance, payment, inventory, and accounts should flexible distributed transaction patterns such as Saga or TCC be used.

Therefore, "escaping traditional distributed transactions" does not mean abandoning consistency. It means moving from database-level strong-consistency commit to business-level recoverable consistency, observable consistency, and eventual consistency governance. For microservice systems, this is an architectural shift from "technical transactions" to "business transactions."

---

## References

1. MySQL Reference Manual: XA Transactions. ([MySQL Developer Zone][2])
2. PostgreSQL Documentation: Two-Phase Transactions / PREPARE TRANSACTION. ([PostgreSQL][15])
3. PostgreSQL Documentation: Prepared transaction usage recommendations. ([PostgreSQL][3])
4. Microsoft Azure Architecture Center: Saga Design Pattern. ([Microsoft Learn][12])
5. Microsoft Azure Architecture Center: Microservices data considerations / API idempotency. ([Microsoft Learn][1])
6. Microsoft .NET Microservices Architecture: Data sovereignty per microservice. ([Microsoft Learn][16])
7. AWS Prescriptive Guidance: Transactional Outbox Pattern. ([AWS Documentation][10])
8. Redis Documentation: Distributed Locks with Redis. ([Redis][8])
9. Apache Seata Documentation: AT, TCC, Saga, and XA transaction models. ([Seata][11])
10. Microservices.io: Database per Service / Saga Pattern. ([microservices.io][6])

[1]: https://learn.microsoft.com/en-us/azure/architecture/microservices/design/data-considerations?utm_source=chatgpt.com "Data Considerations for Microservices - Azure"
[2]: https://dev.mysql.com/doc/refman/9.5/en/xa.html?utm_source=chatgpt.com "MySQL 9.7 Reference Manual :: 15.3.8 XA Transactions"
[3]: https://www.postgresql.org/docs/current/sql-prepare-transaction.html?utm_source=chatgpt.com "Documentation: 18: PREPARE TRANSACTION"
[4]: https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide?view=sql-server-ver17&utm_source=chatgpt.com "Transaction Locking and Row Versioning Guide - SQL Server"
[5]: https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/microservices?utm_source=chatgpt.com "Microservices Architecture Style - Azure Architecture Center"
[6]: https://microservices.io/patterns/data/database-per-service.html?utm_source=chatgpt.com "Pattern: Database per service"
[7]: https://www.postgresql.jp/docs/17/sql-prepare-transaction.html?utm_source=chatgpt.com "PREPARE TRANSACTION"
[8]: https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/?utm_source=chatgpt.com "Distributed Locks with Redis | Docs"
[9]: https://learn.microsoft.com/en-us/azure/architecture/microservices/design/api-design?utm_source=chatgpt.com "API Design - Azure Architecture Center"
[10]: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html?utm_source=chatgpt.com "Transactional outbox pattern - AWS Prescriptive Guidance"
[11]: https://seata.apache.org/docs/next/overview/what-is-seata/?utm_source=chatgpt.com "What Is Seata?"
[12]: https://learn.microsoft.com/en-us/azure/architecture/patterns/saga?utm_source=chatgpt.com "Saga Design Pattern - Azure Architecture Center"
[13]: https://microservices.io/patterns/data/saga.html?utm_source=chatgpt.com "Pattern: Saga"
[14]: https://seata.apache.org/?utm_source=chatgpt.com "Apache Seata"
[15]: https://www.postgresql.org/docs/current/two-phase.html?utm_source=chatgpt.com "Documentation: 18: 67.4. Two-Phase Transactions"
[16]: https://learn.microsoft.com/en-us/dotnet/architecture/microservices/architect-microservice-container-applications/data-sovereignty-per-microservice?utm_source=chatgpt.com "Data sovereignty per microservice - .NET"
