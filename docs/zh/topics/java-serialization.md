---
title: Java 序列化性能调研：JDK、Jackson JSON、Jackson Smile、Protobuf、Kryo、Hessian2
category: 性能工程
summary: 基于 java-serialization-compare 项目的测试结果，对 JDK 原生序列化、Jackson JSON、Jackson Smile、Protobuf、Kryo 和 Hessian2 的体积、性能、生态、跨语言能力、schema 演进和安全边界进行横向对比。
tags:
  - Java
  - 序列化
  - 性能测试
  - Protobuf
  - Kryo
readingDirection: 适合在评估 Java 服务 RPC、消息队列、缓存、对象持久化或中间件数据交换的序列化方案时阅读。
outline: deep
---

# Java 序列化性能调研：JDK、Jackson JSON、Jackson Smile、Protobuf、Kryo、Hessian2

## 1. 调研背景

Java 服务在 RPC 调用、消息队列、缓存存储、分布式计算、对象持久化等场景中都需要序列化与反序列化。不同序列化方案在字节体积、序列化耗时、反序列化耗时、跨语言能力、可读性、schema 演进能力、安全性和框架生态上存在差异。

本文基于 `java-serialization-compare` 项目的测试结果，对以下六种 Java 常见序列化方案进行对比：

* JDK 原生序列化
* Jackson JSON
* Jackson Smile
* Protobuf
* Kryo
* Hessian2

该项目说明其用途是“基于控制变量法比较 Java 中多种主流序列化方式在相同数据语义下的性能和体积差异”，当前已接入 JDK 原生序列化、Jackson JSON、Jackson Smile、Protobuf、Kryo、Hessian2 六种方式。测试矩阵覆盖 `4 种数据格式 × 3 种数据规模 = 12 个场景`，包括结构化平铺对象、结构化嵌套对象、非结构化文本、非结构化二进制，以及小、中、大三类数据规模。对比指标包括序列化字节大小、序列化平均耗时、反序列化平均耗时、序列化吞吐量和反序列化吞吐量。([GitHub][1])

---

## 2. 测试结果摘要

测试报告的场景摘要显示：在 12 个场景中，Kryo 均为“最小体积”方案；在小数据的 4 类场景中，Kryo 同时获得最小体积、最快序列化、最快反序列化；在中数据的结构化平铺对象和结构化嵌套对象中，Kryo 同时获得最小体积、最快序列化、最快反序列化；在大数据场景中，Jackson Smile、Protobuf、JDK 在部分序列化或反序列化耗时指标上领先，Kryo 仍在体积指标上保持最小。([GitHub][2])

| 数据规模 | 场景      | 测试报告中的领先项                                            |
| ---- | ------- | ---------------------------------------------------- |
| 小数据  | 结构化平铺对象 | 最小体积、最快序列化、最快反序列化均为 Kryo                             |
| 小数据  | 结构化嵌套对象 | 最小体积、最快序列化、最快反序列化均为 Kryo                             |
| 小数据  | 非结构化文本  | 最小体积、最快序列化、最快反序列化均为 Kryo                             |
| 小数据  | 非结构化二进制 | 最小体积、最快序列化、最快反序列化均为 Kryo                             |
| 中数据  | 结构化平铺对象 | 最小体积、最快序列化、最快反序列化均为 Kryo                             |
| 中数据  | 结构化嵌套对象 | 最小体积、最快序列化、最快反序列化均为 Kryo                             |
| 中数据  | 非结构化文本  | 最小体积为 Kryo，最快序列化为 Jackson JSON，最快反序列化为 Jackson Smile |
| 中数据  | 非结构化二进制 | 最小体积为 Kryo，最快序列化为 Protobuf，最快反序列化为 Kryo              |
| 大数据  | 结构化平铺对象 | 最小体积为 Kryo，最快序列化和最快反序列化为 Jackson Smile               |
| 大数据  | 结构化嵌套对象 | 最小体积为 Kryo，最快序列化为 Jackson Smile，最快反序列化为 Kryo         |
| 大数据  | 非结构化文本  | 最小体积为 Kryo，最快序列化为 JDK，最快反序列化为 Protobuf               |
| 大数据  | 非结构化二进制 | 最小体积为 Kryo，最快序列化为 Protobuf，最快反序列化为 Kryo              |

从报告数据看，Kryo 在该测试集内的体积指标表现最稳定；序列化和反序列化耗时则会随数据结构、数据规模和数据内容类型变化。([GitHub][2])

---

## 3. JDK 原生序列化

## 3.1 官方定义与使用场景

