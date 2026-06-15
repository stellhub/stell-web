# From Traditional Layer-Based Packaging to Domain-Driven Packaging: A Study of Project Structure Based on DDD, Service Layer, Hexagonal Architecture, and Clean Architecture

## Abstract

Traditional enterprise applications often organize projects by technical layers, using technical roles such as `controller`, `service`, `repository`, `dao`, `mapper`, `entity`, and `dto` as top-level package structures. This model maps directly to common Web application call chains, but in complex business systems it easily causes dispersed business concepts, scattered domain rules, inconsistent package and business boundaries, bloated application services, and infrastructure dependencies leaking inward. Eric Evans' Domain-Driven Design emphasizes core domains, ubiquitous language, bounded contexts, model-driven design, and domain model isolation. Martin Fowler's Service Layer pattern defines the application boundary and coordinates application operations. Alistair Cockburn's Hexagonal Architecture distinguishes the application interior from external technologies through ports and adapters. Robert C. Martin's Clean Architecture further proposes the dependency rule: source-code dependencies can point only inward toward higher-level business policies. Based on these references, this article explains the structural characteristics and problems of traditional packaging, and then proposes a new DDD-oriented project packaging specification.

**Keywords:** Domain-Driven Design; DDD; layered architecture; Service Layer; hexagonal architecture; Clean Architecture; project packaging

## 1. Introduction

Project packaging is not merely a matter of arranging directories. It is a coded expression of software-system boundaries, dependency direction, model expression, and team collaboration style. Traditional layer-based packaging usually centers on technical responsibilities, placing objects such as Controller, Service, DAO, Repository, Entity, and DTO into separate technical packages. This structure can quickly map request handling, business processing, and data access flows in simple CRUD systems. In complex business systems, however, business rules do not always stay stably inside one technical layer.

Domain-Driven Design places the design focus of complex software on the domain model. In DDD, Eric Evans defines patterns such as core domain, ubiquitous language, bounded context, entity, value object, aggregate, domain service, repository, and module, and explicitly states that domain models and business logic need to be isolated from the user interface, infrastructure, and non-business application logic [1][2]. Therefore, in complex business systems, project packaging should express domain boundaries and model structure rather than only technical-layer classification.

## 2. Theoretical Foundations

### 2.1 Domain-Driven Design

Domain-Driven Design is a methodology for complex software development. The core of DDD includes three aspects: focusing on the core domain, exploring models through collaboration between domain experts and software developers, and using a ubiquitous language within explicit boundaries [1]. In DDD, a model is not an analysis document detached from code; it should stay aligned with implementation. Model-driven design requires code to reflect the domain model, and the terms, responsibility allocation, and structural boundaries in code should come from the model [1].

DDD also emphasizes bounded contexts. Large projects usually contain multiple models, and different subsystems, teams, and user groups may require different models. If code based on different models is mixed together, the system becomes difficult to understand and team communication is affected [1]. Therefore, a model must hold within an explicit context. Codebases, database schemas, team organizations, and application areas can all represent context boundaries.

### 2.2 Service Layer

The Service Layer pattern defines an application's boundary and provides a set of available operations from the perspective of external clients. This layer encapsulates application business logic, controls transactions, and coordinates responses for each operation [3]. In enterprise applications, Service Layer does not mean putting all business rules into `xxxService` classes. Its core position is application boundary and use-case coordination. Its responsibilities include transaction control, process orchestration, calling domain objects, and coordinating external resources.

### 2.3 Hexagonal Architecture

Hexagonal Architecture is also known as Ports and Adapters. This architecture places the application on the inside and the outside world on the outside. External events enter the application through ports, and technology-specific adapters convert external input into calls or messages usable by the application. When the application sends information outward, it also passes through ports and lets adapters convert it into the corresponding technical signal [4]. The core of this model is not the hexagon itself, but the distinction between the application interior and external technologies, with ports and adapters providing isolation.

Cockburn points out that business logic leaking into user-interface code affects automated testing, batch calls, and program-to-program calls. Application logic coupled to databases or external services also affects development when the database is unavailable, replaced, or refactored [4]. Therefore, the ports-and-adapters structure is used to reduce entanglement between business logic and external devices, interfaces, databases, and remote services.

