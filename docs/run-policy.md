# Run-Policy Feature

The `run-policy` feature in Haibun provides a robust way to control feature execution and manage environment-specific parameters. It enables a clear separation between **where** a test is running and **what** permissions or parameters are applicable to that environment.

## Overview

A "Run Policy" defines two main things:
1.  **Access Control**: Which feature files are allowed to run based on their directory and an access level prefix (`r_`, `a_`, `w_`).
2.  **Environment Configuration**: Environment-specific parameters (e.g., `BASE_URL`, `TIMEOUT`) that are injected into the test runtime.

## Project Structure Example

A typical Haibun project using run policies might look like this:

```text
my-project/
├── config.json           # Main project configuration
├── features/             # Feature directory
│   └── smoke/            # Smoke tests (r_ prefix)
│       └── r_health.feature
├── schemas/
│   ├── app-params.json   # JSON Schema for specific parameters
│   └── permissive.json   # Access control definitions
```
See an example policy test at [e2e-tests/policy-test/](../e2e-tests/policy-test/).

## Configuration

Run policies are configured in config files (by default, `config.json`) and validated via JSON-Schema.

### Project `config.json`

The root configuration file specifies the policy and parameters for each environment ("place", to avoid confusion with environmental variables).

Example: [e2e-tests/policy-test/config.json](../e2e-tests/policy-test/config.json).

```json
{
  "$schema": "schemas/app-params.json",
  "steppers": ["variables-stepper", "logic-stepper"],
  "runPolicy": "schemas/permissive.json",
  "appParameters": {
    "local": {
      "BASE_URL": "http://localhost:8123",
      "THIS_PLACE": "local"
    },
    "prod": {
      "BASE_URL": "https://production.com",
      "TIMEOUT": 5000,
      "THIS_PLACE": "prod"
    }
  }
}
```

*   `$schema`: Standard JSON-Schema reference to validate the `config.json` file. This allows for IDE autocompletion and strict validation.
*   `runPolicy`: Path to the policy schema that defines valid "places" and access rules.
*   `appParameters`: Environment-specific variables injected into the test runtime, described in app-params.json.

### Parameter Schema (`app-params.json`)

`app-params.json` extends the base Haibun Specl schema and defines the expected `appParameters` for each place.

Example: [e2e-tests/policy-test/schemas/app-params.json](../e2e-tests/policy-test/schemas/app-params.json).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "allOf": [
    { "$ref": "../node_modules/@haibun/core/haibun-core-specl.schema.json" }
  ],
  "properties": {
    "appParameters": {
      "type": "object",
      "properties": {
        "prod": {
          "type": "object",
          "properties": {
            "BASE_URL": { "type": "string", "format": "uri" },
            "TIMEOUT": { "const": 5000 },
            "THIS_PLACE": { "const": "prod" }
          },
          "required": ["BASE_URL", "THIS_PLACE"]
        },
        "local": {
          "type": "object",
          "properties": {
            "BASE_URL": { "const": "http://localhost:8123" },
            "THIS_PLACE": { "const": "local" }
          },
          "required": ["THIS_PLACE"]
        }
      }
    }
  }
}
```

## Access Levels and Prefixes

Haibun provides a hierarchy for access control:
*   `r` (Read): Lowest access. Feature files must start with `r_`.
*   `a` (Auth): Typically auth but no writes. Includes `r`. Feature files must start with `a_`.
*   `w` (Write): Full access. Includes `r` and `a`. Feature files must start with `w_`.

The `runPolicy` schema specifies which directories are allowed for each access level in a given `place`.

Example: [e2e-tests/policy-test/schemas/permissive.json](../e2e-tests/policy-test/schemas/permissive.json) and [e2e-tests/policy-test/schemas/no-prod-writes.json](../e2e-tests/policy-test/schemas/no-prod-writes.json).

In [no-prod-writes](../e2e-tests/policy-test/schemas/no-prod-writes.json), only `r_` features in `my-project/features/smoke/` will be executed (Example: [e2e-tests/policy-test/features/smoke/r_health.feature](../e2e-tests/policy-test/features/smoke/r_health.feature)).

Wildcard is supported for "any directory": `*:r`, `*:a`, or `*:w`.

Matching is strict: a feature must match either an explicit directory rule or the wildcard rule, otherwise it is excluded.

## Usage

### Command Line

```bash
# prod place, smoke directory with 'r' (read) access
npx @haibun/cli --run-policy prod smoke:r ./my-project

# prod place, read access in any directory
npx @haibun/cli --run-policy prod "*:r" ./my-project
```

### Environment Variable

Use `HAIBUN_RUN_POLICY`:

```bash
export HAIBUN_RUN_POLICY="prod smoke:r"
npx @haibun/cli ./my-project

export HAIBUN_RUN_POLICY="prod *:r"
npx @haibun/cli ./my-project
```

## Dry Run

To preview which features will be included or excluded by the current policy without running them, use the `--dry-run` flag:

```bash
npx @haibun/cli --run-policy prod smoke:r --dry-run ./my-project
```
