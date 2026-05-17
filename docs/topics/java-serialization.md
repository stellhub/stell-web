---
title: Java Serialization Performance Study across JDK, Jackson JSON, Jackson Smile, Protobuf, Kryo, and Hessian2
category: Performance Engineering
summary: A benchmark-backed comparison of JDK native serialization, Jackson JSON, Jackson Smile, Protobuf, Kryo, and Hessian2 across size, latency, ecosystem fit, cross-language support, schema evolution, and security boundaries.
tags:
  - Java
  - Serialization
  - Benchmark
  - Protobuf
  - Kryo
readingDirection: Read this when evaluating serialization choices for Java RPC, message queues, caches, object persistence, or middleware data exchange.
outline: deep
---

# Java Serialization Performance Study across JDK, Jackson JSON, Jackson Smile, Protobuf, Kryo, and Hessian2

## Overview

A benchmark-backed comparison of JDK native serialization, Jackson JSON, Jackson Smile, Protobuf, Kryo, and Hessian2 across size, latency, ecosystem fit, cross-language support, schema evolution, and security boundaries.

## 1. Research Background

Java services need serialization and deserialization in RPC calls, message queues, cache storage, distributed computing, object persistence, and other data-exchange scenarios. Different serialization approaches vary in byte size, serialization time, deserialization time, cross-language support, readability, schema evolution, security, and framework ecosystem fit.

This article uses the test results from the `java-serialization-compare` project to compare six common Java serialization approaches:

* JDK native serialization
* Jackson JSON
* Jackson Smile
* Protobuf
* Kryo
* Hessian2

The project describes its purpose as comparing multiple mainstream Java serialization methods under the same data semantics through controlled variables. It currently includes JDK native serialization, Jackson JSON, Jackson Smile, Protobuf, Kryo, and Hessian2. The test matrix covers `4 data formats x 3 data scales = 12 scenarios`, including structured flat objects, structured nested objects, unstructured text, unstructured binary data, and small, medium, and large data scales. The comparison metrics include serialized byte size, average serialization time, average deserialization time, serialization throughput, and deserialization throughput. ([GitHub][1])

---

## 2. Test Result Summary

The scenario summary in the test report shows that Kryo is the smallest-size option in all 12 scenarios. In the four small-data scenarios, Kryo also has the smallest size, fastest serialization, and fastest deserialization. In the medium-data structured flat object and structured nested object scenarios, Kryo again leads across all three metrics. In large-data scenarios, Jackson Smile, Protobuf, and JDK lead in some serialization or deserialization time metrics, while Kryo remains the smallest-size option. ([GitHub][2])

| Data scale | Scenario | Leading items in the test report |
| --- | --- | --- |
| Small | Structured flat object | Smallest size, fastest serialization, and fastest deserialization are all Kryo |
| Small | Structured nested object | Smallest size, fastest serialization, and fastest deserialization are all Kryo |
| Small | Unstructured text | Smallest size, fastest serialization, and fastest deserialization are all Kryo |
| Small | Unstructured binary | Smallest size, fastest serialization, and fastest deserialization are all Kryo |
| Medium | Structured flat object | Smallest size, fastest serialization, and fastest deserialization are all Kryo |
| Medium | Structured nested object | Smallest size, fastest serialization, and fastest deserialization are all Kryo |
| Medium | Unstructured text | Smallest size is Kryo, fastest serialization is Jackson JSON, fastest deserialization is Jackson Smile |
| Medium | Unstructured binary | Smallest size is Kryo, fastest serialization is Protobuf, fastest deserialization is Kryo |
| Large | Structured flat object | Smallest size is Kryo, fastest serialization and fastest deserialization are Jackson Smile |
| Large | Structured nested object | Smallest size is Kryo, fastest serialization is Jackson Smile, fastest deserialization is Kryo |
| Large | Unstructured text | Smallest size is Kryo, fastest serialization is JDK, fastest deserialization is Protobuf |
| Large | Unstructured binary | Smallest size is Kryo, fastest serialization is Protobuf, fastest deserialization is Kryo |

Based on the report data, Kryo is the most stable option on byte size in this test set. Serialization and deserialization time vary with data structure, data scale, and data content type. ([GitHub][2])

---

