# Piranha Enterprise Exhaustive Architecture & Control Flow Catalog

This document provides the **Full-Blown Official Configuration Catalog** for every architectural node in Piranha (`/canvas`). All options are designed for lazy-loaded accordion groups in the UI so architects can select granular starters, suboptions, and decision control flows.

---

## 1. Decision & Control Flow Architecture (Conditional Gateways & Routing)

In enterprise microservices, services do not communicate over static unconditional pipes. Communication flows through **Decision Gateways, Conditional Guards, Saga Orchestrators, and Circuit Breakers**.

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

## 2. Exhaustive Spring Boot (`start.spring.io`) Official Starters Catalog

Every option below maps to an official Spring Initializr starter dependency and its associated enterprise design patterns.

### A. Project Metadata & Design Patterns
- **Build & JDK:** Maven | Gradle (Groovy/Kotlin), Java 21 LTS | Java 17 LTS
- **Design Pattern Presets:**
  - `Standard Layered Architecture:` Controller → Service → Repository → DTOs
  - `Hexagonal Architecture (Ports & Adapters):` Domain Core decoupled via Inbound/Outbound interfaces
  - `Clean / Onion Architecture:` Zero framework annotations in domain entities
  - `CQRS Pattern:` Command Service (Write Model) + Query Service (Read Model)
  - `Spring Modulith:` Modular Monolith with bounded context isolation

### B. Developer Tools & Core Starters
- `[ ] Spring Boot DevTools` (Hot reload & fast restarts)
- `[ ] Lombok` (Annotation-based boilerplate reduction)
- `[ ] Spring Configuration Processor` (Custom `@ConfigurationProperties` metadata generation)
- `[ ] Spring Modulith` (Architectural verification and event publication registry)

### C. Web & API Starters
- `[ ] Spring Web` (Servlet, Apache Tomcat / Undertow embedded container, REST API)
  - *Suboptions:* `[x] OpenAPI 3 / Swagger UI (springdoc-openapi)`, `[x] Global Exception Handler (@ControllerAdvice)`, `[ ] Content Negotiation (JSON/XML/CBOR)`
- `[ ] Spring Reactive Web (WebFlux)` (Non-blocking Netty server, Reactor streams)
  - *Suboptions:* `[ ] RSocket Streaming Protocol`, `[ ] Server-Sent Events (SSE)`
- `[ ] Spring for GraphQL` (Schema-first SDL engine)
  - *Suboptions:* `[x] GraphiQL Interactive Dev UI`, `[ ] DataLoader N+1 Optimization`
- `[ ] Spring HATEOAS` (Hypermedia-driven REST endpoints)

### D. Security & Identity Starters
- `[ ] Spring Security Core`
  - *Suboptions:* `[x] Stateless JWT Token Auth Filter`, `[ ] Role-Based Method Security (@PreAuthorize)`, `[x] CORS & CSRF Hardening`
- `[ ] OAuth2 Client` (Social / Enterprise OIDC Login: Google, GitHub, Okta, Keycloak)
- `[ ] OAuth2 Resource Server` (JWT Bearer Token verification against JWKS endpoint)
- `[ ] OAuth2 Authorization Server` (Embedded enterprise token issuer)

### E. Relational Databases & SQL Persistence
- **SQL Framework Starters:**
  - `Spring Data JPA (Hibernate)` | `Spring Data JDBC` | `Spring Data R2DBC (Reactive SQL)` | `MyBatis Starter` | `JOOQ Starter`
- **SQL Database Drivers:**
  - `PostgreSQL Driver` | `MySQL Driver` | `MariaDB Driver` | `Microsoft SQL Server Driver` | `Oracle Driver` | `H2 In-Memory`
- **Database Migrations:**
  - `Flyway Migration Starter` | `Liquibase Migration Starter`

### F. NoSQL & In-Memory Persistence
- `[ ] Spring Data Redis (Lettuce / Jedis)`
  - *Suboptions:* `[x] Distributed Session Store`, `[ ] Caffeine Second-Level Cache`
- `[ ] Spring Data MongoDB (Synchronous & Reactive)`
- `[ ] Spring Data Elasticsearch`
- `[ ] Spring Data Neo4j (Graph Database)`
- `[ ] Spring Data Cassandra`

### G. Messaging, Event Streaming & Integrations
- `[ ] Spring for Apache Kafka`
  - *Suboptions:* `[x] Dead Letter Topic (DLT) Retry Consumer`, `[x] Confluent Avro Schema Registry`, `[ ] Kafka Streams API`
- `[ ] Spring for RabbitMQ (AMQP)`
  - *Suboptions:* `[x] Direct / Topic / Fanout Exchanges`, `[ ] Message TTL & Dead-Lettering`
- `[ ] Spring Integration` (Enterprise Integration Patterns: Splitter, Aggregator, Router)
- `[ ] Apache Camel Spring Boot Starter`

### H. Observability, Metrics & DevOps
- `[x] Spring Boot Actuator` (`/actuator/health`, `/actuator/info`, `/actuator/metrics`)
- `[ ] Micrometer Prometheus Registry` (`/actuator/prometheus` scraping endpoint)
- `[ ] OpenTelemetry Distributed Tracing (W3C TraceContext)`
- `[ ] Zipkin / Jaeger Trace Exporter`

### I. Spring Cloud Ecosystem
- `[ ] Spring Cloud Gateway` (API Gateway with reactive routing & rate limiting)
- `[ ] Netflix Eureka Discovery Client`
- `[ ] Consul Service Discovery & Configuration`
- `[ ] Spring Cloud Config Client` (Centralized Git-backed config repo)
- `[ ] OpenFeign Declarative REST Client`

---

## 3. Exhaustive Node.js / TypeScript Ecosystem (NestJS & Next.js)

### A. NestJS Enterprise Modules
- **Core Architecture:** Clean Architecture DI Modules
- **API & Documentation:** `@nestjs/swagger` OpenAPI generator, `@nestjs/throttler` rate limiting
- **Security:** `@nestjs/passport` + `@nestjs/jwt`, Helmet security headers
- **Persistence:** `@nestjs/typeorm` (PostgreSQL/MySQL), `@nestjs/prisma`, `@nestjs/mongoose`
- **Background Processing:** `@nestjs/bullmq` Redis task queue with concurrency control

### B. Next.js 15 App Router Full-Stack
- **Rendering:** Server Components (RSC) + Server Actions, Static Site Generation (SSG)
- **State & Caching:** Next.js `revalidateTag` incremental static revalidation, TanStack Query v5
- **UI Architecture:** Tailwind CSS + Glassmorphism tokens (`ui-ux-pro-max` standard)

---

## 4. Exhaustive Python AI & Microservice Ecosystem (FastAPI)

### A. FastAPI High-Performance Async Stack
- **Core Engine:** Pydantic v2 validation, Uvicorn / Gunicorn ASGI Workers
- **Documentation:** Automated OpenAPI 3.1 & ReDoc schemas
- **Async Persistence:** `SQLAlchemy 2.0 AsyncEngine` + `asyncpg` driver, `Alembic` database migrations
- **Background Tasks:** `Celery` + Redis/RabbitMQ broker, `ARQ` async job scheduler

### B. AI & LLM Inference Integration
- `[ ] LangChain Framework` (RAG pipelines, Vector store retrieval)
- `[ ] LlamaIndex` (Structured data indexing for LLMs)
- `[ ] ONNX Runtime / PyTorch Engine` (Local ML model inference node)
