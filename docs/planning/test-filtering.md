
add a new cli option --filters which specifies the following:

--filters schema env dir:access,dir:access

schema is a JSON-Schema file that is used to validate the environment and filter combinations.

env is the target environment, typically local, dev, test, prod.

The directories are relative to the root of features, and they would typicaly be eg smoke, api, web, regression. 
For example, feature/smoke, feature/api, etc.

access is one of the following:
r - read only
a - uses auth
w - writes

Each is a superset of the previous.

Features are named using corresponding prefixes, r_, a_, and w_. During execution, tests without a prefix are not run.

On execution, a schema is generated based on the environment and filter combinations and validated (using Zod) against the passed schema. 
This would typically be used to prevent write tests from running in the prod enviornment.

Task:

Provide an implementation with scaffolded feature directory under e2e-tests.

Provide complete tests.
