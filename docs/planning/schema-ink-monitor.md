# Schema and Monitor Redesign Plan

## Overview

Transform Haibun's monitoring into an **open-ended, pluggable event system** with:
1. **OpenTelemetry-aligned schemas** for industry compatibility
2. **Monitors as steppers** — configured in config.json like any stepper
3. **Built-in implementations**: Console (CI), Ink TUI, Browser, OTel exporter
4. **Default output**: NDJSON to stdout

### Core Concepts

> [!IMPORTANT]
> **REQUIRED** items are non-negotiable design decisions.
> **FLEXIBLE** items are implementation guidelines that may change during development.

---

#### 1. Monitors Are Steppers

> [!IMPORTANT]
> **REQUIRED**: Monitors are steppers configured in config.json, not a separate subscriber system.


```json
{
  "steppers": [
    "@haibun/web-playwright",
    "@haibun/monitor-console",    // CI-focused console output
    "@haibun/monitor-otel"        // Optional OTel export
  ]
}
```

> [!NOTE]
> **FLEXIBLE**: The exact hook name (`onEvent` vs other) and signature may evolve.

They implement `IStepperCycles` hooks to receive events:

```typescript
// How monitors integrate with the execution lifecycle
interface IStepperCycles {
  // Existing hooks
  startExecution?(features: TStartExecution): Promise<void>;
  startFeature?(startFeature: TStartFeature): Promise<void>;
  beforeStep?(beforeStep: TBeforeStep): Promise<void>;
  afterStep?(afterStep: TAfterStep): Promise<TAfterStepResult>;
  endFeature?(endedWith: TEndFeature): Promise<void>;
  endExecution?(results: TExecutorResult): Promise<void>;
  onFailure?(result: TFailureArgs): Promise<void>;
  
  // NEW: Event-driven hook for monitors
  onEvent?(event: THaibunEvent): void;
}
```

---

#### 2. Event Flow via IStepperCycles

> [!IMPORTANT]
> **REQUIRED**: Events flow through the stepper cycle system, not a separate Logger subscriber pattern.

**Current state:** Logger has separate subscriber pattern (`ILogOutput`)

**Target state:** Events flow through `IStepperCycles.onEvent()`:

```
┌─────────────┐      ┌─────────────┐      ┌─────────────────────┐
│ Executor    │─────►│ Logger      │─────►│ IStepperCycles      │
│             │      │ emit()      │      │ .onEvent(event)     │
└─────────────┘      └─────────────┘      └─────────────────────┘
                                                    │
                     ┌──────────────────────────────┼──────────────────────┐
                     ▼                              ▼                      ▼
              ┌─────────────┐              ┌─────────────┐        ┌─────────────┐
              │ Console     │              │ InkTUI      │        │ OTel        │
              │ Stepper     │              │ Stepper     │        │ Stepper     │
              └─────────────┘              └─────────────┘        └─────────────┘
```

---

#### 3. Default Output: NDJSON

> [!IMPORTANT]
> **REQUIRED**: Default output (when no monitor configured) is NDJSON to stdout.

This enables piping to external monitors: `haibun run | haibun-tui`

> [!NOTE]
> **FLEXIBLE**: The exact auto-detection logic may change.

```typescript
// In Executor or Runner setup
if (!steppers.some(s => s.onEvent)) {
  // No monitor stepper, use default NDJSON output
  steppers.push(new NdjsonOutputStepper());
}
```

---

#### 4. Built-In Monitor Steppers

> [!NOTE]
> **FLEXIBLE**: Package names and exact stepper names may change.

| Stepper | Package | Use Case |
|---------|---------|----------|
| `NdjsonOutputStepper` | `@haibun/core` | Default, pipe to external monitor |
| `ConsoleMonitorStepper` | `@haibun/monitor-console` | CI pipelines, human-readable |
| `InkTuiStepper` | `@haibun/monitor-ink` | Interactive terminal |
| `BrowserMonitorStepper` | `@haibun/web-playwright` | HTML file with video sync |
| `OTelExporterStepper` | `@haibun/monitor-otel` | Jaeger/Grafana export |

---

#### 5. OTel-Native Event Model

> [!IMPORTANT]
> **REQUIRED**: Event schema uses OTel terminology where applicable.
> **REQUIRED**: Speculative steps use OTel `links` to connect to their decision span.

Events use standard OTel fields:
- `trace_id`, `span_id`, `parent_span_id`, `status`, `links`
- **Speculative steps** use OTel `links` to connect to decision spans
- Only `haibun.*` namespace for genuinely unique concepts

---

#### 6. Speculative Flow Presentation

> [!IMPORTANT]
> **REQUIRED**: All monitors handle speculative steps consistently (collapse on pass, expand on fail).

| Monitor | On Pass | On Fail |
|---------|---------|---------|
| **TUI/Browser** | Collapse block | Expand all, highlight |
| **Console** | Show all with markers | Show all + failure box |

Detection: Spans with `links[]` = speculative.

---

## Current HTML Monitor Features & Migration Path

This section documents the **existing HTML monitor** capabilities in `modules/web-playwright/src/monitor/` and how each feature maps to the target unified event system.

### Feature Overview

| Feature | Current Implementation | Target System |
|---------|------------------------|---------------|
| Serialization | JSON island in HTML | Same + NDJSON file |
| Timeline/Video | Timestamps sync video playback | seqPath-linked events |
| Level Filtering | CSS-based `haibun-level-*` | Event `level` field |
| Depth Filtering | `data-depth` attribute | `parentId` hierarchy |
| Document View | `HAIBUN_VIEW_MODE` toggle | View mode in event stream |
| Artifact Display | `ArtifactDisplay` classes | `artifact()` builder |
| Variable Introspection | `disclosureJson()` | `payload` deep inspection |
| Debugger | `showPromptControls()` | `control().break()` events |

### 1. Serialization to Local File

**Current**: Monitor embeds a JSON island (`<script type="application/json">`) containing all captured log entries. The HTML file is self-contained and works offline.

```javascript
// In monitor.ts - startLazyIngestion()
const jsonIsland = document.getElementById('haibun-captured-messages-json');
const allLogData = JSON.parse(jsonIsland.textContent);
```

**Target**: Same approach, but with structured events:
- `HtmlPersister` subscriber collects `THaibunEvent[]`
- At `onEnd()`, embeds JSON island + broadcast sets (steppers, artifacts) for message efficiency (use keys rather than full objects)
- HTML template includes monitor.js that consumes events

```html
<script type="application/json" id="haibun-events">[...events...]</script>
<script type="application/json" id="haibun-steppers">[...broadcast set...]</script>
```

### 2. Timeline-Linked Video

**Current**: Video scrubs to match timeline position using `recalcVisibility()`:

```javascript
// In monitor.ts
const monitorState = {
  currentTime: 0,
  startTime: 0,
  maxTime: 0,
  playbackSpeed: 1,
  isPlaying: true
};

function recalcVisibility(timeMs: number, forceScroll = false) {
  // Show/hide log entries based on timestamp
  // Sync video element currentTime
}
```

**Target**: Events carry `timestamp`, monitors:
- Use `timestamp` relative to `startTime` for positioning
- Video artifact has `duration` field
- Timeline slider drives `currentTime`, events with `timestamp <= currentTime` are visible

### 3. Log Level Filtering

**Current**: CSS classes `haibun-level-trace`, `haibun-level-debug`, etc. Dropdown changes dynamic CSS rules.

```javascript
// In controls.ts - updateStyles()
LOG_LEVELS.forEach((level, index) => {
  if (index < selectedIndex) {
    css += `div.haibun-log-entry.haibun-level-${level} { display: none; }`;
  }
});
```

**Target**: Already built into unified event model:
- Every event has `level` field
- Monitors filter events where `event.level < selectedLevel`
- Same dropdown UI, but filtering is data-driven

### 4. Depth Filtering

**Current**: `data-depth` attribute on entries, `applyDepthFilter()` collapses deep entries:

```javascript
// In controls.ts
const depth = parseInt(entry.dataset.depth || '0', 10);
if (depth > currentMaxDepth) {
  entry.classList.add('haibun-log-depth-hidden');
}
```

**Target**: Use `parentId` chain to compute depth:
- `depth = countAncestors(event.parentId)`
- Same filter logic, but derived from event relationships
- Enables tree view in any monitor

### 5. Document View vs Timeline View

**Current**: `HAIBUN_VIEW_MODE` toggles between timeline (time-based) and document (structure-based) views:

```javascript
// In monitor.ts
window.HAIBUN_VIEW_MODE?: 'document' | 'timeline'
```

**Target**: View mode is a monitor concern, not event concern:
- Both views consume same event stream
- Document view groups by `feature` → `scenario` → `step`
- Timeline view sorts by `timestamp`

### 6. Artifact Display & Introspection

**Current**: `ArtifactDisplay` classes render different artifact types (`VideoArtifactDisplay`, `ImageArtifactDisplay`, `JsonArtifactDisplay`):

```javascript
// In messages.ts - createArtifactDisplay()
switch (artifact.artifactType) {
  case 'video': return new VideoArtifactDisplay(artifact);
  case 'image': return new ImageArtifactDisplay(artifact);
  case 'json': return new JsonArtifactDisplay(artifact);
  // ...
}
```

**Target**: Artifacts attached via `artifact()` builder, rendered same way:
```typescript
world.logger.log('Screenshot taken', artifact({ type: 'image', path }));
```
Monitors have same artifact displayers, consuming `event.artifacts[]`.