## 3. JDK Native Serialization

## 3.1 Official Definition and Use Cases

The Java official documentation explains that `ObjectOutputStream` implements object serialization. It maintains the state of objects already serialized and controls traversal and writing of objects and their referenced objects. The Java Object Serialization protocol needs to represent objects, classes, fields, arrays, strings, null values, back references, and other elements. ([Oracle Documentation][3])

Oracle's RMI protocol documentation states that RMI call and return data are formatted using the Java Object Serialization protocol, and that the RMI wire protocol uses Java Object Serialization and HTTP as part of its on-the-wire format. ([Oracle Documentation][4])

Oracle's documentation on deserialization vulnerabilities also states that serialization in the JDK is used by RMI, custom RMI IPC protocols, JMX, and other scenarios. ([Oracle Documentation][5])

Apache Dubbo's serialization security documentation shows that Dubbo 2.7 once officially supported JDK serialization. Dubbo 3.0 included JDK among the protocols supported by default. Dubbo 3.3 removed JDK serialization from the default support list for security reasons. ([Apache Dubbo][6])

## 3.2 Official Security Guidance

Oracle Secure Coding Guidelines state that deserializing untrusted data is inherently dangerous and should be avoided. The same document also explains that Java Serialization bypasses Java language field-access control mechanisms, so serialization and deserialization must be handled carefully. ([Oracle][7])

Oracle's deserialization vulnerability documentation states that applications receiving untrusted data and deserializing it are exposed to attack risk. Attackers can craft streams that make malicious classes execute code during deserialization, causing denial of service or remote code execution. The document recommends using serialization filters, limiting which classes can be deserialized, and controlling object-graph size and complexity. ([Oracle Documentation][5])

## 3.3 Features and Limits

| Dimension | Objective description |
| --- | --- |
| Java object graph support | The official protocol supports objects, classes, fields, arrays, strings, back references, and other elements. ([Oracle Documentation][8]) |
| Adoption cost | Java classes can enter the native Java serialization mechanism after implementing `Serializable` or `Externalizable`. ([Oracle Documentation][5]) |
| Size and performance | Spark documentation says Java serialization is flexible, but usually slow and often produces large serialized formats for many classes. ([Apache Spark][9]) |
| Security | Both Oracle and Dubbo documentation associate untrusted-data deserialization with security risks. ([Oracle][7]) |
| Cross-language support | RMI and Java Object Serialization mainly target the Java object model. Oracle RMI documentation describes call data as using the Java Object Serialization protocol. ([Oracle Documentation][4]) |

---

## 4. Jackson JSON

## 4.1 Official Definition and Use Cases

Spring Boot documentation lists JSON mapping libraries such as Jackson 3, Jackson 2, Gson, JSON-B, and Kotlin Serialization, and states that Jackson 3 is Spring Boot's current preferred and default library. It also states that when Jackson is on the classpath, Spring Boot automatically configures a `JsonMapper`. ([Home][10])

Spring Framework also provides Jackson-related support, such as Jackson Serialization Views in Spring MVC to control which fields are rendered in a response object. ([Home][11])

## 4.2 Official Recommendation and Ecosystem Positioning

Spring Boot's current documentation describes Jackson 3 as the preferred and default library. Jackson 2 support is marked as deprecated, and the documentation says it will be removed in a future Spring Boot 4.x release. ([Home][10])

## 4.3 Features and Limits

| Dimension | Objective description |
| --- | --- |
| Readability | JSON is a text format that can be displayed directly by browsers, logs, HTTP debugging tools, and API documentation tools. |
| Spring ecosystem | Spring Boot officially treats Jackson 3 as the preferred and default JSON library. ([Home][10]) |
| Extension ability | Spring Boot supports custom Jackson serializers, deserializers, and `@JacksonComponent`. ([Home][10]) |
| Performance and size | In the `java-serialization-compare` test report, Jackson JSON is the fastest serialization option for the medium-data unstructured text scenario. In small-object and structured-object scenarios, binary options such as Kryo or Smile more often lead on size and time. ([GitHub][2]) |
| Data contract | JSON itself does not enforce a schema. Business systems usually need OpenAPI, JSON Schema, or code-level constraints to supplement contract governance. |

---

## 5. Jackson Smile

