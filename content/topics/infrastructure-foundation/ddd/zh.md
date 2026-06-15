# 从传统分层分包到领域驱动分包：基于 DDD、Service Layer、Hexagonal Architecture 与 Clean Architecture 的项目结构研究

## 摘要

传统企业应用常采用按技术层分包的项目组织方式，即以 `controller`、`service`、`repository`、`dao`、`mapper`、`entity`、`dto` 等技术角色作为顶层包结构。该模式能够直接对应常见 Web 应用调用链，但在复杂业务系统中容易出现业务概念分散、领域规则扩散、包边界与业务边界不一致、应用服务膨胀以及基础设施依赖内渗等问题。Eric Evans 的领域驱动设计强调核心领域、统一语言、限界上下文、模型驱动设计以及领域模型隔离；Martin Fowler 收录的 Service Layer 模式定义应用边界并协调应用操作；Alistair Cockburn 的 Hexagonal Architecture 通过端口和适配器区分应用内部与外部技术；Robert C. Martin 的 Clean Architecture 进一步提出依赖规则，即源代码依赖只能指向内层业务策略。基于上述文献，本文说明传统分包模式的结构特征及其问题，并给出面向 DDD 的新型项目分包规范。

**关键词**：领域驱动设计；DDD；分层架构；Service Layer；六边形架构；整洁架构；项目分包

## 1 引言

项目分包不是单纯的目录整理问题，而是软件系统边界、依赖方向、模型表达和团队协作方式的代码化呈现。传统分层分包通常以技术职责为主轴，把 Controller、Service、DAO、Repository、Entity、DTO 等对象分别放在不同技术包中。该结构在简单 CRUD 系统中能够快速对应请求处理、业务处理和数据访问流程，但在复杂业务系统中，业务规则并不总是稳定地停留在某一个技术层中。

领域驱动设计将复杂软件的设计重心放在领域模型之上。Eric Evans 在 DDD 中定义了核心领域、统一语言、限界上下文、实体、值对象、聚合、领域服务、仓储和模块等模式，并明确指出领域模型和业务逻辑需要与用户界面、基础设施以及非业务性的应用逻辑隔离 [1][2]。因此，在复杂业务系统中，项目分包应当表达领域边界和模型结构，而不应仅表达技术层分类。

## 2 理论基础

### 2.1 Domain-Driven Design

Domain-Driven Design 是面向复杂软件开发的方法体系。DDD 的核心包括三个方面：聚焦核心领域；通过领域专家与软件开发人员协作探索模型；在明确边界内使用统一语言 [1]。在 DDD 中，模型不是脱离代码的分析文档，而应当与实现保持对应关系。模型驱动设计要求代码反映领域模型，代码中的术语、职责分配和结构划分应当来自模型 [1]。

DDD 同时强调限界上下文。大型项目中通常会存在多个模型，不同子系统、不同团队和不同用户群体可能需要不同模型。若基于不同模型的代码被混合使用，系统会变得难以理解，团队沟通也会受到影响 [1]。因此，模型必须在明确上下文中成立，代码库、数据库模式、团队组织和应用区域都可以成为上下文边界的表现形式。

### 2.2 Service Layer

Service Layer 模式定义应用边界，并从外部客户端视角提供一组可用操作。该层封装应用业务逻辑，控制事务，并协调每个操作的响应 [3]。在企业应用中，Service Layer 不等同于把所有业务规则放进 `xxxService` 类。它的核心位置是应用边界与用例协调，其职责包括事务控制、流程编排、调用领域对象和协调外部资源。

### 2.3 Hexagonal Architecture

Hexagonal Architecture 又称 Ports and Adapters。该架构把应用放在内部，把外部世界放在外部。外部事件通过端口进入应用，技术相关适配器把外部输入转换为应用可使用的调用或消息；应用向外发送信息时，也通过端口交给适配器转换成对应技术信号 [4]。该模型的核心不是六边形本身，而是区分“应用内部”和“外部技术”，并通过端口和适配器实现隔离。

Cockburn 指出，用户界面代码中的业务逻辑渗透会影响自动化测试、批处理调用和程序间调用；应用逻辑与数据库或外部服务绑定，也会在数据库不可用、更换或重构时影响开发 [4]。因此，端口和适配器结构用于减少业务逻辑与外部设备、界面、数据库、远程服务之间的纠缠。

