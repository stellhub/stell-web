# Standardized Design of Traffic Governance Rule Systems

## Abstract

Traffic governance is a foundational governance capability in distributed systems, microservice architectures, and service meshes. Its goal is to provide unified control over traffic entry points, service-to-service calls, routing decisions, load balancing, canary release, failure isolation, rate limiting, circuit breaking, timeouts, retries, and observability during service invocation. According to official documentation from Kubernetes Gateway API, Istio, Envoy, gRPC, and related projects, modern traffic governance has evolved from centralized gateways toward a "centralized configuration, distributed execution" model. North-south traffic mainly describes access traffic between the outside of a cluster and the inside of a cluster, while east-west traffic mainly describes lateral calls between services, workloads, or components inside a mesh. Traditional internal and external gateway architectures concentrate load balancing, traffic scheduling, authentication, rate limiting, circuit breaking, and similar capabilities on gateway nodes. Service mesh and client-side load balancing models move routing rules, load balancing, and instance selection down to client-side proxies or client runtimes. This article provides a structured explanation of traffic governance rule systems around east-west traffic, north-south traffic, centralized gateway architectures, client-side routing, routing rule capabilities, and Istio standard implementations.

**Keywords**: traffic governance; east-west traffic; north-south traffic; internal gateway; external gateway; client-side routing; service discovery; Istio; Envoy; VirtualService; DestinationRule

## 1. Introduction

A microservice system consists of multiple independent services. The number of service instances, deployment locations, version states, and health states continuously change. Service call paths are no longer a single entry point to a single backend. They are composed of ingress traffic, service-to-service calls, cross-availability-zone calls, canary version calls, external dependency access, and failover paths. In such systems, traffic governance rules describe where traffic should enter, where it should pass through, which service version it should be forwarded to, whether cross-zone access is allowed, whether retries should be performed, whether circuit breaking or rate limiting logic should be entered, and whether mirroring, rewriting, or fault injection is needed.

Kubernetes Gateway API positions itself as the official Kubernetes project for L4 and L7 routing, covering both Ingress and Mesh scenarios. Its official documentation explicitly treats North-South and East-West as two routing directions of Gateway API. Istio documentation also divides a service mesh into a control plane and a data plane: the control plane configures proxies, while Envoy proxies in the data plane mediate and control network communication between microservices. Therefore, the core of modern traffic governance is not a single gateway forwarding traffic, but describing traffic behavior through unified rules and delivering those rules to the data plane that actually handles traffic.

## 2. East-West Traffic and North-South Traffic

North-south traffic usually refers to traffic between the inside and outside of a cluster, data center, or service mesh boundary. In Kubernetes Gateway API, Gateway resources can define access points for external traffic entering the cluster. This scenario is described as north/south traffic. Typical north-south traffic includes users accessing web services, mobile clients accessing APIs, third-party systems accessing open APIs, public traffic entering an Ingress Gateway, and service mesh workloads accessing external SaaS or third-party HTTP services.

East-west traffic usually refers to lateral access traffic between internal services. In the service mesh context, east-west traffic mainly appears as calls between microservices, Pods, workloads, services in different namespaces, different service versions, and services inside multi-cluster environments. Gateway API associates Mesh with East-West, and Istio architecture documentation states that data plane proxies control all network communication between microservices. Therefore, east-west traffic governance focuses on service-to-service call paths, instance selection, version selection, availability-zone priority, failover, retries, circuit breaking, and internal security policies.

From a governance boundary perspective, north-south traffic emphasizes entry exposure, external access, TLS termination, domain and path matching, ingress authentication, unified rate limiting, and boundary auditing. East-west traffic emphasizes service discovery, client-side routing, service version canary release, nearby access, cross-zone disaster recovery, internal authorization, connection pools, retries, circuit breaking, and trace observability. Both belong to traffic governance, but their enforcement locations and rule granularities differ.

## 3. Centralized Traffic Governance in the Internal and External Gateway Era