## 5.1 Official Definition and Use Cases

The FasterXML Smile specification explains that Smile is a binary data format used to define a binary equivalent of standard JSON. The format was defined by the Jackson JSON processor development team in 2010. ([GitHub][12])

Spring Framework provides `MappingJackson2SmileHttpMessageConverter` for reading and writing Smile data format, meaning binary JSON, and by default it supports the `application/x-jackson-smile` media type. In Spring Framework 7.0, this class is deprecated and points to the new `JacksonSmileHttpMessageConverter`. ([Home][13])

FasterXML Smile documentation says Java support is provided through the Jackson `jackson-dataformat-smile` module, with streaming access, data binding, and tree model support. ([GitHub][12])

## 5.2 Features and Limits

| Dimension | Objective description |
| --- | --- |
| Data model | Smile is a binary equivalent of JSON, so its logical data model aligns with JSON. ([GitHub][12]) |
| Jackson ecosystem | Smile can be used through the Jackson dataformat module and supports Jackson streaming, data binding, and tree model APIs. ([GitHub][12]) |
| Spring support | Spring Framework provides a Smile HTTP message converter, with `application/x-jackson-smile` as the default media type. ([Home][13]) |
| Readability | Smile is a binary format and does not have the direct readability of text JSON. |
| Test performance | In the test report, Jackson Smile has the fastest serialization and deserialization in the large-data structured flat object scenario, and the fastest serialization in the large-data structured nested object scenario. ([GitHub][2]) |

---

## 6. Protobuf

## 6.1 Official Definition and Use Cases

Protocol Buffers documentation states that Protobuf is a language-neutral, platform-neutral, extensible mechanism for serializing structured data. It is similar to JSON, but smaller and faster, and it generates native language bindings. Developers define data structures in `.proto` files and use the proto compiler to generate multi-language code for reading and writing structured data. ([protobuf.dev][14])

gRPC documentation states that gRPC can use Protocol Buffers as the Interface Definition Language and as the underlying message interchange format. gRPC uses Protocol Buffers by default as its structured-data serialization mechanism. ([gRPC][15])

Confluent Schema Registry documentation provides Protobuf serializers and deserializers for Kafka producers and consumers. The documentation says Protobuf has schema evolution, compact format, and language-agnostic characteristics, and it describes how to use `KafkaProtobufSerializer` with a Kafka Producer. ([docs.confluent.io][16])

Apache Dubbo Triple protocol documentation states that the Triple protocol supports service definition through Protobuf IDL and targets multi-language, gRPC, security, and related scenarios. ([Apache Dubbo][17])

Spring Framework provides `ProtobufHttpMessageConverter` for reading and writing `com.google.protobuf.Message` through Google Protocol Buffers. It supports `application/x-protobuf`, `application/*+x-protobuf`, and `text/plain` by default. ([Home][18])

## 6.2 Official Recommendation and Ecosystem Positioning

The advantages listed in Protobuf documentation include compact data storage, fast parsing, multi-language availability, and optimized features through automatically generated classes. The documentation also says Protobuf is usually used to define communication protocols, especially with gRPC, and is also used for data storage. ([protobuf.dev][14])

The Protobuf documentation also lists scenarios where it may not fit. Protobuf assumes the whole message can be loaded into memory at once. For data larger than a few MB, another solution may be more appropriate. A Protobuf message does not embed complete self-describing information, so interpreting the data fully usually requires the corresponding `.proto` file. Protobuf is also not a formal standard published by a standards organization. ([protobuf.dev][14])

## 6.3 Features and Limits

| Dimension | Objective description |
| --- | --- |
| Cross-language support | The documentation says Protobuf supports many languages, including C++, C#, Java, Kotlin, Objective-C, PHP, Python, Ruby, Go, and Dart. ([protobuf.dev][14]) |
| Schema | Protobuf defines structures through `.proto` files and generates code through the compiler. ([protobuf.dev][14]) |
| RPC ecosystem | gRPC uses Protocol Buffers by default for IDL and payload message structure description. ([gRPC][15]) |
| Kafka ecosystem | Confluent provides a Kafka Protobuf serializer and supports Schema Registry. ([docs.confluent.io][16]) |
| Dubbo ecosystem | Dubbo Triple supports service definition through Protobuf IDL. ([Apache Dubbo][17]) |
| Readability | Protobuf uses binary encoding, and complete interpretation depends on the `.proto` file. ([protobuf.dev][14]) |
| Test performance | In the test report, Protobuf is the fastest serialization option in the medium-data unstructured binary scenario, the fastest deserialization option in the large-data unstructured text scenario, and the fastest serialization option in the large-data unstructured binary scenario. ([GitHub][2]) |