### 2.4 Clean Architecture

Clean Architecture 将架构划分为不同层次，并规定依赖方向只能指向内层。内层代表更高层的业务策略，外层代表机制和技术细节。依赖规则要求内层代码不能知道外层代码中的函数、类、变量或其他命名实体 [5]。Clean Architecture 同时将实体定义为企业级业务规则的承载者，将 Use Cases 定义为应用特定业务规则的实现位置，并把数据库、Web 框架、UI 等外部设施放在外层 [5]。

## 3 传统分包模式及其结构特征

传统 Java Web 或企业应用通常采用按技术层分包的结构。典型形式如下：

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

该结构的顶层包名由技术角色决定。请求通常从 `controller` 进入，由 `service` 处理应用逻辑，再调用 `repository`、`dao` 或 `mapper` 访问数据库，最后通过 `dto` 返回结果。该模式的代码路径与 Web 请求调用链一致，能够直接反映 MVC 或三层架构的技术结构。

但是，该结构的顶层包边界不表达业务模型边界。订单、支付、库存、履约、结算等领域概念会同时散落在 `controller`、`service`、`dao`、`entity`、`dto` 等包中。若一个业务动作涉及多个概念，相关代码往往分布在多个技术包中，阅读者需要沿调用链跨包追踪，才能还原完整业务语义。

## 4 传统分包模式的问题

### 4.1 业务概念被技术层切散

DDD Reference 将模块定义为模型的一部分，并指出模块命名应当成为统一语言的一部分。模块应包含内聚的概念集合，并讲述系统的故事 [1]。按技术层分包时，包名表达的是技术角色，而不是业务概念。`controller`、`service`、`mapper`、`entity` 并不属于业务统一语言，因此无法直接表达领域边界。

例如，在订单系统中，`OrderController`、`OrderService`、`OrderMapper`、`OrderEntity`、`OrderDTO` 分散在不同包中。该结构说明代码属于不同技术层，但无法说明订单创建、订单取消、订单履约、订单结算分别属于哪个模型边界，也无法说明它们与库存、支付、会员、优惠等上下文之间的关系。

### 4.2 领域逻辑扩散到非领域代码中

Evans 指出，当领域相关代码扩散到大量其他代码中时，理解和推理会变得困难；UI 的表层变化可能影响业务逻辑；修改业务规则可能需要追踪 UI 代码、数据库代码或其他程序元素 [2]。在传统按技术层分包中，业务规则常出现在 `controller` 参数判断、`service` 流程判断、`mapper` SQL 条件、`dao` 查询逻辑、`entity` 字段状态和 `util` 工具函数中。此时领域规则没有集中表达位置。

这种结构容易形成“贫血领域模型”。实体类主要承载字段，领域行为由 Service 或 SQL 分散实现。DDD 中的实体、值对象、聚合和领域服务本来用于表达领域概念及其规则；若它们只承担数据结构职责，领域模型就不会成为业务规则的主要载体。

### 4.3 Service 层职责膨胀

Service Layer 的定义是建立应用边界、提供可用操作、控制事务并协调响应 [3]。在传统分包中，`service` 包常同时承担用例编排、事务控制、领域规则、数据转换、外部接口调用、缓存处理、消息发送和权限判断等职责。此时 Service Layer 不再只是应用边界，而会成为业务和技术逻辑的混合层。

DDD 中的领域服务用于表达不适合放入实体和值对象的领域过程或转换 [1]。Clean Architecture 中的 Use Cases 用于封装应用特定业务规则并协调实体完成用例目标 [5]。因此，应用服务、领域服务和基础设施服务应当区分。若统一放入 `service` 包，包名无法表达职责差异。

### 4.4 模型边界与团队边界不一致

DDD 的限界上下文用于定义模型适用边界。大型项目中多个模型不可避免，必须明确某个模型在哪个上下文中成立 [1]。传统按技术层分包把不同业务上下文的代码放入同一技术包。例如，`service` 包下同时存在订单、支付、库存和优惠相关 Service；`repository` 包下同时存在多个上下文的数据访问对象。这种结构无法在包边界上表达上下文边界。