In internal and external gateway architectures, external gateways usually handle north-south traffic, while internal gateways usually handle service-to-service calls. External gateways handle public entry points, domain routing, TLS termination, unified authentication, rate limiting, auditing, and protocol conversion. Internal gateways handle service-to-service access entry points, internal API aggregation, internal authorization, internal rate limiting, service routing, and traffic scheduling. Kubernetes Gateway API documentation also notes that an API Gateway is often used to centralize capabilities such as authentication, authorization, or rate limiting into a unified management location.

When an architecture requires that "internal calls must pass through the internal gateway," the path for Service A calling Service B is no longer A directly accessing B's instances. Instead, A first accesses the internal gateway, and the internal gateway forwards the request to B according to service discovery, routing rules, and load balancing strategy. The objective result of this model is that the internal gateway sits on both the service call path and the governance execution path. Load balancing, traffic scheduling, authentication, rate limiting, circuit breaking, degradation, retries, canary release, logs, metrics, and distributed tracing all execute at the gateway layer.

The engineering characteristics of the centralized gateway model are unified governance logic, unified rule entry points, and centralized audit locations. However, the gateway also becomes a traffic aggregation point. As the number of services, call volume, and east-west traffic scale grow, the gateway needs to process connections, forwarding, protocol parsing, policy matching, and metrics collection for all internal calls. Istio performance documentation states that proxies on the data path consume CPU and memory, and proxy features and telemetry also affect latency and resource usage. Therefore, centralized gateways create obvious data-plane pressure concentration in high-traffic scenarios.

## 4. From Centralized Gateways to Client-Side Routing

An important change in modern traffic governance is moving routing decisions from centralized gateways to the client side. Here, "client side" can mean an in-process client-side load balancer in the application, or a sidecar proxy deployed on the same host or in the same Pod as the application. gRPC official documentation describes the client-side load balancing model: the name resolver provides a list of server IP addresses to the client load balancing policy, and the load balancing policy maintains connections to servers and selects a connection when an RPC is sent. Spring Cloud LoadBalancer documentation also defines it as a client-side load balancing abstraction and implementation.

In a service mesh, routing rules are still configured centrally by the platform, but the execution location is usually the sidecar proxy on the client request path. Istio architecture documentation explains that Istiod converts high-level routing rules into Envoy configuration and propagates them to sidecars at runtime. Envoy sidecars serve as data plane proxies that handle inbound and outbound traffic. This means routing rules are configured centrally in the control plane but take effect in a distributed manner in the data plane. For a single service call, the caller-side proxy can select the target instance according to VirtualService, DestinationRule, service discovery endpoints, load balancing strategy, circuit breaker state, and health state.

Therefore, "routing rules are configured on the server side but directly apply to the client" can be expressed as follows: rules are centrally stored and published by the control plane or configuration center, but they are finally executed by the client runtime, client-side load balancer, or client-side sidecar on the request-initiating side. This model distributes data-plane pressure that was originally concentrated in the internal gateway to the caller side, while retaining centralized configuration and unified governance.

## 5. Relationship Between Service Discovery Weights and Client-Side Routing Rules

Traditional service discovery systems usually store service instance lists, instance health states, instance metadata, weights, availability zones, data centers, versions, and labels. Routing systems can use this metadata to select instances. In the client-side routing model, service discovery no longer only returns "which instances exist." It can also provide more attributes to clients or proxies for load balancing and routing decisions.

Envoy documentation states that Endpoint Discovery Service can provide upstream cluster members to Envoy, and additional attributes carried in endpoint responses can include load balancing weight, canary state, zone, and similar information. These attributes are used in load balancing, statistics, and other behaviors. Kubernetes Topology Aware Routing also uses topology hints in EndpointSlice to influence traffic routing, so traffic preferentially stays in the availability zone where it originated. This shows that weights, availability zones, canary markers, and routing attributes in service discovery can evolve from simple registry fields into client-side routing inputs.

In this model, the service discovery system provides instance facts, the routing rule system provides scheduling intent, and the client-side load balancer or sidecar proxy performs final instance selection. Weights and routing in service discovery do not disappear. They shift from "the registry directly decides" to "the registry provides metadata, and routing rules consume metadata to execute scheduling."

## 6. Basic Model of Routing Rules

The basic model of routing rules can be abstracted into four parts: matching conditions, target sets, traffic ratios, and additional actions.