### 7. Variable/JSON Introspection (disclosureJson)

**Current**: `disclosureJson()` creates collapsible `<details>` elements for deep object inspection:

```javascript
// In disclosureJson.ts
export function disclosureJson(jsonObj: TAnyFixme): HTMLElement {
  // Creates collapsible tree of <details>/<summary> elements
  // Shows object keys, expands on click
  // Handles arrays, nested objects, primitives
}
```

**Target**: Same pattern, but consuming `event.payload`:
- HTML Monitor: Use existing `disclosureJson()`
- Ink TUI: Tree component with expandable nodes  
- MCP: Rich object via resource read
- Console: `--verbose` flag for JSON dump

### 8. Debugger Integration

**Current**: `showPromptControls()` displays buttons (retry/next/fail/step/continue), `haibunResolvePrompt()` sends response:

```javascript
// In controls.ts
window.showPromptControls = (promptsJson) => {
  const prompts: TPrompt[] = JSON.parse(promptsJson);
  // Enable/disable buttons based on prompt.options
  // On button click: window.haibunResolvePrompt(prompt.id, action);
};
```

**Target**: `control().break()` event triggers UI, `Prompter.resolve()` sends response:
```typescript
// Executor emits:
world.logger.log(control(seqPath).break().message('Step failed'));

// Monitor shows prompt UI
// User clicks button
// Monitor calls: world.prompter.resolve(promptId, 'retry');
```

### 9. Step Visual States

**Current**: Classes like `haibun-step-start`, `haibun-step-failed`, `disappeared`, `haibun-log-entry-current`:

```javascript
// In controls.ts - isVisibleByLevel()
if (entry.classList.contains('haibun-step-failed')) return true;  // Always show
if (entry.classList.contains('disappeared')) return false;        // Hide completed
```

**Target**: Derived from lifecycle events:
- `lifecycle.stage === 'start'` → step running (visible)
- `lifecycle.stage === 'end' && status === 'completed'` → disappeared
- `lifecycle.stage === 'end' && status === 'failed'` → always visible
- Current step: highest `seqPath` with `stage === 'start'`

---

## Work Progress Notes

### 2025-12-12: Zod v4 Migration

**Task**: Update codebase for Zod v4 compatibility.

**Completed fixes**:
1. `modules/core/src/lib/core-domains.ts`: Migrated Zod v3 error customization (`invalid_type_error`/`required_error`) to Zod v4's unified `error` parameter.
2. `modules/core/src/steps/variables-stepper.ts`: Replaced internal `schema._def.typeName` access (Zod v3) with schema description fallback.
3. `modules/core/src/lib/feature-variables.ts`: Added guard in `resolveVariable` for undefined domain access - fallback to `DOMAIN_STRING` when domain is undefined.
4. `modules/core/src/lib/core/protocol.ts`: Updated `z.record()` to Zod v4 two-argument syntax (`z.record(z.string(), z.any())`).
5. `modules/core/src/schema/events.ts`: Updated `z.record()` calls to Zod v4 two-argument syntax.

**Test results**:
- Unit tests: 443 passed (1 MCP connection test skipped due to environment)
- E2E tests: 25 features passed

**Notes**: User removed `zod-to-json-schema` dependency (not compatible with Zod v4, and Zod v4 has built-in `z.toJSONSchema()`).

### 2025-12-12: onEvent Hook Infrastructure

**Task**: Add `onEvent` hook to `IStepperCycles` for unified event routing.

**Completed work**:
1. `modules/core/src/lib/defs.ts`: Added `onEvent?(event: THaibunEvent)` to `IStepperCycles` interface
2. `modules/core/src/lib/EventLogger.ts`: Added `setStepperCallback()` method and re-exported `THaibunEvent` type
3. `modules/core/src/phases/Executor.ts`: 
   - Added `doStepperCycleSync()` function for synchronous event dispatch
   - Wired up `setStepperCallback` in `executeFeatures()` to route events to steppers
4. Created `modules/core/src/steps/on-event-hook.test.ts` to verify infrastructure

**Test results**:
- Unit tests: 450 passed
- E2E tests: 25 features passed

**Architecture update**: EventLogger now supports dual output:
- Always emits to stdout (`console.log(JSON.stringify(event))`) for CLI piping to `monitor-cli`
- Additionally routes through `doStepperCycleSync('onEvent', event)` for in-process monitors

### 2025-12-12: Phase 5 - Monitor as Stepper

**Task**: Create example monitor stepper using `onEvent` pattern.

**Completed work**:
1. `modules/core/src/steps/console-monitor-stepper.ts`: Console monitor implementing `onEvent`
2. `modules/core/src/steps/console-monitor-stepper.test.ts`: Test verifying event capture
3. `modules/core/src/lib/EventLogger.ts`: Added `emitter` field and `suppressConsole` option

**Features**:
- Receives lifecycle, log, artifact, control events via `IStepperCycles.onEvent`
- Configurable via module options (CONSOLE_MONITOR_VERBOSE, CONSOLE_MONITOR_LOGS, etc.)
- **Emitter field**: Events include source info (e.g., `doFeatureStep:336`, `action:172`)
- **Log level abbreviation**: Shows full level on first use (`log`), then abbreviates (`l`)
- **Speculative indicators**: Uses ` ✓`/` ✗` with leading space for speculative steps (vs ✅/❌)

**Sample output** (with `HAIBUN_LOG_LEVEL=error` to suppress old Logger):
```
  scen █ 0.486:doFeature:223           ｜ 📋 Scenario: Scenario: Test accessibility pass
   log █ 0.498:doFeatureStep:336       ｜ ✅[1.2.2] set test to http://localhost:8123/a11y.html
     l █ 0.844:doFeatureStep:336       ｜  ✗[1.2.8.-1] page is accessible... (speculative fail)
     l █ 0.845:doFeatureStep:336       ｜ ✅[1.2.8] not page is accessible...
```

### 2025-12-12: Phase 4 - TMessageContext Bridge (Partial)

**Task**: Create bridge for TMessageContext → THaibunEvent migration.

**Completed work**:
1. `modules/core/src/lib/event-bridge.ts`: Converter utility with `messageContextToEvent()`
2. `modules/core/src/lib/event-bridge.test.ts`: 10 tests for conversion logic

**Mappings**:
- `EExecutionMessageType.STEP_START/END` → `LifecycleEvent` with type='step'
- `EExecutionMessageType.FEATURE_START/END` → `LifecycleEvent` with type='feature'
- `EExecutionMessageType.DEBUG` → `ControlEvent` with signal='break'/'pause'
- Other incidents → `LogEvent`

**Test results**:
- Unit tests: 462 passed
- E2E tests: 25 features passed

### 2025-12-13: Monitor Simplification and EventFormatter

**Task**: Simplify monitor architecture, remove dead code, centralize formatting.

**Completed work**:

1. **Removed 5 unused files** from `modules/core/src/monitor/`:
   - `event-view.ts` - EventView wrapper class (not used externally)
   - `filters.ts` - Level/depth filtering (not used externally) 
   - `speculative-tracker.ts` - Speculative block tracking (not used)
   - `state.ts` - MonitorState management (not used)
   - `tree-builder.ts` - Tree hierarchy builder (not used)

2. **Created `EventFormatter` static class** (`modules/core/src/monitor/formatters.ts`):
   ```typescript
   export class EventFormatter {
     static shouldDisplay(event: THaibunEvent): boolean
     static getDisplayLevel(event: THaibunEvent): string
     static getStatusIcon(event: THaibunEvent): string
     static getIndication(event: THaibunEvent): TIndication
     static formatLine(event: THaibunEvent, lastLevel?: string): string
   }
   ```

3. **Simplified TuiMonitorStepper** (`modules/monitor-tui/src/index.tsx`):
   - Uses `EventFormatter.formatLine()` for all output formatting
   - No duplicate rendering logic
   - Stores formatted strings, not events

4. **Removed unused exports**:
   - `LogFormatter` class (was never imported externally)
   - Backward compatibility function aliases

5. **Added `--with-steppers` CLI option** (`modules/cli/src/lib.ts`):
   - Syntax: `--with-steppers=stepper1,stepper2` or `--with-steppers stepper1,stepper2`
   - CLI steppers merged with config.json steppers
   - Allows monitor selection without config changes

**Current monitor directory** (`modules/core/src/monitor/`):
- `formatters.ts` (85 LoC) - `EventFormatter` static class
- `index.ts` (5 LoC) - exports

**Display format**:
```
   log █ 0.671:doFeatureStep:336       ｜ ✅[1.1.1] step description
scenario █ 1.189:doFeature:223         ｜ 📋 Scenario: Test accessibility
```

**Key design decisions**:
- Lifecycle `step` events display as level `log` (not `step`)
- Features use 📄 icon, scenarios use 📋
- Step events show `[id]` and status icons (✅/❌)
- Level abbreviates after first use (`log` → `l`)

**Test results**:
- Unit tests: 461 passed (1 unrelated failure in variables-stepper superdomain test)
- E2E tests: 25 features passed

---

## Current State (December 2025)

### What Has Been Implemented

#### 1. Zod Event Schemas (`modules/core/src/schema/events.ts`)
✅ Complete. Base event types are defined:
- `BaseEvent` with `id`, `timestamp`, `source`
- `LifecycleEvent` for feature/scenario/step start/end
- `LogEvent` for log messages with payload
- `ArtifactEvent` for time-lined artifacts
- `ControlEvent` for debug/graph signals
- `HaibunEvent` discriminated union