---

## 7. Kryo

## 7.1 Official Definition and Use Cases

Kryo documentation defines Kryo as a fast and efficient binary object graph serialization framework for Java. Its goals are high speed, low size, and an easy-to-use API. Kryo can be used to persist objects to files, databases, or network transport. ([GitHub][19])

Apache Spark tuning documentation states that Spark uses Java `ObjectOutputStream` by default to serialize objects, and can also use Kryo. Spark documentation says Kryo is significantly faster and more compact than Java serialization, often as much as 10x, and recommends trying Kryo in network-intensive applications. Spark also states that since Spark 2.0.0, it internally uses the Kryo serializer when shuffling RDDs with simple types, arrays of simple types, or strings. ([Apache Spark][9])

Apache Storm documentation states that Storm uses Kryo for serialization. Kryo is described as a flexible and fast serialization library that produces small serialized output. Storm supports primitive types, strings, byte arrays, ArrayList, HashMap, and HashSet by default. Other types require custom serializer registration. ([Apache Storm][20])

Apache Flink documentation explains that Flink has its own type description, generic type extraction, and type serialization framework. Flink's `KryoSerializer` is a type serializer using the Kryo serialization framework, and it is used as a fallback serializer for cases not covered by basic types, tuples, or POJOs. ([Apache Nightlies][21])

Apache Dubbo Kryo documentation says Kryo is a mature serialization implementation that has been used by Twitter, Groupon, Yahoo, Hive, Storm, and other open-source projects. Dubbo supports enabling Kryo serialization through configuration. ([Apache Dubbo][22])

## 7.2 Official Recommendations and Framework Guidance

Spark documentation states that classes used by the application need to be registered in advance to obtain the best Kryo performance. If custom classes are not registered, Kryo can still work, but it needs to store the full class name in every object, which is wasteful. ([Apache Spark][9])

Dubbo Kryo documentation states that, for Kryo and FST to fully realize high performance, classes to be serialized should be registered in the Dubbo system. After registration, serialization performance can improve significantly, especially in scenarios with a small number of nested objects. ([Apache Dubbo][22])

Kryo documentation says Kryo itself does not enforce a schema. Serializers are pluggable, and each serializer decides what to read and write. Kryo provides many default serializers and also allows partial or complete replacement with custom serializers. ([GitHub][19])

## 7.3 Why Kryo Is Fast

### 7.3.1 Binary Object Graph Serialization

Kryo's official definition directly states that its goals are high speed and low size, and positions it as a Java binary object graph serialization framework. ([GitHub][19])

### 7.3.2 Class Registration and Class IDs

Kryo documentation explains that when Kryo writes an object, it needs to write information identifying the object's class. Registration provides a class with an int class ID, serializer, and object instantiator. During deserialization, registered classes must have exactly the same IDs as they had during serialization. Kryo writes class IDs as positive optimized varints, and small positive integers are most efficient. ([GitHub][19])

Spark documentation also states that, without custom-class registration, Kryo needs to store the full class name with every object. Registering classes avoids that overhead. ([Apache Spark][9])

### 7.3.3 FieldSerializer Writes Only Field Data

Kryo documentation states that `FieldSerializer` works by serializing each non-transient field. It writes only field data and does not write schema information. Instead, it uses Java class files as the schema. This has compatibility limits: adding, removing, or changing field types makes previously serialized bytes invalid. ([GitHub][19])

### 7.3.4 Reference Tracking Is Configurable

Kryo documentation states that references are disabled by default. If references are enabled, the first occurrence of an object writes a varint, and repeated occurrences write only a varint. However, enabling references affects performance because every object read or written must be tracked. ([GitHub][19])

### 7.3.5 Serializers Are Pluggable

