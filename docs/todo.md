 [ ] add and update unit tests for each checkmark


[x] should show raw json when it finds no message (currently blank for graph-link)
[x] max depth should default to 6
[x] ~~~ hidden should handle hidden by depth

[x] it should be possible to horiz size detail view. if the screen is too narrow they should appear below
[x] artifacts should open in that view intsead of below  (traces already do)

[ ] waypoints + proofs are missing in mermaid graph
[ ] display stepArgs in monitor-browser log view
[ ] writeFeaturesArtifact should write json-schema with version from version.ts

[x] (in progress) renaming generic payload to topics (FlowSignalSchema, TOKActionResult, TNotOKActionResult), attributes (LogEvent), args (ControlEvent)

[x] update vite.config.ts

[ ] trim TResultFeature down to its minimum 
[ ] use eg rollup-plugin-visualizer to understand seralized monitor html

[x] vscode links should show only in live mode
[x] defs does not need to import things only to export them. other packges should import directly from protocol
[x] should be only one source of truth for icons like 🚨

[x] what is modules/monitor-browser/src/client/types.ts for?
[x] event level should only be debug, trace, log, info, warm, error, not others like this:

[x] clearer zip archive folders - don't create folders for negative steps, prefix folder with context info
[x] display file and line number in monitor
[ ] hide secret or don't show env variables in monitor

[ ] haibun should be used to test the monitor-browser


## Monitor-browser


 [x] Show start date in ISO format on top left of monitor-browser under "haibun monitor" and persist it when serialized
 [x] don't show log level / time in document view (only in log view)
 [x] add findStepperFromOptionsOrKind in modules/core/src/lib/util/index.ts that returns any single stepper of kind optionNames[0] if no stepper-level option is defined. apply it to steppers that use storage
 [ ] reset to 0s when page is reloaded
 [x] action introspection
   [ ] link between actions with seqPath
   [x] click on action to see its TStepArgs (disclosureJson), stepper details (see legacy monitor)
 [x] artifact support: see legacy monitor for detail
 use a11y-pass.feature for sample
   [x] time-baed (isTimeLined; playwright video)
     [x] attribute on artifact type
     [x] in their own section semi transulucnet, expand when hovered over
     [x] one displayed by default (playwright video when available) linked to timeline with ability to switch to others
   [x] file (html, json, image)
     [x] mermaid diagram: show generated diagram 
     [x] see artifacts using the live monitor-browser 

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