#### 2. EventLogger (`modules/core/src/lib/EventLogger.ts`)
✅ **Now integrated with stepper cycles** (as of 2025-12-12):
- Has `emit()`, `log()`, `stepStart()`, `stepEnd()` methods
- Outputs to both `console.log(JSON.stringify(event))` for CLI piping AND stepper callbacks
- New `setStepperCallback()` method allows routing events through `IStepperCycles.onEvent()`
- `Executor.executeFeatures()` wires up the callback to `doStepperCycleSync('onEvent', event)`

#### 3. monitor-cli (`modules/monitor-cli/src/index.tsx`)
✅ Basic Ink TUI working.
- Parses JSON stdin from `EventLogger`
- Shows completed/running steps with feature/scenario headers
- Handles speculative vs authoritative intent

#### 4. Executor Integration
✅ **Event routing now integrated** (as of 2025-12-12):
- `Executor.executeFeatures()` wires up `eventLogger.setStepperCallback()` 
- Events flow through `doStepperCycleSync('onEvent', event)` to any stepper implementing `onEvent`
- ⚠️ **Still uses dual-logging**: `world.logger` (TMessageContext) alongside `world.eventLogger` (THaibunEvent)
- Migration of existing TMessageContext usages to THaibunEvent is pending

### What Still Uses TMessageContext

 Location | Usage | Migration Path |
|----------|-------|----------------|
| `Executor.ts` | `messageContext` in step results | Convert to `ControlEvent` |
| `debugger-stepper.ts` | `incidentDetails` for debug signals | Convert to `ControlEvent.signal` |
| `activities-stepper.ts` | Activity start/end contexts | Convert to `LifecycleEvent` |
| `narrator.ts` | Artifact attachment | Convert to `ArtifactEvent` |
| `Logger.ts` | All `out()` calls | Route through unified emitter |
| `MonitorHandler.ts` | Subscriber with `TMessageContext` | Accept `THaibunEvent` |

### The Core Architectural Problem

**Two parallel logging systems exist that need to be unified:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CURRENT STATE                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐                    ┌─────────────────────────┐    │
│  │ Executor    │───────────────────►│ EventLogger (new)       │    │
│  │             │  world.eventLogger │ - emits to stdout       │    │
│  │             │                    │ - NO subscribers        │    │
│  │             │                    │ - NO debug interaction  │    │
│  │             │                    └─────────────────────────┘    │
│  │             │                                                   │
│  │             │───────────────────►┌─────────────────────────┐    │
│  │             │  world.logger      │ Logger (old)            │    │
│  └─────────────┘                    │ - TMessageContext       │    │
│                                     │ - HAS subscribers       │    │
│                                     │ - Used by MonitorHandler│    │
│  ┌─────────────┐                    │ - Used by debugger      │    │
│  │ debugger-   │───relies on───────►│                         │    │
│  │ stepper     │  afterStep cycle   └─────────────────────────┘    │
│  └─────────────┘  (gets TMessageContext)                           │
│                                                                     │
│  ┌─────────────┐                    ┌─────────────────────────┐    │
│  │ Prompter    │◄──────────────────►│ ButtonPrompter (web)    │    │
│  │ (subscriber │                    │ ReadlinePrompter (cli)  │    │
│  │  pattern)   │                    └─────────────────────────┘    │
│  └─────────────┘                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**The debugger-stepper relies on:**
1. `IStepperCycles.afterStep` to intercept failures
2. `world.prompter` to get user input (supports multiple subscribers)
3. Returns debug signals via `haibun.control` in `THaibunEvent`

**The monitor needs:**
1. Lifecycle events (step start/end) 
2. Log events  
3. Control events (to show debug UI, pause, etc.)
4. Interactive response capability

**Migration path:** `ILogOutput.out(level, args, TMessageContext)` → `IStepperCycles.onEvent(THaibunEvent)`

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TARGET STATE                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐      ┌─────────────────────────────────────────┐  │
│  │ Executor    │─────►│ Logger (unified)                        │  │
│  │             │      │ - emits THaibunEvent                    │  │
│  │             │      │ - routes to steppers via onEvent()      │  │
│  │             │      │ - default: NdjsonOutputStepper          │  │
│  └─────────────┘      └─────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼ calls IStepperCycles.onEvent()       │
│              ┌───────────────┴───────────────┐                     │
│              │      MONITOR STEPPERS         │                     │
│              │   (configured in config.json) │                     │
│              ├───────────────────────────────┤                     │
│              │                               │                     │
│       ┌──────┴──────┐              ┌────────┴────────┐            │
│       │ InkTuiStepper│              │ BrowserMonitor │            │
│       │ (CLI TUI)   │              │ Stepper         │            │
│       │ - renders   │              │ - renders live  │            │
│       │ - prompts   │              │ - writes HTML   │            │
│       │   via Ink   │              │   on complete   │            │
│       └─────────────┘              └─────────────────┘            │
│                                                                    │
│       ┌─────────────┐              ┌─────────────────┐            │
│       │ Console     │              │ NDJSON (default)│            │
│       │ Stepper     │              │ Stepper         │            │
│       └─────────────┘              └─────────────────┘            │
│                                                                    │
│       ┌─────────────────────────────────────────────┐             │
│       │ OTelExporterStepper (spans to Jaeger)       │             │
│       └─────────────────────────────────────────────┘             │
│                                                                    │
│  ┌─────────────┐                                                   │
│  │ debugger-   │◄─── receives haibun.control events ──────────   │
│  │ stepper     │     emits control signals via onEvent()         │
│  └─────────────┘                                                   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ PROMPTER (bidirectional)                                      │  │
│  │  - TUI: Ink TextInput component → prompter.resolve()          │  │
│  │  - Browser: ButtonPrompter → prompter.resolve()               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### TUI-Prompter Interaction

The Ink TUI monitor integrates with the Prompter via Ink's input components:

```typescript
// In InkMonitor (simplified)
import { Box, Text, useInput } from 'ink';

function DebugPrompt({ prompt, onResolve }) {
  // Ink keyboard handler
  useInput((input, key) => {
    if (input === 'r') onResolve('retry');
    if (input === 'n') onResolve('next');
    if (input === 'f') onResolve('fail');
    if (input === 'c') onResolve('continue');
  });
  
  return (
    <Box borderStyle="double" borderColor="yellow">
      <Text>{prompt.message}</Text>
      <Text dimColor>[r]etry [n]ext [f]ail [c]ontinue</Text>
    </Box>
  );
}

// When control event with signal='break' arrives:
function onEvent(event: THaibunEvent) {
  if (event.control?.signal === 'break') {
    setCurrentPrompt(event);
  }
}

// User presses key → calls world.prompter.resolve(promptId, action)
```

The TUI subscribes to both:
1. **Events** (via `onEvent`) - to know when to show prompt UI
2. **Prompter** (via `prompter.addSubscriber`) - to send responses back

---

## Design Principles

### 0. Unified Event Model with Levels

All events should have a `level` field — not just logs. This simplifies the schema:

```typescript
// ─── OTel-Aligned Event Schema ───
// Uses OTel terminology, haibun.* namespace only for genuinely unique concepts

const HaibunEvent = z.object({
  // ─── Standard OTel span fields ───
  trace_id: z.string(),              // Execution run ID (all spans share this)
  span_id: z.string(),               // seqPath format: "1.1.2.3"
  parent_span_id: z.string().nullable(), // Parent step's seqPath
  timestamp: z.number(),             // Unix ms
  name: z.string(),                  // Step text or lifecycle label
  kind: z.enum(['INTERNAL', 'SERVER', 'CLIENT']).default('INTERNAL'),
  
  // ─── OTel status ───
  status: z.object({
    code: z.enum(['UNSET', 'OK', 'ERROR']),
    message: z.string().optional(),
  }).optional(),
  
  // ─── OTel links (for speculative steps) ───
  links: z.array(z.object({
    trace_id: z.string(),
    span_id: z.string(),            // Links to the compound statement (some/not/any of)
    attributes: z.record(z.unknown()).optional(),
  })).optional(),
  
  // ─── OTel events (logs attached to span) ───
  events: z.array(z.object({
    name: z.string(),
    timestamp: z.number(),
    attributes: z.record(z.unknown()).optional(),
  })).optional(),
  
  // ─── Attributes ───
  attributes: z.object({
    // Haibun scope (no OTel equivalent)
    'haibun.scope': z.enum(['feature', 'scenario', 'step', 'activity', 'waypoint', 'ensure']).optional(),
    'haibun.stage': z.enum(['start', 'end']).optional(),
    'haibun.stepper': z.string().optional(),
    'haibun.action': z.string().optional(),
  }).passthrough(),
  
  // ─── Haibun-specific extensions ───
  'haibun.control': z.object({
    signal: z.enum(['break', 'resume', 'step', 'fail', 'retry', 'next', 'graph_link']),
    prompt_id: z.string().optional(),
    options: z.array(z.string()).optional(),
  }).optional(),
  
  'haibun.artifacts': z.array(ArtifactSchema).optional(),
});
```

### Speculative Steps via OTel Links

**Authoritative step:** Normal span (no links)

**Speculative step:** Span with `links` pointing to the compound statement:

```
Compound statement:  some                    span_id: "1.1"
  Speculative step:  email matches A        span_id: "1.1.1", links: [{ span_id: "1.1" }]
  Speculative step:  email matches B        span_id: "1.1.2", links: [{ span_id: "1.1" }]
  Speculative step:  email matches C        span_id: "1.1.3", links: [{ span_id: "1.1" }]
```