Java 官方文档说明，`ObjectOutputStream` 实现对象序列化，它维护已经序列化对象的状态，并控制对象及其引用对象的遍历和写入。Java 对象序列化协议需要表示对象、类、字段、数组、字符串、null、back reference 等元素。([Oracle 文档][3])

Oracle RMI 协议文档说明，RMI 的调用和返回数据使用 Java Object Serialization 协议进行格式化；RMI wire protocol 使用 Java Object Serialization 和 HTTP 作为 on-the-wire 格式的一部分。([Oracle 文档][4])

Oracle 关于反序列化漏洞的文档还说明，JDK 中序列化被用于 RMI、自定义 RMI IPC 协议、JMX 等场景。([Oracle 文档][5])

Apache Dubbo 的序列化安全文档显示，Dubbo 2.7 曾官方支持 JDK 序列化；Dubbo 3.0 默认支持协议中包括 JDK；Dubbo 3.3 出于安全原因将 JDK 序列化从默认支持列表中移除。([Apache Dubbo][6])

## 3.2 官方安全建议

Oracle Secure Coding Guidelines 明确说明：“反序列化不可信数据本质上是危险的，应当避免。”同一文档还说明，Java Serialization 会绕过 Java 语言的字段访问控制机制，因此在执行序列化和反序列化时需要谨慎处理。([Oracle][7])

Oracle 反序列化漏洞文档说明，接收不可信数据并执行反序列化的应用会暴露于攻击风险；攻击者可以构造数据流，使恶意类在反序列化过程中执行代码，导致拒绝服务或远程代码执行。该文档建议使用 serialization filters，限制可被反序列化的类，并控制对象图大小和复杂度。([Oracle 文档][5])

## 3.3 特性与限制

| 维度         | 客观描述                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Java 对象图支持 | 官方协议支持对象、类、字段、数组、字符串、back reference 等元素。([Oracle 文档][8])                                                            |
| 使用门槛       | Java 类实现 `Serializable` 或 `Externalizable` 后即可进入 Java 原生序列化机制。([Oracle 文档][5])                                      |
| 体积与性能      | Spark 官方文档称 Java serialization 灵活，但通常较慢，并且对很多类会产生较大的序列化格式。([Apache Spark][9])                                       |
| 安全性        | Oracle 和 Dubbo 官方文档均将不可信数据反序列化与安全风险关联。([Oracle][7])                                                                 |
| 跨语言能力      | RMI 和 Java Object Serialization 主要面向 Java 对象模型；Oracle RMI 文档描述其调用数据使用 Java Object Serialization 协议。([Oracle 文档][4]) |

---

## 4. Jackson JSON

## 4.1 官方定义与使用场景

Spring Boot 官方文档列出 Jackson 3、Jackson 2、Gson、JSON-B、Kotlin Serialization 等 JSON 映射库，并说明 Jackson 3 是 Spring Boot 当前 preferred and default library。该文档还说明，当 Jackson 位于 classpath 上时，Spring Boot 会自动配置 `JsonMapper`。([Home][10])

Spring Framework 也内置了 Jackson 相关支持，例如 Spring MVC 支持 Jackson Serialization Views，用于控制响应对象中需要渲染的字段集合。([Home][11])

## 4.2 官方推荐与生态定位

Spring Boot 当前官方文档将 Jackson 3 描述为 preferred and default library；Jackson 2 支持已被标记为 deprecated，并说明将在未来 Spring Boot 4.x 中移除。([Home][10])

## 4.3 特性与限制

| 维度        | 客观描述                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 可读性       | JSON 是文本格式，可直接被浏览器、日志、HTTP 调试工具和 API 文档工具展示。                                                                                          |
| Spring 生态 | Spring Boot 官方将 Jackson 3 作为 preferred and default JSON library。([Home][10])                                                          |
| 扩展能力      | Spring Boot 支持通过 Jackson 自定义 serializer、deserializer 和 `@JacksonComponent`。([Home][10])                                               |
| 性能与体积     | 在 `java-serialization-compare` 测试报告中，Jackson JSON 在中数据非结构化文本场景为最快序列化方案；在小对象和结构化对象场景中，报告中 Kryo 或 Smile 等二进制方案在体积和耗时上更多领先。([GitHub][2]) |
| 数据契约      | JSON 本身不强制 schema；业务系统通常需要借助 OpenAPI、JSON Schema 或代码约束补充契约治理。                                                                         |

---

## 5. Jackson Smile

## 5.1 官方定义与使用场景

