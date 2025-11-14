

The following feature level variable will apply for the following scenarios.

set "feature variable" to "something"

Scenario: Check the variable and set it

variable "feature variable" is "something"

set "feature variable" to "something else"

Scenario: Make sure it is still the feature variable value

variable "feature variable" is "something"


