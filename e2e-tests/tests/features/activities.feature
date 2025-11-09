Haibun supports Activities and waypointed Outcomes that can be used to infer conditions for scenarios. This feature file tests multi-condition scenarios using Activities to set conditions.
Outcomes define the "what", Activities define the "how".

Activity: Login as admin
waypoint Is logged in as admin {who} with set "loginType" to "admin"

Activity: Login as user
waypoint Is logged in as user {who} with set "loginType" to "user"

Activity: Login as guest
waypoint Is guest with set "loginType" to "guest"

Feature: Multi-condition test

Scenario: Use only one condition
ensure Is logged in as user Personoid
variable "loginType" is "user"

The condition has been validated with "loginType" variable set to "user".