Kryo documentation says Kryo is a serializer framework, serializers are pluggable, and the framework itself does not enforce a schema. Default serializers can read and write most objects, and users can partially or completely replace them with custom serializers. ([GitHub][19])

### 7.3.6 Buffer and Thread-Safety Constraints

Kryo documentation states that `Output` and `Input` are responsible for byte buffering. Unsafe buffers can perform the same or better for primitive arrays and similar scenarios, but they have cross-platform compatibility limits. Kryo documentation also says Kryo is not thread-safe, and each thread should have its own Kryo, Input, and Output instances. In multi-threaded environments, ThreadLocal or pooling can be considered. ([GitHub][19])

## 7.4 Features and Limits

| Dimension | Objective description |
| --- | --- |
| Performance positioning | Kryo's official goals are high speed and low size. ([GitHub][19]) |
| Java object graph | Kryo is a Java binary object graph serialization framework. ([GitHub][19]) |
| Framework usage | Spark, Storm, Flink, and Dubbo documentation all describe Kryo-related usage. ([Apache Spark][9]) |
| Class registration | Kryo registration uses int class IDs. Spark and Dubbo documentation both state that class registration can help performance. ([GitHub][19]) |
| Schema compatibility | `FieldSerializer` does not write schema information and uses Java class files as the schema. Adding, removing, or changing field types affects compatibility with historical bytes. ([GitHub][19]) |
| Thread safety | Kryo is not thread-safe. Each thread should use its own Kryo, Input, and Output instances. ([GitHub][19]) |
| Test performance | In the 12-scenario summary of the test report, Kryo is the smallest-size option in every scenario. In all four small-data scenarios and two medium-data structured-object scenarios, Kryo also has the smallest size, fastest serialization, and fastest deserialization. ([GitHub][2]) |

---

## 8. Hessian2

## 8.1 Official Definition and Use Cases

Dubbo Hessian documentation states that Hessian2 is a self-describing serialization type. It does not rely on external description files or interface definitions and uses one byte to represent common primitive types. It is language-independent, supports scripting languages, has a simple protocol, and is more efficient than Java native serialization. ([Apache Dubbo][23])

Dubbo Hessian documentation also states that, in the Dubbo framework, Hessian2 is used as the default serialization method when using the Dubbo communication protocol. ([Apache Dubbo][23])

Dubbo 3.2 upgrade documentation shows that since Dubbo 3.2.0 the default serialization method changed from `hessian2` to `fastjson2`. Dubbo 3.3 upgrade documentation shows that since Dubbo 3.3.0 the default serialization method changed back from `fastjson2` to `hessian2`, with reasons including long-term production stability, compatibility, and hessian-lite being upgraded to hessian4 to support JDK17 and JDK21. ([Apache Dubbo][24])

## 8.2 Official Security Guidance

Dubbo serialization security documentation states that before switching or implementing a serialization protocol, users should fully study the target protocol and its implementation security guarantees, and configure allowlists, blocklists, and other security measures in advance. Dubbo cannot directly guarantee the safety of the target serialization mechanism. The document also states that since Dubbo 3.2, Hessian2 and Fastjson2 use a default allowlist mechanism. ([Apache Dubbo][6])

## 8.3 Features and Limits

| Dimension | Objective description |
| --- | --- |
| Dubbo usage | Dubbo documentation states that Hessian2 is the default serialization method when using the Dubbo communication protocol. ([Apache Dubbo][23]) |
| Protocol characteristics | Hessian2 is self-describing, does not rely on external IDL, is language-independent, and supports scripting languages. ([Apache Dubbo][23]) |
| Compared with Java native serialization | Dubbo documentation says Hessian2 has a shorter binary stream and lower serialization and deserialization time than Java serialization. ([Apache Dubbo][23]) |
| Version evolution | Dubbo 3.2 switched the default serialization to Fastjson2, and Dubbo 3.3 switched it back to Hessian2. ([Apache Dubbo][24]) |
| Security governance | Dubbo documentation requires users to consider security guarantees before switching serialization protocols and to configure allowlists and blocklists. ([Apache Dubbo][6]) |
| Test performance | In this test report, Hessian2 is not the smallest-size, fastest-serialization, or fastest-deserialization option in any summary scenario. ([GitHub][2]) |

---

## 9. Horizontal Comparison

