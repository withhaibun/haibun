
We set up outside, feature and scenario level variables to check scope.


This variable should carry through at all levels (though it can be overriden within a scope, it is restored after the scope ends).
set outsideVariable to "outsideValue"

Feature: First feature

This variable is at the feature level.
set featureVariable to "f1value"

Scenario: Check the variable and set it

variable outsideVariable is "outsideValue"
variable featureVariable is "f1value"

We override it at the scenario level.

set featureVariable to "f1s1value"
set scenarioVariable to "s1value"
set outsideVariable to "f1s1overridden"

Scenario: Variable carries over to next scenario

variable featureVariable is "f1s1value"
variable scenarioVariable is "s1value"
variable outsideVariable is "f1s1overridden"

Feature: Second feature

We are in a new feature, verify that all variables are reset to outside, feature or undefined.

variable outsideVariable is "outsideValue"
variable featureVariable is "f1value"
not variable scenarioVariable exists