The `links` field is standard OTel — speculative steps link to their "decision span" (the compound statement). OTel tools can:
- Filter by "spans with links" = speculative
- Follow links to see the decision context
- Group related spans visually

### Terminology Mapping (Updated)

| Haibun Current | OTel Aligned | Reason |
|----------------|--------------|--------|
| `id` (seqPath) | `span_id` | seqPath IS the span_id |
| `traceId` | `trace_id` | Standard OTel term |
| `parentId` | `parent_span_id` | Standard OTel term |
| `speculative` | `links` present | OTel native — linked to decision span |
| `authoritative` | No `links` | OTel native — standalone span |
| `lifecycle.status` | `status.code` | Standard OTel span status |
| `lifecycle.kind` | `attributes['haibun.scope']` | Haibun-specific hierarchy |
| `control` | `haibun.control` | Debugger-specific extension |
| `artifacts` | `haibun.artifacts` | Haibun-specific extension |

### What's Now Pure OTel

| Concept | Implementation |
|---------|----------------|
| Span identification | `trace_id`, `span_id`, `parent_span_id` |
| Span status | `status.code: OK/ERROR/UNSET` |
| Speculative/Authoritative | `links` (speculative links to decision span) |
| Nested logs | `events[]` |
| Custom metadata | `attributes{}` |

**Only truly Haibun-specific concepts remain namespaced:**
- `haibun.scope` — feature/scenario/step hierarchy
- `haibun.control` — debugger prompting
- `haibun.artifacts` — screenshots/videos

### 0.3 Shared Monitor Core Library (`@haibun/monitor-core`)

> [!IMPORTANT]
> **REQUIRED**: Shared library with high level of code reuse between TUI and browser monitors.
> Consistent behavior across all monitors (filtering, speculative handling, tree building).

All monitors share a common library that provides:

1. **Event Processing** — Parse, validate, filter events
2. **State Management** — Build tree from span hierarchy, track speculative blocks
3. **Display Logic** — Consistent speculative handling, variable tracking
4. **Formatters** — Common rendering utilities (timestamps, paths, status icons)

```
@haibun/monitor-core/
├── src/
│   ├── event-stream.ts       # Parse NDJSON/events, validate with Zod
│   ├── tree-builder.ts       # Build step tree from parent_span_id chain
│   ├── filters.ts            # Level, depth, speculative filtering
│   ├── speculative-tracker.ts # Track speculative blocks, detect pass/fail
│   ├── variable-tracker.ts   # Build variable history index
│   ├── formatters.ts         # Status icons, time formatting, path display
│   ├── types.ts              # Shared types
│   └── index.ts
└── package.json
```

**Key principle:** All display logic lives in `monitor-core`. Individual monitors only handle rendering.

#### How Monitors Use monitor-core

> [!IMPORTANT]
> **REQUIRED**: TUI uses Ink. Browser and TUI both use the shared core library.

**1. Browser Monitor (in `@haibun/web-playwright`):**

```typescript
// In BrowserMonitorStepper - uses monitor-core for all logic
import { TreeBuilder, SpeculativeTracker, filterByLevel } from '@haibun/monitor-core';

export class BrowserMonitorStepper extends AStepper implements IStepperCycles {
  steps = {};
  private tree = new TreeBuilder();
  private speculative = new SpeculativeTracker();
  private events: THaibunEvent[] = [];
  
  onEvent(event: THaibunEvent) {
    this.events.push(event);
    this.tree.addEvent(event);
    this.speculative.trackEvent(event);
    
    // Live update browser UI if connected
    this.sendToBrowser({ type: 'EVENT', event });
  }
  
  async endExecution(results: TExecutorResult) {
    // Embed events in HTML for offline replay
    const html = this.generateHtml({
      events: this.events,
      tree: this.tree.getTree(),
      speculativeBlocks: this.speculative.getBlocks(),
    });
    fs.writeFileSync('monitor.html', html);
  }
}
```

**2. Ink TUI Monitor (in `@haibun/monitor-ink`):**

```typescript
// In InkTuiStepper - React/Ink components use monitor-core state
import { TreeBuilder, SpeculativeTracker, isSpeculative } from '@haibun/monitor-core';
import { render, Box, Text } from 'ink';

export class InkTuiStepper extends AStepper implements IStepperCycles {
  steps = {};
  private tree = new TreeBuilder();
  private speculative = new SpeculativeTracker();
  
  async startExecution() {
    // Render Ink app
    render(<MonitorApp tree={this.tree} speculative={this.speculative} />);
  }
  
  onEvent(event: THaibunEvent) {
    this.tree.addEvent(event);
    this.speculative.trackEvent(event);
    // Ink re-renders automatically via state update
  }
}

// React component uses monitor-core utilities
function StepRow({ event }: { event: THaibunEvent }) {
  const spec = isSpeculative(event);
  return (
    <Box>
      <Text color={spec ? 'gray' : 'white'}>
        {spec ? '┊ ' : '  '}{event.name}
      </Text>
    </Box>
  );
}
```

**3. Console Monitor (in `@haibun/monitor-console`):**

```typescript
// Simple console output using monitor-core EventView
import { EventView } from '@haibun/monitor-core';

export class ConsoleMonitorStepper extends AStepper implements IStepperCycles {
  steps = {};
  
  onEvent(event: THaibunEvent) {
    const ev = new EventView(event);
    console.log(`${ev.formatStatus()} ${ev.formatSeqPath()} ${ev.formatPrefix()}${ev.name}`);
  }
}
```

#### monitor-core API Surface

The core library provides typed abstractions over `THaibunEvent`, all derived from Zod schemas:

```typescript
// @haibun/monitor-core

// ─────────────────────────────────────────────────────────────
// Types (inferred from Zod schemas in @haibun/core)
// ─────────────────────────────────────────────────────────────
import type { THaibunEvent, TEventStatus, TEventLink } from '@haibun/core';

// ─────────────────────────────────────────────────────────────
// EventView: Type-safe view over a single event
// ─────────────────────────────────────────────────────────────
export class EventView {
  constructor(readonly event: THaibunEvent) {}
  
  // Identity
  get spanId(): string { return this.event.span_id; }
  get traceId(): string { return this.event.trace_id; }
  get parentSpanId(): string | undefined { return this.event.parent_span_id; }
  
  // Display
  get name(): string { return this.event.name; }
  get scope(): 'feature' | 'scenario' | 'step' { /* from attributes */ }
  get stage(): 'start' | 'end' | undefined { /* from attributes */ }
  
  // Status
  get status(): TEventStatus | undefined { return this.event.status; }
  get isOk(): boolean { return this.status?.code !== 'ERROR'; }
  
  // Speculative detection via links
  get links(): TEventLink[] { return this.event.links ?? []; }
  get isSpeculative(): boolean { return this.links.length > 0; }
  get decisionSpanId(): string | undefined { return this.links[0]?.span_id; }
  
  // Formatting
  formatStatus(): string { /* ✓ or ✗ with ANSI color */ }
  formatSeqPath(): string { /* left-aligned span_id */ }
  formatPrefix(): string { /* '┊ ' speculative, '  ' authoritative */ }
}

// ─────────────────────────────────────────────────────────────
// State Builders: Accumulate events into queryable structures
// ─────────────────────────────────────────────────────────────
export class TreeBuilder {
  addEvent(event: THaibunEvent): void;
  getTree(): StepTree;
  getChildren(spanId: string): EventView[];
}

export class SpeculativeTracker {
  trackEvent(event: THaibunEvent): void;
  getBlocks(): Map<string, SpeculativeBlock>;
  isBlockPassed(decisionSpanId: string): boolean;
}

export class VariableTracker {
  trackEvent(event: THaibunEvent): void;
  getHistory(varName: string): VariableChange[];
}

// ─────────────────────────────────────────────────────────────
// Filters: Pure functions for event streams
// ─────────────────────────────────────────────────────────────
export function filterByLevel(events: THaibunEvent[], minLevel: TLogLevel): THaibunEvent[];
export function filterByDepth(events: THaibunEvent[], maxDepth: number): THaibunEvent[];
export function filterSpeculative(events: THaibunEvent[], mode: SpeculativeDisplayMode): THaibunEvent[];
```

This ensures all monitors behave consistently and new monitors are easy to create.

### 0.4 JIT Schema Wire Format

> [!NOTE]
> **FLEXIBLE**: Wire format is an optimization. May use simpler NDJSON initially.

For efficiency, use an **interleaved Just-In-Time schema** approach. Schemas are defined on first use, then referenced by short ID:

```json
{"_meta": "schema", "id": "lifecycle-v1", "fields": ["id", "stage", "status", "ts", "label"]}
{"s": "lifecycle-v1", "d": ["1.1", "start", "running", 170001, "Feature: Login"]}
{"s": "lifecycle-v1", "d": ["1.1.1", "start", "running", 170002, "Scenario: Valid login"]}
{"_meta": "schema", "id": "log-v1", "fields": ["id", "level", "msg", "ts"]}
{"s": "log-v1", "d": ["1.1.1.1", "debug", "Navigating to /login", 170003]}
{"_meta": "schema", "id": "network-v1", "fields": ["method", "url", "ms", "status"]}
{"s": "network-v1", "d": ["GET", "/api/auth", 150, 200]}
{"s": "lifecycle-v1", "d": ["1.1.1", "end", "completed", 170010, null]}
```