FasterXML Smile 规范说明，Smile 是一种二进制数据格式，用于定义标准 JSON 数据格式的二进制等价物；该格式由 Jackson JSON processor development team 于 2010 年制定。([GitHub][12])

Spring Framework 提供 `MappingJackson2SmileHttpMessageConverter`，用于读写 Smile data format，即 binary JSON，并默认支持 `application/x-jackson-smile` media type。该类在 Spring Framework 7.0 中已被标记为 deprecated，并指向新的 `JacksonSmileHttpMessageConverter`。([Home][13])

FasterXML Smile 文档说明，Java 支持通过 Jackson `jackson-dataformat-smile` 模块提供，支持 streaming access、data binding 和 tree model。([GitHub][12])

## 5.2 特性与限制

| 维度         | 客观描述                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| 数据模型       | Smile 是 JSON 的二进制等价格式，逻辑数据模型与 JSON 对齐。([GitHub][12])                                                        |
| Jackson 生态 | Smile 可通过 Jackson dataformat 模块使用，并支持 Jackson 的 streaming、data binding、tree model。([GitHub][12])            |
| Spring 支持  | Spring Framework 提供 Smile HTTP message converter，默认 media type 为 `application/x-jackson-smile`。([Home][13]) |
| 可读性        | Smile 是二进制格式，不具备文本 JSON 的直接可读性。                                                                             |
| 测试表现       | 在该测试报告中，Jackson Smile 在大数据结构化平铺对象场景中获得最快序列化和最快反序列化；在大数据结构化嵌套对象场景中获得最快序列化。([GitHub][2])                      |

---

## 6. Protobuf

## 6.1 官方定义与使用场景

Protocol Buffers 官方文档说明，Protobuf 是一种 language-neutral、platform-neutral、extensible 的结构化数据序列化机制；它类似 JSON，但更小、更快，并生成 native language bindings。开发者通过 `.proto` 文件定义数据结构，再通过 proto compiler 生成多语言代码，用于读写结构化数据。([protobuf.dev][14])

gRPC 官方文档说明，gRPC 可以使用 Protocol Buffers 作为 Interface Definition Language，也可以将其作为底层 message interchange format。gRPC 默认使用 Protocol Buffers 作为结构化数据序列化机制。([gRPC][15])

Confluent Schema Registry 官方文档提供 Protobuf serializer/deserializer，用于 Kafka 生产者和消费者。该文档说明，Protobuf 具有 schema evolution、compact format、language agnostic 等特性，并描述了 `KafkaProtobufSerializer` 接入 Kafka Producer 的方式。([docs.confluent.io][16])

Apache Dubbo Triple 协议官方文档说明，Triple protocol 支持使用 Protobuf IDL 定义服务，面向 multi-language、gRPC、安全等场景。([Apache Dubbo][17])

Spring Framework 提供 `ProtobufHttpMessageConverter`，用于通过 Google Protocol Buffers 读写 `com.google.protobuf.Message`，默认支持 `application/x-protobuf`、`application/*+x-protobuf` 和 `text/plain`。([Home][18])

## 6.2 官方推荐与生态定位

Protobuf 官方文档列出的优势包括 compact data storage、fast parsing、多语言可用性，以及通过 automatically-generated classes 获得优化功能。官方文档同时说明，Protobuf 通常用于定义通信协议，尤其与 gRPC 一起使用，也用于数据存储。([protobuf.dev][14])

Protobuf 官方文档也列出不适合场景：Protobuf 假设整个 message 可以一次性加载到内存；对于超过几 MB 的数据，可能应考虑其他方案；Protobuf message 本身并不内嵌完整自描述信息，完整解释数据通常需要对应的 `.proto` 文件；Protobuf 不是某个标准组织发布的正式标准。([protobuf.dev][14])

## 6.3 特性与限制

| 维度       | 客观描述                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------- |
| 跨语言      | 官方文档说明 Protobuf 支持多种语言，包括 C++、C#、Java、Kotlin、Objective-C、PHP、Python、Ruby、Go、Dart 等。([protobuf.dev][14]) |
| schema   | Protobuf 通过 `.proto` 文件定义结构，通过 compiler 生成代码。([protobuf.dev][14])                                       |
| RPC 生态   | gRPC 默认使用 Protocol Buffers 作为 IDL 和 payload message 结构描述方式。([gRPC][15])                                 |
| Kafka 生态 | Confluent 提供 Kafka Protobuf serializer，并支持 Schema Registry。([docs.confluent.io][16])                    |
| Dubbo 生态 | Dubbo Triple 支持使用 Protobuf IDL 定义服务。([Apache Dubbo][17])                                                |
| 可读性      | Protobuf 是二进制编码；其完整解释依赖 `.proto` 文件。([protobuf.dev][14])                                                |
| 测试表现     | 在该测试报告中，Protobuf 在中数据非结构化二进制场景中为最快序列化方案；在大数据非结构化文本场景中为最快反序列化方案；在大数据非结构化二进制场景中为最快序列化方案。([GitHub][2])     |