### 2.4 Clean Architecture

Clean Architecture divides an architecture into different layers and requires dependencies to point only inward. Inner layers represent higher-level business policies, while outer layers represent mechanisms and technical details. The dependency rule requires inner code to know nothing about functions, classes, variables, or other named entities in outer code [5]. Clean Architecture also defines entities as carriers of enterprise-wide business rules, use cases as the place for application-specific business rules, and external facilities such as databases, Web frameworks, and UI as outer-layer details [5].

## 3. Traditional Packaging and Its Structural Characteristics

Traditional Java Web or enterprise applications usually use technical layer-based packaging. A typical form is as follows:

```text
com.example.order
├── controller
│   └── OrderController
├── service
│   ├── OrderService
│   └── InventoryService
├── repository
│   └── OrderRepository
├── dao
│   └── OrderDao
├── mapper
│   └── OrderMapper
├── entity
│   └── OrderEntity
├── dto
│   ├── OrderCreateRequest
│   └── OrderResponse
├── config
│   └── WebConfig
└── util
    └── DateUtils
```

In this structure, top-level package names are determined by technical roles. Requests usually enter through `controller`, are handled by `service` as application logic, then call `repository`, `dao`, or `mapper` to access the database, and finally return results through `dto`. The code path is consistent with the Web request call chain and can directly reflect the technical structure of MVC or three-tier architecture.

However, these top-level package boundaries do not express business model boundaries. Domain concepts such as order, payment, inventory, fulfillment, and settlement are scattered across packages such as `controller`, `service`, `dao`, `entity`, and `dto`. When a business action involves multiple concepts, related code is often distributed across multiple technical packages. Readers must trace across packages along the call chain before they can reconstruct the complete business semantics.

## 4. Problems with Traditional Packaging

### 4.1 Business Concepts Are Split by Technical Layers

The DDD Reference defines modules as part of the model and states that module names should become part of the ubiquitous language. Modules should contain cohesive sets of concepts and tell the story of the system [1]. In technical layer-based packaging, package names express technical roles rather than business concepts. Names such as `controller`, `service`, `mapper`, and `entity` do not belong to the business ubiquitous language, so they cannot directly express domain boundaries.

For example, in an order system, `OrderController`, `OrderService`, `OrderMapper`, `OrderEntity`, and `OrderDTO` are scattered in different packages. This structure says that the code belongs to different technical layers, but it cannot say which model boundary order creation, order cancellation, order fulfillment, or order settlement belongs to, nor can it explain their relationships with contexts such as inventory, payment, membership, and promotion.

### 4.2 Domain Logic Spreads into Non-Domain Code

Evans points out that when domain-related code spreads into large amounts of other code, understanding and reasoning become difficult. Superficial UI changes may affect business logic, and modifying business rules may require tracing UI code, database code, or other program elements [2]. In traditional technical layer-based packaging, business rules often appear in `controller` parameter checks, `service` process decisions, `mapper` SQL conditions, `dao` query logic, `entity` field states, and `util` helper functions. At that point, domain rules have no centralized place for expression.

This structure easily creates an anemic domain model. Entity classes mainly carry fields, while domain behavior is scattered across services or SQL. In DDD, entities, value objects, aggregates, and domain services are intended to express domain concepts and their rules. If they only serve as data structures, the domain model does not become the main carrier of business rules.

### 4.3 The Service Layer Becomes Bloated

The definition of Service Layer is to establish an application boundary, provide available operations, control transactions, and coordinate responses [3]. In traditional packaging, the `service` package often carries use-case orchestration, transaction control, domain rules, data conversion, external interface calls, cache handling, message sending, permission checks, and more. At that point, Service Layer is no longer just an application boundary; it becomes a mixed layer of business and technical logic.

In DDD, domain services express domain processes or transformations that do not naturally belong to entities or value objects [1]. In Clean Architecture, use cases encapsulate application-specific business rules and coordinate entities to achieve use-case goals [5]. Therefore, application services, domain services, and infrastructure services should be distinguished. If all of them are placed into a unified `service` package, the package name cannot express their different responsibilities.

