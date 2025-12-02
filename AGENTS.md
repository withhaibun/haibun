# Haibun Agents Guide

## What is Haibun?

Haibun is a declarative, logic-based, literate framework that unifies specification, testing, and documentation in a single executable format.

The same file serves three purposes: defining expected behavior, verifying systems against that specification, and explaining the system to readers.

> [!TIP]
> This document is executable. Lines starting with lowercase letters are steps. Run `npm test -- agents` to execute all examples.

> [!IMPORTANT]
> The ecosystem evolves. Rely on runtime discovery rather than static documentation.

## Core Philosophy

### Literate Programming

Documentation becomes the test. Prose provides context. Executable steps verify behavior.

### Specification = Test = Documentation

Three purposes, one artifact.

### Waypoints Over Variables

Waypoints verify system states and behaviors.

Variables serve three purposes:
- Parameterization across environments
- Reusability of test logic
- Lightweight state tracking for test efficiency

Variables track configuration and test state, not primary system verification.

## What Can You Test?

Steppers are modules that provide testing capabilities.

Web applications, custom systems, any domain you extend.

## The Interactive Debugger

Runtime introspection reveals available capabilities and current state.

show steppers ;; all available steps
show vars ;; variable state  
show domains ;; type domains
show waypoints ;; verified goals

These steps guide development and debugging.

## Case Sensitivity Rule

**Steps** start with **lowercase** letters.
**Prose** (documentation) starts with uppercase or symbols.

set example to "test"
variable example is "test"

## Part 1: Compound Statements

Compound statements combine multiple steps or introduce control flow.

### The Statement Domain

Many steps accept a `{statement}` parameter—a domain representing single-line executable text.

Compound statements use the statement domain to compose logic:

set x to "1"
where variable x is "1", set y to "2" ;; where accepts condition and action statements

### Examples of Compound Steps

- `where {condition}, {action}` - Conditional
- `whenever {condition}, {action}` - Loop
- `any of {stmt}, {stmt}, ...` - Disjunction
- `until {statements}` - Repeat until success

## Part 2: Activities & Waypoints

Activities and waypoints enable goal-oriented, self-healing tests.

### Defining Activities

Activities represent high-level goals or workflows.

Activity: Initialize System
set system_ready to "false"
set system_ready to "true"
waypoint System is ready with variable system_ready is "true"

Activity steps are NOT indented—they follow the Activity line at the same level.

### Waypoints as Goals

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

### Self-Healing Pattern

Makes tests idempotent and resilient.

Activity: Create Admin
set admin_exists to "false"
set admin_exists to "true"
waypoint Admin exists with variable admin_exists is "true"

ensure Admin exists ;; runs activity if needed
ensure Admin exists ;; skips activity (already satisfied)

## Part 3: Variables

Variables enable parameterization and reusable test configurations.

### Purpose of Variables

Use variables for:
- Configuration (URLs, credentials)
- Test data parameterization
- Cross-environment reusability

Avoid using variables to track system state—use waypoints instead.

### Setting Variables

set base_url to "https://example.com"
set timeout as number to 30
set user_email to "test@example.com"

### Checking Variables

variable base_url is "https://example.com"
variable timeout is 30

show vars ;; inspect all variables with domains and values

## Part 4: Domains

Domains provide type safety and enable ordered comparisons.

### Unordered Sets

set of roles is ["admin", "editor", "viewer"]
set user_role as roles to "admin"

### Ordered Sets

ordered set of priorities is ["low", "medium", "high", "critical"]
set task_priority as priorities to "low"

show domains ;; see all registered domains

### Built-in Domains

Three built-in domains: `string`, `number`, `json`.

set count as number to 0
set config as json to {"enabled": true}

## Part 5: Ordered Sets & Comparisons

Ordered sets enable state machines and efficient waypoint checks.

### Defining Order

ordered set of statuses is ["draft", "review", "published"]
set doc_status as statuses to "draft"

### Comparisons

variable doc_status is less than "published" ;; true

### Incrementing

increment doc_status
variable doc_status is "review"

### Efficient Waypoint Checks

Comparisons enable reusable waypoints that check minimum state.

ordered set of deployment_stages is ["created", "configured", "deployed", "verified"]
set stage as deployment_stages to "created"

Activity: Deploy Application
whenever variable stage is less than "deployed", increment stage
waypoint Application is at least deployed with not variable stage is less than "deployed"

The proof "not less than deployed" succeeds for "deployed" or "verified".

This allows efficient tests: check if state is AT LEAST deployed, not exactly deployed.

ensure Application is at least deployed
variable stage is "deployed"

## Part 6: Logic & Control Flow

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

### State Machine Example

ordered set of workflow_states is ["start", "process", "validate", "complete"]
set workflow as workflow_states to "start"
whenever variable workflow is less than "complete", increment workflow
variable workflow is "complete"

## Part 7: Advanced Patterns

### Domain-Driven Workflows

ordered set of ticket_states is ["open", "assigned", "resolved", "closed"]
set ticket as ticket_states to "open"

Activity: Process Ticket
whenever variable ticket is less than "closed", increment ticket
waypoint Ticket is closed with variable ticket is "closed"

ensure Ticket is closed

### Parameterized Tests

set api_endpoint to "api.staging.example.com"
set api_timeout as number to 5000

Activity: API Health Check
set api_healthy to "false"
set api_healthy to "true"
waypoint API responds with variable api_healthy is "true"

ensure API responds

## Part 8: Comments

Use `;;` for inline explanations.

set max_retries to "5" ;; allows robust retry logic
show vars ;; inspect current state

## Common Patterns

### Pattern 1: Self-Healing Setup

Activity: Environment Setup
set env_configured to "false"
set env_configured to "true"
waypoint Environment is configured with variable env_configured is "true"

ensure Environment is configured

### Pattern 2: Efficient State Checks

ordered set of phases is ["init", "ready", "active"]
set phase as phases to "init"

Activity: Activate System
whenever variable phase is less than "active", increment phase
waypoint System is at least ready with not variable phase is less than "ready"

Check for minimum required state (at least "ready"), not exact state.

ensure System is at least ready ;; activity increments to "active", proof passes
variable phase is "active" ;; verify the activity ran to completion

### Pattern 3: Parameterized Workflows

set target_env to "production"

Activity: Deploy to Environment
set deployed to "false"
set deployed to "true"
waypoint Deployed to target with variable deployed is "true"

ensure Deployed to target

## Next Steps

Explore real examples in `e2e-tests/tests/features/`:
- Web automation
- Complex workflows
- Self-healing patterns
- Domain-driven testing

Remember: **Waypoints verify goals, variables configure tests.**