---

## 7. Kryo

## 7.1 官方定义与使用场景

Kryo 官方文档将 Kryo 定义为 Java 的 fast and efficient binary object graph serialization framework，项目目标是 high speed、low size 和 easy to use API。Kryo 可用于对象持久化到文件、数据库或网络传输。([GitHub][19])

Apache Spark 官方调优文档说明，Spark 默认使用 Java `ObjectOutputStream` 框架序列化对象，同时也可以使用 Kryo；Spark 文档称 Kryo 比 Java serialization 显著更快且更紧凑，通常可达到 10 倍，并建议在 network-intensive application 中尝试 Kryo。Spark 还说明，从 Spark 2.0.0 开始，内部在 shuffle 简单类型、简单类型数组或字符串类型 RDD 时使用 Kryo serializer。([Apache Spark][9])

Apache Storm 官方文档说明，Storm 使用 Kryo 进行序列化；Kryo 是 flexible and fast serialization library，并能产生较小的序列化结果。Storm 默认支持 primitive types、strings、byte arrays、ArrayList、HashMap、HashSet；其他类型需要注册 custom serializer。([Apache Storm][20])

Apache Flink 文档说明，Flink 有自己的类型描述、泛型类型提取和类型序列化框架；Flink 的 `KryoSerializer` 是使用 Kryo serialization framework 的 type serializer，并被用于 basic types、tuples、POJOs 未覆盖场景的 fallback serializer。([Apache Nightlies][21])

Apache Dubbo Kryo 文档说明，Kryo 是成熟的序列化实现，曾被 Twitter、Groupon、Yahoo 以及 Hive、Storm 等开源项目使用；Dubbo 支持通过配置启用 Kryo 序列化。([Apache Dubbo][22])

## 7.2 官方推荐与框架建议

Spark 官方文档说明，为获得 Kryo 最佳性能，需要提前注册程序中使用的类；如果不注册自定义类，Kryo 仍然可以工作，但需要在每个对象中保存完整类名，属于 wasteful。([Apache Spark][9])

Dubbo Kryo 文档说明，为了让 Kryo 和 FST 充分发挥高性能，应将需要序列化的类注册到 Dubbo 系统中；注册这些类后，序列化性能可能显著提升，尤其是少量嵌套对象场景。([Apache Dubbo][22])

Kryo 官方文档说明，Kryo 本身不强制 schema，serializer 是可插拔的，由 serializer 决定读写内容；Kryo 提供许多默认 serializer，也允许部分或完全替换为自定义 serializer。([GitHub][19])

## 7.3 Kryo 快在哪些地方

### 7.3.1 二进制对象图序列化

Kryo 官方定义中直接说明其目标是 high speed 和 low size，并将其定位为 Java binary object graph serialization framework。([GitHub][19])

### 7.3.2 类注册与 class ID

Kryo 官方文档说明，当 Kryo 写入对象时，需要写入用于识别对象 class 的信息；注册机制会为 class 提供 int class ID、serializer 和 object instantiator。反序列化时，注册类必须拥有与序列化时完全相同的 ID。Kryo 的 class ID 使用 positive optimized varints 写入，小的正整数最有效率。([GitHub][19])

Spark 官方文档也说明，如果不注册自定义类，Kryo 需要为每个对象存储完整类名；注册类可以避免该开销。([Apache Spark][9])

### 7.3.3 FieldSerializer 只写字段数据

Kryo 官方文档说明，`FieldSerializer` 通过序列化每个非 transient 字段工作；它只写字段数据，不写 schema 信息，而是使用 Java class files 作为 schema。这种方式有兼容性限制：添加、删除或修改字段类型会使之前序列化的字节失效。([GitHub][19])

### 7.3.4 引用追踪可配置

Kryo 官方文档说明，默认不启用 references；如果启用 references，首次出现对象时会写入 varint，后续重复出现时只写 varint；但启用 references 会影响性能，因为每个读写对象都需要被追踪。([GitHub][19])

### 7.3.5 serializer 可插拔