当多个团队共同维护同一个项目时，技术层分包容易使团队以技术层为边界协作，而不是以领域上下文为边界协作。结果是业务变更通常跨越多个技术包和多个团队职责区域。

### 4.5 基础设施依赖向业务内层渗透

Hexagonal Architecture 指出，用户侧和服务器侧问题的共同原因是业务逻辑与外部实体交互发生纠缠 [4]。Clean Architecture 规定源码依赖只能指向内层，内层代码不能知道外层代码的命名实体；数据库、Web 框架等属于外层细节 [5]。传统分包中，`service` 直接依赖 ORM Entity、Mapper、RPC Client、MQ Client 或框架注解时，应用逻辑和领域规则会直接知道基础设施细节。

一旦数据库表结构、ORM 框架、远程接口协议、消息中间件或 Web 框架变化，业务代码可能同步变化。这与 DDD 的领域隔离、六边形架构的端口适配和 Clean Architecture 的依赖规则不一致。

### 4.6 自动化测试依赖外部技术

Cockburn 指出，业务逻辑进入 UI 后，自动化测试会依赖易变的视觉细节；应用逻辑绑定数据库后，开发工作也会被数据库状态影响 [4]。Clean Architecture 也指出，业务规则应当能够在没有 UI、数据库、Web Server 或其他外部元素的情况下测试 [5]。传统分包若没有端口抽象和适配器隔离，测试应用逻辑通常需要启动容器、数据库、Web 框架或远程服务模拟环境。

## 5 新型项目分包原则

基于 DDD、Service Layer、Hexagonal Architecture 和 Clean Architecture，新型项目分包应当以业务边界为主轴，以依赖方向为约束，以端口和适配器隔离技术细节。该结构不是取消分层，而是把“业务上下文”提升为第一层边界，再在上下文内部划分领域层、应用层、适配器层和基础设施层。

### 5.1 以限界上下文作为顶层边界

顶层包应表达业务上下文，而不是技术层。订单、支付、库存、履约、结算等上下文应当拥有各自独立的包结构。

```text
com.company.trade
├── order
├── payment
├── inventory
├── fulfillment
└── settlement
```

该结构首先表达业务模型边界。每个上下文内部再划分领域、应用、端口、适配器和基础设施。上下文之间不能直接共享对方内部模型，只能通过明确的应用接口、领域事件、开放主机服务、防腐层或适配器通信。

### 5.2 上下文内部按架构职责分层

每个限界上下文内部可以采用如下结构：

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

`domain` 放置领域模型，包括实体、值对象、聚合、领域服务、领域事件和仓储接口。`application` 放置用例编排、事务边界、命令、查询和应用服务。`adapter.inbound` 放置 HTTP Controller、RPC Endpoint、MQ Consumer、CLI Handler 等输入适配器。`adapter.outbound` 放置数据库、缓存、远程服务、消息发送等输出适配器。`bootstrap` 放置依赖注入、配置装配和启动入口。

### 5.3 依赖方向指向业务内核

在该结构中，依赖方向应满足以下约束：

```text
adapter  ──> application ──> domain
bootstrap ──> adapter/application/domain
adapter.outbound ──implements──> domain/application port
domain ──x──> application/adapter/infrastructure/framework
application ──x──> adapter concrete class
```

`domain` 不依赖 `application`、`adapter` 和具体框架。`application` 可以依赖 `domain`，并通过端口接口访问外部资源。`adapter` 依赖内层接口并完成技术转换。`bootstrap` 负责把接口和实现装配起来。该方向与 Clean Architecture 的依赖规则一致：源码依赖只能指向内层业务策略 [5]。

### 5.4 Repository 定义在内层，实现放在外层

DDD Reference 指出，Repository 为需要全局访问的聚合根提供类似内存集合的访问接口，并将对象存储和访问委托给仓储 [1]。因此，在领域驱动分包中，Repository 接口应位于 `domain.repository` 或应用端口中，Repository 实现应位于 `adapter.outbound.persistence`。

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

该结构使领域模型依赖抽象仓储，而不依赖 JPA、MyBatis、SQL、MongoDB 或其他存储技术。数据库行结构、ORM Entity 和 Mapper 属于输出适配器，不属于领域模型本身。

