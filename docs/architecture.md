# Haibun Architecture: The Journey of a Feature Line

This document explains how Haibun processes feature files, grounded in a practical example: logging into a site, verifying all requests stay within allowed domains, and checking that no requests return 4xx/5xx or take longer than 5 seconds.

---

## Design Philosophy

Haibun extends behavior-driven development with literary programming and simple logic. The same file serves three purposes:
1. Define expected behavior
2. Verify systems match that specification
3. Explain the system to readers with up-to-date proof (screenshots, videos, network diagrams, etc)

The name comes from the Japanese literary form that combines prose and haiku. In Haibun:
- **Prose** (uppercase lines) describes intent and context
- **Steps** (lowercase lines) are executable statements, like haiku interspersed in prose

This case sensitivity rule creates self-documenting tests where prose and steps are visually distinct.

---

## The Example Feature

```gherkin
Feature: Secure Login Verification

Backgrounds: auth-setup

Scenario: Login and verify domain compliance

    go to the https://example.com/login webpage
    input credentials for username
    input secret for password
    click "Sign In"
    wait for "Dashboard"

    Verify all requests stayed within allowed domains and performed well.
    
    set of Allowed domains is ["example.com", "cdn.example.com", "api.example.com"]
    
    every host observed in http-trace hosts is some domain in Allowed domains is that {host} matches "*{domain}"
    
    every request observed in http-trace is variable {request}/status is less than 400
    
    every request observed in http-trace is variable {request}/time is less than 5000
```

Features are processed in phases—Collect, Expand, Resolve—before execution begins:

```mermaid
flowchart LR
    A["Feature Files"] --> B["Collector"]
    B --> C["Expand"]
    C --> D["Resolver"]
    D --> E["Executor"]
    E --> F["Stepper Actions"]
    F --> G["Monitors"]
```

---

## Phase 1: Collector

Reads files from `features/` and `backgrounds/` directories:

- `.feature` — Plain text BDD
- `.feature.ts` — TypeScript "kireji" (converted to BDD via `toBdd()`)

---

## Phase 2: Expand

`Backgrounds: auth-setup` is expanded inline—the referenced background file's content is merged at that position.

---

## Phase 3: Resolver

Resolution matches each line to a stepper action, building the complete execution plan before any steps run.

### Stop Word Stripping

`dePolite()` strips words from the start of a line:
```
^((given|when|then|and|should|the|it|I'm|I|am|an|a) )*
```

### Pattern Matching

For `go to the https://example.com/login webpage`:
- Pattern: `go to the { name } webpage`
- Captures: `{name}` = `https://example.com/login`

For `every request observed in http-trace is variable {request}/status is less than 400`:
- Pattern: LogicStepper's universal quantifier
- Parses: iteration source (`http-trace`), bound variable (`{request}`), nested statement

### Waypoint Resolution

Waypoints are registered during resolution. When the resolver encounters an `Activity:` block, it collects the steps before `waypoint` statements as the activity body, then generates a dynamic step that matches the corresponding `ensure` call with a proof, or a statement call with no proof.

---

## Phase 4: Executor

The Executor runs resolved features through stepper lifecycle methods. Steppers that implement `IStepperCycles` can hook into execution at various points:

```
startExecution(features)     
  startFeature(feature)      
    startScenario(scopedVars)
      beforeStep(step)       
      [ACTION]               
      afterStep(step, result)
    endScenario()
  endFeature()
endExecution(results)
```

Throughout execution, `onEvent(event)` is called for each lifecycle event, log, or artifact. Monitors use this to observe and record execution.

For example, when `click "Sign In"` executes:
1. `beforeStep` fires — debugger can pause here
4. `onEvent` broadcasts the step start to monitors
2. WebPlaywright's `click` step action runs
3. `afterStep` fires — monitors record the result, `after every` hooks run
4. `onEvent` broadcasts the step completion to monitors

---

## Logic System

Haibun includes logical constructs for expressing verification rules declaratively. It uses first order logic to reason about objects and their relationships using return values from any step.

### Negation

`not statement` inverts the result:
```
not variable status is "Error"
```

### Conditionals

`where condition, action` and `unless condition, action`:
```
where variable env is "staging", set debug to "true"
```

### Quantifiers

Quantifiers iterate over domains or observation sources:

- `every x in domain is statement` — Universal quantifier (∀). Passes if statement succeeds for all values.
- `some x in domain is statement` — Existential quantifier (∃). Passes if statement succeeds for at least one value.

The bound variable `{x}` is available within the nested statement. From the example:
```
every request observed in http-trace is variable {request}/status is less than 400
```

This reads: "for every request captured in http-trace, verify that its status is less than 400."

Quantifiers, like other Haibun steps, are compasable. The nested form `every
... is some ... is that ...` expresses "for all X, there exists Y such that
predicate(X, Y)":
```
every host observed in http-trace hosts is some domain in Allowed domains is that {host} matches "*{domain}"
```

---

## Activities and Waypoints

Activities implement idempotent, goal-oriented testing. 

1. `ensure Outcome` first checks the proof (P)
2. If proof passes, skip the activity (efficiency)
3. If proof fails, run the activity (A), then re-check the proof

```gherkin
Activity: User is logged in
go to the login webpage
input credentials for username
click "Sign In"
set Logged in to true
waypoint User authenticated with variable Logged in is true

ensure User authenticated  ;; skips activity if already logged in
```