Kryo 官方文档说明，Kryo 是 serializer framework，serializer 可插拔，框架本身不强制 schema；默认 serializer 可以读取和写入大多数对象，也可以被自定义 serializer 部分或完全替换。([GitHub][19])

### 7.3.6 buffer 与线程安全约束

Kryo 官方文档说明，`Output` 和 `Input` 负责缓冲字节；`Unsafe buffers` 对 primitive arrays 等场景可以表现相同或更好，但存在 cross-platform compatibility 限制。Kryo 文档还说明，Kryo 不是线程安全的，每个线程应拥有自己的 Kryo、Input、Output 实例；在多线程环境中可考虑 ThreadLocal 或 pooling。([GitHub][19])

## 7.4 特性与限制

| 维度        | 客观描述                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------- |
| 性能定位      | Kryo 官方目标是 high speed 和 low size。([GitHub][19])                                                   |
| Java 对象图  | Kryo 是 Java binary object graph serialization framework。([GitHub][19])                            |
| 框架使用      | Spark、Storm、Flink、Dubbo 官方文档均有 Kryo 相关描述。([Apache Spark][9])                                      |
| 类注册       | Kryo 注册机制使用 int class ID；Spark 和 Dubbo 文档均说明注册类有助于性能。([GitHub][19])                               |
| schema 兼容 | `FieldSerializer` 不写 schema 信息，使用 Java class files 作为 schema；字段添加、删除、类型变更会影响历史字节兼容。([GitHub][19]) |
| 线程安全      | Kryo 不是线程安全的，每个线程应使用自己的 Kryo、Input、Output 实例。([GitHub][19])                                       |
| 测试表现      | 在该测试报告的 12 个场景摘要中，Kryo 均为最小体积方案；在小数据 4 个场景和中数据 2 个结构化对象场景中，同时获得最小体积、最快序列化、最快反序列化。([GitHub][2])    |

---

## 8. Hessian2

## 8.1 官方定义与使用场景

Dubbo Hessian 文档说明，Hessian2 是自描述序列化类型，不依赖外部描述文件或接口定义，使用一个字节表示常见基础类型；它语言无关，支持脚本语言；协议简单，并且比 Java 原生序列化更高效。([Apache Dubbo][23])

Dubbo Hessian 文档还说明，在 Dubbo 框架中，当使用 Dubbo communication protocol 时，Hessian2 被用作默认序列化方式。([Apache Dubbo][23])

Dubbo 3.2 升级文档显示，Dubbo 3.2.0 起默认序列化方式从 `hessian2` 切换到 `fastjson2`；Dubbo 3.3 升级文档显示，从 Dubbo 3.3.0 起默认序列化方式又从 `fastjson2` 切换回 `hessian2`，原因包括长期生产稳定性、兼容性和 hessian-lite 升级到 hessian4 后支持 JDK17/JDK21。([Apache Dubbo][24])

## 8.2 官方安全建议

Dubbo 序列化安全文档说明，在切换或实现序列化协议前，用户应充分研究目标协议及其实现的安全保障，并提前配置黑白名单等安全措施；Dubbo 不能直接保证目标序列化机制的安全。该文档还说明，从 Dubbo 3.2 起，Hessian2 和 Fastjson2 使用默认白名单机制。([Apache Dubbo][6])

## 8.3 特性与限制

| 维度             | 客观描述                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| Dubbo 使用       | Dubbo 文档说明，使用 Dubbo communication protocol 时，Hessian2 是默认序列化方式。([Apache Dubbo][23])   |
| 协议特性           | Hessian2 自描述、不依赖外部 IDL，语言无关，支持脚本语言。([Apache Dubbo][23])                               |
| 与 Java 原生序列化对比 | Dubbo 文档说明 Hessian2 相比 Java serialization 有更短的二进制流、更低的序列化和反序列化时间。([Apache Dubbo][23]) |
| 版本演进           | Dubbo 3.2 曾将默认序列化切到 Fastjson2；Dubbo 3.3 又切回 Hessian2。([Apache Dubbo][24])             |
| 安全治理           | Dubbo 官方文档要求在切换序列化协议前关注安全保障，并配置黑白名单等措施。([Apache Dubbo][6])                            |
| 测试表现           | 在该测试报告中，Hessian2 在所有摘要场景中没有成为最小体积、最快序列化或最快反序列化方案。([GitHub][2])                        |

---

## 9. 横向对比