| Option | Data format | Readability | Schema / contract | Cross-language support | Official or framework usage | Test-report performance |
| --- | --- | --- | --- | --- | --- | --- |
| JDK native serialization | Java object binary | No text readability | Based on Java classes and the Object Serialization protocol | Mainly Java-oriented | RMI uses Java Object Serialization; Dubbo historically supported JDK serialization. ([Oracle Documentation][4]) | Not the smallest-size option in the report summary; fastest serialization in the large-data unstructured text scenario. ([GitHub][2]) |
| Jackson JSON | Text JSON | Text-readable | Does not enforce schema | Common across languages | Spring Boot currently treats Jackson 3 as the preferred and default JSON library. ([Home][10]) | Fastest serialization in the medium-data unstructured text scenario. ([GitHub][2]) |
| Jackson Smile | Binary JSON | No text readability | Logical model is equivalent to JSON | Multi-language implementations exist, but depend on language-specific codecs | FasterXML defines Smile; Spring Framework provides a Smile HTTP message converter. ([GitHub][12]) | Leads in some serialization and deserialization metrics for large structured-object scenarios. ([GitHub][2]) |
| Protobuf | Binary structured data | No text readability | `.proto` files define schema | Official multi-language support | gRPC, Confluent Kafka Schema Registry, Dubbo Triple, and Spring Protobuf converters support it. ([gRPC][15]) | Leads in serialization or deserialization for some medium/large binary or text scenarios. ([GitHub][2]) |
| Kryo | Java binary object graph | No text readability | Can omit external schema and rely on Java classes and serializers | Mainly Java-oriented | Spark, Storm, Flink, and Dubbo documentation all describe Kryo usage. ([Apache Spark][9]) | Smallest size in all 12 scenarios; leads across all three metrics in all small-data scenarios and medium-data structured-object scenarios. ([GitHub][2]) |
| Hessian2 | Binary self-describing protocol | No text readability | Does not rely on external IDL | Dubbo documentation describes it as language-independent | Hessian2 is the default serialization method for the Dubbo communication protocol; Dubbo 3.3 switched the default back from Fastjson2 to Hessian2. ([Apache Dubbo][23]) | No leading item in the summary scenarios of this test report. ([GitHub][2]) |

---

## 10. Selection Dimensions in Business Applications

## 10.1 Whether Text Readability Is Required

Jackson JSON is a text format and is the current preferred and default JSON library in Spring Boot. For interfaces that need HTTP debugging, browser display, log observation, API documentation, or manual troubleshooting, text JSON provides direct readability. ([Home][10])

Jackson Smile, Protobuf, Kryo, and Hessian2 are all binary serialization forms and do not have the direct text readability of JSON. Smile is a binary equivalent of JSON. Protobuf uses `.proto` files to interpret structure. Kryo depends on Java classes and serializers. Hessian2 is a self-describing binary protocol. ([GitHub][12])

## 10.2 Whether Cross-Language Support Is Required

Protobuf documentation states that it is language-neutral and platform-neutral, and supports multiple languages. gRPC uses Protobuf by default as its IDL and message interchange format. Dubbo Triple supports Protobuf IDL for multi-language, gRPC, security, and related scenarios. ([protobuf.dev][14])

Kryo's official positioning is a Java binary object graph serialization framework. Kryo usage in Spark, Storm, Flink, and Dubbo is concentrated in JVM or Java object-processing scenarios. ([GitHub][19])

## 10.3 Whether Schema Evolution Is Required

Protobuf documentation states that, as long as `.proto` update practices are followed, old code can read new messages and ignore newly added fields. Protobuf is used for service communication protocols and long-term data storage. ([protobuf.dev][14])

Kryo `FieldSerializer` documentation states that it writes only field data, writes no schema information, and uses Java class files as the schema. It does not support adding, removing, or changing field types without affecting previously serialized bytes. Kryo also provides `VersionFieldSerializer` and `TaggedFieldSerializer` for different levels of compatibility, but those introduce additional mechanisms and constraints. ([GitHub][19])

## 10.4 Whether Very Small Size and Low Serialization Overhead Are Required

