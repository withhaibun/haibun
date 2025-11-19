
We set up outside, feature and scenario level variables to check scope.


This variable should carry through at all levels (though it can be overriden within a scope, it is restored after the scope ends).
set outsideVariable to "outsideValue"

Feature: First feature

set featureVariable to "f1value"

Scenario: Check the variable and set it

variable "featureVariable" is "f1value"

set featureVariable to "f1s1value"
set scenarioVariable to "s1value"

Scenario: Variable carries over to next scenario

variable outsideVariable is "outsideValue"
variable featureVariable is "f1s1value"
variable scenarioVariable is "s1value"
set outsideVariable to "s1overridden"

Feature: Second feature

variable outsideVariable is "outsideValue"
variable featureVariable is "f1value"
not variable scenarioVariable is set