**Wire format:**
- `{"_meta": "schema", ...}` — schema definition (sent once per type)
- `{"s": "<schema-id>", "d": [...]}` — data row referencing schema

**Benefits:**
- ~60% smaller than full JSON objects
- Stream-friendly (no header required upfront)
- Self-describing (schema embedded in stream)
- Validates via Zod on parse

**Schema registry in monitor-core:**

```typescript
// In monitor-core/src/schema-registry.ts
class SchemaRegistry {
  private schemas = new Map<string, { fields: string[], zod: z.ZodSchema }>();
  
  register(id: string, fields: string[], zodSchema: z.ZodSchema) {
    this.schemas.set(id, { fields, zod: zodSchema });
  }
  
  parse(line: string): THaibunEvent | null {
    const obj = JSON.parse(line);
    
    if (obj._meta === 'schema') {
      // Register new schema
      this.register(obj.id, obj.fields, this.zodForSchema(obj.id));
      return null; // Schema line, not an event
    }
    
    // Data line — expand to full object
    const schema = this.schemas.get(obj.s);
    if (!schema) throw new Error(`Unknown schema: ${obj.s}`);
    
    const expanded: Record<string, unknown> = {};
    schema.fields.forEach((field, i) => expanded[field] = obj.d[i]);
    
    return schema.zod.parse(expanded);
  }
}
```

**Serialization side (Logger):**

```typescript
// In Logger - emit JIT schema format
private schemasSent = new Set<string>();

emitEvent(event: THaibunEvent) {
  const schemaId = this.getSchemaId(event);
  
  // Send schema definition on first use
  if (!this.schemasSent.has(schemaId)) {
    this.output(JSON.stringify({ _meta: 'schema', id: schemaId, fields: this.getFields(schemaId) }));
    this.schemasSent.add(schemaId);
  }
  
  // Send compact data row
  const data = this.getFields(schemaId).map(f => event[f]);
  this.output(JSON.stringify({ s: schemaId, d: data }));
}
```

### 0.5 CI Console Output Format

> [!IMPORTANT]
> **REQUIRED**: Console output must be highly readable. This is critical for CI debugging.

Console output must be **human-readable and debuggable**, not JSON. It should clearly show:
- Step hierarchy via indentation
- Timing information
- Failure context
- Variable values on failure

**Example CI output:**

```
✓ Feature: User Login (1.2s)
  ✓ Scenario: Valid credentials
    ✓ 1.1.1  Given I am on the login page                    (120ms)
    ✓ 1.1.2  When I enter "test@example.com" as email        (45ms)
    ✓ 1.1.3  And I enter "password123" as password           (42ms)
    ✓ 1.1.4  And I click the login button                    (890ms)
    ✓ 1.1.5  Then I should see the dashboard                 (230ms)

✗ Feature: Password Reset (0.8s)
  ✗ Scenario: Invalid email
    ✓ 1.2.1  Given I am on the reset page                    (115ms)
    ✓ 1.2.2  When I enter "invalid-email" as email           (40ms)
    ✗ 1.2.3  Then I should see "Invalid email format"        (520ms)
      
      ╭─ FAILURE ────────────────────────────────────────╮
      │ Expected: "Invalid email format"                 │
      │ Actual:   "Please enter a valid email"           │
      │                                                  │
      │ Step: web-playwright.shouldSeeText               │
      │ Variables:                                       │
      │   $expected = "Invalid email format"             │
      │   $actual   = "Please enter a valid email"       │
      ╰──────────────────────────────────────────────────╯
      
      Screenshot: file:///tmp/haibun/screenshot-1.2.3.png

Summary: 1 passed, 1 failed (2.0s total)
```

**Key features:**
- **seqPath prefix** (`1.1.1`) for cross-reference with logs
- **Indentation** shows feature → scenario → step hierarchy
- **Timing** per-step and per-feature
- **Failure box** with expected/actual, stepper, variable dump
- **Artifact links** inline for screenshots, videos
- **Color coding** (✓ green, ✗ red) in TTY environments

**Console stepper uses monitor-core:**

```typescript
// In @haibun/monitor-console
class ConsoleMonitorStepper extends AStepper implements IStepperCycles {
  steps = {}; // No steps, just cycles
  private indent = 0;
  
  onEvent(event: THaibunEvent) {
    if (event.attributes?.['haibun.scope'] === 'feature') {
      this.renderFeature(event);
    } else if (event.attributes?.['haibun.scope'] === 'step') {
      this.renderStep(event);
    }
    // On failure, dump variables and show failure box
    if (event.status?.code === 'ERROR') {
      this.renderFailure(event);
    }
  }
}
```

### 0.6 Speculative Step Display Strategy

> [!IMPORTANT]
> This is a **critical consistency requirement** across all monitors.

**Speculative blocks** (e.g., `some`, `not`, `any of`) run steps internally to test conditions. How these display varies by monitor type:

#### Display Rules by Monitor Type

| Monitor Type | Speculative Pass | Speculative Fail | Authoritative |
|--------------|------------------|------------------|---------------|
| **CI Console** | Show all steps inline | Show all + failure box | Show all |
| **Interactive (TUI/HTML)** | Collapse/hide block | Show all + keep on screen | Show all |
| **JSON/NDJSON** | Emit all events | Emit all events | Emit all |

#### Event Structure for Speculative Steps

Speculative steps use OTel `links` to point to their decision span:

```typescript
// Speculative step links to its compound statement (some/not/any of)
{
  span_id: "1.1.2",
  links: [{ 
    span_id: "1.1",   // Points to the decision span
    trace_id: "run-123"
  }],
  // ... other fields
}
```

**Detection:** `event.links?.length > 0` = speculative, no links = authoritative.

#### Monitor-Core Filter Logic

```typescript
// In monitor-core/src/filters.ts
export type SpeculativeDisplayMode = 'show-all' | 'collapse-on-pass' | 'hide-on-pass';

export function isSpeculative(event: THaibunEvent): boolean {
  return (event.links?.length ?? 0) > 0;
}

export function filterSpeculative(
  events: THaibunEvent[], 
  displayMode: SpeculativeDisplayMode
): THaibunEvent[] {
  
  if (displayMode === 'show-all') {
    return events; // CI mode - show everything
  }
  
  // Group events by decision span (linked span_id)
  const blocks = groupByDecisionSpan(events);
  
  return events.filter(event => {
    if (!isSpeculative(event)) return true; // Authoritative, always show
    
    const decisionSpanId = event.links?.[0]?.span_id;
    const block = blocks.get(decisionSpanId);
    
    if (block?.failed) {
      return true; // Speculative block failed, show ALL its steps
    }
    
    if (displayMode === 'hide-on-pass') {
      return false; // Hide passed speculative steps
    }
    
    if (displayMode === 'collapse-on-pass') {
      // Return summary event only
      return event.span_id === block?.summaryEventId;
    }
    
    return true;
  });
}
```

#### CI Console Output (Default)

Shows ALL steps in sequence, with speculative blocks marked:

```
✓ Feature: Validation (0.5s)
  ✓ Scenario: Check input
    ✓ 1.1.1  Given I have input "test@email.com"
    ┊ 1.1.2  [speculative: some]
    ┊   ✓ 1.1.2.1  email matches pattern A         (pass)
    ┊   ✗ 1.1.2.2  email matches pattern B         (skip)
    ✓ 1.1.2  some: passed (1 of 2 matched)
    ✓ 1.1.3  Then validation succeeds
```

#### Interactive (TUI/HTML) Behavior

1. **While running**: Show all speculative steps as they execute
2. **On pass**: Collapse block to single summary line
3. **On fail**: Keep ALL steps on screen, highlight failure

```
Interactive mode - after speculative PASS:
  ✓ 1.1.2  some: matched "email matches pattern A"  [▸ expand]

Interactive mode - after speculative FAIL:
  ✗ 1.1.2  some: no match
      ✗ 1.1.2.1  email matches pattern A  (no match)
      ✗ 1.1.2.2  email matches pattern B  (no match)
      ✗ 1.1.2.3  email matches pattern C  (no match)
      → Variable $email = "invalid-input"
```

#### Filter Controls

Beyond level and depth, add speculative filter:

| Control | Values | Effect |
|---------|--------|--------|
| `--speculative` | `all` / `summary` / `failed` | Control speculative display |
| Level dropdown | trace→error | Filter by log level |
| Depth slider | 1-N | Collapse deep nesting |

#### Monitor Auto-Selection

```typescript
// In runner initialization
function configureDefaultMonitor(steppers: AStepper[]): void {
  // Check if any monitor stepper with onEvent is loaded
  const hasMonitorStepper = steppers.some(s => 
    typeof (s as IStepperCycles).onEvent === 'function'
  );
  
  if (!hasMonitorStepper) {
    // No monitor stepper configured, add default NDJSON output
    steppers.push(new NdjsonOutputStepper());
  }
}
```

#### Future: Variable Change Tracking (All Steps)

Track variable changes across **all steps** (authoritative and speculative), enabling:

1. **Step detail view**: Click any step → see what variables it changed
2. **Variable history**: Click a variable → see all steps that modified it (with timeline)
3. **Debugging**: "Why is `$status` suddenly 'failed'?" → jump to the step that changed it

```typescript
// Every step event can include variable changes
{
  id: "1.2.3",
  lifecycle: { kind: 'step', stage: 'end', status: 'completed' },
  changes: {
    variables: [
      { name: 'counter', before: 0, after: 1 },
      { name: 'status', before: 'pending', after: 'active' }
    ]
  }
}
```

**Monitor-core builds variable history index:**

