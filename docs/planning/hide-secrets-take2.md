
remove provenance, it can later be reconstructed by querying set statements

Secrets can only be set via environment variables, it does not need to handle `in` statements

how are esecrets identified?
* environment variables that contain /(password|secret)/i (fix: `cli/src/lib.ts` currently marks all as non-secret)
* variables set via `as secret string`
* any variable name matching `/(password|secret)/i` at resolution time (fallback)

identify all steps that handle secrets to carry secret status
* compose: marks result secret if any input is secret
* set: propagates `hasSecretSource` from interpolation to the stored variable

identify all places where a secret may be present (search for `shared` usage)
* `populateActionArgs.ts`: currently loses secret metadata during resolution
* `LogicStepper.ts`: iterators (`some`, `every`) and conditionals (`whenever`, `where`)
* `VariablesStepper.ts`: `show var`, `show vars`, `show env`, `show domain`
* `interactionSteps.ts`: `dialogIs` and `inputVariable`
* `readFileIntoVar`: storage content stored into variables


thots:

Mandatory secure context for variable retrieval
- Centralize all retrieval into a **single** method: `FeatureVariables.resolveVariable`
- **REMOVE** `FeatureVariables.get` and `FeatureVariables.getJSON`
- `resolveVariable` **must** require a `{ secure: boolean }` options flag
- If `secure` is false and the variable is marked `secret`, return `[OBSCURED_VALUE]`
- `populateActionArgs` (the primary caller for stepper actions) will pass `secure: true`
- `EventLogger` (for reconstructing `in` logs) will pass `secure: false`
- `VariablesStepper` (for `show var`, `show env`) will pass `secure: false`
- Steppers currently using `shared.get` will be refactored to use `resolveVariable` with `Origin.var`.

Always construct `in` values 
- use `gwta` template and populate with sanitized values from `stepValuesMap` (resolved with `secure: false`)
- this ensures secrets are redacted at the very source of logging
- removes the need for downstream global redaction passes
