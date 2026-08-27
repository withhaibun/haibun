Feature: Walking toward a goal one step at a time

A goal gets reached by running the steps that produce it. Where those steps need nothing, `pursue` runs the whole path at once. Where a step needs something from the person walking it, the path gets walked instead: begun, then advanced with what each step takes.

Scenario: A path whose only step needs an argument

set aVariable to "what was walked to"

Beginning a walk resolves the goal and holds the path chosen, stopping before its first step.

set walk from walk toward "var-snapshot"
variable walk.status is "pending"
variable walk.stepIndex is 0
variable walk.next is "VariablesStepper-showVar"

A walk names what its next step takes, as that step declares it, which an advance then supplies.

variable walk.needs.0 is "what"

Advancing runs that step with what it was given. This path had one step, so the walk completes, and what it produced gets recorded against it.

set advanced from advance the walk `walk.walk` with {"what": "aVariable"}
variable advanced.status is "completed"
variable advanced.stepIndex is 1
variable advanced.factIds.length is 1