In the scenario summary of the `java-serialization-compare` test report, Kryo is the smallest-size option in all 12 scenarios. In all small-data scenarios and medium-data structured-object scenarios, Kryo is also the fastest serialization and fastest deserialization option. ([GitHub][2])

Spark documentation states that Kryo is significantly faster and more compact than Java serialization, often as much as 10x. It also notes that Kryo does not support all `Serializable` types and needs class registration in advance for best performance. ([Apache Spark][9])

## 10.5 Whether the Input Is Untrusted

Oracle security documentation states that deserializing untrusted data is inherently dangerous and should be avoided. If it cannot be avoided, serialization filters should be used. Dubbo security documentation also says users should study the target protocol and implementation security guarantees before switching or implementing serialization protocols, and should configure allowlists, blocklists, and other controls in advance. ([Oracle][7])

---

## 11. Why Kryo Performs Well in This Test

## 11.1 Test-Result Reasons

In the 12 scenarios covered by the test report summary, Kryo has the smallest size in all 12 scenarios. In the four small-data scenarios and two medium-data structured-object scenarios, Kryo also has the smallest size, fastest serialization, and fastest deserialization. In the medium-data unstructured binary, large-data structured nested object, and large-data unstructured binary scenarios, Kryo also has the fastest deserialization. ([GitHub][2])

## 11.2 Framework-Documentation Reasons

Spark documentation states that Kryo is significantly faster and more compact than Java serialization, often as much as 10x. Its limitations are that it does not support all `Serializable` types and that best performance depends on class registration in advance. ([Apache Spark][9])

Storm documentation states that Storm uses Kryo for serialization, and that Kryo is a flexible and fast serialization library that produces small serialized output. ([Apache Storm][20])

Dubbo Kryo documentation states that registering serialized classes can help Kryo and FST fully realize high performance, especially in scenarios with a small number of nested objects. ([Apache Dubbo][22])

## 11.3 Kryo Mechanism Reasons

Kryo documentation describes the following mechanisms:

| Kryo mechanism | Documentation description | Performance implication |
| --- | --- | --- |
| Java binary object graph serialization | Kryo is a Java binary object graph serialization framework with goals of high speed and low size. ([GitHub][19]) | Performs binary encoding for Java object graphs. |
| Class registration | After class registration, Kryo provides an int class ID, serializer, and object instantiator. Class IDs use optimized varints. ([GitHub][19]) | Reduces repeated class-information writes. |
| FieldSerializer | Writes only field data and no schema information, using Java class files as the schema. ([GitHub][19]) | Reduces schema-metadata writes. |
| Reference configuration | References are disabled by default. Enabling references tracks objects and affects performance. ([GitHub][19]) | Simple-object scenarios avoid extra reference-tracking cost. |
| Pluggable serializers | Kryo serializers can be replaced, and users can define custom serializers. ([GitHub][19]) | Hot types can use specialized serializers. |
| Buffer and pooling | Kryo documentation describes Input/Output byte buffering, and Kryo is not thread-safe; multi-threaded environments can use ThreadLocal or pooling. ([GitHub][19]) | Reduces repeated object creation and buffer-management overhead. |

---

## 12. Conclusion

Based on the `java-serialization-compare` project test report, Kryo has the most stable size metric in this test set: it is the smallest-size option in all 12 scenarios. In all small-data scenarios and medium-data structured-object scenarios, Kryo also has the smallest size, fastest serialization, and fastest deserialization. In large-data scenarios, Jackson Smile, Protobuf, and JDK lead on some time metrics, so the test results show that serialization performance depends on data structure, data scale, and data content type. ([GitHub][2])

Kryo's performance characteristics can be explained through official and framework documentation. Kryo targets high speed and low size. It reduces byte size and processing overhead through binary object graph serialization, class ID registration, FieldSerializer writing only field data, configurable reference tracking, pluggable serializers, and Input/Output buffering. Spark, Storm, Flink, and Dubbo documentation all include Kryo usage or support. Spark explicitly states that Kryo is usually faster and more compact than Java serialization and recommends trying Kryo in network-intensive applications. ([GitHub][19])