| 方案            | 数据格式        | 可读性      | schema / 契约                        | 跨语言                   | 官方或框架使用情况                                                                                               | 测试报告表现                                                  |
| ------------- | ----------- | -------- | ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| JDK 原生序列化     | Java 对象二进制  | 不具备文本可读性 | 基于 Java 类和 Object Serialization 协议 | 主要面向 Java             | RMI 使用 Java Object Serialization；Dubbo 历史支持 JDK 序列化。([Oracle 文档][4])                                    | 在报告摘要中没有成为最小体积方案；大数据非结构化文本场景中序列化耗时最快。([GitHub][2])      |
| Jackson JSON  | 文本 JSON     | 具备文本可读性  | 不强制 schema                         | 多语言通用                 | Spring Boot 当前将 Jackson 3 作为 preferred and default JSON library。([Home][10])                            | 中数据非结构化文本场景中序列化耗时最快。([GitHub][2])                       |
| Jackson Smile | Binary JSON | 不具备文本可读性 | 逻辑模型等价于 JSON                       | 有多语言实现，但主要依赖各语言 codec | FasterXML 定义 Smile；Spring Framework 提供 Smile HTTP message converter。([GitHub][12])                      | 大数据结构化对象场景中有序列化和反序列化领先项。([GitHub][2])                   |
| Protobuf      | 二进制结构化数据    | 不具备文本可读性 | `.proto` 文件定义 schema               | 官方支持多语言               | gRPC、Confluent Kafka Schema Registry、Dubbo Triple、Spring Protobuf converter 均支持。([gRPC][15])            | 中/大数据二进制或文本场景中有序列化或反序列化领先项。([GitHub][2])                |
| Kryo          | Java 二进制对象图 | 不具备文本可读性 | 可不写外部 schema，依赖 Java 类和 serializer | 主要面向 Java             | Spark、Storm、Flink、Dubbo 官方文档均描述 Kryo 使用。([Apache Spark][9])                                             | 12 个场景均为最小体积方案；小数据所有场景和中数据结构化对象场景中三项指标均领先。([GitHub][2]) |
| Hessian2      | 二进制自描述协议    | 不具备文本可读性 | 不依赖外部 IDL                          | Dubbo 文档称其语言无关        | Dubbo communication protocol 默认序列化方式为 Hessian2；Dubbo 3.3 默认从 Fastjson2 切回 Hessian2。([Apache Dubbo][23]) | 在该测试报告摘要中没有成为领先项。([GitHub][2])                          |

---

## 10. 业务应用中的取舍维度

## 10.1 是否需要文本可读性

Jackson JSON 是文本格式，并且在 Spring Boot 中属于当前 preferred and default JSON library。对需要 HTTP 调试、浏览器展示、日志观察、API 文档、人工排查的接口，文本 JSON 具备直接可读性。([Home][10])

Jackson Smile、Protobuf、Kryo、Hessian2 均为二进制序列化形式，不具备 JSON 的直接文本可读性。Smile 是 JSON 的二进制等价格式；Protobuf 通过 `.proto` 解释结构；Kryo 依赖 Java class 和 serializer；Hessian2 是自描述二进制协议。([GitHub][12])

## 10.2 是否需要跨语言

Protobuf 官方文档说明其为 language-neutral、platform-neutral，并支持多种语言；gRPC 默认使用 Protobuf 作为 IDL 和 message interchange format；Dubbo Triple 支持 Protobuf IDL，用于 multi-language、gRPC、安全等场景。([protobuf.dev][14])

Kryo 官方定位是 Java binary object graph serialization framework；Spark、Storm、Flink、Dubbo 中的 Kryo 使用均集中在 JVM 或 Java 对象处理场景。([GitHub][19])

## 10.3 是否需要 schema 演进

Protobuf 官方文档说明，只要遵循 `.proto` 更新实践，旧代码可以读取新消息并忽略新增字段；Protobuf 被用于服务通信协议和长期数据存储。([protobuf.dev][14])

Kryo `FieldSerializer` 官方文档说明，它只写字段数据，不写 schema 信息，使用 Java class files 作为 schema；它不支持添加、删除或修改字段类型而不影响之前序列化字节。Kryo 也提供 `VersionFieldSerializer` 和 `TaggedFieldSerializer` 来处理不同级别的兼容性，但会引入额外机制和约束。([GitHub][19])

## 10.4 是否需要极小体积和较低序列化开销

在 `java-serialization-compare` 测试报告的场景摘要中，Kryo 在 12 个场景中均为最小体积方案；在小数据全部场景以及中数据结构化对象场景中，Kryo 同时是最快序列化和最快反序列化方案。([GitHub][2])

