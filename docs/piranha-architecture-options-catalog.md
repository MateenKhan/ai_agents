# Piranha Enterprise Architecture Configuration Catalog

This catalog defines the **Exhaustive Inspector Options, Nested Sub-Options, and Architectural Design Patterns** for every major node type in the Piranha Architecture Canvas (`/canvas`).

---

## 1. Backend Frameworks

### A. Spring Boot (`start.spring.io` + Java Patterns)
- **Build Tool & JDK:** Maven | Gradle (Kotlin/Groovy), Java 21 LTS | Java 17 LTS
- **Design Pattern Presets:**
  - Standard Layered Service (`Controller -> Service -> Repository -> DTOs`)
  - Hexagonal Architecture (`Domain Core -> Web Ports -> Outbound DB Adapters`)
  - CQRS Command / Query Segregation
- **Web & API:**
  - `[ ] Spring Web (Tomcat/Undertow)` → *Suboptions:* `[x] OpenAPI 3 / Swagger UI`, `[ ] Global Exception Handler`
  - `[ ] Reactive WebFlux (Netty)` → *Suboptions:* `[ ] RSocket Streaming`
  - `[ ] Spring for GraphQL`
- **Security:**
  - `[ ] Spring Security` → *Suboptions:* `[x] Stateless JWT Token Auth`, `[ ] OAuth2 / Keycloak OIDC Resource Server`
- **Persistence & ORM:**
  - ORM: `Spring Data JPA (Hibernate)` | `Spring Data JDBC` | `JOOQ`
  - Migrations: `Flyway` | `Liquibase`
  - Caching: `[ ] Spring Data Redis` → *Suboptions:* `[ ] Caffeine Second-Level Cache`
- **Messaging & Events:**
  - `[ ] Apache Kafka` → *Suboptions:* `[x] Dead Letter Topic (DLT) Consumer`, `[ ] Avro Schema Registry`
  - `[ ] RabbitMQ AMQP` → *Suboptions:* `[ ] Topic / Direct Exchange Binding`
- **Observability:**
  - `[x] Actuator Health & Metrics` → *Suboptions:* `[ ] Prometheus Exporter`, `[ ] OpenTelemetry Tracing`

---

### B. Node.js & Express / NestJS
- **Language & Runtime:** TypeScript 5.x | JavaScript (ESM), Node 22 LTS
- **Design Pattern Presets:**
  - Clean Modular Service (`Routes -> Controllers -> Domain Services -> Repositories`)
  - NestJS Dependency Injection Modules
- **Web & Middleware:**
  - `[x] Express / NestJS Router` → *Suboptions:* `[x] Swagger / OpenAPI Spec`, `[x] Helmet Security & CORS Middleware`, `[ ] Zod Request Validation`
- **Security & Auth:**
  - `[x] JWT / Passport Authentication` → *Suboptions:* `[ ] Role-Based Access Control (RBAC)`, `[ ] OAuth2 Google/GitHub Login`
- **Database ORM:**
  - ORM: `Prisma ORM` | `Drizzle ORM` | `TypeORM`
  - Drivers: `PostgreSQL` | `MySQL` | `SQLite`
- **Queue & Background Jobs:**
  - `[ ] BullMQ Redis Jobs` → *Suboptions:* `[ ] Concurrency Rate Limiter`, `[ ] Failed Job Retries`

---

### C. Python FastAPI / Django
- **Language & Server:** Python 3.12+, Uvicorn Async Server
- **Design Pattern Presets:**
  - Async Pydantic DDD (`Routers -> Schemas -> Async Services -> SQLModel/SQLAlchemy`)
- **API Features:**
  - `[x] Auto OpenAPI / ReDoc Documentation`
  - `[x] Pydantic v2 Type-Safe Validation`
- **Database & Async Persistence:**
  - `SQLAlchemy 2.0 Async` | `SQLModel` | `Tortoise ORM`
  - Migrations: `Alembic Migrations`
- **Background Tasks & AI:**
  - `[ ] Celery Worker Queue` | `[ ] ARQ Async Queue`
  - `[ ] LangChain / LlamaIndex Vector Hook`

---

## 2. Frontend & Full-Stack Web Apps

### A. React & Next.js (App Router)
- **Rendering Strategy:** App Router SSR / Server Components | Static Site Generation (SSG) | Single Page App (Vite React)
- **UI & Styling System:**
  - `[x] UI/UX Pro Max Standard (Tailwind CSS + Glassmorphism)`
  - `[ ] Radix UI Accessibility Primitives`
  - `[ ] Framer Motion Interactive Animations`
- **State & Data Fetching:**
  - `[x] TanStack Query (React Query) v5`
  - `[ ] Zustand Global Client Store`
- **Forms & Validation:**
  - `[x] React Hook Form + Zod Schema Validation`

---

## 3. Databases & Data Stores

### A. PostgreSQL / MySQL Relational DB
- **Deployment Mode:** Managed Cloud DB (AWS RDS / Supabase) | Containerized Docker
- **Enterprise Configuration:**
  - `[ ] PgBouncer Connection Pooler`
  - `[ ] Read-Only Replica Scaling`
  - `[ ] pgvector Extension for AI Vector Search`
  - `[ ] Automated Point-In-Time Daily Backups`

### B. Redis & In-Memory Caching
- **Usage Profile:** Session Store | Distributed Cache | Pub/Sub Message Broker | Job Queue Storage
- **Persistence & Eviction:**
  - Policy: `LRU (Least Recently Used)` | `LFU` | `No Eviction`
  - Persistence: `RDB Snapshots` + `AOF Logging`

---

## 4. Cloud Infrastructure & DevOps

### A. Kubernetes / Docker DevOps
- **Orchestration & Packaging:**
  - `[x] Dockerfile Multi-Stage Optimization`
  - `[ ] Helm Chart Enterprise Templates`
- **Service Mesh & Ingress:**
  - `[ ] Nginx / Traefik Ingress Controller`
  - `[ ] TLS Auto-Cert (Let's Encrypt / Cert-Manager)`
- **Auto-Scaling:**
  - `[ ] Horizontal Pod Autoscaler (HPA - CPU/RAM based)`