### 4.4 Model Boundaries Do Not Match Team Boundaries

DDD uses bounded contexts to define model applicability boundaries. In large projects, multiple models are inevitable, and the context in which a model holds must be explicit [1]. Traditional technical layer-based packaging places code from different business contexts into the same technical package. For example, the `service` package may contain services related to order, payment, inventory, and promotion, while the `repository` package may contain data access objects from multiple contexts. This structure cannot express context boundaries at the package level.

When multiple teams maintain one project together, technical-layer packaging easily causes teams to collaborate around technical layers instead of domain contexts. As a result, business changes usually cross multiple technical packages and multiple team responsibility areas.

### 4.5 Infrastructure Dependencies Leak into Business Inner Layers

Hexagonal Architecture points out that the common cause of user-side and server-side problems is the entanglement of business logic with external entities [4]. Clean Architecture states that source-code dependencies can point only inward, and inner code must not know named entities from outer code. Databases and Web frameworks belong to outer details [5]. In traditional packaging, when `service` directly depends on ORM entities, mappers, RPC clients, MQ clients, or framework annotations, application logic and domain rules directly know infrastructure details.

Once database table structures, ORM frameworks, remote interface protocols, message middleware, or Web frameworks change, business code may have to change at the same time. This conflicts with DDD's domain isolation, Hexagonal Architecture's ports and adapters, and Clean Architecture's dependency rule.

### 4.6 Automated Tests Depend on External Technologies

Cockburn points out that after business logic enters the UI, automated tests depend on volatile visual details. After application logic binds to a database, development is also affected by database state [4]. Clean Architecture also states that business rules should be testable without a UI, database, Web server, or any other external element [5]. If traditional packaging has no port abstractions and adapter isolation, testing application logic usually requires starting containers, databases, Web frameworks, or remote-service simulation environments.

## 5. New Project Packaging Principles

Based on DDD, Service Layer, Hexagonal Architecture, and Clean Architecture, new project packaging should use business boundaries as the main axis, dependency direction as a constraint, and ports and adapters to isolate technical details. This structure does not eliminate layering. Instead, it promotes business context to the first-level boundary, then divides domain, application, adapter, and infrastructure responsibilities inside each context.

### 5.1 Use Bounded Contexts as Top-Level Boundaries

Top-level packages should express business contexts rather than technical layers. Contexts such as order, payment, inventory, fulfillment, and settlement should each have their own independent package structure.

```text
com.company.trade
├── order
├── payment
├── inventory
├── fulfillment
└── settlement
```

This structure first expresses business model boundaries. Each context then divides domain, application, ports, adapters, and infrastructure internally. Contexts should not directly share each other's internal models. They should communicate only through explicit application interfaces, domain events, open host services, anticorruption layers, or adapters.

### 5.2 Layer by Architectural Responsibility Inside Each Context

Each bounded context can use the following structure internally:

```text
com.company.trade.order
├── domain
│   ├── model
│   ├── service
│   ├── event
│   └── repository
├── application
│   ├── command
│   ├── query
│   └── service
├── adapter
│   ├── inbound
│   │   ├── web
│   │   └── messaging
│   └── outbound
│       ├── persistence
│       ├── rpc
│       └── messaging
└── bootstrap
```

`domain` contains the domain model, including entities, value objects, aggregates, domain services, domain events, and repository interfaces. `application` contains use-case orchestration, transaction boundaries, commands, queries, and application services. `adapter.inbound` contains input adapters such as HTTP controllers, RPC endpoints, MQ consumers, and CLI handlers. `adapter.outbound` contains output adapters such as database, cache, remote service, and message sending implementations. `bootstrap` contains dependency injection, configuration assembly, and startup entry points.

### 5.3 Dependencies Point Toward the Business Core

In this structure, dependency direction should satisfy the following constraints:

```text
adapter  ──> application ──> domain
bootstrap ──> adapter/application/domain
adapter.outbound ──implements──> domain/application port
domain ──x──> application/adapter/infrastructure/framework
application ──x──> adapter concrete class
```