Serialization choices in business scenarios are usually determined by objective constraints: whether text readability is required, whether cross-language support is required, whether schema evolution is required, whether minimal size is required, whether input is untrusted, and whether a specific framework default protocol is involved. Spring Boot currently uses Jackson 3 as the preferred and default JSON library. gRPC uses Protobuf by default. Confluent Schema Registry provides Kafka Protobuf serializers. Dubbo documentation currently shows Hessian2 as the default serialization method for the Dubbo protocol and Protobuf IDL support for the Triple protocol. Spark, Storm, Flink, and Dubbo all have Kryo-related usage or support documentation. ([Home][10])

---

## 13. Project Address

To reproduce the Java serialization performance tests in this article or to extend the comparison with other serialization protocols, refer to the project source code, run the benchmark, and generate the Markdown test report.

Project address:
[https://github.com/stellhub/java-serialization-compare](https://github.com/stellhub/java-serialization-compare)

The project currently covers JDK native serialization, Jackson JSON, Jackson Smile, Protobuf, Kryo, and Hessian2, and provides both `mvn test` and complete benchmark entry points. ([GitHub][1])

[1]: https://github.com/stellhub/java-serialization-compare "GitHub - stellhub/java-serialization-compare"
[2]: https://github.com/stellhub/java-serialization-compare/blob/main/serialization-benchmark-report.md "java-serialization-compare serialization benchmark report"
[3]: https://docs.oracle.com/javase/8/docs/platform/serialization/spec/output.html "Java Object Serialization Specification: Object Output Classes"
[4]: https://docs.oracle.com/en/java/javase/17/docs/specs/rmi/protocol.html "Java Remote Method Invocation: RMI Wire Protocol"
[5]: https://docs.oracle.com/en/java/javase/21/core/addressing-serialization-vulnerabilities.html "Addressing Deserialization Vulnerabilities"
[6]: https://dubbo.apache.org/en/overview/notices/serialization/ "Serialization Security | Apache Dubbo"
[7]: https://www.oracle.com/java/technologies/javase/seccodeguide.html "Secure Coding Guidelines for Java SE"
[8]: https://docs.oracle.com/en/java/javase/11/docs/specs/serialization/protocol.html "Java Object Serialization Specification: Object Serialization Stream Protocol"
[9]: https://spark.apache.org/docs/latest/tuning.html "Tuning - Spark Documentation"
[10]: https://docs.spring.io/spring-boot/reference/features/json.html "JSON :: Spring Boot"
[11]: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/jackson.html "Spring Framework Jackson support"
[12]: https://github.com/fasterxml/smile-format-specification "FasterXML Smile format specification"
[13]: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/converter/smile/MappingJackson2SmileHttpMessageConverter.html "MappingJackson2SmileHttpMessageConverter"
[14]: https://protobuf.dev/overview/ "Overview | Protocol Buffers Documentation"
[15]: https://grpc.io/docs/what-is-grpc/introduction/ "Introduction to gRPC"
[16]: https://docs.confluent.io/platform/current/schema-registry/fundamentals/serdes-develop/serdes-protobuf.html "Protobuf Schema Serializer and Deserializer for Schema Registry on Confluent Platform"
[17]: https://dubbo.apache.org/en/overview/mannual/java-sdk/tasks/protocols/triple/idl/ "Developing Triple Communication Services Using Protobuf (IDL) | Apache Dubbo"
[18]: https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/converter/protobuf/ProtobufHttpMessageConverter.html "ProtobufHttpMessageConverter"
[19]: https://github.com/esotericsoftware/kryo "EsotericSoftware/kryo"
[20]: https://storm.apache.org/releases/2.6.0/Serialization.html "Storm Serialization"
[21]: https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/fault-tolerance/serialization/types_serialization/ "Apache Flink Types and Serialization"
[22]: https://dubbo.apache.org/en/overview/mannual/java-sdk/reference-manual/serialization/dubbo/kryo/ "Kryo | Apache Dubbo"
[23]: https://dubbo.apache.org/en/overview/mannual/java-sdk/reference-manual/serialization/dubbo/hessian/ "Hessian | Apache Dubbo"
[24]: https://dubbo.apache.org/en/overview/mannual/java-sdk/reference-manual/upgrades-and-compatibility/version/3.1-to-3.2-compatibility-guide/ "Upgrade from Dubbo 3.1 to 3.2"

## Chinese Reference

- [Read the original Chinese article](/zh/topics/java-serialization)