```typescript
// In monitor-core/src/variable-tracker.ts
class VariableTracker {
  private history = new Map<string, Array<{ seqPath: string, before: unknown, after: unknown }>>();
  
  onEvent(event: THaibunEvent) {
    if (event.changes?.variables) {
      for (const change of event.changes.variables) {
        const hist = this.history.get(change.name) || [];
        hist.push({ seqPath: event.id, before: change.before, after: change.after });
        this.history.set(change.name, hist);
      }
    }
  }
  
  getHistoryFor(varName: string) {
    return this.history.get(varName) || [];
  }
  
  getChangesAt(seqPath: string) {
    // Return all variables changed by this step
  }
}
```

**UI Integration:**
- HTML/TUI: Hovering a variable shows its history popup
- Timeline: Variable changes shown as markers alongside step events
- Search: "Find steps that changed $counter"

### 0.1 Deep Introspection Support

All monitors must support **deep inspection** of event payloads (like `disclosureJson` in the current HTML monitor):

- **HTML Monitor**: Collapsible `<details>` elements for nested objects (existing pattern)
- **Ink TUI**: Expandable tree view using Ink primitives 
- **MCP**: Rich object payloads via MCP resource protocol
- **Console**: JSON pretty-print on demand (e.g., `--verbose`)

Every event can carry a `payload` object for deep inspection:

```typescript
world.logger.debug('Step resolved', 
  lifecycle(seqPath).step('end'),
  { resolved: { args, action, domain, valMap } }  // payload for inspection
);
```

Monitors display payload content progressively — collapsed by default, expandable on demand.

### 0.2 Storage Efficiency via References

For storage efficiency, events use **references** instead of duplicating data:

```typescript
const HaibunEvent = z.object({
  id: z.string(),         // seqPath - unique key for this event
  timestamp: z.number(),
  level: TLogLevel,
  
  // References instead of embedded data
  parentId: z.string().optional(),      // seqPath of parent step
  stepperRef: z.string().optional(),    // stepper name (lookup in broadcast set)
  artifactRefs: z.array(z.string()).optional(),  // paths to artifacts
  
  // Actual content (small)
  message: z.string().optional(),
  lifecycle: LifecycleData.optional(),
  control: ControlData.optional(),
});
```

**Broadcast sets** (written once, referenced many times):
- `steppers[]` — registered steppers with their step patterns
- `artifacts[]` — artifact metadata with paths
- `features[]` — resolved feature structure

Events reference these by name/id rather than embedding full objects:

```json
{
  "id": "1.2.3",
  "stepperRef": "WebPlaywright",     // lookup in steppers[]
  "artifactRefs": ["html-001", "video-001"],  // lookup in artifacts[]
  "parentId": "1.2"
}
```

This matches how MCP resources work — catalog of resources, then fetch by URI.


### 1. Level-First API (No `.emit()` Required)

The **level method IS the emission**. Everything goes through a log level:

```typescript
// Simple messages (most common - identical to current API)
world.logger.log('Processing feature');
world.logger.debug('Variable resolved', { name, value });
world.logger.error('Connection failed');

// Lifecycle events - level determines visibility
world.logger.log(lifecycle(seqPath).step('start').label(step.in));
world.logger.debug(lifecycle(seqPath).step('end').status('completed'));  
world.logger.trace(lifecycle(seqPath).step('end').status('completed'));   // speculative

// Multiple things in one emission (message + events + artifacts)
world.logger.info('Step complete',
  lifecycle(seqPath).step('end').status('completed'),
  artifact({ type: 'image', path: screenshot }),
  artifact({ type: 'video', path: recording })
);

// Control events (debugging)
world.logger.log(control(seqPath).break());
world.logger.log(control(seqPath).resume());
```

**Key insight**: `world.logger.<level>(content...)` - level is the method, content is varargs.

**Content can be:**
- `string` — plain message
- `object` — payload (like `{ name, value }`)
- `lifecycle(...)` — lifecycle event builder
- `control(...)` — control event builder  
- `artifact(...)` — artifact attachment

**Implementation:**

```typescript
// Free functions that return event data (not classes with .emit())
function lifecycle(seqPath: TSeqPath) {
  return {
    step: (stage: 'start' | 'end') => ({
      type: 'lifecycle', kind: 'step', stage, id: formatSeqPath(seqPath),
      status: (s: string) => ({ ...this, status: s }),
      label: (l: string) => ({ ...this, label: l }),
    }),
    feature: (stage) => ({ /* ... */ }),
    scenario: (stage) => ({ /* ... */ }),
  };
}

function control(seqPath: TSeqPath) {
  return {
    break: () => ({ type: 'control', signal: 'break', id: formatSeqPath(seqPath) }),
    resume: () => ({ type: 'control', signal: 'resume', id: formatSeqPath(seqPath) }),
    // etc.
  };
}

function artifact(data: TArtifact) {
  return { type: 'artifact', ...data };
}

// Logger collects varargs into one event
class Logger {
  log(...content: TContent[]) { this.emit('log', content); }
  debug(...content: TContent[]) { this.emit('debug', content); }
  info(...content: TContent[]) { this.emit('info', content); }
  trace(...content: TContent[]) { this.emit('trace', content); }
  warn(...content: TContent[]) { this.emit('warn', content); }
  error(...content: TContent[]) { this.emit('error', content); }
  
  private emit(level: TLogLevel, content: TContent[]) {
    const event: THaibunEvent = {
      level,
      timestamp: Date.now(),
      message: content.filter(c => typeof c === 'string').join(' '),
      payload: content.find(c => isPayload(c)),
      lifecycle: content.find(c => c.type === 'lifecycle'),
      control: content.find(c => c.type === 'control'),
      artifacts: content.filter(c => c.type === 'artifact'),
    };
    this.notifySubscribers(event);
  }
}
```

### 2. IStepperCycle Integration for Monitors