`domain` does not depend on `application`, `adapter`, or concrete frameworks. `application` can depend on `domain` and access external resources through port interfaces. `adapter` depends on inner interfaces and performs technical conversion. `bootstrap` assembles interfaces and implementations. This direction is consistent with the Clean Architecture dependency rule: source-code dependencies can point only inward toward business policies [5].

### 5.4 Define Repository Interfaces in Inner Layers and Implement Them in Outer Layers

The DDD Reference states that a Repository provides aggregate roots that require global access with an interface similar to an in-memory collection, and delegates object storage and access to the repository [1]. Therefore, in domain-driven packaging, repository interfaces should be located in `domain.repository` or application ports, while repository implementations should be located in `adapter.outbound.persistence`.

```text
order
├── domain
│   └── repository
│       └── OrderRepository
└── adapter
    └── outbound
        └── persistence
            ├── JpaOrderRepository
            ├── OrderJpaEntity
            └── OrderJpaMapper
```

This structure lets the domain model depend on abstract repositories rather than JPA, MyBatis, SQL, MongoDB, or other storage technologies. Database row structures, ORM entities, and mappers belong to output adapters, not to the domain model itself.

### 5.5 Application Services Only Orchestrate Use Cases

Application services express application use cases. They receive commands, control transactions, load aggregates, call domain behavior, save aggregates, and publish events. Domain rules should preferably be placed in aggregates, entities, value objects, or domain services. Application services should not replace the domain model as the carrier of business rules.

```java
public final class PlaceOrderApplicationService {

    private final OrderRepository orderRepository;
    private final ProductPricingPort productPricingPort;

    public OrderId placeOrder(PlaceOrderCommand command) {
        // Load external data through a port
        Money price = productPricingPort.getPrice(command.productId());

        // Create aggregate through domain behavior
        Order order = Order.place(command.customerId(), command.productId(), price);

        // Persist aggregate through repository abstraction
        orderRepository.save(order);

        return order.id();
    }
}
```

In this example, the application service orchestrates the process. Price lookup is completed through a port. Order creation is expressed by the domain model. Persistence is completed through a repository abstraction. The external pricing service and database implementation do not enter the domain layer.

### 5.6 Adapters Only Handle Protocol Conversion and Technical Integration

Input adapters convert external protocols such as HTTP, RPC, messaging, and CLI into application-layer commands or queries. Output adapters convert inner port calls into database access, cache access, remote calls, or message sending. Adapters can depend on frameworks and technical implementations, but they should not carry domain rules.

```java
@RestController
public final class OrderController {

    private final PlaceOrderApplicationService placeOrderService;

    @PostMapping("/orders")
    public OrderResponse placeOrder(@RequestBody PlaceOrderRequest request) {
        // Convert transport request to application command
        PlaceOrderCommand command = new PlaceOrderCommand(
                request.customerId(),
                request.productId()
        );

        OrderId orderId = placeOrderService.placeOrder(command);

        // Convert application result to transport response
        return new OrderResponse(orderId.value());
    }
}
```

In this code, the controller only converts between transport-layer objects and application-layer commands. The HTTP request structure does not enter the domain layer. This practice is consistent with Clean Architecture's principle for boundary data structures: data crossing a boundary should be isolated simple data structures, and outer framework formats should not force inner layers to depend on external details [5].

## 6. Problems Solved by the New Packaging Model

### 6.1 Business Structure Becomes Visible

After bounded contexts become top-level packages, the project directory directly presents the business map. Package names such as `order`, `payment`, `inventory`, and `fulfillment` come from business language rather than technical language. DDD treats modules as part of the model and requires module names to reflect domain insight [1]. Therefore, the new packaging model keeps code structure aligned with the ubiquitous language.

### 6.2 Domain Rules Are Expressed Centrally

The domain layer centrally contains entities, value objects, aggregates, domain services, and domain events. Aggregates define consistency boundaries. External objects can reference only aggregate roots, and aggregate roots maintain overall invariants. Updates across aggregate boundaries are usually handled asynchronously [1]. This structure makes domain rules preferentially land in model objects instead of being scattered across controllers, mappers, SQL, or utility classes.

