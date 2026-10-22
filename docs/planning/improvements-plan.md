# Haibun Improvements Plan

This document outlines the next stage of Haibun development. The aim is a **transparent system that describes itself**. One stream of structured events supplies every view. Standard interfaces and an upper ontology simplify the architecture.

## 1. Unified Observability & Message System
**Goal:** Derive every view from one immutable stream of structured messages. A view selects messages by generalized `is-a` relationships.

### 1.1. Ontology-Driven Views
Views are projections over the event hierarchy in the Upper Ontology. They replace hardcoded "Developer" and "User" logs.
-   **Mechanism:** The system emits a linear stream of events. Views **filter** this stream by abstract types the ontology defines.
    -   **System User View:** Filters for `SystemUserEvent`. Any event that *is-a* `SystemUserEvent` (e.g., `PatientAdmitted`, `PaymentProcessed`) appears in this view.
    -   **Debug View:** Filters for `ActualityEvent`. `ActualityEvent` includes `TraceEvent`, `StateChange` and `Error`.
    -   **Machine View:** Reads the raw stream (`Root` type) for analysis.

### 1.2. Consistent Identifiers
**Requirement:** All events and updates reference the parts of actuality by the same identifiers.
-   **seqPath:** The `seqPath` (Sequence Path) is the canonical identifier for any step or block in actuality's tree.
-   **Message Erasure/Updates:** Updates (like progress bars or status changes) must reference the `seqPath` of the originating step.
    -   *Example:* `UpdateEvent { subject: seqPath(1.2.3), status: "Running" }`

## 2. Architectural Simplification

### 2.1. MCP/JSON-RPC as the Core Interface
**Goal:** Simplify the codebase by implementing a standard protocol in the `Executor` directly.
-   **Standard Interface:** The `Executor` implements a JSON-RPC / MCP interface.
-   **Simplification:** CLI/Test Runner and Agents use this same API.
-   **Rationalized State:** Executor flags are refactored into a typed configuration object passed via RPC.
-   **Support LSP interface** (for code completion, etc.)

### 2.2. Static Resolution (Resolve Time)
**Goal:** Every step is fully resolved *before* actuality begins. Compound statements and activities are resolved too.
-   **Resolve Phase:** A distinct phase where the parser expands all `activities`, `waypoints`, and compound steps (`whenever`, `anyOf`) into a static tree of steps.
-   **Determinism:** The resolve phase determines every path through the steps before any step runs. The paths include every possible branch and can be validated in advance.
-   **Logic Isn't Hidden:** The resolve phase links activities. Actuality doesn't search for them at runtime.

### 2.3. Unified Parsing & Cycles
-   **Unified Parser:** Use one argument parsing mechanism.
-   **Cycle-Based Lifecycle:** Centralize lifecycle logic in `IStepperCycles`.

## 3. Upper Ontology & Schema Definitions
**Goal:** Reason over `is-a` relationships declared in Haibun step syntax.

### 3.1. Schema-Driven Variables
Types are defined with Haibun compound statements and sets in place of raw JSON.
-   **Definition:**
    ```gherkin
    Define type Sentient Being with property name
    Define type Human is a Sentient Being
    ```
    *(Note: The system generates the IDs and schema automatically.)*
-   **Usage:**
    -   Step: `ensure some Sentient Being is present`
    -   Resolution: The system queries the variable store for any object where `type` *is-a* `SentientBeing`. The query returns "Dr. Kildare" (Human) because `Human` *is-a* `SentientBeing`.

## 4. Readability and Developer Experience

### 4.1. Human-Readable Steps
**Problem:** Compound statements need clearer connecting words. The change must keep the core parser working.
**Solution:** Use `dePolite` stopwords and `aliases` so that steps read as natural language.

#### Examples of Improvements:

**1. Negative Conditions**
*   *Current:* `whenever not variable Privacy status is "Pending"`
*   *Improved:* `whenever it is not that variable "Privacy" status is "Pending"`
*   *Mechanism:*
    *   Stopwords: [it](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/modules/core/src/lib/domain-types.ts#39-40), [is](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/modules/core/src/steps/variables-stepper.ts#41-47), `that`
    *   The core step stays `not variable ...`. The [not](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/e2e-tests/tests/features/haibun-overview.feature.not) step performs the negation.
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
    *   (Note: [not](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/e2e-tests/tests/features/haibun-overview.feature.not) stays the functional operator.)

### 4.2. Self-Description Plan
**Goal:** Haibun should describe itself.
**Plan:**
1.  **Foundation:** Ensure that unit tests cover the core code of [LogicStepper](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/modules/core/src/steps/logic-stepper.ts#7-153) and [ActivitiesStepper](file:///home/vid/Private/D/dev/withhaibun/haibun.zod/modules/core/src/steps/activities-stepper.ts#24-456).
2.  **Core Logic Feature:** Create `features/self/logic.feature`.
    -   Scenario: "Testing the `whenever` loop"
    -   Steps: Define a variable, run a `whenever` loop that increments it, verify it stops.
3.  **Activity Feature:** Create `features/self/activities.feature`.
    -   Scenario: "Resolving a waypoint"
    -   Steps: Define an activity in a background, trigger it via `ensure` in the feature, verify the activity ran.
4.  **Verification:** These features become the primary CI check.

## 5. General Maintenance
-   **Declarative & Deterministic:** Ensure every path through the steps is resolvable statically.
-   **Mermaid Diagrams:** Generate diagrams from the *resolved* static tree. Each diagram shows every path.
    -   **Animation:** The diagram view should support animation to visualize each step as it runs.
-   **Terminology:** Avoid generic terms. Use specific terms like `actualityScope`, `schemaDefinition`, and `subject`.

## 6. Support Markdown
**Goal:** Enable "Literate Testing" by allowing feature files to be written in Markdown (`.md`).
-   **Mechanism:** The feature collector should accept `.md` files in addition to `.feature` files.
-   **Parsing:**
    -   Extract Gherkin content from fenced code blocks (e.g., ```gherkin or ```feature).
    -   Treat the whole file as a feature when it has a specific structure (e.g., it starts with `# Feature:`). This is optional.
-   **Benefits:**
    -   Documentation and tests can share one file.
    -   Enables "executable specifications" that are easy to read and maintain.
-   **Compatibility:** Existing `.feature` files must continue to work without modification.
-   **User Experience:** The user doesn't need to do anything different for Markdown files. `haibun-cli` should detect and process `.md` files in the feature directory automatically.
