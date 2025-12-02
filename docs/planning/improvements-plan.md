# Haibun Improvements Plan

This document outlines the strategic roadmap for the next phase of Haibun development. The core philosophy is to create a **transparent, self-revealing system** where a single stream of structured events serves all stakeholders, and where the architecture is simplified by adopting standard interfaces and a robust upper ontology.

## 1. Unified Observability & Message System
**Goal:** Create a transparent, self-revealing system where all "views" are derived from a single, immutable stream of structured messages using generalized `is-a` relationships.

### 1.1. Ontology-Driven Views
Instead of hardcoded "Developer" or "User" logs, views are projections based on the event hierarchy in the Upper Ontology.
-   **Mechanism:** The system emits a linear stream of events. Views **filter** this stream based on abstract types defined in the ontology.
    -   **System User View:** Filters for `SystemUserEvent`. Any event that *is-a* `SystemUserEvent` (e.g., `PatientAdmitted`, `PaymentProcessed`) appears here.
    -   **Debug View:** Filters for `ExecutionEvent`. Includes `TraceEvent`, `StateChange`, and `Error`.
    -   **Machine View:** Consumes the raw stream (`Root` type) for analysis.

### 1.2. Consistent Identifiers
**Critical:** All events and updates must use the same consistent identifiers to reference execution elements.
-   **seqPath:** The `seqPath` (Sequence Path) is the canonical identifier for any step or block in the execution tree.
-   **Message Erasure/Updates:** Updates (like progress bars or status changes) must reference the `seqPath` of the originating step.
    -   *Example:* `UpdateEvent { subject: seqPath(1.2.3), status: "Running" }`

## 2. Architectural Simplification

### 2.1. MCP/JSON-RPC as the Core Interface
**Goal:** Simplify the codebase by making the `Executor` natively speak a standard protocol.
-   **Standard Interface:** The `Executor` implements a JSON-RPC / MCP interface.
-   **Simplification:** CLI, Test Runner, and Agents use this same API.
-   **Rationalized State:** Executor flags are refactored into a typed configuration object passed via RPC.

### 2.2. Static Resolution (Resolve Time)
**Goal:** All steps, including compound statements and activities, must be fully resolved *before* execution begins.
-   **Resolve Phase:** A distinct phase where the parser expands all `activities`, `waypoints`, and compound steps (`whenever`, `anyOf`) into a static execution tree.
-   **Determinism:** This ensures that the entire execution path (including potential branches) is known and validatable before a single step runs.
-   **No "Hidden" Logic:** Activities are not "found" at runtime; they are linked during the resolution phase.

### 2.3. Unified Parsing & Cycles
-   **Unified Parser:** Standardize on a single argument parsing mechanism.
-   **Cycle-Based Lifecycle:** Centralize lifecycle logic in `IStepperCycles`.

## 3. Upper Ontology & Schema Definitions
**Goal:** Enable sophisticated reasoning using `is-a` relationships defined via idiomatic Haibun syntax.

### 3.1. Schema-Driven Variables
We define types using Haibun compound statements and sets, rather than raw JSON.
-   **Definition:**
    ```gherkin
    Define type Sentient Being with property name
    Define type Human is a Sentient Being
    ```
    *(Note: The system automatically generates the underlying IDs and schema)*
-   **Usage:**
    -   Step: `ensure some Sentient Being is present`
    -   Resolution: The system queries the variable store for any object where `type` *is-a* `SentientBeing`. It finds "Dr. Kildare" (Human) because `Human` *is-a* `SentientBeing`.

## 4. Readability and Developer Experience

### 4.1. Human-Readable Steps
**Problem:** Compound statements need to be tied together more clearly without breaking the core parser.
**Solution:** Use `depolite` stopwords and `aliases` to make steps flow like natural language.

#### Examples of Improvements:

**1. Negative Conditions**
*   *Current:* `whenever not variable Privacy status is "Pending"`
*   *Improved:* `whenever it is not that variable "Privacy" status is "Pending"`
*   *Mechanism:*
    *   Stopwords: [it](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/modules/core/src/lib/domain-types.ts#39-40), [is](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/modules/core/src/steps/variables-stepper.ts#41-47), `that`
    *   Core Step remains: `not variable ...` (The [not](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/e2e-tests/tests/features/haibun-overview.feature.not) stepper is functional).
    *   **Aliases:** Use `stepper.aliases` to map [not](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/e2e-tests/tests/features/haibun-overview.feature.not) to `isn't`.
        *   *Result:* `whenever variable "Privacy" status isn't "Pending"`

**2. Ensure Statements**
*   *Current:* `ensure Patient is admitted to "Emergency"`
*   *Improved:* `ensure that the Patient is admitted to "Emergency"`
*   *Mechanism:*
    *   Stopwords: `that`, `the`

**3. Complex Logic**
*   *Current:* `whenever not variable Room 101 status is "Clean", ensure Cleanup Crew is dispatched to Room 101`
*   *Improved:* `whenever it is not that variable "Room 101" status is "Clean", then ensure that the Cleanup Crew is dispatched to Room 101`
*   *Mechanism:*
    *   Stopwords: [it](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/modules/core/src/lib/domain-types.ts#39-40), [is](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/modules/core/src/steps/variables-stepper.ts#41-47), [not](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/e2e-tests/tests/features/haibun-overview.feature.not), `that`, `then`
    *   (Note: [not](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/e2e-tests/tests/features/haibun-overview.feature.not) is preserved as the functional operator).

### 4.2. Self-Description Plan
**Goal:** Haibun should describe itself.
**Plan:**
1.  **Foundation:** Ensure [LogicStepper](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/modules/core/src/steps/logic-stepper.ts#7-153) and [ActivitiesStepper](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/modules/core/src/steps/activities-stepper.ts#24-456) are supported by a core of thoroughly unit-tested code.
2.  **Core Logic Feature:** Create `features/self/logic.feature`.
    -   Scenario: "Testing the `whenever` loop"
    -   Steps: Define a variable, run a `whenever` loop that increments it, verify it stops.
3.  **Activity Feature:** Create `features/self/activities.feature`.
    -   Scenario: "Resolving a waypoint"
    -   Steps: Define an activity in a background, trigger it via `ensure` in the feature, verify the activity ran.
4.  **Execution:** These features become the primary CI gate.

## 5. General Maintenance
-   **Declarative & Deterministic:** Ensure all execution paths are resolvable statically.
-   **Mermaid Diagrams:** Generated from the *resolved* static tree, accurately reflecting all paths.
    -   **Animation:** The diagram view should support animation to visualize the execution flow step-by-step.
-   **Terminology:** Avoid overly generalized terms. Use specific terms like `executionScope`, `schemaDefinition`, and `subject`.