Spark 官方文档说明，Kryo 比 Java serialization 显著更快且更紧凑，通常可达到 10 倍；同时指出 Kryo 不支持所有 `Serializable` 类型，并且为了最佳性能需要提前注册类。([Apache Spark][9])

## 10.5 是否面对不可信输入

Oracle 官方安全文档说明，反序列化不可信数据本质上是危险行为，应避免；如果无法避免，应使用 serialization filters。Dubbo 官方安全文档也说明，切换或实现序列化协议前应研究目标协议和实现的安全保障，并提前设置黑白名单等安全措施。([Oracle][7])

---

## 11. 为什么 Kryo 在该测试中表现突出

## 11.1 测试结果层面的原因

在该测试报告覆盖的 12 个场景摘要中，Kryo 在全部 12 个场景中获得“最小体积”；在小数据 4 个场景和中数据 2 个结构化对象场景中，Kryo 同时获得最小体积、最快序列化、最快反序列化；在中数据非结构化二进制、大数据结构化嵌套对象、大数据非结构化二进制场景中，Kryo 也获得最快反序列化。([GitHub][2])

## 11.2 框架文档层面的原因

Spark 官方文档说明，Kryo 相比 Java serialization 显著更快且更紧凑，通常可达 10 倍；其不足是并不支持所有 `Serializable` 类型，并且最佳性能依赖提前注册类。([Apache Spark][9])

Storm 官方文档说明，Storm 使用 Kryo 进行序列化，Kryo 是 flexible and fast serialization library，并产生较小序列化结果。([Apache Storm][20])

Dubbo Kryo 文档说明，注册序列化类可以让 Kryo 和 FST 充分发挥高性能，尤其是少量嵌套对象场景。([Apache Dubbo][22])

## 11.3 Kryo 自身机制层面的原因

Kryo 的官方文档描述了以下机制：

| Kryo 机制                                | 官方文档描述                                                                                                  | 性能含义                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------- |
| Java binary object graph serialization | Kryo 是 Java 的 binary object graph serialization framework，目标是 high speed 和 low size。([GitHub][19])      | 面向 Java 对象图进行二进制编码。   |
| class registration                     | 注册 class 后提供 int class ID、serializer 和 object instantiator；class ID 使用 optimized varints。([GitHub][19]) | 减少重复 class 信息写入。      |
| FieldSerializer                        | 只写字段数据，不写 schema 信息，使用 Java class files 作为 schema。([GitHub][19])                                        | 减少 schema 元信息写入。      |
| reference 配置                           | 默认不启用 references；启用 references 会追踪对象并影响性能。([GitHub][19])                                                | 简单对象场景不必为引用追踪付出额外成本。  |
| serializer 可插拔                         | Kryo serializer 可替换，用户可自定义 serializer。([GitHub][19])                                                    | 热点类型可使用专用 serializer。 |
| buffer 与 pooling                       | Kryo 文档描述 Input/Output 负责字节缓冲，Kryo 非线程安全，多线程环境中可考虑 ThreadLocal 或 pooling。([GitHub][19])                 | 减少重复对象创建和缓冲区管理开销。     |

---

## 12. 结论

基于 `java-serialization-compare` 项目的测试报告，Kryo 在该测试集内的体积指标最稳定：12 个场景中均为最小体积方案；在小数据全部场景和中数据结构化对象场景中，Kryo 同时获得最小体积、最快序列化、最快反序列化。大数据场景中，Jackson Smile、Protobuf、JDK 在部分耗时指标上领先，因此测试结果显示序列化性能与数据结构、数据规模、数据内容类型有关。([GitHub][2])

Kryo 的性能特征可以从官方和框架文档中找到对应解释：Kryo 目标是 high speed 和 low size；它通过二进制对象图序列化、class ID 注册、FieldSerializer 只写字段数据、可配置引用追踪、serializer 可插拔、Input/Output 缓冲等机制减少字节量和处理开销。Spark、Storm、Flink、Dubbo 等框架文档均存在 Kryo 使用或支持说明，其中 Spark 明确说明 Kryo 通常比 Java serialization 更快、更紧凑，并建议在 network-intensive application 中尝试 Kryo。([GitHub][19])

不同业务场景中的序列化取舍通常由以下客观约束决定：是否需要文本可读性、是否需要跨语言、是否需要 schema 演进、是否需要极小体积、是否面对不可信输入、是否依赖特定框架默认协议。Spring Boot 当前将 Jackson 3 作为 preferred and default JSON library；gRPC 默认使用 Protobuf；Confluent Schema Registry 提供 Kafka Protobuf serializer；Dubbo 当前文档显示 Dubbo protocol 默认使用 Hessian2，Triple protocol 支持 Protobuf IDL；Spark、Storm、Flink、Dubbo 均有 Kryo 相关使用或支持说明。([Home][10])

