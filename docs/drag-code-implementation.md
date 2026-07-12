# Drag-Code Implementation Plan

This plan outlines the architecture for adding a "Drag-Code" Visual Architecture Builder to the project.

## Goal Description
Build a fully interactive, drag-and-drop architecture canvas where users can design infrastructure and software topologies (API Gateways, Spring Boot, Databases). The canvas will be hosted on a separate route (`/canvas`) and will be bi-directionally linked to the main Tasks board.

## Proposed Changes

### 1. Dependencies
* **[NEW]** Install `reactflow` (or `@xyflow/react`) via `pnpm` for the core node/edge engine.

### 2. Routing & Navigation
* **[MODIFY]** `src/App.tsx` (or the main React Router file):
  * Add a new top-level route: `<Route path="/canvas" element={<CanvasPage />} />`
* **[MODIFY]** `src/pages/TasksPage.tsx` (Main Board):
  * Add a highly visible button/link in the header: "Architecture Canvas" pointing to `/canvas`.

### 3. Canvas Implementation
* **[NEW]** `src/pages/canvas/CanvasPage.tsx`:
  * The main page container with a full-screen React Flow instance.
  * A "Back to Tasks Board" button fixed in the top-left corner.
* **[NEW]** `src/pages/canvas/components/CustomNodes.tsx`:
  * Define custom, styled nodes for components (e.g., `GatewayNode`, `SpringBootNode`, `DatabaseNode`).
  * Implement nesting (allowing child nodes to be dragged inside parent nodes).
* **[NEW]** `src/pages/canvas/components/InspectorPanel.tsx`:
  * A context-aware left-side panel. When a user clicks a node (e.g., Spring Boot), this panel updates to show specific configuration fields (ConfigServer, Redis, Kafka toggles).

### 4. Integration with Agents (Future Scope / Phase 2)
* **[NEW]** A "Build/Verify" button on the canvas that serializes the React Flow graph into JSON.
* **[NEW]** Send the JSON payload to the orchestrator to generate boilerplate code or verify the architecture against existing code.

## Verification Plan
### Manual Verification
* Navigate to the main board and click the new "Canvas" link.
* Verify the canvas loads on `/canvas`.
* Drag and drop a Spring Boot node onto the canvas.
* Click the node and ensure the left-side inspector panel opens with the correct options.
* Click the "Back to Board" link to verify bidirectional navigation works.