Matching conditions determine which requests hit a rule. Common conditions include service name, domain name, HTTP Method, URL Path, Header, Query, Cookie, gRPC method, source service, source namespace, source availability zone, user identifier, tenant identifier, request protocol, and destination port.

Target sets describe which backends requests should be forwarded to. Targets can be services, service versions, instance groups, availability zones, data centers, namespaces, instance label sets, external services, backup services, or degraded services.

Traffic ratios describe distribution relationships among multiple targets. Typical scenarios include sending 90% of traffic to a stable version and 10% to a canary version; preferring the same availability zone and using cross-zone failover; distributing traffic to different instance spaces by weight; and pinning requests from specific users or tenants to a specific version.

Additional actions describe processing before or after forwarding. Common actions include path rewrite, header addition/deletion/modification, request mirroring, redirect, direct response, timeout, retry, fault injection, rate limiting, circuit breaking, connection pool control, cross-zone failover, and audit marking.

## 7. Governance Capabilities Implemented by Routing Rules

Routing rules are not only used for service version selection. They can implement multiple traffic governance capabilities.

First, version-based canary release. Rules can distribute part of traffic to a new version by percentage, such as gradually expanding from 1%, 5%, 10%, and 50% until the new version fully takes over.

Second, targeted canary release based on users, tenants, or request headers. Rules can route requests from internal users, test users, specific tenants, specific headers, or specific cookies to a canary version.

Third, interface-level routing based on URL or method. HTTP scenarios can match Path, Method, Header, and Query. gRPC scenarios can match specific service methods at the HTTP/2/gRPC routing layer.

Fourth, nearby access based on availability zone or region. Rules can preferentially schedule traffic to instances in the same region, availability zone, or data center to reduce cross-zone latency and cross-zone cost.

Fifth, failover based on failure state. Rules can switch traffic to backup availability zones, backup versions, or backup services when the local availability zone is unavailable, instances are abnormal, consecutive errors occur, or health checks fail.

Sixth, capacity scheduling based on weights. Rules can distribute traffic by instance weight, group weight, version weight, or availability zone weight. This is useful for uneven capacity, heterogeneous machines, elastic scaling, and cost-control scenarios.

Seventh, request mirroring. Rules can copy real production requests to shadow services or new-version services for functional validation, load-test replay, and compatibility observation. Mirrored requests do not affect the original response.

Eighth, path rewrite and redirect. Rules can forward old paths to new paths, gradually migrate monolithic application paths to microservice paths, or redirect deprecated APIs to new services.

Ninth, timeout and retry control. Rules can configure timeout duration, retry count, retry conditions, and per-try timeout for APIs, services, or versions, avoiding failure requests occupying call-chain resources indefinitely.

Tenth, circuit breaking and abnormal instance ejection. Rules can limit connection pools, concurrent requests, and pending requests, and temporarily remove continuously failing instances from the load balancing pool based on outlier detection.

Eleventh, fault injection. Rules can intentionally inject latency or error responses to verify caller timeout, retry, degradation, and fault-tolerance logic.

Twelfth, egress traffic governance. Rules can constrain paths for services accessing external networks, forcing external access through dedicated egress gateways and applying monitoring, routing, and security policies at the egress point.

Thirteenth, multi-cluster and cross-cluster routing. Rules can schedule traffic to the local cluster, local region, remote cluster, or disaster recovery cluster for multi-active, disaster recovery, and migration scenarios.

Fourteenth, protocol-level routing. Rules can match and forward at different protocol layers for HTTP, HTTP/2, gRPC, TCP, TLS, and SNI.

Fifteenth, configuration visibility and scope control. Rules can be limited to specific namespaces, gateways, sidecar groups, or service groups, preventing global rules from affecting unrelated services.

## 8. Granularity Boundaries of Custom Routing

Custom routing can support URL-level, method-level, and some parameter-level routing, but different granularities fit different execution locations.

URL-level routing is suitable for gateways, sidecars, and client-side proxies. HTTP Path is protocol-visible information, so proxies can match it without understanding business request bodies. Istio VirtualService HTTPMatchRequest supports URI, Header, Method, Authority, and Query parameter matching. Therefore, URL and Method are routing conditions that can be expressed at the infrastructure layer.