Waypoints can be parameterized:
```
waypoint Navigate to {page} with variable WebPlaywright.currentURI is {page}

ensure Navigate to mainUrl
ensure Navigate to haibunUrl
```

---

## Domains

Domains act as types in a formal system. A variable's domain constrains what values it can hold (soundness).

```gherkin
set of roles is ["admin", "editor", "viewer"]
set user_role as roles to "admin"
not set user_role as roles to "guest"  ;; would fail: "guest" not in roles
not set x as number to "twentynine"
not set x as json to {woops
```

Ordered domains enable comparisons and state machines:
```
ordered set of Status is ["draft", "review", "published"]
set doc_status as Status to "draft"
increment doc_status
variable doc_status is "review"
variable doc_status is less than "published"
```

---

## Steppers

### Core Steppers

| Stepper | Example Steps |
|---------|---------------|
| Haibun | `Backgrounds: name`, `Feature:`, `Scenario:`, `until statement`, `after every StepperName, statement` |
| VariablesStepper | `set var to "value"`, `variable var is "value"`, `set of domain is [values]`, `that {x} matches "pattern"`, `increment var` |
| ActivitiesStepper | `Activity: name`, `waypoint Label with proof`, `ensure outcome` |
| LogicStepper | `not statement`, `if condition, action`, `every x in domain is statement`, `some x in domain is statement` |
| DebuggerStepper | `debug step by step`, `debug stepper StepperName`, `continue stepper StepperName`; debugger commands: `step`, `continue`, `retry`, `next`, `fail` |

### Web Steppers

| Stepper | Example Steps |
|---------|---------------|
| WebPlaywright | `go to the {uri} webpage`, `click "{target}"`, `click "{target}" by "placeholder"`, `input {what} for {field}`, `wait for "{target}"`, `see "{text}"`, `cookie {name} is {value}`, `take a screenshot` |
| WebServerStepper | `serve files at /path from "dir"` |
| A11yStepper | `page is accessible accepting serious {N} and moderate {N}` |
| WebHttp | `fetch from {url} is "{expected}"` |

### Storage Steppers

| Stepper | Purpose |
|---------|---------|
| StorageFS | File system artifact storage |
| StorageMem | In-memory storage for tests |

---

## Observations

Observation sources provide runtime metrics for quantifier iteration via `observed in`:

| Source | Metrics | Provider |
|--------|---------|----------|
| `step usage` | `count` | Core |
| `stepper usage` | `count` | Core |
| `http-trace` | `url`, `status`, `time`, `method` | WebPlaywright |
| `http-trace hosts` | `count` | WebPlaywright |

Steppers register sources via `getConcerns()` in their cycles.

---

## Monitors

Monitors receive `THaibunEvent` via `onEvent` during execution. They track progress, emit telemetry, and generate reports.

| Monitor | Purpose |
|---------|---------|
| MonitorBrowserStepper | Real-time web UI with timeline, artifact viewer, debugger. Generates standalone HTML reports. |
| MonitorOtelStepper | OpenTelemetry traces to OTLP backends. Features become root spans; steps become child spans. |
| ConsoleMonitorStepper | Simple console output. |

---

## Variable Resolution

`FeatureVariables.resolveVariable()` resolves values based on origin:

For `Origin.defined` (the common case for unquoted variable references):

1. runtimeArgs — Check `featureStep.runtimeArgs[term]` (bound by quantifiers like `every x in`)
2. Environment — Check `world.options.envVariables[term]`
3. Stored variables — Check `this.values[term]` (set via `set foo to "bar"`)
4. Literal fallback — If the term looks like a literal value (contains special chars), use it directly

For `Origin.quoted` (quoted strings like `"literal value"`):
- If `{varName}` syntax inside quotes, resolve via runtimeArgs → stored
- Otherwise, strip quotes and use as literal

For `Origin.var`: Direct lookup in stored values

For `Origin.env`: Direct lookup in environment variables

---

## TypeScript Features (Kireji)

For `.feature.ts` files, type-safe helpers generate BDD statements:

```typescript
import { withAction } from '@haibun/core/kireji/withAction.js';
import type { TKirejiExport } from '@haibun/core/kireji/withAction.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';

const { set, compose } = withAction(new VariablesStepper());
const { activity, ensure } = withAction(new ActivitiesStepper());

export const backgrounds: TKirejiExport = {
    'Login setup': [
        activity({ activity: 'Setup credentials' }),
        set({ what: 'baseUrl', value: 'https://example.com' }),
        compose({ what: 'loginUrl', template: '{baseUrl}/login' }),
        'waypoint Credentials ready with variable baseUrl exists',
    ]
};

export const features: TKirejiExport = {
    'Login verification': [
        ensure({ outcome: 'Credentials ready' }),
        'go to the {loginUrl} webpage',  // Raw strings passed through
        'click "Sign In"',
    ]
};
```

---

## Extension Points

| Extension | How |
|-----------|-----|
| New Steppers | Extend `AStepper`, define `steps` object with `gwta`/`match`/`exact` patterns |
| Lifecycle Hooks | Implement `IStepperCycles` (`startFeature`, `afterStep`, `onEvent`, etc.) |
| Domains | Register `TDomainDefinition` with schema and coercer |
| Observation Sources | Implement `IObservationSource` for quantifier iteration (`observed in source`) |
| Monitors | Implement `onEvent` to receive execution telemetry |
