# Architecture Canvas (/canvas) Control Flow & Exhaustive Inspector Plan

> **Note:** The tables below are a human-readable rendering of `src/pages/canvas/data/*.ts` — edit the data files, not these tables.

## 1. Git Worktree & Subagent Assignment
- **Assigned Role:** `Canvas Control Flow Architect`
- **Git Worktree Directory:** TBD (will be assigned at launch)
- **Status:** PLANNING

---

## 2. User Feedback & Documented Requirements
1. **Control Flow / Decision Gateways:**
   - Searching for `contro` returned no results in `/canvas`.
   - The user requested: *"give decisions control flow like one spring invoke in another spring based on some condition"*.
   - Enterprise architecture requires Decision Diamonds, Saga Orchestrators, Circuit Breakers, and Parallel Fork/Join nodes.
2. **Exhaustive Framework Inspector Options:**
   - The user requested: *"why do you always give less options anyhow we will lazy load give more options in each option also check their respective docs websites to get full blown list"*.
   - We must wire the full official `start.spring.io` starters and design pattern catalog into `EdgeInspector.tsx` and node properties.

---

## 3. Control Flow Nodes to Add to NodePalette

### A. Decision Diamond / Conditional Gateway (`ControlFlowGateway`)
Allows conditional invocation (e.g., *Spring Boot A invokes Spring Boot B ONLY IF `payload.amount > 10000`, ELSE invokes Spring Boot C*).
- **Evaluation Engine:**
  - `SpEL (Spring Expression Language)` | `JSONPath Predicate` | `JavaScript Expression` | `Header Regex Match`
- **Routing Rules Table:**
  - `Rule 1 (IF condition match)` → Target Node ID (e.g., `PaymentFraudAuditService`)
  - `Rule 2 (ELSE IF condition match)` → Target Node ID (e.g., `InstantPaymentService`)
  - `Fallback (ELSE)` → Default Target Node ID or Dead Letter Queue

### B. Saga Orchestrator / Choreography Gateway (`SagaOrchestrator`)
Manages distributed transactions across multiple independent services.
- **Saga Pattern Mode:**
  - `Orchestrated Saga (Central Coordinator Service)` | `Choreographed Saga (Event Pub/Sub)`
- **Compensating Action Configuration:**
  - Defines rollback endpoints (`DELETE /order/{id}`, `POST /payment/{id}/refund`) executed automatically if a downstream step fails.

### C. Circuit Breaker & Retry Gateway (`ResilienceGateway`)
Protects downstream services from cascading failure storms.
- **Failure Thresholds:**
  - `Failure Rate Threshold (%):` e.g., 50%
  - `Sliding Window Size:` e.g., 100 requests
  - `Wait Duration in Open State:` e.g., 60 seconds
  - `Half-Open Probe Calls:` e.g., 10 requests

### D. Fork / Join Parallel Fan-Out (`ForkJoinGateway`)
Splits a single request into parallel invocations across multiple downstream services and joins the results.
- **Join Strategy:**
  - `Wait for ALL (Promise.all / CompletableFuture.allOf)`
  - `Wait for ANY FIRST response (Race)`
  - `Partial Tolerance (Continue if at least M of N succeed)`

---

## 4. Spring Boot — Full Option Reference (`spring-boot`)