---

## 13. 项目地址

如果需要复现本文中的 Java 序列化性能测试，或继续扩展其他序列化协议，可以直接查看项目源码、运行 benchmark，并生成 Markdown 测试报告。

项目地址：
[https://github.com/stellhub/java-serialization-compare](https://github.com/stellhub/java-serialization-compare)

该项目当前覆盖 JDK 原生序列化、Jackson JSON、Jackson Smile、Protobuf、Kryo、Hessian2 六种方式，并提供 `mvn test` 以及完整 benchmark 运行入口。([GitHub][1])

[1]: https://github.com/stellhub/java-serialization-compare "GitHub - stellhub/java-serialization-compare: Java serialization benchmark and comparison project for JSON, binary codecs, performance, compatibility, and middleware data exchange. · GitHub"
[2]: https://github.com/stellhub/java-serialization-compare/blob/main/serialization-benchmark-report.md "java-serialization-compare/serialization-benchmark-report.md at main · stellhub/java-serialization-compare · GitHub"
[3]: https://docs.oracle.com/javase/8/docs/platform/serialization/spec/output.html "Java Object Serialization Specification: 2 - Object Output Classes"
[4]: https://docs.oracle.com/en/java/javase/17/docs/specs/rmi/protocol.html "Java Remote Method Invocation: 10 - RMI Wire Protocol"
[5]: https://docs.oracle.com/en/java/javase/21/core/addressing-serialization-vulnerabilities.html "Addressing Deserialization Vulnerabilities"
[6]: https://dubbo.apache.org/en/overview/notices/serialization/ "Serialization Security | Apache Dubbo"
[7]: https://www.oracle.com/java/technologies/javase/seccodeguide.html "Secure Coding Guidelines for Java SE"
[8]: https://docs.oracle.com/en/java/javase/11/docs/specs/serialization/protocol.html "Java Object Serialization Specification: 6 - Object Serialization Stream Protocol"
[9]: https://spark.apache.org/docs/latest/tuning.html "Tuning - Spark 4.1.1 Documentation"
[10]: https://docs.spring.io/spring-boot/reference/features/json.html "JSON :: Spring Boot"
[11]: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/jackson.html "https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/jackson.html"
[12]: https://github.com/fasterxml/smile-format-specification "GitHub - FasterXML/smile-format-specification: New home for Smile format (https://en.wikipedia.org/wiki/Smile_(data_interchange_format)) · GitHub"
[13]: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/converter/smile/MappingJackson2SmileHttpMessageConverter.html "MappingJackson2SmileHttpMessageConverter (Spring Framework 7.0.7 API)"
[14]: https://protobuf.dev/overview/ "Overview | Protocol Buffers Documentation"
[15]: https://grpc.io/docs/what-is-grpc/introduction/ "Introduction to gRPC | gRPC"
[16]: https://docs.confluent.io/platform/current/schema-registry/fundamentals/serdes-develop/serdes-protobuf.html "Protobuf Schema Serializer and Deserializer for Schema Registry on Confluent Platform | Confluent Documentation"
[17]: https://dubbo.apache.org/en/overview/mannual/java-sdk/tasks/protocols/triple/idl/ "Developing Triple Communication Services Using Protobuf (IDL) | Apache Dubbo"
[18]: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/converter/protobuf/ProtobufHttpMessageConverter.html "ProtobufHttpMessageConverter (Spring Framework 7.0.7 API)"
[19]: https://github.com/esotericsoftware/kryo "GitHub - EsotericSoftware/kryo: Java binary serialization and cloning: fast, efficient, automatic · GitHub"
[20]: https://storm.apache.org/releases/2.6.0/Serialization.html "Serialization"
[21]: https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/fault-tolerance/serialization/types_serialization/ "Overview | Apache Flink"
[22]: https://dubbo.apache.org/en/overview/mannual/java-sdk/reference-manual/serialization/dubbo/kryo/ "Kryo | Apache Dubbo"
[23]: https://dubbo.apache.org/en/overview/mannual/java-sdk/reference-manual/serialization/dubbo/hessian/ "Hessian | Apache Dubbo"
[24]: https://dubbo.apache.org/en/overview/mannual/java-sdk/reference-manual/upgrades-and-compatibility/version/3.1-to-3.2-compatibility-guide/ "Upgrade from 3.1 to 3.2 | Apache Dubbo"