### 5.5 Application Service 只负责编排用例

Application Service 表达应用用例，负责接收命令、控制事务、加载聚合、调用领域行为、保存聚合和发布事件。领域规则应优先放在聚合、实体、值对象或领域服务中。Application Service 不应替代领域模型承载业务规则。

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

在该示例中，应用服务负责编排流程；价格查询通过端口完成；订单创建由领域模型表达；持久化通过仓储抽象完成。外部价格服务和数据库实现不进入领域层。

### 5.6 Adapter 只负责协议转换和技术对接

输入适配器将 HTTP、RPC、消息、CLI 等外部协议转换为应用层命令或查询。输出适配器将内层端口调用转换为数据库访问、缓存访问、远程调用或消息发送。适配器可以依赖框架和技术实现，但不承载领域规则。

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

该代码中，Controller 只负责传输层对象和应用层命令之间的转换。HTTP 请求结构不会进入领域层。该做法与 Clean Architecture 关于边界数据结构的原则一致：跨边界传递的数据应当是隔离的简单数据结构，外层框架格式不应迫使内层依赖外部细节 [5]。

## 6 新型分包解决的问题

### 6.1 业务结构可见化

以限界上下文为顶层包后，项目目录直接呈现业务地图。`order`、`payment`、`inventory`、`fulfillment` 等包名来自业务语言，而不是技术语言。DDD 将模块视为模型的一部分，要求模块名称反映领域洞察 [1]。因此，新型分包使代码结构与统一语言保持一致。

### 6.2 领域规则集中表达

领域层集中放置实体、值对象、聚合、领域服务和领域事件。聚合用于定义一致性边界，外部对象只能引用聚合根，聚合根负责维护整体不变量；跨聚合边界的更新通常异步处理 [1]。该结构使领域规则优先落在模型对象中，而不是散布在 Controller、Mapper、SQL 或工具类中。

### 6.3 技术变化被限制在适配器层

Hexagonal Architecture 将外部设备、UI、数据库、测试工具、批处理、HTTP 接口和程序间调用都视为适配器，应用通过端口与外界通信 [4]。Clean Architecture 将数据库、Web 框架等称为外层细节，并要求业务规则不绑定这些细节 [5]。因此，当数据库、消息中间件、远程接口或 Web 框架变化时，主要变化区域位于适配器层和启动装配层。

### 6.4 自动化测试边界清晰

应用服务和领域模型可以通过端口替身、内存仓储或 Mock Adapter 进行测试。Cockburn 在 Hexagonal Architecture 中给出内存数据库替代真实数据库、测试工具驱动应用端口的用法 [4]。Clean Architecture 也说明业务规则应能脱离 UI、数据库和 Web Server 测试 [5]。因此，新型分包把测试对象从外部技术细节中分离出来。

### 6.5 上下文间集成方式显式化

限界上下文要求明确模型适用边界 [1]。在新型分包中，一个上下文不能直接访问另一个上下文的内部领域对象、数据库表或 Repository 实现。跨上下文集成应通过应用服务接口、领域事件、消息、远程 API 或防腐层完成。该规范避免不同模型概念在代码层面直接混合。

## 7 分包规范

基于上述分析，复杂业务系统中的 DDD 分包可形成以下规范。

第一，顶层包按限界上下文或业务子域划分，不以 `controller`、`service`、`dao` 等技术层作为全局顶层边界。

第二，包名应来自统一语言。业务包名应表达订单、支付、库存、履约、结算、账户、合同、报价等领域概念。`common`、`util`、`manager`、`handler`、`processor` 等泛化包名应受到限制。

第三，每个上下文内部保留架构层次。典型层次包括 `domain`、`application`、`adapter`、`bootstrap`。其中 `domain` 是业务内核，`application` 是用例编排，`adapter` 是协议与技术转换，`bootstrap` 是装配入口。

第四，依赖方向只能由外向内。领域层不得依赖 Web、ORM、MQ、RPC、缓存、配置框架和数据库行结构。应用层不得依赖具体适配器实现。适配器可以依赖应用层和领域层。

第五，领域模型承担领域规则。实体表达身份和生命周期；值对象表达无身份的属性组合和相关行为；聚合表达一致性边界；领域服务表达不自然属于实体或值对象的领域过程；领域事件表达领域专家关心的已发生事实；Repository 提供聚合根访问接口。