Monitors integrate via the `IStepperCycles` interface — see [Core Concepts](#1-monitors-are-steppers) for the full interface definition.

Key hooks for monitors:
- `onEvent(event: THaibunEvent)` — receive all events
- `onControl(event: TControlEvent)` — for interactive debugging

This means:
- `MonitorHandler` becomes a stepper with `onEvent` cycle
- `InkMonitor` becomes a stepper with `onEvent` cycle  
- `debugger-stepper` uses `onControl` to intercept break events

**Benefits:**
- Consistent with existing architecture
- Multiple monitors automatically supported
- Testable via mock steppers

### 3. Interactive Debugging via Prompter

The debugger-stepper's interactive loop works with the `Prompter` subscriber pattern. This should remain unchanged:

```
[Executor]
    │
    ├── afterStep (failure detected)
    │       │
    │       ▼
    │   [debugger-stepper.afterStep]
    │       │
    │       ├── emit ControlEvent(break)  ──► [monitors show debug UI]
    │       │
    │       ├── await world.prompter.prompt() ◄── [user input from monitor]
    │       │
    │       └── return { rerunStep: true } or { nextStep: true }
    │
    └── [Executor respects afterStep result]
```

The key insight: **Prompter is bidirectional, events are unidirectional.**

### 4. Additive Monitor Subscriptions

Monitors are **additive**, not mutually exclusive. Multiple can run simultaneously:

```bash
# Default: human-readable console output (CI-friendly)
haibun run features/

# Add monitors via repeated flag or config
haibun run features/ --monitor=tui         # just TUI
haibun run features/ --monitor=html        # just HTML persistence
haibun run features/ --monitor=tui --monitor=html --monitor=mcp   # all three

# Or in config.json
{
  "monitors": ["console", "html", "mcp"]
}
```

**Built-in monitors:**
| Monitor | Description |
|---------|-------------|
| `console` | Human-readable text to stdout (default, always on unless `--silent`) |
| `tui` | Ink terminal UI (takes over terminal) |
| `html` | Persists events to self-contained HTML file |
| `json` | NDJSON to stdout for piping |
| `mcp` | Exposes events via MCP protocol |

> [!NOTE]
> `console` and `tui` conflict (both use terminal). If `tui` is specified, `console` is suppressed.

### 5. Debugger Improvements

#### 5.1 Stack Issue (Multiple Fails Required)

**Problem**: When a step inside `some`/`not`/recursive blocks fails, each layer's `afterStep` triggers debugger. User must type "fail" multiple times.

**Solution**: Track "handled" state on the failure:

```typescript
// In debugger-stepper.afterStep
if (actionResult.debugHandled) {
  // Already processed by inner debugger, skip
  return;
}

// After user chooses an action, mark it handled
actionResult.debugHandled = true;
```

Or use a shared context flag `world.runtime.debugHandled`.

#### 5.2 Live Commands (No Break Required)

**Idea**: Allow sending commands while execution is running, not just on breaks.

```
┌──────────────────────────────────────────────┐
│  Running: Step 5 of 20...                    │
│  [pause] [step] [break on next error]        │  ← always visible
│                                              │
│  > set foo to "bar"                          │  ← type commands live
└──────────────────────────────────────────────┘
```

This requires:
- The `Prompter` to accept input asynchronously (not just on `await prompt()`)
- A command queue processed by the Executor between steps
- Similar to how REPL debuggers work

**Implementation sketch:**
```typescript
// Prompter gets a background listener
world.prompter.onInput((input) => {
  // Queue for processing between steps
  world.runtime.commandQueue.push(input);
});

// In Executor, between steps:
while (world.runtime.commandQueue.length > 0) {
  const cmd = world.runtime.commandQueue.shift();
  await this.executeDebugCommand(cmd);
}
```

### 5. Monitor Steppers with IStepperCycles

Monitors implement `IStepperCycles.onEvent()` — see [monitor-core API](#monitor-core-api-surface) for the `EventView` class and [ConsoleMonitorStepper example](#3-console-monitor-in-haibunmonitor-console).

**Built-in monitor steppers:**

| Class | Purpose |
|-------|---------|
| `NdjsonOutputStepper` | Default NDJSON to stdout |
| `ConsoleMonitorStepper` | CI-focused plain text |
| `InkTuiStepper` | Interactive terminal |
| `BrowserMonitorStepper` | HTML file with video sync |
| `OTelExporterStepper` | Jaeger/Grafana export |

**Creating a custom monitor:**
```typescript
// In your-project/src/my-slack-monitor.ts
import { AStepper, IStepperCycles, THaibunEvent } from '@haibun/core';

export class SlackMonitorStepper extends AStepper implements IStepperCycles {
  steps = {};
  
  onEvent(event: THaibunEvent) {
    if (event.status?.code === 'ERROR') {
      this.sendToSlack(`❌ Step failed: ${event.name}`);
    }
  }
}
```

```json
// config.json
{ "steppers": ["@haibun/web-playwright", "./src/my-slack-monitor"] }
```

### 5.1 OpenTelemetry Module (`modules/otel`)

A new optional module that exports Haibun events as OpenTelemetry spans:

```typescript
// modules/otel/src/otel-stepper.ts
import { trace, Span, SpanStatusCode, context } from '@opentelemetry/api';

export class OTelExporterStepper extends AStepper implements IStepperCycles {
  steps = {}; // No steps, just cycles
  private tracer = trace.getTracer('haibun', '1.0.0');
  private spans = new Map<string, Span>();
  
  onEvent(event: THaibunEvent) {
    // Start events create spans
    if (event.attributes?.['haibun.stage'] === 'start') {
      const parentSpan = this.spans.get(event.parent_span_id);
      const ctx = parentSpan ? trace.setSpan(context.active(), parentSpan) : undefined;
      
      const span = this.tracer.startSpan(event.name, {
        // Use span links for speculative steps
        links: event.links?.map(l => ({ context: { traceId: l.trace_id, spanId: l.span_id } })),
        attributes: {
          'haibun.scope': event.attributes?.['haibun.scope'],
          'haibun.seqPath': event.span_id,
          'haibun.stepper': event.attributes?.['haibun.stepper'],
        }
      }, ctx);
      
      this.spans.set(event.span_id, span);
    }
    
    // End events close spans
    if (event.attributes?.['haibun.stage'] === 'end') {
      const span = this.spans.get(event.span_id);
      if (span) {
        span.setStatus({
          code: event.status?.code === 'ERROR' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
          message: event.status?.message
        });
        
        // Attach artifacts as span events
        if (event['haibun.artifacts']?.length) {
          for (const artifact of event['haibun.artifacts']) {
            span.addEvent('artifact', { type: artifact.artifactType });
          }
        }
        
        span.end();
        this.spans.delete(event.span_id);
      }
    }
    
    // Log events become span events (events without haibun.stage)
    if (!event.attributes?.['haibun.stage'] && event.events?.length) {
      const parentSpan = this.spans.get(event.span_id);
      event.events.forEach(e => parentSpan?.addEvent(e.name, e.attributes));
    }
  }
}
```

**Usage:**
```json
// config.json - monitors are steppers
{ "steppers": ["@haibun/web-playwright", "@haibun/monitor-otel"] }
```

**Benefits:**
- View test runs in Jaeger/Grafana
- Correlate with backend traces (distributed tracing)
- Standard tooling for performance analysis
- Speculative steps visible via span links

**`EventPersister`** is a subscriber that:
- Collects all events in memory
- Optionally streams to `haibun.ndjson` as they arrive
- At `onEnd()`, embeds events into HTML monitor template

This is not a physical class yet — it's a design for how persistence fits into the architecture.

### 6. Event Persistence Strategy

Events must be persisted for:
1. **CI logs** - Raw NDJSON for programmatic consumption
2. **HTML monitor** - Self-contained replay

**Solution: Dual-write from a persistence stepper**

```typescript
class EventPersisterStepper extends AStepper implements IStepperCycles {
  steps = {}; // No steps, just cycles
  private events: THaibunEvent[] = [];
  
  onEvent(event: THaibunEvent) {
    this.events.push(event);
    // Optionally stream to NDJSON file
    fs.appendFileSync('haibun.ndjson', JSON.stringify(event) + '\n');
  }
  
  async endExecution() {
    // Write embedded in HTML for self-contained monitor
    const html = fs.readFileSync('monitor-template.html', 'utf-8');
    const embedded = html.replace(
      '<!-- HAIBUN_EVENTS -->',
      `<script type="application/json" id="haibun-events">${JSON.stringify(this.events)}</script>`
    );
    fs.writeFileSync('monitor.html', embedded);
  }
}
```

### 7. Migration Strategy: Adapt TMessageContext First

**Simplest first step:** Create an adapter that converts `TMessageContext` → `THaibunEvent`, preserving all current behavior.

```typescript
// In Logger.ts - bridge old to new
out(level: TLogLevel, args: TLogArgs, messageContext?: TMessageContext) {
  // Convert to new event format
  const event = this.convertToEvent(level, args, messageContext);
  
  // Emit to new subscribers
  this.emitEvent(event);
  
  // Also emit to old subscribers during migration
  for (const subscriber of this.oldSubscribers) {
    subscriber.out(level, args, messageContext);
  }
}

private convertToEvent(level: TLogLevel, args: string, ctx?: TMessageContext): THaibunEvent {
  if (ctx?.incident === EExecutionMessageType.STEP_START) {
    return LifecycleEvent.parse({ /* ... */ });
  }
  // ... map all incident types
  return LogEvent.parse({ level, message: args, /* ... */ });
}
```

This allows incremental migration while keeping monitors working.

---

## Next Steps

> [!NOTE]
> **FLEXIBLE**: These phases are implementation guidelines. Order and exact steps may change as development progresses.

### Phase 1: Add onEvent to IStepperCycles

1. **Add `onEvent` hook to `IStepperCycles`**
   ```typescript
   interface IStepperCycles {
     // ... existing hooks ...
     onEvent?(event: THaibunEvent): void;  // NEW
   }
   ```

2. **Extend `Logger` to route events to steppers**
   - Add `emitEvent(event: THaibunEvent)` method
   - Logger calls `stepper.onEvent(event)` for all steppers with `onEvent`
   - Keep `out()` for backward compatibility during migration

3. **Create default `NdjsonOutputStepper`**
   - Auto-registered if no other monitor stepper configured
   - Outputs NDJSON to stdout for piping

4. **Deprecate `EventLogger`** – fold its functionality into `Logger`

### Phase 2: Migrate TMessageContext Usage

1. Convert each `TMessageContext` usage to the appropriate `THaibunEvent`:
   - `EExecutionMessageType.DEBUG` → `haibun.control` with `signal: 'break' | 'resume'`
   - `EExecutionMessageType.STEP_START/END` → lifecycle event
   - Artifacts → `haibun.artifacts`

2. Update `debugger-stepper` to:
   - Receive `haibun.control` events via its own `onEvent` hook
   - Emit control signals via events
   - Work with `Prompter` pattern for interactive input

### Phase 3: Create Monitor Steppers

1. **`@haibun/monitor-console`**
   - `ConsoleMonitorStepper` extends `AStepper` implements `IStepperCycles`
   - Formats `THaibunEvent` as plain text for CI
   - Uses existing lifecycle hooks + new `onEvent`

2. **`@haibun/monitor-ink`**  
   - `InkTuiStepper` with React/Ink components
   - Handles `haibun.control` for interactive debugging
   - Integrates with `Prompter` for CLI input

3. **Browser monitor in `@haibun/web-playwright`**
   - `BrowserMonitorStepper` replaces `MonitorHandler`
   - Uses `onEvent` hook, `ButtonPrompter` already works

### Phase 4: Default Monitor Selection

1. If no monitor stepper in config, auto-add `NdjsonOutputStepper`:
   ```typescript
   // In Runner setup
   if (!steppers.some(s => s.onEvent)) {
     steppers.push(new NdjsonOutputStepper());
   }
   ```

2. This enables piping: `haibun run | haibun-tui`

3. support a tool to output ndjson to any monitor stepper

### Phase 5: Complete TMessageContext Removal

1. Remove `TMessageContext` from `interfaces/logger.ts`
2. Remove `EExecutionMessageType` enum
3. Remove `ILogOutput` interface
4. Update all steppers using `messageContext` in action results

---

## 2. Schema Redesign: `TMessageContext` -> Zod

We will transition to strict **Zod** schemas designed for **External Consistency**.

### Key Design Principles
1.  **`seqPath` as Identity**: The deterministic path (e.g., `"1.2.1"`) is the primary key.
2.  **Public API Readiness**: Schemas use consistent naming and strict typing.
3.  **Inspectability**: Logs carry structured payloads for deep inspection.

### Implemented Zod Schemas (in `modules/core/src/schema/events.ts`)

#### Base Protocol
```typescript
const BaseEvent = z.object({
  id: z.string(), // seqPath
  timestamp: z.number().int(),
  source: z.string().default('haibun'),
});
```

#### 1. Lifecycle Events (Container Blocks)
```typescript
const LifecycleEvent = BaseEvent.extend({
  kind: z.literal('lifecycle'),
  type: z.enum(['feature', 'scenario', 'step', 'activity', 'waypoint', 'ensure', 'execution']),
  stage: z.enum(['start', 'end']),
  stepperName: z.string().optional(),
  actionName: z.string().optional(),
  label: z.string().optional(), 
  status: z.enum(['running', 'completed', 'failed', 'skipped']).optional(),
  error: z.string().optional(),
  intent: z.object({ mode: z.enum(['speculative', 'authoritative']).optional() }).optional(),
});
```

#### 2. Log Events (Atomic Evidence & Inspection)
```typescript
const LogEvent = BaseEvent.extend({
  kind: z.literal('log'),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error']),
  message: z.string(),
  payload: z.record(z.unknown()).optional(),
});
```

#### 3. Artifact Events (Time-Lined)
```typescript
const ArtifactEvent = BaseEvent.extend({
  kind: z.literal('artifact'),
  artifactType: z.enum(['video', 'image', 'html', 'json', 'file', 'network-trace', 'terminal']),
  mimetype: z.string(),
  path: z.string().optional(),
  isTimeLined: z.boolean().default(false),
  duration: z.number().optional(), 
});
```

#### 4. Control Events (for debugging)
```typescript
const ControlEvent = BaseEvent.extend({
  kind: z.literal('control'),
  signal: z.enum(['graph-link', 'break', 'pause', 'resume']),
  payload: z.record(z.unknown()),
});
```

> [!IMPORTANT]
> **`ControlEvent.signal` needs expansion** for debugger-stepper:
> - `break` - execution paused, waiting for prompt
> - `resume` - continue execution  
> - `step` - execute one step and break again
> - `fail` - mark step as failed and stop
> - `retry` - re-run the current step
> - `next` - skip to next step (ignore failure)

---

## 3. Code Organization & Architecture Cleanup

### A. Centralized "Truth" ✅ (Mostly Done)
- `modules/core/src/schema/events.ts` exists with Zod schemas
- **Remaining**: Remove `TMessageContext` and bridge to new schema

### B. Separation of Concerns (Runner vs. Renderer)
- **Current**: Executor emits to both `eventLogger` and `logger`
- **Target**: Single emission point, multiple subscribers

### C. Standardized Artifacts
- `ArtifactEvent` schema exists
- **Remaining**: Migrate `TArtifact` union type usage to `ArtifactEvent`

### D. Testing & Validation
- Can validate schema with Zod `.safeParse()`
- **Remaining**: Create JSON fixtures for monitor testing

---

## 4. Implementation Phases (Updated)

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Schema: Create Zod schemas | ✅ Complete |
| 2 | Runner Update: Emit via EventLogger | ⚠️ Partial (dual-emit) |
| 3 | Unify Logger: Subscriber pattern for events | 🔲 Not started |
| 4 | Monitor CLI: Ink TUI with debugging | ⚠️ Displays only, no debug |
| 5 | Monitor Web: Migrate from TMessageContext | 🔲 Not started |
| 6 | Remove TMessageContext | 🔲 Blocked by phases 3-5 |

---

## Open Questions

1. ~~**Interactive Control Flow**: How should `ControlEvent` responses flow back?~~
   - ✅ **Resolved**: Keep `Prompter` system. Events are unidirectional (Logger → Monitors), prompts are bidirectional.

2. ~~**CI Mode Detection**: How to auto-detect non-interactive environment?~~
   - ✅ **Resolved**: Check `process.stdout.isTTY`. Pipe mode works naturally via NDJSON stdin.

3. ~~**Event Persistence**: Should all events be written to a file for replay?~~
   - ✅ **Resolved**: Yes. `EventPersister` subscriber writes both NDJSON and embedded HTML.

4. **Testing the debugger**: How to make debugger-stepper easy to test?
   - Mock the `Prompter` with scripted responses
   - Use `IStepperCycle.onEvent` to capture emitted events
   - Test against recorded event fixtures

5. **LSP/Language Server support**: 
   - Added to improvements-plan.md
   - use for interactive debugging completion
   - Could use same event stream for real-time feedback

---

## Code Analysis: How This Plan Improves the Codebase

### Current Pain Points (With Evidence)

#### 1. Dual Logging System

**Evidence** (`Executor.ts` lines 179 vs 195-200):
```typescript
// Line 179: Uses old Logger with TMessageContext
this.logit(`start feature ${currentScenario}`, { incident: EExecutionMessageType.FEATURE_START, ... });

// Lines 195-200: Uses new EventLogger with Zod schemas
world.eventLogger.emit(LifecycleEvent.parse({
  id: world.tag.sequence.toString(),
  timestamp: Date.now(),
  kind: 'lifecycle',
  type: 'feature',
  stage: 'start',
  ...
}));
```

**Problem**: Same event (feature start) logged twice through different systems.
**Impact**: Confusion, wasted bytes, inconsistent data.

**Target solution**: Single `world.logger.log(lifecycle(...))` call.

---

#### 2. Complex Enum vs Simple Types

**Current** (`interfaces/logger.ts` lines 32-50):
```typescript
export enum EExecutionMessageType {
  INIT = 'INIT',
  EXECUTION_START = 'EXECUTION_START',
  FEATURE_START = 'FEATURE_START',
  SCENARIO_START = 'SCENARIO_START',
  STEP_START = 'STEP_START',
  STEP_NEXT = 'STEP_NEXT',
  ACTION = 'ACTION',
  TRACE = 'TRACE',
  STEP_END = 'STEP_END',
  ENSURE_START = 'ENSURE_START',
  ENSURE_END = 'ENSURE_END',
  SCENARIO_END = 'SCENARIO_END',
  FEATURE_END = 'FEATURE_END',
  EXECUTION_END = 'EXECUTION_END',
  ON_FAILURE = 'ON_FAILURE',
  DEBUG = "DEBUG",
  GRAPH_LINK = 'GRAPH_LINK',
}
```

**Problem**: 19 enum values that conflate:
- Lifecycle events (START/END)
- Log levels (TRACE, DEBUG)
- Control signals (ON_FAILURE, GRAPH_LINK)

**Target solution**: 4 event types with clear semantics:
```typescript
type: 'log' | 'lifecycle' | 'artifact' | 'control'
```

**Comparison to standard systems**:
| System | Pattern |
|--------|---------|
| OpenTelemetry | Trace spans (start/end) + Logs + Metrics |
| Chrome DevTools | Timeline events + Console |
| Jest | Test lifecycle + Reporter events |
| **Haibun Target** | Lifecycle + Log + Artifact + Control |

---

#### 3. No Subscriber Integration for CLI

**Evidence** (`monitor-cli/index.tsx` lines 25-36):
```typescript
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const json = JSON.parse(line);
  const event = HaibunEvent.safeParse(json);
  ...
});
```

**Problem**: CLI reads from stdin, not integrated with Logger's subscriber pattern.
**Impact**: Can't run CLI monitor in-process for testing. No bidirectional prompter.

**Target solution**: CLI as stepper with `IStepperCycles.onEvent()`:
```typescript
class InkMonitorStepper implements IStepperCycles {
  onEvent(event: THaibunEvent) {
    this.updateDisplay(event);
  }
}
```

---

#### 4. Awkward Artifact Attachment

**Evidence** (`Logger.ts` lines 84-96):
```typescript
export const topicArtifactLogger = (world: TWorld) => <T extends TArtifact>(
  message: TLogArgs,
  data: { incident: EExecutionMessageType, artifact?: T, incidentDetails?: TAnyFixme },
  level: TLogLevel = 'log'
): void => {
  const context: TMessageContext = {
    incident: data.incident,
    artifacts: data.artifact ? [data.artifact] : undefined,
    incidentDetails: data.incidentDetails,
  };
  world.logger[level](message, context);
}
```

**Problem**: Workaround function just to attach artifacts to logs.
**Impact**: Non-obvious API, extra indirection.

**Target solution**: Direct attachment via varargs:
```typescript
world.logger.log('Screenshot captured', artifact({ type: 'image', path }));
```

---

### Summary: How This Makes the Codebase Better

| Aspect | Before | After |
|--------|--------|-------|
| **Single source of truth** | 2 logging systems | 1 unified Logger |
| **Event types** | 19-value enum | 4 clear types |
| **Monitor integration** | stdin piping | `IStepperCycles` hooks |
| **Artifact attachment** | Helper function | Direct varargs |
| **Shared code** | None | `monitor-core` library |
| **Wire format** | Full JSON | JIT schema (~60% smaller) |
| **Speculative handling** | Ad-hoc CSS classes | Consistent filter logic |
| **Industry alignment** | Custom patterns | OpenTelemetry-like model |

### Ease of Reasoning

1. **One way to do things**: Log via `world.logger.<level>(content...)`. No choice paralysis.
2. **Events are data**: Zod schemas are inspectable, validatable, serializable.
3. **Monitors are steppers**: Same lifecycle as all other components.
4. **Filters are composable**: Level + depth + speculative, all in `monitor-core`.

### Standard Patterns Used

| Pattern | Industry Standard | Haibun Adoption |
|---------|-------------------|-----------------|
| Event sourcing | OpenTelemetry, Jaeger | Events as immutable records |
| Stepper lifecycle | Plugin architecture | `IStepperCycles.onEvent()` |
| Zod validation | tRPC, Hono | Schema-first API |
| JIT compression | Protobuf, Avro | Schema-on-first-use wire format |
| Span model | OpenTelemetry | `trace_id`, `span_id`, `links` |