Method-level routing usually appears as Method plus Path in HTTP scenarios, and as gRPC service method in gRPC scenarios. Istio VirtualService HTTPRoute can apply to HTTP, HTTP/2, and gRPC protocols, and it matches requests by ordered rules. Therefore, canary release, retries, timeouts, mirroring, and version scheduling for API or RPC methods can be part of standard routing rules.

Parameter-level routing needs to distinguish protocol parameters from business parameters. Headers, Query, Cookies, Path Variables, and similar parameters are visible to gateways and proxies, so they can be used as infrastructure-layer matching conditions. Business fields inside request bodies, database resource ownership, order state, user permissions, product status, and similar information require business services to parse and judge, so they are not suitable for complete execution by generic routing proxies. Otherwise, the routing system would need to understand business protocols, request body structures, and data semantics, causing strong coupling between platform rules and business models.

Therefore, traffic governance rules should support method-level granularity. Parameter-level granularity should be limited to protocol-visible parameters. Business-semantic parameters can be handled by application-layer routing, business gateway plugins, external policy services, or domain service logic.

## 9. Standard Istio Implementation of Routing Rules

Istio traffic governance is mainly composed of resources such as Gateway, VirtualService, DestinationRule, ServiceEntry, and Sidecar. Gateway describes the load balancer at the edge of the service mesh and is used to receive HTTP/TCP connections entering or leaving the mesh. VirtualService defines routing rules that apply when hosts are accessed. DestinationRule defines policies that apply to the target service after routing occurs, including load balancing, connection pools, and outlier detection.

Istio documentation describes VirtualService as a core resource that decouples the address requested by clients from the actual target workload. Clients send requests to a virtual host, and Envoy routes traffic to different service versions, services, or subsets according to VirtualService rules. VirtualService supports percentage-based traffic splitting, matching by Header or URI, ordered rule matching, default routes, rewrite, redirect, timeout, retry, fault injection, and request mirroring.

DestinationRule takes effect after the VirtualService routing decision. It defines subsets of a target service, such as dividing service instances into v1, v2, and v3 by version labels. It also defines load balancing policies, connection pool sizes, TLS settings, and outlierDetection. Istio DestinationRule documentation describes outlierDetection as part of the circuit breaking implementation, which tracks the state of individual hosts in upstream services and removes consecutively failing hosts from the load balancing pool.

Gateway is mainly used for boundary traffic. Istio documentation states that Gateway configures only L4-L6 load balancing properties such as port, protocol, and TLS, while L7 routing is still completed by binding VirtualService. Therefore, Istio gateway traffic and mesh-internal traffic can be expressed using the same VirtualService routing model.

Egress Gateway is used for egress traffic governance. Istio documentation states that Ingress Gateway defines entry points into the mesh, while Egress Gateway symmetrically defines exit points leaving the mesh and can apply monitoring and routing rules to traffic leaving the mesh. This shows that Istio brings north-south ingress, east-west internal calls, and egress traffic into one unified traffic governance system.

## 10. Configuration Methods for Traffic Governance Rules

Traffic governance rule configuration can be divided into three layers: declarative configuration, centralized configuration, and runtime dynamic delivery.

Declarative configuration expresses rules through Kubernetes CRDs, YAML, or platform configuration objects. Istio Gateway, VirtualService, and DestinationRule are declarative configuration. Gateway API HTTPRoute and GRPCRoute are also declarative routing resources.

Centralized configuration means rules are uniformly maintained by the platform, control plane, or configuration center. Users do not directly modify every client instance. Instead, they submit rule objects, and the control plane generates data-plane configuration according to service discovery state, deployment state, and rule state.

Runtime dynamic delivery means the control plane converts rules into executable proxy configuration and pushes it to the data plane. In Istio, Istiod converts high-level routing rules into Envoy configuration and propagates them to sidecars. Envoy xDS APIs support dynamic configuration capabilities such as LDS, RDS, CDS, and EDS. RDS can discover complete HTTP route configuration at runtime, EDS can discover upstream cluster members, and CDS can discover upstream clusters.