第六，Application Service 承担用例编排。它负责事务边界、命令处理、查询处理、调用领域对象、调用端口和协调返回结果。它不应成为所有业务规则的唯一承载点。

第七，Repository 接口位于内层，Repository 实现位于外层。接口应表达领域语义，具体 SQL、ORM、索引、表结构和数据转换属于持久化适配器。

第八，输入适配器不写领域规则。HTTP Controller、RPC Endpoint、MQ Consumer 和 CLI Handler 负责鉴权上下文提取、参数校验、协议转换和调用应用服务。业务规则进入应用层和领域层。

第九，输出适配器不反向污染领域模型。数据库 Entity、RPC DTO、MQ Event Payload 和缓存结构属于外部技术模型，不应作为领域对象在内层传播。

第十，跨上下文访问必须通过显式接口。一个上下文不得直接引用另一个上下文的领域对象、数据库表、Mapper 或 Repository 实现。跨上下文交互使用应用 API、消息事件、防腐层或开放主机服务。

## 8 示例：订单上下文的领域驱动分包

订单上下文可以采用如下结构：

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

该结构中，`Order`、`OrderId`、`Money`、`OrderPlacedEvent` 等名称来自订单上下文的统一语言。`OrderRepository` 是领域层接口，`OrderJpaRepository` 是基础设施实现。`OrderController` 是输入适配器，`ProductClientAdapter` 和 `OrderEventPublisherAdapter` 是输出适配器。应用服务通过端口和仓储接口访问外部资源，不直接依赖数据库、RPC 或消息中间件。

## 9 讨论

DDD 分包不是把传统结构中的 `entity` 包改名为 `domain`，也不是把所有业务代码统一放入 `domain` 包。DDD 的核心在于模型边界、统一语言、聚合一致性、领域隔离和上下文边界。Service Layer 解决应用边界和用例协调问题；Hexagonal Architecture 解决应用内部与外部技术之间的端口适配问题；Clean Architecture 解决依赖方向和业务规则独立性问题。四者在项目分包上的共同结果是：包结构应当先表达业务模型，再表达技术适配；依赖应当指向业务内核；外部技术细节应当位于边界之外。

因此，新型项目分包并不是取消 `controller`、`service`、`repository` 等技术对象，而是改变它们的位置和依赖关系。Controller 属于输入适配器，Repository 实现属于输出适配器，Application Service 属于用例层，Domain Service 属于领域层。相同的类名后缀在不同层中具有不同职责，必须由包边界和依赖规则加以区分。

## 10 结论

传统按技术层分包以技术角色作为顶层边界，适合表达请求处理链路，但不适合表达复杂业务模型边界。在复杂业务系统中，该模式容易导致业务概念被技术层切散、领域规则扩散、Service 层膨胀、上下文边界不清、基础设施依赖内渗和测试依赖外部技术。

基于 DDD、Service Layer、Hexagonal Architecture 和 Clean Architecture 的新型分包，应以限界上下文或业务子域作为顶层边界，在上下文内部划分领域层、应用层、适配器层和启动装配层。该结构通过统一语言命名包，通过领域层集中表达业务规则，通过应用层编排用例，通过端口和适配器隔离外部技术，通过依赖方向保护业务内核。最终形成的规范是：业务边界优先于技术边界，模型名称优先于框架名称，依赖方向指向领域内核，技术实现位于系统边缘。

## 参考文献

[1] Eric Evans. Domain-Driven Design: Tackling Complexity in the Heart of Software. Addison-Wesley, 2003/2004.
[2] Eric Evans. Domain-Driven Design Reference. Domain Language, 2015.
[3] Martin Fowler. Patterns of Enterprise Application Architecture: Service Layer. 2002/2003.
[4] Alistair Cockburn. Hexagonal Architecture / Ports and Adapters. 2005.
[5] Robert C. Martin. The Clean Architecture. 2012.
[6] Robert C. Martin. Clean Architecture: A Craftsman’s Guide to Software Structure and Design. 2017.
[7] Martin Fowler. Patterns of Enterprise Application Architecture. Addison-Wesley, 2002.
