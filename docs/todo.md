 [ ] add and update unit tests for each checkmark


[x] show raw json where a message isn't found, such as for graph-link
[x] max depth should default to 6
[x] ~~~ hidden should handle hidden by depth

[x] make the detail view resizable horizontally. Show detail views below on a screen that is too narrow.
[x] open artifacts in the detail view, not below it. Traces open there already.

[ ] the mermaid graph doesn't show waypoints and proofs
[ ] writeFeaturesArtifact should write json-schema with version from version.ts

[x] rename generic payload to topics (FlowSignalSchema, TOKActionResult, TNotOKActionResult), attributes (LogEvent) and args (ControlEvent)

[x] update vite.config.ts

[ ] reduce TResultFeature to the fields its readers use
[ ] measure what the serialized monitor html contains with a tool such as rollup-plugin-visualizer

[x] vscode links should show only in live mode
[x] defs doesn't import a type only to export it. Other packages import from protocol directly.
[x] define icons such as 🚨 in one place

[x] limit event levels to debug, trace, log, info, warn and error

[x] zip archive folders: don't create folders for negative steps. Prefix each folder with its context.
[x] display file and line number in monitor
[ ] hide secrets in the monitor, or don't show env variables there



## Monitor-tui

 [ ] give the current events section (bottom) more lines, or a number of lines that fits its events
 [ ] support the debugger

## Remove messagecontext

[ ] confirm the new version provides each earlier feature (logging, artifacts, web-playwright monitor and others)
[ ] manage THaibunEvents with builders, routers and inferred types, so that the code is shorter and type safe.
[ ] remove the remaining code of the earlier messagecontext and monitor
[ ] replace the bridge with direct event handling

## Message consistency

 [ ] review the feature definitions (TFeatureMeta, TExpandedFeature, TResolvedFeature, AStepper, CStepper, TAfterStepResult) in modules/core/src/lib/execution.ts and modules/core/src/lib/astepper.ts. Review the result definitions (TActionResult, TFeatureResult and others) in modules/core/src/schema/protocol.ts. Note where the schema-based event definitions overlap them.
 [ ] summarize how they are used, where they overlap and how they can be combined
 [ ] make feature results a superset of feature definitions

## Other

* [x] the increment test passes: `it('whenever loop increment and compare with is', ...)`
* [k] coerce a variable only when it is tested or read
 [ ]  * confirm that setting a variable doesn't coerce it
* [ ] confirm that resolveVariable and populateActionArgs don't have side effects
* [x] populateActionArgs is a minimal wrapper around resolveVariable
* [x] Haibun.prose should use new rules in FIXME
* [ ] normalizeDomainKey probably isn't needed. Check whether it ever throws an Error.