This configuration method forms a governance structure of "centralized rule management, distributed execution." It differs from the traditional internal gateway model where rules and execution are both centralized, and it also differs from fully SDK-based governance where rules and execution are scattered into application code.

## 11. Standardized Traffic Governance Model

A complete traffic governance rule system should contain the following standard objects.

First, traffic entry objects, used to describe external entries, internal entries, egress gateways, and service exposure boundaries.

Second, service target objects, used to describe service name, namespace, port, protocol, version, instance subset, availability zone, cluster, and external service.

Third, matching condition objects, used to describe domain, path, method, Header, Query, Cookie, source service, source identity, source availability zone, port, protocol, and SNI.

Fourth, routing action objects, used to describe forwarding, traffic splitting, rewrite, redirect, mirroring, direct response, fault injection, and external forwarding.

Fifth, load balancing objects, used to describe round robin, random, least request, consistent hashing, weight, region priority, availability zone priority, and failover.

Sixth, resilience governance objects, used to describe timeout, retry, circuit breaking, abnormal instance ejection, connection pool, concurrency limit, request queuing, and degradation.

Seventh, security governance objects, used to describe authentication, authorization, mTLS, access control, egress control, and policy auditing.

Eighth, observability objects, used to describe metrics, logs, distributed tracing, access logs, matched rules, routing results, and abnormal causes.

Ninth, scope objects, used to describe where rules take effect, such as namespace, service, gateway, sidecar, tenant, environment, or availability zone.

Tenth, release objects, used to describe rule versions, canary release, rollback, validation, conflict detection, priority, and change auditing.

This model can cover multiple implementation modes such as internal gateways, external gateways, client-side load balancing, service discovery, service mesh, and application-layer routing.

## 12. Conclusion

Traffic governance is systematic control over request paths, target selection, failure handling, and policy execution in distributed systems. North-south traffic mainly describes access between external and internal boundaries. East-west traffic mainly describes lateral calls between services. Internal and external gateway architectures use centralized gateways to uniformly carry load balancing, traffic scheduling, authentication, rate limiting, circuit breaking, and auditing, but under large-scale east-west calls, gateways become data-plane aggregation points.

Client-side routing and service meshes transform the governance model into centralized configuration and distributed execution. Routing rules can be centrally managed by the control plane, but they actually apply to client runtimes, client-side load balancers, or client-side sidecars. Instance weight, availability zone, version, canary marker, and health state in service discovery can become inputs to client-side routing rules, unifying service discovery and routing scheduling on the request side.

Istio's standard implementation shows that Gateway is responsible for boundary traffic ingress and egress, VirtualService is responsible for routing rules, DestinationRule is responsible for target service policies, Envoy is responsible for data-plane execution, and Istiod is responsible for configuration conversion and delivery. This model brings north-south traffic, east-west traffic, canary release, request routing, timeout, retry, mirroring, circuit breaking, abnormal instance ejection, and locality load balancing into one unified governance system. Traffic governance rules should support at least service-level, interface-level, and method-level granularity. Parameter-level rules should be limited to protocol-visible parameters, while business-semantic parameters should remain in the application layer or external policy systems.

