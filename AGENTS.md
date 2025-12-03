# Haibun agents guide

This document is designed for human and AI developers. It can be verified from [e2e-tests](e2e-tests/tests/features/agents-examples.feature).

## What is Haibun?

Haibun is a declarative, logic-grounded, literate orchestrator designed to unify specification, verification, and documentation in a single "executable" format.

The same file serves three purposes: defining expected behavior, verifying systems against that specification, and explaining the system to readers. All statements are reusable, built on a tested core and steppers.

> This document can be verified; lines starting with lowercase letters are steps. Run `npm test -- agents` in the e2e-tests directory to execute all examples.

## Core philosophy

### Literate programming

Documentation becomes the test; prose provides context, and executable statements verify behavior. All statements are strictly validated.

## What can be tested?

Web applications, custom systems, and other domains can be tested via a mix of reusable steppers that execute steps.

Steppers are modules that provide testing capabilities. They are configured via a config.json file, and each may have their own runtime options. Use `--help` with haibun-cli and a config.json (typically, `npm test -- --help`to see current options.

## Case sensitivity rule

**Prose** (description) lines start with **uppercase or symbols**, analogous to the objective prose of Haibun.
**Steps** statements start with **lowercase** letters, analogous to the haikus of Haibun.

    set example to "test"
    variable example is "test"

Steps can also be written as Typescript modules, analogous to kireji, identified with .feature.ts. They can be mixed with text form and are displayed in text form during execution. Kireji provides syntax checking and navigation. See [examples in e2e-tests](e2e-tests/tests/features/).

## Part 1: Compound statements

Compound statements combine multiple steps in one line. 

### The statement domain

Many steps accept a `{statement}` parameter; a domain representing executable statments.

Compound statements use the statement domain to compose logic:

    set x to "1"
    where variable x is "1", set y to "2" ;; where accepts condition and action statements

### Examples of compound steps

- `where {condition}, {action}` - Conditional
- `whenever {condition}, {action}` - Loop
- `any of {stmt}, {stmt}, ...` - Disjunction
- `until {statements}` - Repeat until success
- `not {statement}` - Negation

## Part 2: Activities & waypoints

Activities and waypoints enable reusable goal-oriented, idempotent tests.

NB The ensure pattern guarantees prerequisites, not outcomes. Use ensure to establish the starting state required for a test (e.g. auth or database setup). Avoid using ensure to enforce the primary behavior under test, as it may obscure failure logic by "correcting" it.

```mermaid
graph TD
    A[Start 'ensure Goal'] --> B{Check Goal Proof}
    B -- Pass --> C[Skip Activity \n(Idempotent)]
    B -- Fail --> D[Run 'Activity' Steps]
    D --> E{Check Goal Proof Again}
    E -- Pass --> F[Success]
    E -- Fail --> G[Fail Test]
```

### Defining activities

Activities represent high-level goals or workflows.

    Activity: Initialize System
    set system_ready to "false"
    set system_ready to "true"
    waypoint System is ready with variable system_ready is "true"

### Waypoints as goals

Waypoints define verifiable goals with proof steps.

    Activity: Setup Database
    set db_ready to "false"
    set db_ready to "true"
    waypoint Database is initialized with variable db_ready is "true"

### Using ensure

Verifies the waypoint's proof.

If the proof passes: skip the activity (efficiency).
If the proof fails: run the activity, then re-check the proof.

    ensure System is ready
    ensure Database is initialized

    show waypoints ;; see all verified waypoints

### Idempotent pattern

Makes tests idempotent and resilient.

    set count as number to 0

    Activity: Create Admin
    set admin_exists to "false"
    increment count
    set admin_exists to "true"
    waypoint Admin exists with variable admin_exists is "true"

    ensure Admin exists ;; runs activity if needed
    ensure Admin exists ;; skips activity (already satisfied)
    variable count is 1

## Part 3: Variables

Variables enable parameterization and reusable test configurations between environments.

### Purpose of variables

Use variables for:
- Configuration (URLs, credentials)
- Test data parameterization including for waypoints
- Test efficiency (eg track expected entity state)
- Cross-environment reusability

Avoid using variables to track live system state, use waypoints instead.

### Setting variables

    set base_url to "https://example.com"
    set timeout as number to 30
    set user_email to "test@example.com"

### Checking variables

    variable base_url is "https://example.com"
    variable timeout is 30

    show vars ;; inspect all variables with domains and values

### Built-in variables

These variables are updated by steppers when they are active.

`WebPlaywright.currentURI` and `WebPlaywright.navigationCount` during page navigation.

## Part 4: Domains

Domains act as **Types** (or Sets) in a formal system, defining a universe of valid values. Variables are **Terms** that must belong to a specific Domain ($x \in D$).

### Unordered sets

    set of roles is ["admin", "editor", "viewer"]
    set user_role as roles to "admin"

### Soundness and Validation

Haibun enforces **soundness** by preventing invalid states. A variable cannot hold a value outside its domain.

    not set user_role as roles to "guest" ;; without `not`, this would fail because "guest" is not in roles

### Ordered sets

Domains can define a comparator, enabling formal logical operations like `is less than`.

    ordered set of priorities is ["low", "medium", "high", "critical"]
    set task_priority as priorities to "low"

    show domains ;; see all registered domains
    show domain roles ;; see detailed definition and members of 'roles'

### Built-in domains

`string`, `number`, `json`, `date`, and `page-locator`.

    set count as number to 0
    set config as json to {"enabled": true}

## Part 5: Ordered sets & comparisons

Ordered sets enable state machines and efficient waypoint checks.

### Defining order

    ordered set of statuses is ["draft", "review", "published"]
    set doc_status as statuses to "draft"

### Comparisons

    variable doc_status is less than "published" ;; true

### Incrementing

    increment doc_status
    variable doc_status is "review"

### Efficient waypoint checks

Comparisons enable reusable waypoints that check minimum state.

    ordered set of order_stages is ["placed", "packed", "shipped", "delivered"]
    set order_status as order_stages to "placed"

    Activity: Process order
    whenever variable order_status is less than "shipped", increment order_status
    waypoint Order is at least shipped with not variable order_status is less than "shipped"

The proof "not less than shipped" succeeds for "shipped" or "delivered".

This allows efficient tests: check if state is AT LEAST shipped, not exactly shipped.

    ensure Order is at least shipped
    variable order_status is "shipped"

## Part 6: Logic & control flow

Logic steps enable complex workflows and conditional behavior.

### Conditionals

    set env to "staging"
    where variable env is "staging", set debug to "true"
    variable debug is "true"

### Disjunction

    set status to "Success"
    any of variable status is "Success", variable status is "Completed"

### Negation

    not variable status is "Error"

### Loops

    set counter as number to 0
    whenever variable counter is less than 3, increment counter
    variable counter is 3

### State machine example

    ordered set of workflow_states is ["start", "process", "validate", "complete"]
    set workflow as workflow_states to "start"
    whenever variable workflow is less than "complete", increment workflow
    variable workflow is "complete"

## Part 7: Usage patterns

NB these tests use variables for proofs, in a "live" system they might rely on API endpoints or browser elements.

### Domain-driven workflows

    ordered set of Ticket states is ["open", "assigned", "resolved", "closed"]
    set ticket as Ticket states to "open"

    Activity: Process ticket
    whenever variable ticket is less than "closed", increment ticket
    waypoint Ticket is closed with variable ticket is "closed"

    ensure Ticket is closed

### Parameterized tests

    set API Endpoint to "api.staging.example.com"
    set API Timeout as number to 5000

    Activity: API health check
    set API Status to "false" 
    set API Status to "true"
    waypoint API responds with variable API Status is "true"

    ensure API responds 

## Part 8: Comments

Inline explanations use `;;`.

    set max_retries to "5" ;; allows robust retry logic
    show vars ;; inspect current state

## Common patterns

### Pattern 1: Idempotent setup

    Activity: Environment setup
    set Environment configured to "false"
    set Environment configured to "true"
    waypoint Environment is configured with variable Environment configured is "true"

    ensure Environment is configured

### Pattern 2: Efficient state checks

    ordered set of Approval stages is ["draft", "reviewed", "approved"]
    set Document stage as Approval stages to "draft"

    Activity: Approve document
    whenever variable Document stage is less than "approved", increment Document stage
    waypoint Document is at least reviewed with not variable Document stage is less than "reviewed"

    Checks for minimum required state (at least "reviewed"), not exact state.

    ensure Document is at least reviewed ;; activity increments to "approved", proof passes
    variable Document stage is "approved" ;; verify the activity ran to completion

### Pattern 3: Parameterized workflows

    Activity: Publish article
    set published to {article}
    waypoint Article {article} is published with variable published is {article}

    ensure Article "Writing haibuns" is published

### Pattern 4: Dynamic domains

    set of entities is ["a", "b"]

    Activity: Initialize entities for {name}
    every entity in entities is ordered set of {name}/{entity} is ["void", "created"]
    every entity in entities is set status_{name}/{entity} as {name}/{entity} to "void"
    waypoint Entities initialized for {name} with every entity in entities is variable status_{name}/{entity} is "void"

    ensure Entities initialized for test

## Next steps

Examples are available in `e2e-tests/tests/features/.