### 6.3 Technical Changes Are Restricted to the Adapter Layer

Hexagonal Architecture treats external devices, UI, databases, testing tools, batch processes, HTTP interfaces, and program-to-program calls as adapters. The application communicates with the outside world through ports [4]. Clean Architecture treats databases and Web frameworks as outer details and requires business rules not to bind to those details [5]. Therefore, when databases, message middleware, remote interfaces, or Web frameworks change, the main change area is the adapter layer and startup assembly layer.

### 6.4 Automated Test Boundaries Are Clear

Application services and domain models can be tested through port doubles, in-memory repositories, or mock adapters. In Hexagonal Architecture, Cockburn gives examples of replacing a real database with an in-memory database and using a test tool to drive application ports [4]. Clean Architecture also explains that business rules should be testable without UI, databases, or Web servers [5]. Therefore, the new packaging model separates test targets from external technical details.

### 6.5 Integration Between Contexts Becomes Explicit

Bounded contexts require explicit model applicability boundaries [1]. In the new packaging model, one context must not directly access another context's internal domain objects, database tables, or repository implementations. Cross-context integration should be completed through application-service interfaces, domain events, messages, remote APIs, or anticorruption layers. This specification prevents concepts from different models from being mixed directly at the code level.

## 7. Packaging Specification

Based on the analysis above, complex business systems can form the following DDD packaging specification.

First, top-level packages are divided by bounded context or business subdomain, not by technical layers such as `controller`, `service`, and `dao` as global top-level boundaries.

Second, package names should come from the ubiquitous language. Business package names should express domain concepts such as order, payment, inventory, fulfillment, settlement, account, contract, and quotation. Generic package names such as `common`, `util`, `manager`, `handler`, and `processor` should be restricted.

Third, each context keeps architectural layers internally. Typical layers include `domain`, `application`, `adapter`, and `bootstrap`. Here, `domain` is the business core, `application` is use-case orchestration, `adapter` is protocol and technical conversion, and `bootstrap` is the assembly entry point.

Fourth, dependencies can only point from outside to inside. The domain layer must not depend on Web, ORM, MQ, RPC, cache, configuration frameworks, or database row structures. The application layer must not depend on concrete adapter implementations. Adapters can depend on the application layer and domain layer.

Fifth, the domain model carries domain rules. Entities express identity and lifecycle. Value objects express identity-free attribute combinations and related behavior. Aggregates express consistency boundaries. Domain services express domain processes that do not naturally belong to entities or value objects. Domain events express occurred facts that domain experts care about. Repositories provide access interfaces for aggregate roots.

Sixth, application services handle use-case orchestration. They are responsible for transaction boundaries, command handling, query handling, calling domain objects, calling ports, and coordinating returned results. They should not become the only carrier of all business rules.

Seventh, repository interfaces are located in inner layers, and repository implementations are located in outer layers. Interfaces should express domain semantics, while concrete SQL, ORM, indexes, table structures, and data conversion belong to persistence adapters.

Eighth, input adapters do not write domain rules. HTTP controllers, RPC endpoints, MQ consumers, and CLI handlers are responsible for extracting authentication context, parameter validation, protocol conversion, and calling application services. Business rules enter the application layer and domain layer.

Ninth, output adapters do not pollute the domain model in reverse. Database entities, RPC DTOs, MQ event payloads, and cache structures are external technical models and should not spread through inner layers as domain objects.

Tenth, cross-context access must go through explicit interfaces. One context must not directly reference another context's domain objects, database tables, mappers, or repository implementations. Cross-context interaction uses application APIs, message events, anticorruption layers, or open host services.

## 8. Example: Domain-Driven Packaging for an Order Context

An order context can use the following structure:

```text
com.company.trade.order
├── domain
│   ├── model
│   │   ├── Order
│   │   ├── OrderId
│   │   ├── OrderItem
│   │   ├── OrderStatus
│   │   └── Money
│   ├── service
│   │   └── OrderPricingService
│   ├── event
│   │   └── OrderPlacedEvent
│   └── repository
│       └── OrderRepository
├── application
│   ├── command
│   │   ├── PlaceOrderCommand
│   │   └── CancelOrderCommand
│   ├── query
│   │   └── OrderDetailQuery
│   └── service
│       ├── PlaceOrderApplicationService
│       └── CancelOrderApplicationService
├── adapter
│   ├── inbound
│   │   ├── web
│   │   │   ├── OrderController
│   │   │   ├── PlaceOrderRequest
│   │   │   └── OrderResponse
│   │   └── messaging
│   │       └── PaymentCompletedConsumer
│   └── outbound
│       ├── persistence
│       │   ├── OrderJpaRepository
│       │   ├── OrderJpaEntity
│       │   └── OrderPersistenceMapper
│       ├── rpc
│       │   └── ProductClientAdapter
│       └── messaging
│           └── OrderEventPublisherAdapter
└── bootstrap
    └── OrderModuleConfiguration
```

In this structure, names such as `Order`, `OrderId`, `Money`, and `OrderPlacedEvent` come from the ubiquitous language of the order context. `OrderRepository` is a domain-layer interface, while `OrderJpaRepository` is an infrastructure implementation. `OrderController` is an input adapter, while `ProductClientAdapter` and `OrderEventPublisherAdapter` are output adapters. Application services access external resources through ports and repository interfaces, without directly depending on databases, RPC, or message middleware.

## 9. Discussion

DDD packaging is not about renaming the traditional `entity` package to `domain`, nor is it about placing all business code into a single `domain` package. The core of DDD lies in model boundaries, ubiquitous language, aggregate consistency, domain isolation, and context boundaries. Service Layer solves application boundary and use-case coordination problems. Hexagonal Architecture solves the ports-and-adapters problem between application internals and external technologies. Clean Architecture solves dependency direction and business-rule independence. Their shared result in project packaging is this: package structure should express the business model before technical adaptation; dependencies should point toward the business core; and external technical details should stay outside the boundary.

Therefore, the new project packaging model does not eliminate technical objects such as `controller`, `service`, and `repository`; instead, it changes their locations and dependency relationships. Controllers belong to input adapters. Repository implementations belong to output adapters. Application services belong to the use-case layer. Domain services belong to the domain layer. The same class-name suffix has different responsibilities in different layers and must be distinguished by package boundaries and dependency rules.

## 10. Conclusion

Traditional technical layer-based packaging uses technical roles as top-level boundaries. It is suitable for expressing request-processing call chains, but it is not suitable for expressing complex business model boundaries. In complex business systems, this model easily causes business concepts to be split by technical layers, domain rules to spread, the Service layer to bloat, context boundaries to become unclear, infrastructure dependencies to leak inward, and tests to depend on external technologies.

The new packaging model based on DDD, Service Layer, Hexagonal Architecture, and Clean Architecture should use bounded contexts or business subdomains as top-level boundaries, and divide the domain layer, application layer, adapter layer, and startup assembly layer inside each context. This structure uses ubiquitous-language names for packages, centralizes business rules in the domain layer, orchestrates use cases in the application layer, isolates external technologies through ports and adapters, and protects the business core through dependency direction. The final specification is: business boundaries take priority over technical boundaries, model names take priority over framework names, dependencies point toward the domain core, and technical implementations stay at the system edge.

## References

[1] Eric Evans. Domain-Driven Design: Tackling Complexity in the Heart of Software. Addison-Wesley, 2003/2004.
[2] Eric Evans. Domain-Driven Design Reference. Domain Language, 2015.
[3] Martin Fowler. Patterns of Enterprise Application Architecture: Service Layer. 2002/2003.
[4] Alistair Cockburn. Hexagonal Architecture / Ports and Adapters. 2005.
[5] Robert C. Martin. The Clean Architecture. 2012.
[6] Robert C. Martin. Clean Architecture: A Craftsman's Guide to Software Structure and Design. 2017.
[7] Martin Fowler. Patterns of Enterprise Application Architecture. Addison-Wesley, 2002.