[R1] Kubernetes Gateway API official documentation states that Gateway API is the official Kubernetes project for L4/L7 routing and supports Ingress and Mesh scenarios. The documentation also explicitly describes North-South and East-West traffic directions. ([Gateway API][1])
[R2] Kubernetes Gateway API official documentation states that API Gateways are commonly used to centralize capabilities such as authentication, authorization, or rate limiting into a unified management location. ([Gateway API][1])
[R3] Istio architecture documentation states that Istio consists of a control plane and a data plane. Envoy sidecars mediate and control service-to-service communication, and Istiod converts high-level routing rules into Envoy configuration and propagates them to sidecars. ([Istio][2])
[R4] Istio Traffic Management documentation states that VirtualService is used to decouple the address requested by clients from the actual target workload, and uses routing rules to instruct Envoy how to forward traffic. ([Istio][3])
[R5] Istio VirtualService reference documentation states that VirtualService defines traffic routing rules that apply when hosts are accessed. Rules contain matching conditions and forward to target services or subsets. ([Istio][4])
[R6] Istio DestinationRule reference documentation states that DestinationRule applies to target services after routing occurs and configures load balancing, connection pools, and outlier detection. ([Istio][5])
[R7] Istio Gateway reference documentation states that Gateway is a load balancer at the service mesh edge for receiving inbound or outbound HTTP/TCP connections. ([Istio][6])
[R8] Istio Ingress Gateway documentation states that Gateway configures ports and protocols, while L7 routing for ingress traffic is completed through ordinary routing rules. Internal service requests use similar routing rules. ([Istio][7])
[R9] Istio Egress Gateway documentation states that Egress Gateway defines exit points leaving the service mesh and can apply monitoring and routing rules to egress traffic. ([Istio][8])
[R10] Kubernetes Topology Aware Routing documentation states that this capability can keep traffic preferentially in the availability zone where it originated, improving reliability, performance, or cost. ([Kubernetes][9])
[R11] gRPC official documentation states that client-side load balancing policies receive address lists from name resolvers and are responsible for maintaining connections and selecting a connection for each RPC. ([gRPC][10])
[R12] Envoy xDS documentation states that APIs such as RDS, CDS, EDS, and LDS support dynamic configuration of routes, clusters, endpoints, and listeners. ([envoyproxy.io][11])
[R13] Envoy service discovery documentation states that EDS can provide endpoints to Envoy, and endpoint attributes can include weight, canary state, and zone, participating in load balancing and routing. ([envoyproxy.io][12])
[R14] Gateway API HTTP traffic splitting documentation states that HTTPRoute can use backendRefs weights to distribute traffic across multiple backends. ([Gateway API][13])
[R15] Envoy official documentation states that Envoy supports advanced load balancing, automatic retries, circuit breaking, global rate limiting, request mirroring, and outlier detection. ([envoyproxy.io][14])
[R16] Istio Circuit Breaking documentation states that Istio can configure circuit breaking rules related to connections, requests, and outlier detection. ([Istio][15])
[R17] Istio Locality Load Balancing documentation states that locality consists of region, zone, and sub-zone, and Istio can use this information to control load balancing behavior. ([Istio][16])
[R18] Spring Cloud LoadBalancer official documentation states that Spring Cloud provides a client-side load balancing abstraction and can obtain instances from service discovery. ([docs.spring.io][17])

[1]: https://gateway-api.sigs.k8s.io/docs/ "Introduction | Gateway API"
[2]: https://istio.io/latest/docs/ops/deployment/architecture/ "Istio / Architecture"
[3]: https://istio.io/latest/docs/concepts/traffic-management/ "Istio / Traffic Management"
[4]: https://istio.io/latest/docs/reference/config/networking/virtual-service/ "Istio / Virtual Service"
[5]: https://istio.io/latest/docs/reference/config/networking/destination-rule/ "Istio / Destination Rule"
[6]: https://istio.io/latest/docs/reference/config/networking/gateway/ "Istio / Gateway"
[7]: https://istio.io/latest/docs/tasks/traffic-management/ingress/ingress-control/ "Istio / Ingress Gateways"
[8]: https://istio.io/latest/docs/tasks/traffic-management/egress/egress-gateway/ "Istio / Egress Gateways"
[9]: https://kubernetes.io/docs/concepts/services-networking/topology-aware-routing/ "Topology Aware Routing | Kubernetes"
[10]: https://grpc.io/docs/guides/custom-load-balancing/ "Custom Load Balancing Policies | gRPC"
[11]: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/dynamic_configuration "xDS configuration API overview"
[12]: https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/service_discovery "Service discovery"
[13]: https://gateway-api.sigs.k8s.io/guides/user-guides/traffic-splitting/ "HTTP traffic splitting | Gateway API"
[14]: https://www.envoyproxy.io/docs/envoy/latest/intro/what_is_envoy "What is Envoy"
[15]: https://istio.io/latest/docs/tasks/traffic-management/circuit-breaking/ "Istio / Circuit Breaking"
[16]: https://istio.io/latest/docs/tasks/traffic-management/locality-load-balancing/ "Istio / Locality Load Balancing"
[17]: https://docs.spring.io/spring-cloud-commons/reference/spring-cloud-commons/loadbalancer.html "Spring Cloud LoadBalancer"
