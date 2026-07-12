# Architecture Canvas (/canvas) Control Flow & Exhaustive Inspector Plan

## 1. Problem Statement
- Searching for `contro` or decision flow nodes in `/canvas` returns no results.
- Enterprise architectures require conditional gateways, routing decision diamonds, circuit breakers, and saga orchestration nodes.
- Inspector properties need full nested accordion sub-options corresponding to `start.spring.io` and official starters.

## 2. Proposed Solution
- Add a dedicated **Control Flow / Sagas** palette category:
  - `ControlFlowGateway` (Decision Diamond conditional router)
  - `SagaOrchestrator` (Compensating transactions coordinator)
  - `ResilienceGateway` (Circuit Breaker & retry policies)
  - `ForkJoinGateway` (Parallel fan-out / join)
- Wire `docs/architecture-options-catalog-pending.md` into `EdgeInspector` and node property panels.