Source: the official [start.spring.io metadata endpoint](https://start.spring.io/metadata/client) (fetched 2026-07-12), mirrored category-for-category in `src/pages/canvas/data/springCatalog.ts`, augmented with a Project Metadata & Design Patterns category, nested suboptions, and the legacy Spring Cloud Netflix stack (kept with maintenance/deprecated status and named successors because users still ask for it by name). **25 categories, 248 options** (231 top-level + 17 nested suboptions). Entries marked ⚠ are in maintenance or deprecated; the arrow names the recommended successor.

### 4.A Project Metadata & Design Patterns (10 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Maven** | Declarative XML build with the dependency and plugin ecosystem most Spring guides assume by default. | [docs](https://maven.apache.org/guides/index.html) |
| **Gradle (Groovy DSL)** | Incremental, cacheable builds scripted in the classic Groovy build.gradle DSL. | [docs](https://docs.gradle.org/current/userguide/userguide.html) |
| **Gradle (Kotlin DSL)** | Gradle builds written in statically-typed build.gradle.kts with IDE auto-completion. | [docs](https://docs.gradle.org/current/userguide/kotlin_dsl.html) |
| **Java 21 (LTS)** | Current long-term-support JDK with virtual threads (Loom), record patterns, and sequenced collections. | [docs](https://openjdk.org/projects/jdk/21/) |
| **Java 17 (LTS)** | Widely-deployed long-term-support JDK baseline required by Spring Boot 3.x (sealed classes, records). | [docs](https://openjdk.org/projects/jdk/17/) |
| **Standard Layered Architecture** | Classic Controller → Service → Repository layering with DTOs at the web boundary; the default for CRUD services. | [docs](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/n-tier) |
| **Hexagonal Architecture (Ports & Adapters)** | Keeps the domain core framework-free behind inbound/outbound ports, with adapters for web, DB, and messaging. | [docs](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html) |
| **Clean / Onion Architecture** | Concentric dependency rule pointing inward so domain entities carry zero framework annotations. | [docs](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) |
| **CQRS Pattern** | Splits the write model (commands) from the read model (queries) so each side scales and evolves independently. | [docs](https://martinfowler.com/bliki/CQRS.html) |
| **Spring Modulith** | Modular monolith with enforced bounded-context boundaries, module tests, and an event publication registry. | [docs](https://spring.io/projects/spring-modulith) |

### 4.B Developer Tools (7 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **GraalVM Native Support** | Support for compiling Spring applications to native executables using the GraalVM native-image compiler. | [docs](https://docs.spring.io/spring-boot/reference/packaging/native-image/index.html) |
| **GraphQL DGS Code Generation** | Generate data types and type-safe APIs for querying GraphQL APIs by parsing schema files. | [docs](https://netflix.github.io/dgs/generating-code-from-schema/) |
| **Spring Boot DevTools** | Provides fast application restarts, LiveReload, and configurations for enhanced development experience. | [docs](https://docs.spring.io/spring-boot/reference/using/devtools.html) |
| **Lombok** | Java annotation library which helps to reduce boilerplate code. | [docs](https://projectlombok.org/features/) |
| **Spring Configuration Processor** | Generate metadata for developers to offer contextual help and "code completion" when working with custom configuration keys (ex.application.properties/.yml files). | [docs](https://docs.spring.io/spring-boot/specification/configuration-metadata/annotation-processor.html) |
| **Docker Compose Support** | Provides docker compose support for enhanced development experience. | [docs](https://docs.spring.io/spring-boot/reference/features/dev-services.html#features.dev-services.docker-compose) |
| **Spring Modulith** | Support for building modular monolithic applications. | [docs](https://docs.spring.io/spring-modulith/reference/) |

### 4.C Web (25 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Spring Web** | Build web, including RESTful, applications using Spring MVC. Uses Apache Tomcat as the default embedded container. | [docs](https://docs.spring.io/spring-boot/reference/web/servlet.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ OpenAPI 3 / Swagger UI (springdoc-openapi) | Generates a live OpenAPI 3 contract and Swagger UI for your Spring MVC endpoints via springdoc-openapi. | [docs](https://springdoc.org/) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Global Exception Handler (@ControllerAdvice) | Centralizes exception-to-HTTP mapping for every controller with @ControllerAdvice and @ExceptionHandler. | [docs](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-advice.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Content Negotiation (JSON/XML/CBOR) | Serves the same endpoint as JSON, XML, or CBOR based on Accept headers or URL parameters. | [docs](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-config/content-negotiation.html) |
| **Spring Reactive Web** | Build reactive web applications with Spring WebFlux and Netty. | [docs](https://docs.spring.io/spring-boot/reference/web/reactive.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ RSocket Streaming Protocol | Adds request-stream and channel interactions over the RSocket binary protocol on top of Reactor. | [docs](https://docs.spring.io/spring-framework/reference/rsocket.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Server-Sent Events (SSE) | Streams Flux results to browsers as Server-Sent Events for live one-way updates without WebSockets. | [docs](https://docs.spring.io/spring-framework/reference/web/webflux/reactive-spring.html) |
| **HTTP Client** | Spring Boot integration for RestClient and RestTemplate to make HTTP requests. | [docs](https://docs.spring.io/spring-boot/reference/io/rest-client.html#io.rest-client.restclient) |
| **Reactive HTTP Client** | Spring Boot integration for WebClient to make reactive HTTP requests. | [docs](https://docs.spring.io/spring-boot/reference/io/rest-client.html#io.rest-client.webclient) |
| **Spring for GraphQL** | Build GraphQL applications with Spring for GraphQL and GraphQL Java. | [docs](https://docs.spring.io/spring-boot/reference/web/spring-graphql.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ GraphiQL Interactive Dev UI | Enables the in-browser GraphiQL editor for exploring and testing your GraphQL schema during development. | [docs](https://docs.spring.io/spring-graphql/reference/graphiql.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ DataLoader N+1 Optimization | Batches and caches nested field fetches with DataLoader to eliminate N+1 query storms. | [docs](https://docs.spring.io/spring-graphql/reference/request-execution.html) |
| **Rest Repositories** | Exposing Spring Data repositories over REST via Spring Data REST. | [docs](https://docs.spring.io/spring-boot/how-to/data-access.html#howto.data-access.exposing-spring-data-repositories-as-rest) |
| **Spring Session for Spring Data MongoDB** | Provides an API and a Spring Data MongoDB implementation for managing user session information. | [docs](https://docs.spring.io/spring-session/reference/) |
| **Spring Session for Spring Data Redis** | Provides an API and a Spring Data Redis implementation for managing user session information. | [docs](https://docs.spring.io/spring-session/reference/) |
| **Spring Session for Hazelcast** | Provides an API and a Hazelcast implementation for managing user session information. | [docs](https://docs.spring.io/spring-session/reference/) |
| **Spring Session for JDBC** | Provides an API and a JDBC implementation for managing user session information. | [docs](https://docs.spring.io/spring-session/reference/) |
| **Rest Repositories HAL Explorer** | Browsing Spring Data REST repositories in your browser. | [docs](https://docs.spring.io/spring-data/rest/reference/) |
| **Spring HATEOAS** | Eases the creation of RESTful APIs that follow the HATEOAS principle when working with Spring / Spring MVC. | [docs](https://docs.spring.io/spring-boot/reference/web/spring-hateoas.html) |
| **Spring Web Services** | Facilitates contract-first SOAP development using Spring WS. Allows for the creation of flexible web services using one of the many ways to manipulate XML payloads. | [docs](https://docs.spring.io/spring-boot/reference/io/webservices.html) |
| **Jersey** | Framework for developing RESTful Web Services in Java that provides support for JAX-RS APIs. | [docs](https://docs.spring.io/spring-boot/reference/web/servlet.html#web.servlet.jersey) |
| **Vaadin** | The full-stack web app platform for Spring. Build views fully in Java with Flow, or in React using Hilla. | [docs](https://vaadin.com/docs) |
| **Netflix DGS** | Build GraphQL applications with Netflix DGS and Spring for GraphQL. | [docs](https://netflix.github.io/dgs/) |
| **htmx** | Build modern user interfaces with the simplicity and power of hypertext. | [docs](https://github.com/wimdeblauwe/htmx-spring-boot) |
| **SpringDoc OpenAPI** | Add OpenAPI / Swagger documentation to web-based Spring applications. | [docs](https://springdoc.org/) |

### 4.D Template Engines (5 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Thymeleaf** | A modern server-side Java template engine for both web and standalone environments. Allows HTML to be correctly displayed in browsers and as static prototypes. | [docs](https://docs.spring.io/spring-boot/reference/web/servlet.html#web.servlet.spring-mvc.template-engines) |
| **Apache Freemarker** | Java library to generate text output (HTML web pages, e-mails, configuration files, source code, etc.) based on templates and changing data. | [docs](https://docs.spring.io/spring-boot/reference/web/servlet.html#web.servlet.spring-mvc.template-engines) |
| **Mustache** | Logic-less templates for both web and standalone environments. There are no if statements, else clauses, or for loops. Instead there are only tags. | [docs](https://docs.spring.io/spring-boot/reference/web/servlet.html#web.servlet.spring-mvc.template-engines) |
| **Groovy Templates** | Groovy templating engine. | [docs](https://docs.spring.io/spring-boot/reference/web/servlet.html#web.servlet.spring-mvc.template-engines) |
| **jte** | Secure and lightweight template engine for Java and Kotlin. | [docs](https://jte.gg/) |

### 4.E Security (12 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Spring Security** | Highly customizable authentication and access-control framework for Spring applications. | [docs](https://docs.spring.io/spring-boot/reference/web/spring-security.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Stateless JWT Token Auth Filter | Validates JWT bearer tokens on every request for fully stateless authentication without server sessions. | [docs](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Role-Based Method Security (@PreAuthorize) | Guards individual service methods with SpEL role and permission rules via @PreAuthorize/@PostAuthorize. | [docs](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ CORS & CSRF Hardening | Locks down cross-origin requests and enables CSRF token protection for browser-facing endpoints. | [docs](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html) |
| **OAuth2 Client** | Spring Boot integration for Spring Security's OAuth2/OpenID Connect client features. | [docs](https://docs.spring.io/spring-boot/reference/web/spring-security.html#web.security.oauth2.client) |
| **OAuth2 Authorization Server** | Spring Boot integration for Spring Authorization Server. | [docs](https://docs.spring.io/spring-boot/reference/web/spring-security.html#web.security.oauth2.authorization-server) |
| **OAuth2 Resource Server** | Spring Boot integration for Spring Security's OAuth2 resource server features. | [docs](https://docs.spring.io/spring-boot/reference/web/spring-security.html#web.security.oauth2.server) |
| **SAML 2.0** | Spring Boot integration for Spring Security's SAML 2.0 features. | [docs](https://docs.spring.io/spring-boot/reference/web/spring-security.html#web.security.saml2) |
| **WebAuthn for Spring Security** | Support for WebAuthn in Spring Security. | [docs](https://docs.spring.io/spring-security/reference/servlet/authentication/passkeys.html) |
| **LDAP** | LDAP is an open, vendor-neutral, industry standard application protocol for accessing and maintaining distributed directory information services over an IP network. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.ldap) |
| **Spring Data LDAP** | Spring Data support for LDAP. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.ldap) |
| **Okta** | Okta specific configuration for Spring Security/Spring Boot OAuth2 features. Enable your Spring Boot application to work with Okta via OAuth 2.0/OIDC. | [docs](https://github.com/okta/okta-spring-boot#readme) |

### 4.F SQL (19 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **JDBC API** | Database Connectivity API that defines how a client may connect and query a database. | [docs](https://docs.spring.io/spring-boot/reference/data/sql.html) |
| **R2DBC API** | Reactive Database Connectivity API that defines how a client may connect and query a database. | [docs](https://docs.spring.io/spring-boot/reference/data/sql.html#data.sql.r2dbc) |
| **Spring Data JPA** | Persist data in SQL stores with Java Persistence API using Spring Data and Hibernate. | [docs](https://docs.spring.io/spring-boot/reference/data/sql.html#data.sql.jpa-and-spring-data) |
| **Spring Data JDBC** | Persist data in SQL stores with plain JDBC using Spring Data. | [docs](https://docs.spring.io/spring-boot/reference/data/sql.html#data.sql.jdbc) |
| **Spring Data R2DBC** | Provides Reactive Relational Database Connectivity to persist data in SQL stores using Spring Data in reactive applications. | [docs](https://docs.spring.io/spring-boot/reference/data/sql.html#data.sql.r2dbc) |
| **MyBatis Framework** | Persistence framework with support for custom SQL, stored procedures and advanced mappings. | [docs](https://mybatis.org/spring-boot-starter/mybatis-spring-boot-autoconfigure/) |
| **Liquibase Migration** | Liquibase database migration and source control library. | [docs](https://docs.spring.io/spring-boot/how-to/data-initialization.html#howto.data-initialization.migration-tool.liquibase) |
| **Flyway Migration** | Version control for your database so you can migrate from any version (incl. an empty database) to the latest version of the schema. | [docs](https://docs.spring.io/spring-boot/how-to/data-initialization.html#howto.data-initialization.migration-tool.flyway) |
| **JOOQ Access Layer** | Generate Java code from your database and build type safe SQL queries through a fluent API. | [docs](https://docs.spring.io/spring-boot/reference/data/sql.html#data.sql.jooq) |
| **IBM DB2 Driver** | A JDBC driver that provides access to IBM DB2. | [docs](https://www.ibm.com/support/pages/db2-jdbc-driver-versions-and-downloads) |
| **Apache Derby Database** | An open source relational database implemented entirely in Java. | [docs](https://db.apache.org/derby/) |
| **H2 Database** | Provides a fast in-memory database that supports JDBC API and R2DBC access, with a small (2mb) footprint. | [docs](https://www.h2database.com/html/main.html) |
| **HyperSQL Database** | Lightweight 100% Java SQL Database Engine. | [docs](https://hsqldb.org/) |
| **MariaDB Driver** | MariaDB JDBC and R2DBC driver. | [docs](https://mariadb.com/kb/en/about-mariadb-connector-j/) |
| **MS SQL Server Driver** | A JDBC and R2DBC driver that provides access to Microsoft SQL Server and Azure SQL Database from any Java application. | [docs](https://learn.microsoft.com/en-us/sql/connect/jdbc/microsoft-jdbc-driver-for-sql-server) |
| **MySQL Driver** | MySQL JDBC driver. | [docs](https://dev.mysql.com/doc/connector-j/en/) |
| **Oracle Driver** | A JDBC driver that provides access to Oracle. | [docs](https://www.oracle.com/database/technologies/appdev/jdbc.html) |
| **PostgreSQL Driver** | A JDBC and R2DBC driver that allows Java programs to connect to a PostgreSQL database using standard, database independent Java code. | [docs](https://jdbc.postgresql.org/) |
| **SQLite Driver** | JDBC driver for SQLite, a lightweight, embedded SQL database engine. | [docs](https://github.com/xerial/sqlite-jdbc) |

### 4.G NoSQL (17 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Spring Data Redis (Access+Driver)** | Advanced and thread-safe Java Redis client for synchronous, asynchronous, and reactive usage. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.redis) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Distributed Session Store | Externalizes HTTP session state into Redis via Spring Session so any instance can serve any user. | [docs](https://docs.spring.io/spring-session/reference/) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Caffeine Second-Level Cache | Layers a near-instant in-process Caffeine cache in front of Redis for hot keys. | [docs](https://github.com/ben-manes/caffeine/wiki) |
| **Spring Data Reactive Redis** | Access Redis key-value data stores in a reactive fashion with Spring Data Redis. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.redis) |
| **MongoDB** | MongoDB is an open-source NoSQL document database that uses a JSON-like schema instead of traditional table-based relational data. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.mongodb) |
| **Spring Data MongoDB** | Spring Data support for MongoDB. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.mongodb) |
| **Spring Data Reactive MongoDB** | Reactive Spring Data support for MongoDB. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.mongodb) |
| **Elasticsearch** | Elasticsearch is an open source, distributed, RESTful search and analytics engine. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.elasticsearch) |
| **Spring Data Elasticsearch** | Spring Data support for Elasticsearch. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.elasticsearch) |
| **Cassandra** | Cassandra is an open source, distributed database management system designed to handle large amounts of data across many commodity servers. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.cassandra) |
| **Spring Data for Apache Cassandra** | Spring Data support for Cassandra. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.cassandra) |
| **Spring Data Reactive for Apache Cassandra** | Reactive Spring Data support for Cassandra. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.cassandra) |
| **Couchbase** | Couchbase is an open-source, distributed, multi-model NoSQL document-oriented database that is optimized for interactive applications. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.couchbase) |
| **Spring Data Couchbase** | Spring Data support for Couchbase. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.couchbase) |
| **Spring Data Reactive Couchbase** | Reactive Spring Data support for Couchbase. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.couchbase) |
| **Neo4j** | Neo4j is an open-source NoSQL graph database that uses a rich data model of nodes connected by first class relationships, which is better suited for connected big data than traditional RDBMS approaches. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.neo4j) |
| **Spring Data Neo4j** | Spring Data support for Neo4j. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.neo4j) |

### 4.H Messaging (18 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Spring Integration** | Adds support for Enterprise Integration Patterns. Enables lightweight messaging and supports integration with external systems via declarative adapters. | [docs](https://docs.spring.io/spring-boot/reference/messaging/spring-integration.html) |
| **Spring for RabbitMQ** | Gives your applications a common platform to send and receive messages, and your messages a safe place to live until received. | [docs](https://docs.spring.io/spring-boot/reference/messaging/amqp.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Direct / Topic / Fanout Exchanges | Declares direct, topic, headers, and fanout exchanges with bindings to route messages to queues. | [docs](https://docs.spring.io/spring-amqp/reference/amqp/broker-configuration.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Message TTL & Dead-Lettering | Expires stale messages with per-queue TTLs and reroutes rejected ones to dead-letter exchanges. | [docs](https://docs.spring.io/spring-amqp/reference/amqp/resilience-recovering-from-errors-and-broker-failures.html) |
| **Spring for RabbitMQ Streams** | Building stream processing applications with RabbitMQ. | [docs](https://docs.spring.io/spring-amqp/reference/stream.html) |
| **Spring for Apache Kafka** | Publish, subscribe, store, and process streams of records. | [docs](https://docs.spring.io/spring-boot/reference/messaging/kafka.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Dead Letter Topic (DLT) Retry Consumer | Retries failed records on backoff topics and parks poison messages on a dead letter topic. | [docs](https://docs.spring.io/spring-kafka/reference/retrytopic.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Confluent Avro Schema Registry | Serializes records as Avro with schemas versioned and compatibility-checked in Confluent Schema Registry. | [docs](https://docs.confluent.io/platform/current/schema-registry/index.html) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Kafka Streams API | Builds stateful stream-processing topologies (joins, windows, aggregations) directly on Kafka topics. | [docs](https://docs.spring.io/spring-kafka/reference/streams.html) |
| **Spring for Apache Kafka Streams** | Building stream processing applications with Apache Kafka Streams. | [docs](https://docs.spring.io/spring-kafka/reference/streams.html) |
| **Spring for Apache ActiveMQ 5** | Spring JMS support with Apache ActiveMQ 'Classic'. | [docs](https://docs.spring.io/spring-boot/reference/messaging/jms.html#messaging.jms.activemq) |
| **Spring for Apache ActiveMQ Artemis** | Spring JMS support with Apache ActiveMQ Artemis. | [docs](https://docs.spring.io/spring-boot/reference/messaging/jms.html#messaging.jms.artemis) |
| **Spring for Apache Pulsar** | Build messaging applications with Apache Pulsar. | [docs](https://docs.spring.io/spring-boot/reference/messaging/pulsar.html) |
| **Spring for Apache Pulsar (Reactive)** | Build reactive messaging applications with Apache Pulsar. | [docs](https://docs.spring.io/spring-boot/reference/messaging/pulsar.html) |
| **WebSocket** | Build Servlet-based WebSocket applications with SockJS and STOMP. | [docs](https://docs.spring.io/spring-boot/reference/messaging/websockets.html) |
| **RSocket** | RSocket.io applications with Spring Messaging and Netty. | [docs](https://rsocket.io/) |
| **Apache Camel** | Apache Camel is an open source integration framework that empowers you to quickly and easily integrate various systems consuming or producing data. | [docs](https://camel.apache.org/camel-spring-boot/latest/spring-boot.html) |
| **Solace PubSub+** | Connect to a Solace PubSub+ Advanced Event Broker to publish, subscribe, request/reply and store/replay messages. | [docs](https://www.solace.dev/start-spring-io-help/) |

### 4.I I/O (12 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Spring Batch** | Batch applications with transactions, retry/skip and chunk based processing. | [docs](https://docs.spring.io/spring-boot/how-to/batch.html) |
| **Spring Batch JDBC** | JDBC support for Spring Batch applications. | [docs](https://docs.spring.io/spring-boot/how-to/batch.html) |
| **Spring Batch MongoDB** | MongoDB support for Spring Batch applications. | [docs](https://docs.spring.io/spring-boot/how-to/batch.html) |
| **Hazelcast** | Hazelcast is a distributed cache with in-memory compute and stream processing that accelerates applications with data caching, data integration, and distributed computing. | [docs](https://docs.spring.io/spring-boot/reference/io/hazelcast.html) |
| **Validation** | Bean Validation with Hibernate validator. | [docs](https://docs.spring.io/spring-boot/reference/io/validation.html) |
| **Java Mail Sender** | Send email using Java Mail and Spring Framework's JavaMailSender. | [docs](https://docs.spring.io/spring-boot/reference/io/email.html) |
| **Quartz Scheduler** | Schedule jobs using Quartz. | [docs](https://docs.spring.io/spring-boot/reference/io/quartz.html) |
| **JobRunr** | Easily schedule and process background jobs using a distributed job scheduler with a built-in dashboard. | [docs](https://www.jobrunr.io/en/documentation/configuration/spring/) |
| **Spring Cache Abstraction** | Provides cache-related operations, such as the ability to update the content of the cache, but does not provide the actual data store. | [docs](https://docs.spring.io/spring-boot/reference/io/caching.html) |
| **Spring Shell** | Build command line applications with spring. | [docs](https://docs.spring.io/spring-shell/reference/index.html) |
| **Spring gRPC Server** | Server support for gRPC, a high performance, open source universal RPC framework. | [docs](https://docs.spring.io/spring-grpc/reference/server.html) |
| **Spring gRPC Client** | Client support for gRPC, a high performance, open source universal RPC framework. | [docs](https://docs.spring.io/spring-grpc/reference/client.html) |

### 4.J Ops (6 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Spring Boot Actuator** | Supports built in (or custom) endpoints that let you monitor and manage your application - such as application health, metrics, sessions, etc. | [docs](https://docs.spring.io/spring-boot/reference/actuator/index.html) |
| **CycloneDX SBOM support** | Creates a Software Bill of Materials in CycloneDX format. | [docs](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html#actuator.endpoints.sbom) |
| **codecentric's Spring Boot Admin (Client)** | Required for your application to register with a Codecentric's Spring Boot Admin Server instance. | [docs](https://codecentric.github.io/spring-boot-admin/current/#getting-started) |
| **codecentric's Spring Boot Admin (Server)** | A community project to manage and monitor your Spring Boot applications. Provides a UI on top of the Spring Boot Actuator endpoints. | [docs](https://codecentric.github.io/spring-boot-admin/current/#getting-started) |
| **Sentry** | Application performance monitoring and error tracking that help software teams see clearer, solve quicker, and learn continuously. | [docs](https://docs.sentry.io/platforms/java/) |
| **Cloud Foundry** | Cloud Foundry provides a highly efficient, open source platform for cloud-native application development. | [docs](https://docs.spring.io/spring-boot/reference/actuator/cloud-foundry.html) |

### 4.K Observability (12 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Datadog** | Publish Micrometer metrics to Datadog, a dimensional time-series SaaS with built-in dashboarding and alerting. | [docs](https://docs.spring.io/spring-boot/reference/actuator/metrics.html#actuator.metrics.export.datadog) |
| **Dynatrace** | Publish Micrometer metrics to Dynatrace, a platform featuring observability, AIOps, application security and analytics. | [docs](https://docs.spring.io/spring-boot/reference/actuator/metrics.html#actuator.metrics.export.dynatrace) |
| **Influx** | Publish Micrometer metrics to InfluxDB, a dimensional time-series server that support real-time stream processing of data. | [docs](https://docs.spring.io/spring-boot/reference/actuator/metrics.html#actuator.metrics.export.influx) |
| **Graphite** | Publish Micrometer metrics to Graphite, a hierarchical metrics system backed by a fixed-size database. | [docs](https://docs.spring.io/spring-boot/reference/actuator/metrics.html#actuator.metrics.export.graphite) |
| **New Relic** | Publish Micrometer metrics to New Relic, a SaaS offering with a full UI and a query language called NRQL. | [docs](https://docs.spring.io/spring-boot/reference/actuator/metrics.html#actuator.metrics.export.newrelic) |
| **OTLP for metrics** | Publish Micrometer metrics to an OpenTelemetry Protocol (OTLP) capable backend. | [docs](https://docs.spring.io/spring-boot/reference/actuator/metrics.html#actuator.metrics.export.otlp) |
| **Prometheus** | Expose Micrometer metrics in Prometheus format, an in-memory dimensional time series database with a simple built-in UI, a custom query language, and math operations. | [docs](https://docs.spring.io/spring-boot/reference/actuator/metrics.html#actuator.metrics.export.prometheus) |
| **Datasource Micrometer** | Add Micrometer observability instrumentation for JDBC operations. | [docs](https://jdbc-observations.github.io/datasource-micrometer/docs/current/docs/html/) |
| **Distributed Tracing** | Enable span and trace IDs in logs. | [docs](https://docs.spring.io/spring-boot/reference/actuator/tracing.html) |
| **OpenTelemetry** | Publish metrics and traces in OpenTelemetry's OTLP format. | [docs](https://docs.spring.io/spring-boot/reference/actuator/observability.html#actuator.observability.opentelemetry) |
| **Wavefront** | Publish metrics and optionally distributed traces to Tanzu Observability by Wavefront, a SaaS-based metrics monitoring and analytics platform that lets you visualize, query, and alert over data from across your entire stack. | [docs](https://docs.wavefront.com/wavefront_springboot.html) |
| **Zipkin** | Enable and expose span and trace IDs to Zipkin. | [docs](https://zipkin.io/) |

### 4.L Testing (5 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Spring REST Docs** | Document RESTful services by combining hand-written with Asciidoctor and auto-generated snippets produced with Spring MVC Test. | [docs](https://docs.spring.io/spring-restdocs/docs/current/reference/htmlsingle/) |
| **Testcontainers** | Provide lightweight, throwaway instances of common databases, Selenium web browsers, or anything else that can run in a Docker container. | [docs](https://java.testcontainers.org/) |
| **Contract Verifier** | Moves TDD to the level of software architecture by enabling Consumer Driven Contract (CDC) development. | [docs](https://docs.spring.io/spring-cloud-contract/reference/) |
| **Contract Stub Runner** | Stub Runner for HTTP/Messaging based communication. Allows creating WireMock stubs from RestDocs tests. | [docs](https://docs.spring.io/spring-cloud-contract/reference/project-features-stubrunner.html) |
| **Embedded LDAP Server** | Provides a platform neutral way for running a LDAP server in unit tests. | [docs](https://docs.spring.io/spring-boot/reference/data/nosql.html#data.nosql.ldap.embedded) |

### 4.M Spring Cloud (3 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Cloud Bootstrap** | Non-specific Spring Cloud features, unrelated to external libraries or integrations (e.g. Bootstrap context and @RefreshScope). | [docs](https://docs.spring.io/spring-cloud-commons/reference/spring-cloud-commons/application-context-services.html) |
| **Function** | Promotes the implementation of business logic via functions and supports a uniform programming model across serverless providers, as well as the ability to run standalone (locally or in a PaaS). | [docs](https://docs.spring.io/spring-cloud-function/reference/) |
| **Task** | Allows a user to develop and run short lived microservices using Spring Cloud. Run them locally, in the cloud, and on Spring Cloud Data Flow. | [docs](https://docs.spring.io/spring-cloud-task/reference/) |

### 4.N Spring Cloud Config (5 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Config Client** | Client that connects to a Spring Cloud Config Server to fetch the application's configuration. | [docs](https://docs.spring.io/spring-cloud-config/reference/client.html) |
| **Config Server** | Central management for configuration via Git, SVN, or HashiCorp Vault. | [docs](https://docs.spring.io/spring-cloud-config/reference/server.html) |
| **Vault Configuration** | Provides client-side support for externalized configuration in a distributed system. | [docs](https://docs.spring.io/spring-cloud-vault/reference/) |
| **Apache Zookeeper Configuration** | Enable and configure common patterns inside your application and build large distributed systems with Apache Zookeeper based components. | [docs](https://docs.spring.io/spring-cloud-zookeeper/reference/config.html) |
| **Consul Configuration** | Enable and configure the common patterns inside your application and build large distributed systems with Hashicorp’s Consul. | [docs](https://docs.spring.io/spring-cloud-consul/reference/) |

### 4.O Spring Cloud Discovery (4 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Eureka Discovery Client** | A REST based service for locating services for the purpose of load balancing and failover of middle-tier servers. | [docs](https://docs.spring.io/spring-cloud-netflix/reference/spring-cloud-netflix.html#_service_discovery_eureka_clients) |
| **Eureka Server** | spring-cloud-netflix Eureka Server. | [docs](https://docs.spring.io/spring-cloud-netflix/reference/spring-cloud-netflix.html#spring-cloud-eureka-server) |
| **Apache Zookeeper Discovery** | Service discovery with Apache Zookeeper. | [docs](https://docs.spring.io/spring-cloud-zookeeper/reference/discovery.html) |
| **Consul Discovery** | Service discovery with Hashicorp Consul. | [docs](https://docs.spring.io/spring-cloud-consul/reference/discovery.html) |

### 4.P Spring Cloud Routing (4 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Gateway** | Provides a simple, yet effective way to route to APIs in Servlet-based applications. | [docs](https://docs.spring.io/spring-cloud-gateway/reference/spring-cloud-gateway-server-webmvc.html) |
| **Reactive Gateway** | Provides a simple, yet effective way to route to APIs in reactive applications. | [docs](https://docs.spring.io/spring-cloud-gateway/reference/spring-cloud-gateway-server-webflux.html) |
| **OpenFeign** | Declarative REST Client. OpenFeign creates a dynamic implementation of an interface decorated with JAX-RS or Spring MVC annotations. | [docs](https://docs.spring.io/spring-cloud-openfeign/reference/) |
| **Cloud LoadBalancer** | Client-side load-balancing with Spring Cloud LoadBalancer. | [docs](https://docs.spring.io/spring-cloud-commons/reference/spring-cloud-commons/loadbalancer.html) |

### 4.Q Spring Cloud Circuit Breaker (1 option)

| Option | What it does | Docs |
| --- | --- | --- |
| **Resilience4J** | Spring Cloud Circuit breaker with Resilience4j as the underlying implementation. | [docs](https://docs.spring.io/spring-cloud-circuitbreaker/reference/spring-cloud-circuitbreaker-resilience4j.html) |

### 4.R Spring Cloud Messaging (2 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Cloud Bus** | Links nodes of a distributed system with a lightweight message broker which can used to broadcast state changes or other management instructions (requires a binder, e.g. | [docs](https://docs.spring.io/spring-cloud-bus/reference/) |
| **Cloud Stream** | Framework for building highly scalable event-driven microservices connected with shared messaging systems (requires a binder, e.g. | [docs](https://docs.spring.io/spring-cloud-stream/reference/) |

### 4.S Spring Cloud Netflix (legacy) (5 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Ribbon** ⚠ *maintenance* | Client-side load balancer with pluggable rules (round-robin, zone-aware) for inter-service calls. → *Spring Cloud LoadBalancer* | [docs](https://cloud.spring.io/spring-cloud-netflix/multi/multi_spring-cloud-ribbon.html) |
| **Hystrix** ⚠ *maintenance* | Circuit breaker isolating remote calls in thread pools with fallbacks to stop cascading failures. → *Resilience4j / Spring Cloud Circuit Breaker* | [docs](https://cloud.spring.io/spring-cloud-netflix/multi/multi__circuit_breaker_hystrix_clients.html) |
| **Zuul** ⚠ *deprecated* | Blocking JVM edge router and server-side proxy with request/response filters for routing and auth. → *Spring Cloud Gateway* | [docs](https://cloud.spring.io/spring-cloud-netflix/multi/multi__router_and_filter_zuul.html) |
| **Turbine** ⚠ *deprecated* | Aggregates Hystrix metrics streams from many instances into one dashboard-friendly feed. → *Micrometer + Spring Cloud Circuit Breaker metrics* | [docs](https://docs.spring.io/spring-cloud-netflix/docs/2.2.10.RELEASE/reference/html/#turbine) |
| **Archaius** ⚠ *deprecated* | Netflix dynamic configuration library with polled property sources and runtime property changes. → *Spring Cloud Config / Spring Environment* | [docs](https://cloud.spring.io/spring-cloud-netflix/multi/multi__external_configuration_archaius.html) |

### 4.T VMware Tanzu Application Service (2 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Config Client (TAS)** | Config client on VMware Tanzu Application Service. | [docs](https://docs.vmware.com/en/Spring-Cloud-Services-for-VMware-Tanzu/index.html) |
| **Service Registry (TAS)** | Eureka service discovery client on VMware Tanzu Application Service. | [docs](https://docs.vmware.com/en/Spring-Cloud-Services-for-VMware-Tanzu/index.html) |

### 4.U VMware Tanzu Spring Enterprise Extensions (7 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Governance Starter [Enterprise]** | The Enterprise Spring Boot Governance Starter library enforces cipher and TLS security based on the industry standard, and empowers Spring developers to auto-generate compliance and governance reporting information for their applications. | [docs](https://techdocs.broadcom.com/us/en/vmware-tanzu/spring/tanzu-spring/commercial/spring-tanzu/index-sbgs.html) |
| **Spring Cloud Gateway Access Control [Enterprise]** | Spring Cloud Gateway filters for access control based on API keys or JWT Tokens. | [docs](https://techdocs.broadcom.com/us/en/vmware-tanzu/spring/spring-cloud-gateway-extensions/1-0-0/scg-extensions/access-control.html) |
| **Spring Cloud Gateway Custom [Enterprise]** | Spring Cloud Gateway utilities to help develop custom filters and predicates. | [docs](https://techdocs.broadcom.com/us/en/vmware-tanzu/spring/spring-cloud-gateway-extensions/1-0-0/scg-extensions/custom.html) |
| **Spring Cloud Gateway GraphQL [Enterprise]** | Spring Cloud Gateway filters to restrict GraphQL operations. | [docs](https://techdocs.broadcom.com/us/en/vmware-tanzu/spring/spring-cloud-gateway-extensions/1-0-0/scg-extensions/graphql.html) |
| **Spring Cloud Gateway Single Sign On [Enterprise]** | Spring Cloud Gateway filters to add single sign-on (SSO) and restrict traffic based on roles or scopes. | [docs](https://techdocs.broadcom.com/us/en/vmware-tanzu/spring/spring-cloud-gateway-extensions/1-0-0/scg-extensions/sso.html) |
| **Spring Cloud Gateway Traffic Control [Enterprise]** | Spring Cloud Gateway filters to restrict traffic based on request parameters and add circuit breakers. | [docs](https://techdocs.broadcom.com/us/en/vmware-tanzu/spring/spring-cloud-gateway-extensions/1-0-0/scg-extensions/traffic-control.html) |
| **Spring Cloud Gateway Transformation [Enterprise]** | Spring Cloud Gateway filters to transform the response before returning downstream. | [docs](https://techdocs.broadcom.com/us/en/vmware-tanzu/spring/spring-cloud-gateway-extensions/1-0-0/scg-extensions/transformation.html) |

### 4.V VMware Tanzu Spring SDK (1 option)

| Option | What it does | Docs |
| --- | --- | --- |
| **Tanzu Spring SDK [Enterprise]** | The Tanzu Spring SDK is a Spring Boot BOM with optional libraries for exposing observability and using OpenFeature based feature flags in Tanzu Platform. | [docs](https://techdocs.broadcom.com/us/en/vmware-tanzu/spring/tanzu-spring/commercial/spring-tanzu/tanzu-spring-sdk-getting-started.html) |

### 4.W Microsoft Azure (5 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Azure Support** | Auto-configuration for Azure Services (Service Bus, Storage, Active Directory, Key Vault, and more). | [docs](https://aka.ms/spring/msdocs/developer-guide) |
| **Azure Active Directory** | Spring Security integration with Azure Active Directory for authentication. | [docs](https://microsoft.github.io/spring-cloud-azure/current/reference/html/index.html#spring-security-with-azure-active-directory) |
| **Azure Cosmos DB** | Fully managed NoSQL database service for modern app development, including Spring Data support. | [docs](https://microsoft.github.io/spring-cloud-azure/current/reference/html/index.html#spring-data-support) |
| **Azure Key Vault** | All key vault features are supported, e.g. manage application secrets and certificates. | [docs](https://microsoft.github.io/spring-cloud-azure/current/reference/html/index.html#secret-management) |
| **Azure Storage** | All Storage features are supported, e.g. blob, fileshare and queue. | [docs](https://microsoft.github.io/spring-cloud-azure/current/reference/html/index.html#resource-handling) |

### 4.X Google Cloud (3 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Google Cloud Support** | Contains auto-configuration support for every Google Cloud integration. | [docs](https://googlecloudplatform.github.io/spring-cloud-gcp/reference/html/index.html) |
| **Google Cloud Messaging** | Adds the Google Cloud Support entry and all the required dependencies so that the Google Cloud Pub/Sub integration work out of the box. | [docs](https://googlecloudplatform.github.io/spring-cloud-gcp/reference/html/index.html#cloud-pubsub) |
| **Google Cloud Storage** | Adds the Google Cloud Support entry and all the required dependencies so that the Google Cloud Storage integration work out of the box. | [docs](https://googlecloudplatform.github.io/spring-cloud-gcp/reference/html/index.html#cloud-storage) |

### 4.Y AI (58 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Anthropic Claude** | Spring AI support for Anthropic Claude AI models. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/anthropic-chat.html) |
| **Azure OpenAI** | Spring AI support for Azure’s OpenAI offering, powered by ChatGPT. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/azure-openai-chat.html) |
| **Azure AI Search** | Spring AI vector database support for Azure AI Search. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/azure.html) |
| **Amazon Bedrock** | Spring AI support for Amazon Bedrock Cohere and Titan Embedding Models. | [docs](https://docs.spring.io/spring-ai/reference/api/bedrock-chat.html) |
| **Amazon Bedrock Converse** | Spring AI support for Amazon Bedrock Converse. | [docs](https://docs.spring.io/spring-ai/reference/api/bedrock-converse.html) |
| **Amazon Bedrock Knowledge Base** | Spring AI vector database support for Amazon Bedrock Knowledge Base. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/bedrock-knowledgebase.html) |
| **DeepSeek** | Spring AI support for DeepSeek AI models. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/deepseek-chat.html) |
| **ElevenLabs** | Spring AI support for ElevenLabs text-to-speech models. | [docs](https://docs.spring.io/spring-ai/reference/api/speech/elevenlabs-speech.html) |
| **Google GenAI** | Spring AI support for Google GenAI (Gemini) models. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/google-genai-chat.html) |
| **Google GenAI Embeddings** | Spring AI support for Google GenAI embedding models. | [docs](https://docs.spring.io/spring-ai/reference/api/embeddings/google-genai-embeddings.html) |
| **HuggingFace** | Spring AI support for HuggingFace AI models. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/huggingface.html) |
| **MiniMax** | Spring AI support for MiniMax AI models. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/minimax-chat.html) |
| **OCI GenAI** | Spring AI support for Oracle Cloud Infrastructure (OCI) GenAI models. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/oci-genai-chat.html) |
| **ZhipuAI** | Spring AI support for ZhipuAI models. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/zhipuai-chat.html) |
| **Apache Cassandra Vector Database** | Spring AI vector database support for Apache Cassandra. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/apache-cassandra.html) |
| **Chroma Vector Database** | Spring AI vector database support for Chroma. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/chroma.html) |
| **Couchbase Vector Database** | Spring AI vector database support for Couchbase. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/couchbase.html) |
| **Elasticsearch Vector Database** | Spring AI vector database support for Elasticsearch. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/elasticsearch.html) |
| **GemFire Vector Database** | Spring AI vector database support for GemFire. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/gemfire.html) |
| **Model Context Protocol Server** | Spring AI support for Model Context Protocol (MCP) servers. | [docs](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-server-boot-starter-docs.html) |
| **Model Context Protocol Client** | Spring AI support for Model Context Protocol (MCP) clients. | [docs](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-client-boot-starter-docs.html) |
| **Model Context Protocol Security [Experimental]** | Provides security for Spring AI's MCP server and client, and for the OAuth2 Authorization Server. | [docs](https://github.com/spring-ai-community/mcp-security?tab=readme-ov-file#mcp-security) |
| **Milvus Vector Database** | Spring AI vector database support for Milvus. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/milvus.html) |
| **Mistral AI** | Spring AI support for Mistral AI, the open and portable generative AI for devs and businesses. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/mistralai-chat.html) |
| **MongoDB Atlas Vector Database** | Spring AI vector database support for MongoDB Atlas. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/mongodb.html) |
| **Neo4j Vector Database** | Spring AI vector database support for Neo4j's Vector Search. It allows users to query vector embeddings from large datasets. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/neo4j.html) |
| **OpenSearch Vector Database** | Spring AI vector database support for OpenSearch. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/opensearch.html) |
| **AWS OpenSearch Vector Database** | Spring AI vector database support for AWS OpenSearch Service. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/opensearch.html) |
| **Ollama** | Spring AI support for Ollama. It allows you to run various Large Language Models (LLMs) locally and generate text from them. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/ollama-chat.html) |
| **OpenAI** | Spring AI support for ChatGPT, the AI language model and DALL-E, the Image generation model from OpenAI. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/openai-chat.html) |
| **OpenAI SDK** | Spring AI support for OpenAI using the official OpenAI SDK. Alternative implementation with enhanced features and compatibility. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/openai-sdk-chat.html) |
| **In-memory Chat Memory Repository** | Spring AI support for in-memory chat memory repository. | [docs](https://docs.spring.io/spring-ai/reference/api/chat-memory.html) |
| **JDBC Chat Memory Repository** | Spring AI support for JDBC based chat memory. | [docs](https://docs.spring.io/spring-ai/reference/api/chat-memory.html) |
| **Cassandra Chat Memory Repository** | Spring AI support for Cassandra based chat memory. | [docs](https://docs.spring.io/spring-ai/reference/api/chat-memory.html) |
| **MongoDB Chat Memory Repository** | Spring AI support for MongoDB based chat memory. | [docs](https://docs.spring.io/spring-ai/reference/api/chat-memory.html) |
| **Neo4j Chat Memory Repository** | Spring AI support for Neo4j based chat memory. | [docs](https://docs.spring.io/spring-ai/reference/api/chat-memory.html) |
| **Azure Cosmos DB Chat Memory Repository** | Spring AI support for Azure Cosmos DB based chat memory. | [docs](https://docs.spring.io/spring-ai/reference/api/chat-memory.html) |
| **Redis Chat Memory Repository** | Spring AI support for Redis based chat memory. | [docs](https://docs.spring.io/spring-ai/reference/api/chat-memory.html) |
| **Oracle Vector Database** | Spring AI vector database support for Oracle. Enables storing, indexing and searching vector embeddings in Oracle Database 23ai. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/oracle.html) |
| **PGvector Vector Database** | Spring AI vector database support for PGvector. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/pgvector.html) |
| **Pinecone Vector Database** | Spring AI vector database support for Pinecone. It is a popular cloud-based vector database and allows you to store and search vectors efficiently. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/pinecone.html) |
| **PostgresML** | Spring AI support for the PostgresML text embeddings models. | [docs](https://docs.spring.io/spring-ai/reference/api/embeddings/postgresml-embeddings.html) |
| **Redis Search and Query Vector Database** | Spring AI vector database support for Redis Search and Query. It extends the core features of Redis OSS and allows you to use Redis as a vector database. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/redis.html) |
| **S3 Vector Database** | Spring AI vector database support for AWS S3. Store and retrieve vector embeddings using Amazon S3 object storage with efficient search capabilities. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/s3.html) |
| **MariaDB Vector Database** | Spring AI support for MariaDB. MariaDB Vector Store support is part of MariaDB 11.7. It provides efficient vector similarity search capabilities using vector indexes, supporting both cosine similarity and Euclidean distance metrics. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/mariadb.html) |
| **Azure Cosmos DB Vector Store** | Spring AI support for Azure Cosmos DB. Azure Cosmos DB is Microsoft’s globally distributed cloud-native database service designed for mission-critical applications. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/azure-cosmos-db.html) |
| **Stability AI** | Spring AI support for Stability AI's text to image generation model. | [docs](https://docs.spring.io/spring-ai/reference/api/image/stabilityai-image.html) |
| **Transformers (ONNX) Embeddings** | Spring AI support for pre-trained transformer models, serialized into the Open Neural Network Exchange (ONNX) format. | [docs](https://docs.spring.io/spring-ai/reference/api/embeddings/onnx.html) |
| **Vertex AI Gemini** | Spring AI support for Google Vertex Gemini chat. Doesn't support embeddings. | [docs](https://docs.spring.io/spring-ai/reference/api/chat/vertexai-gemini-chat.html) |
| **Vertex AI Embeddings** | Spring AI support for Google Vertex text and multimodal embedding models. | [docs](https://docs.spring.io/spring-ai/reference/api/embeddings/vertexai-embeddings-text.html) |
| **Qdrant Vector Database** | Spring AI vector database support for Qdrant. It is an open-source, high-performance vector search engine/database. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/qdrant.html) |
| **Typesense Vector Database** | Spring AI vector database support for Typesense. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/typesense.html) |
| **Weaviate Vector Database** | Spring AI vector database support for Weaviate, an open-source vector database. | [docs](https://docs.spring.io/spring-ai/reference/api/vectordbs/weaviate.html) |
| **Markdown Document Reader** | Spring AI Markdown document reader. It allows to load Markdown documents, converting them into a list of Spring AI Document objects. | [docs](https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html#_markdown) |
| **Tika Document Reader** | Spring AI Tika document reader. It uses Apache Tika to extract text from a variety of document formats, such as PDF, DOC/DOCX, PPT/PPTX, and HTML. The documents are converted into a list of Spring AI Document objects. | [docs](https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html#_tika_docx_pptx_html) |
| **PDF Document Reader** | Spring AI PDF document reader. It uses Apache PdfBox to extract text from PDF documents and converting them into a list of Spring AI Document objects. | [docs](https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html#_pdf_page) |
| **JSoup Document Reader** | Spring AI HTML document reader using JSoup. It parses HTML documents and converts them into a list of Spring AI Document objects. | [docs](https://docs.spring.io/spring-ai/reference/api/etl-pipeline.html) |
| **Timefold Solver** | AI solver to optimize operations and scheduling. | [docs](https://timefold.ai/docs/timefold-solver/latest/quickstart/spring-boot/spring-boot-quickstart#springBootJavaQuickStart) |

---

## 5. Node.js / TypeScript Ecosystem — Full Option Reference (NestJS & Next.js)

The Node.js/TypeScript side of the canvas spans two catalogs: NestJS for backend services (5.1) and Next.js App Router for full-stack frontends (5.2). Both are rendered below from their respective data files.
### 5.1. NestJS Enterprise Modules — Full Option Reference (`nestjs`)

Source: the official NestJS documentation navigation at [docs.nestjs.com](https://docs.nestjs.com), mirrored in `src/pages/canvas/data/nestCatalog.ts`. **12 categories, 93 options** (88 top-level + 5 nested suboptions). Every row links to a real official docs page.

#### 5.1.A Core Architecture (20 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Modules** | Organize the application into cohesive feature modules with explicit imports and exports. | [docs](https://docs.nestjs.com/modules) |
| **Controllers** | Route incoming HTTP requests to handler methods with decorators like @Get and @Post. | [docs](https://docs.nestjs.com/controllers) |
| **Providers & Dependency Injection** | Injectable services wired through the built-in constructor-based DI container. | [docs](https://docs.nestjs.com/providers) |
| **Middleware** | Run request/response logic (logging, auth pre-checks) before route handlers execute. | [docs](https://docs.nestjs.com/middleware) |
| **Exception Filters** | Centralize error handling and shape error responses for thrown exceptions. | [docs](https://docs.nestjs.com/exception-filters) |
| **Pipes** | Transform and validate handler input, including the built-in ValidationPipe. | [docs](https://docs.nestjs.com/pipes) |
| **Guards** | Decide per-request whether a handler may run; the canonical place for authorization. | [docs](https://docs.nestjs.com/guards) |
| **Interceptors** | Wrap handler execution to add logging, response mapping, timeouts, or caching. | [docs](https://docs.nestjs.com/interceptors) |
| **Custom Route Decorators** | Build reusable parameter and metadata decorators such as @CurrentUser(). | [docs](https://docs.nestjs.com/custom-decorators) |
| **Custom Providers** | Register value, factory, class, and alias providers for full control over DI tokens. | [docs](https://docs.nestjs.com/fundamentals/custom-providers) |
| **Async Providers** | Defer provider creation until async setup (e.g. a database connection) completes. | [docs](https://docs.nestjs.com/fundamentals/async-providers) |
| **Dynamic Modules** | Build configurable modules exposing forRoot/forRootAsync/register factory APIs. | [docs](https://docs.nestjs.com/fundamentals/dynamic-modules) |
| **Injection Scopes** | Choose singleton, request-scoped, or transient provider lifetimes. | [docs](https://docs.nestjs.com/fundamentals/injection-scopes) |
| **Lazy-Loading Modules** | Load modules on demand with LazyModuleLoader to cut serverless cold-start time. | [docs](https://docs.nestjs.com/fundamentals/lazy-loading-modules) |
| **Lifecycle Events** | Hook OnModuleInit/OnApplicationShutdown for startup work and graceful shutdown. | [docs](https://docs.nestjs.com/fundamentals/lifecycle-events) |
| **Execution Context** | Inspect the current HTTP/RPC/WS context and read metadata with Reflector. | [docs](https://docs.nestjs.com/fundamentals/execution-context) |
| **ModuleRef** | Resolve providers dynamically at runtime from the injection container. | [docs](https://docs.nestjs.com/fundamentals/module-ref) |
| **Circular Dependency Handling** | Break provider/module cycles with forwardRef() when refactoring is not possible. | [docs](https://docs.nestjs.com/fundamentals/circular-dependency) |
| **DiscoveryService** | Enumerate providers, controllers, and metadata at runtime to build plugin systems. | [docs](https://docs.nestjs.com/fundamentals/discovery-service) |
| **Standalone Applications** | Use the Nest DI container without an HTTP listener for CLIs and workers. | [docs](https://docs.nestjs.com/standalone-applications) |

#### 5.1.B API & Documentation (14 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **@nestjs/swagger (OpenAPI)** | Generate an OpenAPI document and Swagger UI directly from decorators and DTOs. | [docs](https://docs.nestjs.com/openapi/introduction) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Types & Parameters | Annotate DTO properties with @ApiProperty for accurate schema generation. | [docs](https://docs.nestjs.com/openapi/types-and-parameters) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Operations | Document tags, responses, headers, and file upload endpoints per operation. | [docs](https://docs.nestjs.com/openapi/operations) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ OpenAPI Security Schemes | Declare bearer, basic, OAuth2, cookie, and API-key auth in the generated spec. | [docs](https://docs.nestjs.com/openapi/security) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Mapped Types | Derive PartialType/PickType/OmitType/IntersectionType variants of DTOs. | [docs](https://docs.nestjs.com/openapi/mapped-types) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Swagger CLI Plugin | Compiler plugin that infers @ApiProperty metadata to remove decorator boilerplate. | [docs](https://docs.nestjs.com/openapi/cli-plugin) |
| **API Versioning** | Version endpoints via URI, header, media type, or custom strategy. | [docs](https://docs.nestjs.com/techniques/versioning) |
| **@nestjs/throttler (Rate Limiting)** | Protect endpoints from brute force with configurable TTL/limit throttling guards. | [docs](https://docs.nestjs.com/security/rate-limiting) |
| **Serialization** | Shape responses with class-transformer, excluding or exposing fields per DTO. | [docs](https://docs.nestjs.com/techniques/serialization) |
| **@nestjs/axios HTTP Module** | Call external services with the Axios-based HttpService wrapped in Observables. | [docs](https://docs.nestjs.com/techniques/http-module) |
| **MVC Templating** | Server-render views with template engines like Handlebars for classic MVC apps. | [docs](https://docs.nestjs.com/techniques/mvc) |
| **Serve Static Assets** | Serve SPA bundles or static files with @nestjs/serve-static. | [docs](https://docs.nestjs.com/recipes/serve-static) |
| **Compodoc Documentation** | Generate a browsable project documentation site from the Nest source tree. | [docs](https://docs.nestjs.com/recipes/documentation) |
| **CRUD Generator** | Scaffold a resource (module, controller, service, DTOs, tests) with one CLI command. | [docs](https://docs.nestjs.com/recipes/crud-generator) |

#### 5.1.C GraphQL (8 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **@nestjs/graphql (Apollo / Mercurius)** | Code-first or schema-first GraphQL server on Apollo or Mercurius drivers. | [docs](https://docs.nestjs.com/graphql/quick-start) |
| **Resolvers** | Define queries and field resolvers with @Resolver/@Query/@ResolveField decorators. | [docs](https://docs.nestjs.com/graphql/resolvers) |
| **Mutations** | Model write operations with @Mutation and typed input objects. | [docs](https://docs.nestjs.com/graphql/mutations) |
| **Subscriptions** | Push realtime GraphQL events over WebSockets using PubSub. | [docs](https://docs.nestjs.com/graphql/subscriptions) |
| **Apollo Federation** | Compose a supergraph from multiple subgraph services for distributed GraphQL. | [docs](https://docs.nestjs.com/graphql/federation) |
| **Query Complexity** | Reject overly expensive queries by scoring fields with complexity estimators. | [docs](https://docs.nestjs.com/graphql/complexity) |
| **Field Middleware** | Intercept individual field resolution to transform results or enforce field-level rules. | [docs](https://docs.nestjs.com/graphql/field-middleware) |
| **GraphQL CLI Plugin** | Compiler plugin that auto-annotates classes to reduce code-first boilerplate. | [docs](https://docs.nestjs.com/graphql/cli-plugin) |

#### 5.1.D Security & Identity (9 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Authentication (@nestjs/jwt)** | Official JWT-based authentication flow: validate credentials, sign and verify tokens. | [docs](https://docs.nestjs.com/security/authentication) |
| **@nestjs/passport Strategies** | Integrate Passport strategies (local, JWT, OAuth providers) behind AuthGuard. | [docs](https://docs.nestjs.com/recipes/passport) |
| **Authorization (RBAC / CASL)** | Enforce role- and claims-based access, including CASL ability-based policies. | [docs](https://docs.nestjs.com/security/authorization) |
| **Encryption & Hashing** | Encrypt payloads with Node crypto and hash passwords with bcrypt or argon2. | [docs](https://docs.nestjs.com/security/encryption-and-hashing) |
| **Helmet Security Headers** | Set protective HTTP headers (CSP, HSTS, etc.) via the helmet middleware. | [docs](https://docs.nestjs.com/security/helmet) |
| **CORS** | Configure cross-origin resource sharing with enableCors options. | [docs](https://docs.nestjs.com/security/cors) |
| **CSRF Protection** | Mitigate cross-site request forgery for cookie/session-based apps. | [docs](https://docs.nestjs.com/security/csrf) |
| **Sessions** | Persist user state across requests with express-session or @fastify/secure-session. | [docs](https://docs.nestjs.com/techniques/session) |
| **Cookies** | Read and set cookies with cookie-parser or @fastify/cookie. | [docs](https://docs.nestjs.com/techniques/cookies) |

#### 5.1.E Persistence & Databases (5 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **@nestjs/typeorm (TypeORM)** | First-party TypeORM integration for PostgreSQL, MySQL, and other SQL databases. | [docs](https://docs.nestjs.com/techniques/database) |
| **@nestjs/sequelize (Sequelize)** | Promise-based Sequelize ORM integration with decorated model classes. | [docs](https://docs.nestjs.com/recipes/sql-sequelize) |
| **@nestjs/mongoose (MongoDB)** | Schema-based MongoDB object modeling through the official Mongoose module. | [docs](https://docs.nestjs.com/techniques/mongodb) |
| **Prisma** | Type-safe database client with generated types, integrated via a PrismaService. | [docs](https://docs.nestjs.com/recipes/prisma) |
| **MikroORM** | Unit-of-work TypeScript ORM integrated through @mikro-orm/nestjs. | [docs](https://docs.nestjs.com/recipes/mikroorm) |

#### 5.1.F Microservices & Transports (8 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Microservices Overview** | Message- and event-based services with request-response and event patterns. | [docs](https://docs.nestjs.com/microservices/basics) |
| **Kafka Transport** | High-throughput event streaming transport built on kafkajs. | [docs](https://docs.nestjs.com/microservices/kafka) |
| **RabbitMQ Transport** | AMQP message broker transport with queues, acks, and routing options. | [docs](https://docs.nestjs.com/microservices/rabbitmq) |
| **Redis Transport** | Publish/subscribe messaging over Redis channels for lightweight service links. | [docs](https://docs.nestjs.com/microservices/redis) |
| **NATS Transport** | Subject-based messaging with queue groups for load-balanced NATS consumers. | [docs](https://docs.nestjs.com/microservices/nats) |
| **MQTT Transport** | Lightweight pub/sub transport suited to IoT and constrained networks. | [docs](https://docs.nestjs.com/microservices/mqtt) |
| **gRPC Transport** | Contract-first RPC over HTTP/2 with Protocol Buffers definitions. | [docs](https://docs.nestjs.com/microservices/grpc) |
| **Custom Transporters** | Implement a bespoke transport strategy (e.g. Google Cloud Pub/Sub) for microservices. | [docs](https://docs.nestjs.com/microservices/custom-transport) |

#### 5.1.G Background Jobs & Events (4 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **@nestjs/bullmq (Queues)** | Redis-backed BullMQ task queues with concurrency control, retries, and schedulers. | [docs](https://docs.nestjs.com/techniques/queues) |
| **@nestjs/schedule** | Declarative cron jobs, intervals, and timeouts with the @Cron decorator. | [docs](https://docs.nestjs.com/techniques/task-scheduling) |
| **@nestjs/event-emitter** | In-process domain events with @OnEvent listeners for decoupled modules. | [docs](https://docs.nestjs.com/techniques/events) |
| **@nestjs/cqrs** | Commands, queries, events, and sagas for CQRS/event-sourced architectures. | [docs](https://docs.nestjs.com/recipes/cqrs) |

#### 5.1.H Realtime & Streaming (5 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **WebSocket Gateways** | Realtime gateways with @WebSocketGateway on socket.io or ws platforms. | [docs](https://docs.nestjs.com/websockets/gateways) |
| **WebSocket Adapters** | Swap the socket engine (socket.io, ws, or a Redis-propagated custom adapter). | [docs](https://docs.nestjs.com/websockets/adapter) |
| **Server-Sent Events** | Push one-way realtime updates over HTTP with the @Sse decorator. | [docs](https://docs.nestjs.com/techniques/server-sent-events) |
| **Streaming Files** | Return StreamableFile responses for efficient large-file downloads. | [docs](https://docs.nestjs.com/techniques/streaming-files) |
| **File Upload (Multer)** | Handle multipart/form-data uploads with FileInterceptor and Multer. | [docs](https://docs.nestjs.com/techniques/file-upload) |

#### 5.1.I Configuration & Validation (2 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **@nestjs/config** | Load and validate environment configuration with namespaced, typed ConfigService. | [docs](https://docs.nestjs.com/techniques/configuration) |
| **ValidationPipe (class-validator)** | Decorator-based DTO validation and transformation via the global ValidationPipe. | [docs](https://docs.nestjs.com/techniques/validation) |

#### 5.1.J Caching & Performance (4 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **@nestjs/cache-manager** | In-memory or Redis (Keyv) response and data caching with CacheInterceptor. | [docs](https://docs.nestjs.com/techniques/caching) |
| **Compression** | Shrink response payloads with gzip/brotli compression middleware. | [docs](https://docs.nestjs.com/techniques/compression) |
| **Fastify Platform** | Swap Express for Fastify to roughly double raw HTTP throughput. | [docs](https://docs.nestjs.com/techniques/performance) |
| **SWC Builder** | Compile and test with SWC for roughly 20x faster builds than the default tsc. | [docs](https://docs.nestjs.com/recipes/swc) |

#### 5.1.K Observability & Health (5 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **@nestjs/terminus (Healthchecks)** | Readiness/liveness endpoints with database, HTTP, memory, and disk indicators. | [docs](https://docs.nestjs.com/recipes/terminus) |
| **Logger** | Built-in logger service with custom logger and JSON structured logging support. | [docs](https://docs.nestjs.com/techniques/logger) |
| **NestJS Devtools** | Visualize the dependency graph and debug the application with the Devtools platform. | [docs](https://docs.nestjs.com/devtools/overview) |
| **Sentry Integration** | Capture errors and performance traces with the official @sentry/nestjs SDK. | [docs](https://docs.nestjs.com/recipes/sentry) |
| **Async Local Storage** | Propagate per-request context (trace ids, tenants) without parameter drilling. | [docs](https://docs.nestjs.com/recipes/async-local-storage) |

#### 5.1.L Testing & Tooling (9 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Testing (@nestjs/testing)** | Unit and e2e testing with Test.createTestingModule and dependency overrides. | [docs](https://docs.nestjs.com/fundamentals/testing) |
| **Suites (unit testing)** | Auto-mocked solitary/sociable unit tests for DI classes via the Suites framework. | [docs](https://docs.nestjs.com/recipes/suites) |
| **REPL** | Inspect and invoke providers interactively from a terminal REPL session. | [docs](https://docs.nestjs.com/recipes/repl) |
| **Hot Reload** | Speed up development feedback with webpack HMR for the application entry. | [docs](https://docs.nestjs.com/recipes/hot-reload) |
| **Nest CLI** | Scaffold, build, and serve projects with the nest command-line interface. | [docs](https://docs.nestjs.com/cli/overview) |
| **Monorepo Mode** | Manage multiple apps and shared libraries in a single CLI workspace. | [docs](https://docs.nestjs.com/cli/monorepo) |
| **nest-commander** | Build full CLI applications with Nest DI on top of Commander. | [docs](https://docs.nestjs.com/recipes/nest-commander) |
| **RouterModule** | Compose hierarchical route prefixes across modules for large HTTP apps. | [docs](https://docs.nestjs.com/recipes/router-module) |
| **Serverless Deployment** | Package the app as a serverless handler and optimize cold starts. | [docs](https://docs.nestjs.com/faq/serverless) |

### 5.2. Next.js App Router Full-Stack — Full Option Reference (`nextjs`)

Source: the official Next.js App Router documentation index at [nextjs.org/docs](https://nextjs.org/docs), plus the official docs of first-class ecosystem libraries (Auth.js, TanStack Query, Tailwind CSS), mirrored in `src/pages/canvas/data/nextCatalog.ts`. **7 categories, 89 options** (all 89 top-level; this catalog has no nested suboptions). Entries marked ⚠ are legacy APIs; the arrow names the recommended successor.

#### 5.2.A Rendering & Server Components (14 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **React Server Components (RSC)** | Render components on the server by default, shipping zero JS for static parts. | [docs](https://nextjs.org/docs/app/getting-started/server-and-client-components) |
| **'use client' Directive** | Mark interactive component subtrees for client-side rendering and hydration. | [docs](https://nextjs.org/docs/app/api-reference/directives/use-client) |
| **Server Actions** | Mutate data with 'use server' functions callable directly from forms and components. | [docs](https://nextjs.org/docs/app/guides/server-actions) |
| **'use server' Directive** | Declare server-only functions that clients invoke as typed RPC endpoints. | [docs](https://nextjs.org/docs/app/api-reference/directives/use-server) |
| **Static Generation (generateStaticParams)** | Pre-render dynamic route segments at build time for SSG pages. | [docs](https://nextjs.org/docs/app/api-reference/functions/generate-static-params) |
| **Incremental Static Regeneration (ISR)** | Update static pages after deployment on a revalidation interval or on demand. | [docs](https://nextjs.org/docs/app/guides/incremental-static-regeneration) |
| **Partial Prerendering (PPR)** | Serve a static shell instantly while streaming dynamic holes in the same response. | [docs](https://nextjs.org/docs/app/guides/ppr-platform-guide) |
| **Streaming with Suspense** | Progressively stream UI as data resolves, wrapped in React Suspense boundaries. | [docs](https://nextjs.org/docs/app/guides/streaming) |
| **loading.js Convention** | Instant loading states per route segment rendered while content streams in. | [docs](https://nextjs.org/docs/app/api-reference/file-conventions/loading) |
| **'use cache' Directive** | Cache a page, component, or function output as part of Cache Components. | [docs](https://nextjs.org/docs/app/api-reference/directives/use-cache) |
| **Cache Components** | Opt into the cacheComponents model where dynamic is default and caching is explicit. | [docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents) |
| **Static Exports** | Export the app as pure static HTML/CSS/JS deployable to any static host. | [docs](https://nextjs.org/docs/app/guides/static-exports) |
| **Single-Page Application Mode** | Build client-heavy SPAs in Next.js while keeping incremental server adoption open. | [docs](https://nextjs.org/docs/app/guides/single-page-applications) |
| **View Transitions** | Animate route and state changes with the View Transitions API integration. | [docs](https://nextjs.org/docs/app/guides/view-transitions) |

#### 5.2.B Routing & Navigation (16 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Layouts & Pages** | File-system routing with nested, shared layouts and per-segment pages. | [docs](https://nextjs.org/docs/app/getting-started/layouts-and-pages) |
| **Linking & Navigating** | Client-side transitions with <Link>, prefetching, and the useRouter API. | [docs](https://nextjs.org/docs/app/getting-started/linking-and-navigating) |
| **Dynamic Route Segments** | Parameterized paths with [slug], catch-all [...slug], and optional variants. | [docs](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes) |
| **Route Groups** | Organize segments with (group) folders without affecting the URL path. | [docs](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) |
| **Parallel Routes** | Render multiple @slot pages simultaneously in one layout (dashboards, modals). | [docs](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes) |
| **Intercepting Routes** | Show a route (e.g. a photo modal) within the current layout while keeping its URL. | [docs](https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes) |
| **Route Handlers (route.ts)** | Build REST-style API endpoints with Web Request/Response in route.ts files. | [docs](https://nextjs.org/docs/app/getting-started/route-handlers) |
| **Proxy (middleware)** | Intercept requests before routing via proxy.ts (the renamed middleware.ts) for rewrites, redirects, and auth checks. | [docs](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) |
| **Error Handling (error.js)** | Segment-level error boundaries with error.js and global-error.js recovery UI. | [docs](https://nextjs.org/docs/app/getting-started/error-handling) |
| **not-found.js Convention** | Custom 404 UI per segment, triggered by the notFound() function. | [docs](https://nextjs.org/docs/app/api-reference/file-conventions/not-found) |
| **template.js Convention** | Layout-like wrapper that remounts on navigation for per-page effects and animations. | [docs](https://nextjs.org/docs/app/api-reference/file-conventions/template) |
| **Redirects** | redirect()/permanentRedirect(), next.config redirects, and proxy-level rules. | [docs](https://nextjs.org/docs/app/guides/redirecting) |
| **Internationalization** | Locale-aware routing and translated content for multi-language sites. | [docs](https://nextjs.org/docs/app/guides/internationalization) |
| **Multi-Zones** | Compose several independent Next.js apps under one domain as micro-frontends. | [docs](https://nextjs.org/docs/app/guides/multi-zones) |
| **Multi-Tenant Apps** | Serve many tenants from one codebase with dynamic hostname-based routing. | [docs](https://nextjs.org/docs/app/guides/multi-tenant) |
| **Typed Routes** | Statically typed links that catch invalid hrefs at compile time. | [docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/typedRoutes) |

#### 5.2.C Data Fetching & Caching (16 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Data Fetching in Server Components** | async/await fetch or ORM calls directly inside Server Components. | [docs](https://nextjs.org/docs/app/getting-started/fetching-data) |
| **Extended fetch API** | fetch with per-request cache and next.revalidate/tags cache controls. | [docs](https://nextjs.org/docs/app/api-reference/functions/fetch) |
| **Caching Layers** | How the request memoization, data cache, and full route cache interact. | [docs](https://nextjs.org/docs/app/getting-started/caching) |
| **Revalidation Strategies** | Time-based and on-demand revalidation of cached data and routes. | [docs](https://nextjs.org/docs/app/getting-started/revalidating) |
| **revalidateTag()** | Purge all cached fetches labeled with a tag on demand (e.g. after a mutation). | [docs](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) |
| **revalidatePath()** | Invalidate the cache for a specific route path on demand. | [docs](https://nextjs.org/docs/app/api-reference/functions/revalidatePath) |
| **updateTag()** | Expire and immediately refresh tagged cache entries within Server Actions. | [docs](https://nextjs.org/docs/app/api-reference/functions/updateTag) |
| **cacheLife()** | Set revalidation profiles (seconds/minutes/hours) for 'use cache' scopes. | [docs](https://nextjs.org/docs/app/api-reference/functions/cacheLife) |
| **cacheTag()** | Tag 'use cache' output so it can be targeted by revalidateTag/updateTag. | [docs](https://nextjs.org/docs/app/api-reference/functions/cacheTag) |
| **unstable_cache()** ⚠ *maintenance* | Cache arbitrary async function results (legacy API superseded by use cache). → *'use cache' directive* | [docs](https://nextjs.org/docs/app/api-reference/functions/unstable_cache) |
| **after()** | Schedule work (logging, analytics) to run after the response has been sent. | [docs](https://nextjs.org/docs/app/api-reference/functions/after) |
| **Draft Mode** | Preview unpublished headless-CMS content by bypassing static rendering. | [docs](https://nextjs.org/docs/app/guides/draft-mode) |
| **Mutating Data** | Server Function mutations with useActionState, validation, and cache updates. | [docs](https://nextjs.org/docs/app/getting-started/mutating-data) |
| **Forms with Server Actions** | Progressive-enhancement forms wired to Server Actions and next/form. | [docs](https://nextjs.org/docs/app/guides/forms) |
| **TanStack Query** | Client-side async state manager for queries/mutations alongside RSC data fetching. | [docs](https://tanstack.com/query/latest) |
| **CDN Caching & Cache-Control** | Tune Cache-Control headers and CDN behavior for statically served output. | [docs](https://nextjs.org/docs/app/guides/cdn-caching) |

#### 5.2.D Styling, Assets & UI (15 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **CSS Modules & Global CSS** | Scoped component styles with .module.css plus global stylesheets. | [docs](https://nextjs.org/docs/app/getting-started/css) |
| **Tailwind CSS** | Utility-first CSS framework; the default styling choice in create-next-app. | [docs](https://tailwindcss.com/docs) |
| **Sass** | Author styles with .scss/.sass including CSS Modules variants. | [docs](https://nextjs.org/docs/app/guides/sass) |
| **CSS-in-JS** | Runtime CSS-in-JS libraries (styled-components, emotion) with App Router setup. | [docs](https://nextjs.org/docs/app/guides/css-in-js) |
| **next/image** | Automatic image optimization: resizing, modern formats, and lazy loading. | [docs](https://nextjs.org/docs/app/api-reference/components/image) |
| **next/font** | Self-hosted, zero-layout-shift font loading for Google and local fonts. | [docs](https://nextjs.org/docs/app/api-reference/components/font) |
| **next/link** | Prefetching client-side navigation component for internal routes. | [docs](https://nextjs.org/docs/app/api-reference/components/link) |
| **next/script** | Load third-party scripts with controlled loading strategies. | [docs](https://nextjs.org/docs/app/api-reference/components/script) |
| **next/form** | HTML form component with prefetching and client-side navigation on submit. | [docs](https://nextjs.org/docs/app/api-reference/components/form) |
| **Metadata & Open Graph Images** | Static and dynamic SEO metadata plus generated OG images per route. | [docs](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) |
| **generateMetadata()** | Compute per-page metadata from route params and fetched data. | [docs](https://nextjs.org/docs/app/api-reference/functions/generate-metadata) |
| **ImageResponse (OG image generation)** | Render JSX to social-card images at the edge with ImageResponse. | [docs](https://nextjs.org/docs/app/api-reference/functions/image-response) |
| **MDX** | Author pages in Markdown with embedded React components via @next/mdx. | [docs](https://nextjs.org/docs/app/guides/mdx) |
| **Lazy Loading (next/dynamic)** | Defer client component and library loading with dynamic imports. | [docs](https://nextjs.org/docs/app/guides/lazy-loading) |
| **JSON-LD Structured Data** | Embed schema.org structured data for rich search results. | [docs](https://nextjs.org/docs/app/guides/json-ld) |

#### 5.2.E Authentication & Security (8 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Authentication Patterns** | Official guidance on sessions, stateless tokens, and the DAL authorization pattern. | [docs](https://nextjs.org/docs/app/guides/authentication) |
| **Auth.js (NextAuth v5)** | Full-featured OAuth/credentials/passkey auth library with first-class Next.js support. | [docs](https://authjs.dev/getting-started) |
| **Data Security & Server Actions** | Keep secrets server-side with data access layers, taint APIs, and action auth checks. | [docs](https://nextjs.org/docs/app/guides/data-security) |
| **Content Security Policy** | Nonce-based CSP headers configured in proxy/middleware for XSS defense. | [docs](https://nextjs.org/docs/app/guides/content-security-policy) |
| **forbidden() (403 flows)** | Render forbidden.js UI when an authenticated user lacks permission. | [docs](https://nextjs.org/docs/app/api-reference/functions/forbidden) |
| **unauthorized() (401 flows)** | Render unauthorized.js UI (e.g. a login prompt) for unauthenticated access. | [docs](https://nextjs.org/docs/app/api-reference/functions/unauthorized) |
| **React Taint APIs** | Mark objects/values so React errors if they would ever be sent to the client. | [docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/taint) |
| **Environment Variables** | Server-only vs NEXT_PUBLIC_ variables loaded from .env files per environment. | [docs](https://nextjs.org/docs/app/guides/environment-variables) |

#### 5.2.F Deployment & Runtime (10 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Deployment Options** | Node.js server, Docker, static export, and platform adapter deployment targets. | [docs](https://nextjs.org/docs/app/getting-started/deploying) |
| **Self-Hosting** | Run Next.js on your own infra with ISR, image optimization, and env config intact. | [docs](https://nextjs.org/docs/app/guides/self-hosting) |
| **Edge Runtime** | Web-standard, V8-isolate runtime for low-latency proxy and route handlers. | [docs](https://nextjs.org/docs/app/api-reference/edge) |
| **runtime Segment Config (nodejs \| edge)** | Choose the Node.js or Edge runtime per route segment. | [docs](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/runtime) |
| **output: standalone** | Emit a minimal traced server bundle ideal for slim Docker images. | [docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) |
| **Turbopack** | Rust-based bundler powering fast dev and production builds. | [docs](https://nextjs.org/docs/app/api-reference/turbopack) |
| **Custom Server** | Embed Next.js in your own Node server for bespoke routing needs. | [docs](https://nextjs.org/docs/app/guides/custom-server) |
| **Deployment Adapters** | Adapter API used by platforms to customize build output and hosting behavior. | [docs](https://nextjs.org/docs/app/api-reference/adapters) |
| **Progressive Web Apps** | Manifest, service worker, and push notification setup for installable PWAs. | [docs](https://nextjs.org/docs/app/guides/progressive-web-apps) |
| **Production Checklist** | Official pre-launch checklist covering performance, security, and caching. | [docs](https://nextjs.org/docs/app/guides/production-checklist) |

#### 5.2.G Observability & Testing (10 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **instrumentation.ts** | Server startup hook for wiring observability SDKs before the app boots. | [docs](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) |
| **instrumentation-client.ts** | Early-running browser hook for client-side analytics and error tracking. | [docs](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client) |
| **OpenTelemetry** | Built-in span instrumentation exported via @vercel/otel or a custom OTel setup. | [docs](https://nextjs.org/docs/app/guides/open-telemetry) |
| **Web Vitals Analytics** | Measure and report Core Web Vitals with the useReportWebVitals hook. | [docs](https://nextjs.org/docs/app/guides/analytics) |
| **useReportWebVitals()** | Hook that surfaces TTFB/FCP/LCP/CLS/INP metrics to your analytics endpoint. | [docs](https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals) |
| **Jest** | Unit and snapshot testing setup with next/jest transform. | [docs](https://nextjs.org/docs/app/guides/testing/jest) |
| **Vitest** | Fast Vite-powered unit testing configured for React components. | [docs](https://nextjs.org/docs/app/guides/testing/vitest) |
| **Playwright** | Cross-browser end-to-end testing of full user flows. | [docs](https://nextjs.org/docs/app/guides/testing/playwright) |
| **Cypress** | E2E and component testing runner integrated with the Next.js dev server. | [docs](https://nextjs.org/docs/app/guides/testing/cypress) |
| **Debugging** | Debug server and client code with VS Code, Chrome DevTools, and source maps. | [docs](https://nextjs.org/docs/app/guides/debugging) |

---

## 6. FastAPI Async & AI Stack — Full Option Reference (`fastapi`)

Source: the official FastAPI documentation navigation at [fastapi.tiangolo.com](https://fastapi.tiangolo.com), plus each ecosystem project's own official docs (SQLAlchemy, Celery, vLLM, LangChain, etc.), mirrored in `src/pages/canvas/data/fastapiCatalog.ts`. **9 categories, 79 options** (73 top-level + 6 nested suboptions). Entries marked ⚠ are in maintenance; the arrow names the recommended successor.

### 6.A Core Framework (24 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Path Operations** | Declare typed endpoints with decorators like @app.get and automatic docs. | [docs](https://fastapi.tiangolo.com/tutorial/first-steps/) |
| **Pydantic v2** | Rust-core data validation and serialization library powering all FastAPI models. | [docs](https://docs.pydantic.dev/latest/) |
| **Request Body Models** | Validate JSON bodies with Pydantic BaseModel classes and get editor completion. | [docs](https://fastapi.tiangolo.com/tutorial/body/) |
| **Query & Path Validations** | Constrain parameters with Query/Path metadata: lengths, regex, numeric bounds. | [docs](https://fastapi.tiangolo.com/tutorial/query-params-str-validations/) |
| **Response Models** | Filter and document output with response_model and return type annotations. | [docs](https://fastapi.tiangolo.com/tutorial/response-model/) |
| **Dependency Injection** | Hierarchical Depends() system for sharing logic, connections, and auth context. | [docs](https://fastapi.tiangolo.com/tutorial/dependencies/) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Classes as Dependencies | Use callable classes for parameterized, typed dependencies. | [docs](https://fastapi.tiangolo.com/tutorial/dependencies/classes-as-dependencies/) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Sub-Dependencies | Compose dependencies that themselves depend on other dependencies. | [docs](https://fastapi.tiangolo.com/tutorial/dependencies/sub-dependencies/) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Global Dependencies | Apply dependencies to every route of the app or an APIRouter. | [docs](https://fastapi.tiangolo.com/tutorial/dependencies/global-dependencies/) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Dependencies with yield | Setup/teardown dependencies (DB sessions) with context-manager semantics. | [docs](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/) |
| **BackgroundTasks** | Run lightweight post-response work in-process without a separate worker. | [docs](https://fastapi.tiangolo.com/tutorial/background-tasks/) |
| **Middleware** | Wrap every request/response with ASGI middleware for timing, headers, etc. | [docs](https://fastapi.tiangolo.com/tutorial/middleware/) |
| **CORS Middleware** | Allow browser origins with CORSMiddleware configuration. | [docs](https://fastapi.tiangolo.com/tutorial/cors/) |
| **APIRouter (Bigger Applications)** | Split large apps into routers with shared prefixes, tags, and dependencies. | [docs](https://fastapi.tiangolo.com/tutorial/bigger-applications/) |
| **Error Handling** | HTTPException, custom exception handlers, and validation error overrides. | [docs](https://fastapi.tiangolo.com/tutorial/handling-errors/) |
| **Lifespan Events** | Startup/shutdown logic (model loading, pools) via the lifespan context manager. | [docs](https://fastapi.tiangolo.com/advanced/events/) |
| **Settings (pydantic-settings)** | Typed environment configuration with BaseSettings and .env support. | [docs](https://fastapi.tiangolo.com/advanced/settings/) |
| **OpenAPI Metadata & Docs UIs** | Automatic OpenAPI 3.1 schema with Swagger UI and ReDoc, plus tags metadata. | [docs](https://fastapi.tiangolo.com/tutorial/metadata/) |
| **Generate SDK Clients** | Produce typed frontend/backend clients from the OpenAPI schema. | [docs](https://fastapi.tiangolo.com/advanced/generate-clients/) |
| **Custom Response Classes** | HTMLResponse, ORJSONResponse, FileResponse, StreamingResponse, and more. | [docs](https://fastapi.tiangolo.com/advanced/custom-response/) |
| **Sub-Applications (Mounts)** | Mount independent FastAPI/ASGI apps under a path prefix. | [docs](https://fastapi.tiangolo.com/advanced/sub-applications/) |
| **File Uploads** | Receive multipart uploads with UploadFile streaming semantics. | [docs](https://fastapi.tiangolo.com/tutorial/request-files/) |
| **Static Files** | Serve static assets with StaticFiles mounts. | [docs](https://fastapi.tiangolo.com/tutorial/static-files/) |
| **GraphQL (Strawberry)** | Mount a GraphQL schema alongside REST routes using Strawberry or other libs. | [docs](https://fastapi.tiangolo.com/how-to/graphql/) |

### 6.B Server & Deployment (9 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **FastAPI CLI** | fastapi dev / fastapi run commands for local dev and production serving. | [docs](https://fastapi.tiangolo.com/fastapi-cli/) |
| **Uvicorn** | The lightning-fast ASGI server that runs FastAPI in dev and production. | [docs](https://www.uvicorn.org/) |
| **Multiple Workers** | Scale across CPU cores with uvicorn --workers or process managers. | [docs](https://fastapi.tiangolo.com/deployment/server-workers/) |
| **Gunicorn (process manager)** | Battle-tested WSGI/process manager usable with uvicorn worker classes. | [docs](https://docs.gunicorn.org/en/stable/) |
| **Docker Containers** | Official container guidance: single-process images behind an orchestrator. | [docs](https://fastapi.tiangolo.com/deployment/docker/) |
| **HTTPS & TLS Termination** | How certificates, SNI, and TLS termination proxies fit around the app. | [docs](https://fastapi.tiangolo.com/deployment/https/) |
| **Deployment Concepts** | Restarts, replication, memory, and previous-steps checklists for production. | [docs](https://fastapi.tiangolo.com/deployment/concepts/) |
| **Cloud Deployment** | Deploy on cloud providers or FastAPI Cloud with minimal configuration. | [docs](https://fastapi.tiangolo.com/deployment/cloud/) |
| **Behind a Proxy** | root_path handling when serving under path prefixes via reverse proxies. | [docs](https://fastapi.tiangolo.com/advanced/behind-a-proxy/) |

### 6.C Persistence & Databases (9 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **SQLModel** | Official companion ORM combining Pydantic models with SQLAlchemy tables. | [docs](https://fastapi.tiangolo.com/tutorial/sql-databases/) |
| **SQLModel Documentation** | Full SQLModel docs: relationships, indexes, and FastAPI integration patterns. | [docs](https://sqlmodel.tiangolo.com/) |
| **SQLAlchemy 2.0 AsyncEngine** | Async ORM sessions and engines via sqlalchemy.ext.asyncio for non-blocking DB IO. | [docs](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html) |
| **asyncpg** | High-performance asyncio PostgreSQL driver used under SQLAlchemy async. | [docs](https://magicstack.github.io/asyncpg/current/) |
| **Alembic Migrations** | Versioned schema migrations for SQLAlchemy/SQLModel metadata. | [docs](https://alembic.sqlalchemy.org/en/latest/) |
| **Tortoise ORM** | Django-inspired asyncio ORM with a familiar queryset API. | [docs](https://tortoise.github.io/) |
| **Motor (async MongoDB)** | Coroutine-based MongoDB driver for asyncio applications. | [docs](https://motor.readthedocs.io/en/stable/) |
| **Beanie ODM** | Async MongoDB object-document mapper built on Motor and Pydantic. | [docs](https://beanie-odm.dev/) |
| **Testing a Database** | Official recipe for overriding DB dependencies in tests. | [docs](https://fastapi.tiangolo.com/how-to/testing-database/) |

### 6.D Auth & Security (7 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **OAuth2 Security First Steps** | Wire OAuth2PasswordBearer so docs UI gets an Authorize button. | [docs](https://fastapi.tiangolo.com/tutorial/security/first-steps/) |
| **Current User Dependency** | Resolve the authenticated user via a reusable Depends chain. | [docs](https://fastapi.tiangolo.com/tutorial/security/get-current-user/) |
| **OAuth2 Password Flow** | Token endpoint with form-encoded username/password per the OAuth2 spec. | [docs](https://fastapi.tiangolo.com/tutorial/security/simple-oauth2/) |
| **JWT Bearer Tokens** | Sign and verify JWT access tokens with expiry and hashed passwords. | [docs](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) |
| **OAuth2 Scopes** | Fine-grained per-endpoint permissions with SecurityScopes. | [docs](https://fastapi.tiangolo.com/advanced/security/oauth2-scopes/) |
| **HTTP Basic Auth** | Simple credential auth with timing-attack-safe comparison. | [docs](https://fastapi.tiangolo.com/advanced/security/http-basic-auth/) |
| **API Keys (header/query/cookie)** | APIKeyHeader/APIKeyQuery/APIKeyCookie security schemes from fastapi.security. | [docs](https://fastapi.tiangolo.com/reference/security/) |

### 6.E Background Jobs & Messaging (5 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **Celery** | Distributed task queue for heavy, retryable jobs beyond BackgroundTasks. | [docs](https://docs.celeryq.dev/en/stable/) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ Redis Broker/Backend | Use Redis as the Celery message broker and result backend. | [docs](https://redis.io/docs/latest/) |
| &nbsp;&nbsp;&nbsp;&nbsp;↳ RabbitMQ Broker | AMQP broker option for Celery with robust routing and acknowledgements. | [docs](https://www.rabbitmq.com/docs) |
| **ARQ** | Asyncio-native Redis job queue from the Pydantic author; fits async FastAPI apps. | [docs](https://arq-docs.helpmanual.io/) |
| **Dramatiq** | Simple, reliable task processing over RabbitMQ or Redis with sane defaults. | [docs](https://dramatiq.io/) |

### 6.F WebSockets & Streaming (5 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **WebSockets** | Bidirectional realtime endpoints with @app.websocket and dependencies. | [docs](https://fastapi.tiangolo.com/advanced/websockets/) |
| **Server-Sent Events** | One-way event streams over HTTP for live updates and LLM token streaming. | [docs](https://fastapi.tiangolo.com/tutorial/server-sent-events/) |
| **Streaming JSON Lines** | Stream newline-delimited JSON responses for incremental results. | [docs](https://fastapi.tiangolo.com/tutorial/stream-json-lines/) |
| **StreamingResponse** | Stream large or generated payloads without buffering in memory. | [docs](https://fastapi.tiangolo.com/advanced/stream-data/) |
| **Testing WebSockets** | Exercise websocket endpoints with TestClient context managers. | [docs](https://fastapi.tiangolo.com/advanced/testing-websockets/) |

### 6.G Observability (4 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **prometheus-fastapi-instrumentator** | Expose /metrics with request count, latency, and size Prometheus metrics. | [docs](https://github.com/trallnag/prometheus-fastapi-instrumentator) |
| **OpenTelemetry FastAPI Instrumentation** | Auto-instrument request traces via opentelemetry-instrumentation-fastapi. | [docs](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/fastapi/fastapi.html) |
| **OpenTelemetry Python SDK** | Traces, metrics, and logs exported to any OTLP-compatible backend. | [docs](https://opentelemetry.io/docs/languages/python/) |
| **Sentry FastAPI Integration** | Error monitoring and performance tracing with the official sentry-sdk integration. | [docs](https://docs.sentry.io/platforms/python/integrations/fastapi/) |

### 6.H Testing (6 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **TestClient** | Synchronous httpx-based client for testing endpoints without a server. | [docs](https://fastapi.tiangolo.com/tutorial/testing/) |
| **Async Tests** | Test with httpx.AsyncClient and anyio for async DB calls inside tests. | [docs](https://fastapi.tiangolo.com/advanced/async-tests/) |
| **Dependency Overrides** | Swap real dependencies for fakes with app.dependency_overrides. | [docs](https://fastapi.tiangolo.com/advanced/testing-dependencies/) |
| **Testing Lifespan Events** | Ensure startup/shutdown handlers run in tests via the client context manager. | [docs](https://fastapi.tiangolo.com/advanced/testing-events/) |
| **pytest** | The standard Python test runner used throughout FastAPI documentation. | [docs](https://docs.pytest.org/en/stable/) |
| **HTTPX** | Sync/async HTTP client underlying TestClient; also for outbound service calls. | [docs](https://www.python-httpx.org/) |

### 6.I AI & LLM Integration (10 options)

| Option | What it does | Docs |
| --- | --- | --- |
| **LangChain** | Framework for LLM apps: chains, agents, tool calling, and RAG pipelines. | [docs](https://docs.langchain.com/oss/python/langchain/overview) |
| **LlamaIndex** | Data framework for indexing and querying structured/unstructured data with LLMs. | [docs](https://developers.llamaindex.ai/python/framework/) |
| **ONNX Runtime** | Cross-platform accelerator for serving exported ML models with low latency. | [docs](https://onnxruntime.ai/docs/) |
| **PyTorch** | Deep learning framework for in-process model inference inside endpoints. | [docs](https://docs.pytorch.org/docs/stable/index.html) |
| **TorchServe** ⚠ *maintenance* | PyTorch model serving with management/inference APIs; now in limited maintenance. → *vLLM* | [docs](https://docs.pytorch.org/serve/) |
| **vLLM** | High-throughput LLM inference engine with PagedAttention and OpenAI-style API. | [docs](https://docs.vllm.ai/) |
| **Hugging Face Transformers** | Pretrained model pipelines for text, vision, and audio inference. | [docs](https://huggingface.co/docs/transformers/index) |
| **pgvector** | PostgreSQL extension adding vector types and similarity search for embeddings. | [docs](https://github.com/pgvector/pgvector) |
| **Qdrant** | High-performance vector database with a first-party async Python client. | [docs](https://qdrant.tech/documentation/) |
| **Chroma** | Open-source embedding database for quick RAG prototypes and local dev. | [docs](https://docs.trychroma.com/) |

---

## 7. Implementation Plan (Code Changes)

**Status update (2026-07-12):** The exhaustive framework option catalogs are **DONE** — they now exist as typed, lazy-loadable data in `src/pages/canvas/data/` (`catalogTypes.ts`, `springCatalog.ts`, `nestCatalog.ts`, `nextCatalog.ts`, `fastapiCatalog.ts`), and sections 4–6 of this document are generated from that data. The inspector/palette UI wiring (steps 1 and 2 below) is **IN PROGRESS** by a parallel agent.

1. **Add Control Flow Nodes to `src/pages/canvas/components/NodePalette.tsx`:** *(IN PROGRESS — parallel agent)*
   - Add `'Control Flow / Sagas'` to `CategoryName` type union
   - Add 4 nodes with lucide icons (`GitBranch`, `Repeat`, `ShieldAlert`, `GitFork`)
   - Add `'Control Flow / Sagas': true` to `openCategories` default state
2. **Expand `src/pages/canvas/components/EdgeInspector.tsx`:** *(IN PROGRESS — parallel agent)*
   - When a Spring Boot / NestJS / FastAPI node is selected, render expandable accordion groups with nested checkboxes from the catalogs in `src/pages/canvas/data/` *(catalog data itself: DONE)*
3. **Automated Verification:**
   - Add Playwright E2E assertion verifying searching `control` displays the Control Flow / Sagas category
