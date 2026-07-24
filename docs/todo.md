 [ ] add and update unit tests for each checkmark


[x] should show raw json when it finds no message (currently blank for graph-link)
[x] max depth should default to 6
[x] ~~~ hidden should handle hidden by depth

[x] it should be possible to horiz size detail view. if the screen is too narrow they should appear below
[x] artifacts should open in that view intsead of below  (traces already do)

[ ] waypoints + proofs are missing in mermaid graph
[ ] writeFeaturesArtifact should write json-schema with version from version.ts

[x] (in progress) renaming generic payload to topics (FlowSignalSchema, TOKActionResult, TNotOKActionResult), attributes (LogEvent), args (ControlEvent)

[x] update vite.config.ts

[ ] trim TResultFeature down to its minimum 
[ ] use eg rollup-plugin-visualizer to understand seralized monitor html

[x] vscode links should show only in live mode
[x] defs does not need to import things only to export them. other packges should import directly from protocol
[x] should be only one source of truth for icons like 🚨

[x] event level should only be debug, trace, log, info, warm, error, not others like this:

[x] clearer zip archive folders - don't create folders for negative steps, prefix folder with context info
[x] display file and line number in monitor
[ ] hide secret or don't show env variables in monitor



## Monitor-tui

 [ ] use more/variable (appropriate?) lines for current events section (bottom)
 [ ] needs to support debugger

## Remove messageconext

[ ] review to make sure all legacy features are more than provide in the new version (logging, artifacts, web-playwright monitor, etc)
[ ] use builders and routers and inferred types to manage THaibunEvents so code isn't so bulky and is type safe.
[ ] get rid of all traces of prevoius messagecontext, monitor, etc.
[ ] get rid of the bridge and replace it with streamlined event handling

## Message consistency

 [ ] review current feature (TFeatureMeta, TExpandeFeature, TResolvedFeature, AStepper, CStepper, TAfterStepResult, ) and result (TActionResult, TFeatureResult &c) definitions in defs.ts, take special note of how the new schema based event definitions overlap.
 [ ] create a summary of how they are used, how they overlap, how they can be streamlined
 [ ] feature results should be a superset of feature definitions, not something totally different

## Grab bag

* [x] increment test must pass 	it('whenever loop increment and compare with is', async () => {
* [k] should coerce only when variables are being tested or consumed
 [ ]  * make sure that variables are not coerced when they are being set
* [ ] make sure there are no side effects in resolveVariable or populateActionArgs
* [x] populateActionArgs should be a minimal wrapper around resolveVariable
* [x] Haibun.prose should use new rules in FIXME
* [ ] normalizeDomainKey is probably not needed, see if it ever throws Error