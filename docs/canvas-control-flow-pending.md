# Architecture Canvas (/canvas) Control Flow & Exhaustive Inspector Plan

## 1. Git Worktree & Subagent Assignment
- **Assigned Role:** `Canvas Control Flow Architect`
- **Git Branch:** `subagent-canvas-control-flow`
- **Worktree Directory:** `.system_generated/worktrees/subagent-canvas-control-flow`
- **Status:** PENDING EXECUTION

---

## 2. User Feedback & Documented Requirements
1. **Control Flow / Decision Gateways:**
   - Searching for `contro` returned no results in `/canvas`.
   - The user requested: *"give decisions control flow like one spring invoke in another spring based on some condition"*.
   - Enterprise architecture requires Decision Diamonds (`ControlFlowGateway`), Saga Orchestrators (`SagaOrchestrator`), Circuit Breakers (`ResilienceGateway`), and Parallel Fork/Join nodes (`ForkJoinGateway`).
2. **Exhaustive Framework Inspector Options:**
   - The user requested: *"why do you always give less options anyhow we will lazy load give more options in each option also check their respective docs websites to get full blown list"*.
   - We must wire the full official `start.spring.io` starters and design pattern catalog (`docs/architecture-options-catalog-pending.md`) into `EdgeInspector.tsx` and node properties.

---

## 3. Detailed Architectural Plan
1. **Add Control Flow Nodes to `src/pages/canvas/components/NodePalette.tsx`:**
   - Add new Category: `'Control Flow / Sagas'`
   - Items:
     - `control-gateway`: Conditional Decision Router (IF/ELSE conditions based on payload predicates)
     - `saga-orchestrator`: Distributed Saga Transaction Coordinator (Compensating Rollbacks)
     - `circuit-breaker`: Resilience4j Circuit Breaker Gateway
     - `fork-join`: Parallel Fan-Out / Fan-In Gateway
2. **Expand `src/pages/canvas/components/EdgeInspector.tsx`:**
   - When a Spring Boot node is selected, render expandable accordion groups covering all official Spring Initializr starters (Web/OpenAPI, Security/OAuth2, SQL JPA/Flyway, Redis/Caffeine, Kafka DLT, Actuator/Prometheus, Design Patterns).
3. **Automated Verification:**
   - Add Playwright E2E assertion verifying that searching `control` in the Node Palette displays the Control Flow / Sagas category and nodes.
