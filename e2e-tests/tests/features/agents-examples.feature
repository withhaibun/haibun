# Haibun agents guide

## What is Haibun?

Haibun is a declarative, logic-based, literate framework designed to unify specification, verification, and documentation in a single executable format.

The same file serves three purposes: defining expected behavior, verifying systems against that specification, and explaining the system to readers.

> This document is executable; lines starting with lowercase letters are steps. Run `npm test -- agents` to execute all examples.
> The ecosystem evolves. Rely on runtime discovery rather than static documentation.

## Core philosophy

### Literate programming

Documentation becomes the test. Prose provides context. Executable steps verify behavior.

### Waypoints over variables

Waypoints verify system states and behaviors.

Variables serve three purposes:
- Parameterization across environments
- Reusability of test logic
- Lightweight state tracking for test efficiency

Variables track configuration and test state, not primary system verification.

## What can be tested?

Steppers are modules that provide testing capabilities.

Web applications, custom systems, and extended domains can be tested.

## Case sensitivity rule

**Steps** start with **lowercase** letters.
**Prose** (documentation) starts with uppercase or symbols.

set example to "test"
variable example is "test"

## Part 1: Compound statements

Compound statements combine multiple steps or introduce control flow.

### The statement domain

Many steps accept a `{statement}` parameter—a domain representing executable statments.

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

Activities and waypoints enable reusable goal-oriented, self-healing tests.

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

### Self-healing pattern

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
- Test data parameterization
- Cross-environment reusability
- Test efficiency (eg track expected entity state)

Avoid using variables to track live system state — use waypoints instead.

### Setting variables

set base_url to "https://example.com"
set timeout as number to 30
set user_email to "test@example.com"

### Checking variables

variable base_url is "https://example.com"
variable timeout is 30

show vars ;; inspect all variables with domains and values

## Part 4: Domains

Domains provide type safety and enable ordered comparisons.

### Unordered sets

set of roles is ["admin", "editor", "viewer"]
set user_role as roles to "admin"

### Ordered sets

ordered set of priorities is ["low", "medium", "high", "critical"]
set task_priority as priorities to "low"

show domains ;; see all registered domains

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

## Part 7: Advanced patterns

### Domain-driven workflows

ordered set of ticket_states is ["open", "assigned", "resolved", "closed"]
set ticket as ticket_states to "open"

Activity: Process ticket
whenever variable ticket is less than "closed", increment ticket
waypoint Ticket is closed with variable ticket is "closed"

ensure Ticket is closed

### Parameterized tests

set api_endpoint to "api.staging.example.com"
set api_timeout as number to 5000

Activity: API health check
set api_healthy to "false" 
set api_healthy to "true"
waypoint API responds with variable api_healthy is "true"

ensure API responds 

## Part 8: Comments

Inline explanations use `;;`.

set max_retries to "5" ;; allows robust retry logic
show vars ;; inspect current state

## Common patterns

### Pattern 1: Self-healing setup

Activity: Environment setup
set env_configured to "false"
set env_configured to "true"
waypoint Environment is configured with variable env_configured is "true"

ensure Environment is configured

### Pattern 2: Efficient state checks

ordered set of approval_stages is ["draft", "reviewed", "approved"]
set doc_stage as approval_stages to "draft"

Activity: Approve document
whenever variable doc_stage is less than "approved", increment doc_stage
waypoint Document is at least reviewed with not variable doc_stage is less than "reviewed"

Check for minimum required state (at least "reviewed"), not exact state.

ensure Document is at least reviewed ;; activity increments to "approved", proof passes
variable doc_stage is "approved" ;; verify the activity ran to completion

### Pattern 3: Parameterized workflows

Activity: Publish article
set published to {article}
waypoint Article {article} is published with variable published is {article}

ensure Article "Writing haibuns" is published

## Next steps

Real examples are available in `e2e-tests/tests/features/`:
- Web automation
- Complex workflows
- Self-healing patterns
- Domain-driven testing
