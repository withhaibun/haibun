# @haibun/monitor-otel

OpenTelemetry monitor for Haibun - exports test execution traces to observability platforms.

## What Does This Module Do?

This monitor captures every step of your test execution and sends it to an observability platform like Jaeger. With it you can:

- **See your tests visually** - View the execution flow as a timeline/graph
- **Debug failures** - Identify exactly which step failed and why
- **Measure performance** - See how long each step takes
- **Understand nesting** - See how Activities, Waypoints, and Quantifiers expand into their component steps

## What You'll See in Jaeger

When you open Jaeger after running tests, you'll see **traces** - visual representations of your test execution.

### For Casual Users

A trace looks like a timeline showing each step of your test:

```
┌─ feature: haibun-execution ────────────────────────────────────────┐
│                                                                     │
│  ├─ step: set username to "alice"           [5ms]                  │
│  ├─ step: go to the login page              [150ms]                │
│  ├─ step: fill in username field            [12ms]                 │
│  ├─ step: click submit button               [8ms]                  │
│  └─ step: verify welcome message appears    [45ms]                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Each bar shows a step, its name, and how long it took. Longer bars = slower steps.

### For Technical Users

Traces capture the full Haibun execution model:

- **Root span**: The entire feature execution
- **Child spans**: Each step with full context including:
  - Stepper name (`VariablesStepper`, `WebPlaywrightStepper`, etc.)
  - Action name (`set`, `click`, `navigate`, etc.)
  - Execution mode (`authoritative` vs `speculative`)
  - Error details on failures

Nested Haibun constructs create nested spans:

```
feature: haibun-execution
├─ step: ensure User is authenticated           ← ensure Waypoint
│   └─ step: User is authenticated              ← Waypoint body
│       ├─ step: go to login page
│       └─ step: verify logged in
├─ step: every item in cart is verify price     ← Quantifier
│   ├─ step: verify price (item=Widget)         ← Iteration 1
│   └─ step: verify price (item=Gadget)         ← Iteration 2
```

## Haibun Concepts → Trace Structure

| Haibun Concept | How It Appears in Traces |
|----------------|--------------------------|
| **Feature** | Root span containing all steps |
| **Steps** | Individual child spans with timing |
| **Activities** | Parent span with child spans for each step in the Activity body |
| **Waypoints with `ensure`** | Shows `ensure <Waypoint>` → `<Waypoint>` → body steps |
| **Quantifiers (`every`/`some`)** | Parent span with repeated child spans for each iteration |
| **Speculative steps** | Tagged with `haibun.intent.mode: speculative` |
| **Failed steps** | Red, with `status: ERROR` and error message in attributes |

## Span Attributes Reference

Click any span in Jaeger to see its attributes:

| Attribute | Description | Example |
|-----------|-------------|---------|
| `haibun.stepper` | Which stepper handled this step | `VariablesStepper` |
| `haibun.action` | The action name | `set`, `click`, `ensure` |
| `haibun.event.id` | Step sequence path | `[1.1.3]` |
| `haibun.intent.mode` | Execution mode | `authoritative` or `speculative` |
| `haibun.error` | Error message (if failed) | `Element not found` |
| `haibun.speculative.failed` | True if speculative step failed | `true` |

For a comprehensive example demonstrating Activities, Waypoints, Quantifiers, and more, see [AGENTS.md](../../AGENTS.md) - run it with this monitor to see the corresponding trace structure in Jaeger.

---

## Quick Start

### 1. Start the local observability stack

```bash
cd modules/monitor-otel
docker-compose up -d
```

This starts:
- **OpenTelemetry Collector** - receives and routes telemetry data
- **Jaeger** - trace visualization at [http://localhost:16686](http://localhost:16686)
- **Prometheus** - metrics at [http://localhost:9091](http://localhost:9091)

### 2. Add to your project config

In your test project's `config.json`:
```json
{
  "steppers": [
    "@haibun/monitor-otel/build/index",
    // ... other steppers
  ]
}
```

### 3. Run tests and view traces

```bash
haibun-cli -c config.json tests
```

Then open [http://localhost:16686](http://localhost:16686), select service "haibun", and click "Find Traces".

## Configuration

| Option | Environment Variable | Default |
|--------|---------------------|---------|
| `OTEL_ENDPOINT` | `HAIBUN_O_MONITOROTELSTEPPER_OTEL_ENDPOINT` | `http://localhost:4318` |
| `SERVICE_NAME` | `HAIBUN_O_MONITOROTELSTEPPER_SERVICE_NAME` | `haibun` |

## Testing

```bash
# Unit tests
npm test

# Integration tests (requires Docker stack running)
docker-compose up -d
npm run test:integration
```

## Cloud Backends

Set the OTLP endpoint environment variable to use cloud observability platforms:

```bash
# Grafana Cloud
HAIBUN_O_MONITOROTELSTEPPER_OTEL_ENDPOINT=https://otlp-gateway-prod-us-central-0.grafana.net/otlp

# Honeycomb  
HAIBUN_O_MONITOROTELSTEPPER_OTEL_ENDPOINT=https://api.honeycomb.io
```
