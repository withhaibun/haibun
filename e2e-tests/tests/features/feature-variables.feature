
This feature sets variables outside a feature, at the feature level and at the scenario level. It checks the scope of each.


Every level reads this variable. A scenario can override it. The override holds for the rest of the feature. The next feature reads the original value.
set outsideVariable to "outsideValue"

Feature: First feature

This variable is at the feature level.
set featureVariable to "f1value"

Scenario: Check the variable and set it

variable outsideVariable is "outsideValue"
variable featureVariable is "f1value"

This scenario overrides the feature and outside variables. It sets a scenario variable as well.

set featureVariable to "f1s1value"
set scenarioVariable to "s1value"
set outsideVariable to "f1s1overridden"

Scenario: Variable carries over to next scenario

variable featureVariable is "f1s1value"
variable scenarioVariable is "s1value"
variable outsideVariable is "f1s1overridden"

Feature: Second feature

A new feature restores the variables to their values before the first scenario. The outside and feature variables hold the values their levels set. The scenario variable doesn't exist.

variable outsideVariable is "outsideValue"
variable featureVariable is "f1value"
not variable scenarioVariable exists

