import { withAction, type TKirejiStep } from "@haibun/core/kireji/withAction.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import type WebPlaywright from "@haibun/web-playwright";
import { INSTRUMENTATION_GRAPHS } from "@haibun/core/lib/instrumentation-graphs.js";
import { dePolite } from "@haibun/core/lib/util/index.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import ShuGraphViewControls from "../components/shu-graph-view.controls.js";

const { setGraphVisibility } = withAction(new ShuGraphViewControls());
const { setAs } = withAction(new VariablesStepper());

/**
 * The origin a browser-driving feature navigates to.
 *
 * Default: the feature's own webserver at `http://localhost:<port>` — the port from
 * `HAIBUN_O_WEBSERVERSTEPPER_PORT`, else `defaultPort`. A self-contained feature serves its own app and seeds its
 * own store, so the browser must reach that loopback server. On a host that also fronts a deployed instance through
 * a reverse proxy, localhost stays off the proxy path, so any proxy authentication is not involved.
 *
 * Override — `HAIBUN_TEST_HOST`: point a run at a separate, already-running instance instead of the feature's own
 * server. Accepts a full origin (`https://demo.example.com`, `http://10.0.0.5:8728`) or a bare hostname, taken as
 * `https://<host>`. For a deliberate read-only run only: a feature that seeds its own store fails against a remote
 * instance that lacks that data, and a target behind basic auth also needs browser credentials (Playwright
 * `httpCredentials`), which this does not supply.
 */
export function serviceHost(defaultPort: string): string {
	const target = process.env.HAIBUN_TEST_HOST;
	if (target) return target.includes("://") ? target : `https://${target}`;
	return `http://localhost:${process.env.HAIBUN_O_WEBSERVERSTEPPER_PORT ?? defaultPort}`;
}

/** Declare one id under the `page-test-id` domain so the variable resolver maps the bare name to that test id. */
const registerTestIdStep = (id: string): TKirejiStep => setAs({ what: id, domain: "page-test-id", value: `"${id}"` });

// Hide the engine's instrumentation graphs so a feature's view shows only its domain data. Args are
// quoted because an unquoted value would be resolved as a variable name rather than a literal.
export function hideInstrumentationGraphs(): TKirejiStep {
	return setGraphVisibility({ operation: '"hide"', types: `"${INSTRUMENTATION_GRAPHS.join(",")}"` });
}

/** Collect every leaf id string from the given id-set objects (and bare id arrays), de-duplicated. */
function collectTestIds(idSets: Array<Record<string, unknown> | ReadonlyArray<string>>): string[] {
	const flat = idSets.flatMap((set) => (Array.isArray(set) ? [...set] : flattenTestIds(set as Record<string, unknown>)));
	return [...new Set(flat)];
}

/** Wrap steps as an activity: they run as hidden substeps, surfaced as the single line `as` (a lowercase declarative outcome like "the recipe is created", unique per feature, shown after the steps run). Spread `setup` before the scenarios, `call` at the point of use. */
export function activity(as: string, ...steps: TKirejiStep[]): { setup: TKirejiStep[]; call: TKirejiStep[] } {
	// The resolver de-polites an actionable (strips a leading "the"/"a"/…) before matching, so the
	// outcome is registered de-polited — otherwise a natural label like "the root recipe is created"
	// never matches its invocation. The displayed lines keep the natural wording.
	return { setup: [`Activity: ${as}`, ...steps, `waypoint ${dePolite(as).trim()}`], call: [as] };
}

export function flattenTestIds(obj: Record<string, unknown>): string[];
/** Activity form: bundle the test-id registrations into one activity. `as` is a lowercase declarative label; spread `setup` before the scenarios and `call` once before any step that uses a test id. */
export function flattenTestIds(as: string, ...idSets: Array<Record<string, unknown> | ReadonlyArray<string>>): { setup: TKirejiStep[]; call: TKirejiStep[] };
export function flattenTestIds(
	objOrAs: Record<string, unknown> | string,
	...idSets: Array<Record<string, unknown> | ReadonlyArray<string>>
): string[] | { setup: TKirejiStep[]; call: TKirejiStep[] } {
	if (typeof objOrAs !== "string") {
		const result: string[] = [];
		for (const value of Object.values(objOrAs)) {
			if (typeof value === "string") result.push(value);
			else if (typeof value === "object" && value !== null) result.push(...flattenTestIds(value as Record<string, unknown>));
		}
		return result;
	}
	return activity(objOrAs, ...collectTestIds(idSets).map(registerTestIdStep));
}

const IDS = SHU_TEST_IDS;

import { normalizeStepKey } from "../util.js";
export { normalizeStepKey };
const stepRun = (method: string, callIndex: number) => `${normalizeStepKey(method)}-${callIndex}-step-run`;
const stepDone = (method: string, callIndex: number) => `${normalizeStepKey(method)}-${callIndex}-step-done`;
const stepResult = (method: string, callIndex: number) => `${normalizeStepKey(method)}-${callIndex}-step-result`;
const stepError = (method: string, callIndex: number) => `${normalizeStepKey(method)}-${callIndex}-step-error`;
const stepInput = (method: string, callIndex: number, param: string) => `${normalizeStepKey(method)}-${callIndex}-step-input-${param}`;

export function stepTestIds(method: string, callIndex: number, inputParams: string[]): string[] {
	return [
		stepRun(method, callIndex),
		stepDone(method, callIndex),
		stepResult(method, callIndex),
		stepError(method, callIndex),
		...inputParams.map((p) => stepInput(method, callIndex, p)),
	];
}

/**
 * Encode a JS-literal composite sub-field value for the gwta form-input
 * argument. Always emits a literal — never a variable reference — because
 * callers pass JS scalars/arrays/objects, not haibun variable names. Plain
 * strings without embedded `"` use the quoted-arg form (haibun strips the
 * outer quotes); any value with inner `"` (JSON objects/arrays, strings
 * containing `"`) is emitted as bare-literal text that matches the gwta
 * placeholder's `(?:[^"]|"[^"]*")+?` branch and reaches `setValue.fill()`
 * byte-for-byte.
 *
 * Variable references — e.g. `id: "recordId"` — must be passed at the
 * top level of `params`, not nested inside a composite, since composite
 * sub-fields here are always literal.
 */
function encodeCompositeFieldLiteral(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	if (text.includes('"')) return text;
	return JSON.stringify(text);
}

export function createStepUI(wp: WebPlaywright) {
	const { waitFor, click, setValue, selectionOption, press, shouldSeeTestId, type: typeText } = withAction(wp);

	/** Set every leaf string in `idSets` as a `page-test-id` variable. */
	function registerTestIds(...idSets: Array<Record<string, unknown> | ReadonlyArray<string>>): TKirejiStep[] {
		return collectTestIds(idSets).map(registerTestIdStep);
	}

	/** Ensure the actions-bar is expanded. Uses MODE_SELECT (always present when the bar is open, regardless of Ask availability) so this works without an LLM provider. The `where … , …` form is idempotent — the click is skipped when MODE_SELECT is already on the page. */
	const expandActionsBar: TKirejiStep[] = [`where not has test id ${IDS.APP.MODE_SELECT}, click ${IDS.APP.TWISTY}`, waitFor({ target: IDS.APP.MODE_SELECT })];

	/** Collapse the actions-bar if it is open — the inverse of expandActionsBar (MODE_SELECT present ⇒ click the twisty to close). Idempotent: skipped when already collapsed. The expanded panel floats over lower content (e.g. a graph), so close it before interacting with what sits beneath. */
	const collapseActionsBar: TKirejiStep[] = [`where has test id ${IDS.APP.MODE_SELECT}, click ${IDS.APP.TWISTY}`];

	const enterStepMode: TKirejiStep[] = [...expandActionsBar, selectionOption({ option: '"Step"', field: IDS.APP.MODE_SELECT }), waitFor({ target: IDS.APP.STEP_SELECT })];

	/** Expand the actions-bar and switch to Search mode — the filter/query UI (type, text search, filters) is the search-mode body, so this is the entry to any of those controls. Search is the default mode, so a fresh bar is already here. */
	const enterSearchMode: TKirejiStep[] = [...expandActionsBar, selectionOption({ option: '"Search"', field: IDS.APP.MODE_SELECT }), waitFor({ target: IDS.APP.TYPE_SELECT })];

	/** Expand the actions-bar and switch to Ask mode. Symmetric to enterStepMode. */
	const enterAskMode: TKirejiStep[] = [...expandActionsBar, selectionOption({ option: '"Ask"', field: IDS.APP.MODE_SELECT }), waitFor({ target: IDS.APP.CHAT_INPUT })];

	/** Type a prompt into the Ask area's chat-input and submit. Keep curly braces out of the prompt when the reply
	 *  feeds `matches` — its `{var}` interpolation breaks on a model echoing braces back. */
	// The turn must FULLY complete (cookie written + server-side recordChatComments persisted) before later steps re-mount the chat, or the turn is lost. The session combo (app-session-select) only renders after handleChat's post-stream block runs refreshSessionList, so waiting for it blocks until completion — far more reliable than network-idle on a long-lived stream.
	function askExchange(prompt: string): TKirejiStep[] {
		return [
			click({ target: IDS.APP.CHAT_INPUT }),
			typeText({ text: `"${prompt}"` }),
			click({ target: IDS.APP.CHAT_SUBMIT }),
			waitFor({ target: IDS.APP.CHAT_OUTPUT }),
			waitFor({ target: IDS.APP.CHAT_TEXT }),
			waitFor({ target: IDS.APP.SESSION_SELECT }),
		];
	}

	/** Click the first row of the current shu-query result table; waits for the column-browser pane to appear. */
	const selectQueryFirstRow: TKirejiStep[] = [waitFor({ target: IDS.QUERY.FIRST_ROW }), click({ target: IDS.QUERY.FIRST_ROW }), waitFor({ target: IDS.COLUMN_BROWSER.COLUMN })];

	// Per-method invocation counter. Each runStep call increments the next index
	// for that method so repeated invocations produce unique testids.
	const callIndexByMethod = new Map<string, number>();
	const nextCallIndex = (method: string): number => {
		const next = callIndexByMethod.get(method) ?? 0;
		callIndexByMethod.set(method, next + 1);
		return next;
	};

	// Dynamic per-invocation testids (`${method}-${callIndex}-...`) are declared via registerTestIdStep
	// before any waitFor/setValue uses them, since the shared variable resolver maps bare names to test
	// ids by lookup, not by string shape.
	function buildStepBody(method: string, passes: boolean, params: Record<string, unknown> = {}): TKirejiStep[] {
		const callIndex = nextCallIndex(method);
		const expandedEntries: Array<[string, string]> = [];
		for (const [name, rawValue] of Object.entries(params)) {
			// Composite params (plain objects) decompose into one entry per
			// sub-field. Scalars in the composite are JSON-quoted (haibun
			// strips quotes, setValue.fill types the value). Arrays/objects
			// are passed as bare JSON text — the bare-literal branch of the
			// gwta placeholder accepts non-`"` chars and `"…"` pairs, so
			// `["A","B"]` captures cleanly.
			const isComposite = rawValue !== null && typeof rawValue === "object" && !Array.isArray(rawValue);
			if (isComposite) {
				for (const [subName, subValue] of Object.entries(rawValue as Record<string, unknown>)) {
					expandedEntries.push([`${name}-${subName}`, encodeCompositeFieldLiteral(subValue)]);
				}
			} else if (typeof rawValue === "string") {
				expandedEntries.push([name, rawValue]);
			} else {
				expandedEntries.push([name, encodeCompositeFieldLiteral(rawValue)]);
			}
		}
		const runTarget = stepRun(method, callIndex);
		const doneTarget = stepDone(method, callIndex);
		const resultTarget = stepResult(method, callIndex);
		const errorTarget = stepError(method, callIndex);
		const inputTargets = expandedEntries.map(([name]) => stepInput(method, callIndex, name));
		const branchTarget = passes ? resultTarget : errorTarget;
		// The step-caller emits `step-done` once execution settles (success or
		// error). Waiting for `step-done` returns as soon as the outcome lands;
		// `has test id <branchTarget>` then asserts which branch actually fired,
		// failing fast with the on-screen error text when the wrong one shows.
		const body: TKirejiStep[] = [
			...[runTarget, doneTarget, resultTarget, errorTarget, ...inputTargets].map(registerTestIdStep),
			click({ target: IDS.APP.STEP_SELECT }),
			setValue({ what: `"${method}"`, field: IDS.APP.STEP_SELECT }),
			press({ key: '"Enter"' }),
			...(expandedEntries.length > 0
				? [
						waitFor({ target: stepInput(method, callIndex, expandedEntries[0][0]) }),
						...expandedEntries.map(([name, value]) => setValue({ what: value, field: stepInput(method, callIndex, name) })),
					]
				: [waitFor({ target: runTarget })]),
			click({ target: runTarget }),
			waitFor({ target: doneTarget }),
			shouldSeeTestId({ testId: branchTarget }),
		];
		return body;
	}

	/** Flat (inline) form: the ~9 mechanics emitted directly. Kept for callers that don't want the activity wrapper. */
	function runStep(method: string, passes: boolean, params: Record<string, unknown> = {}): TKirejiStep[] {
		return buildStepBody(method, passes, params);
	}

	function passesStepExecution(method: string, params: Record<string, unknown> = {}): TKirejiStep[] {
		return runStep(method, true, params);
	}

	function failsStepExecution(method: string, params: Record<string, unknown> = {}): TKirejiStep[] {
		return runStep(method, false, params);
	}

	/** Activity form: switching to step mode + the step-caller mechanics run as hidden substeps, so the document shows one declarative line per call (e.g. "the root recipe is created"), shown after the steps run. Entering step mode is idempotent, so callers never add it themselves. */
	function stepActivity(as: string, method: string, passes: boolean, params: Record<string, unknown> = {}): { setup: TKirejiStep[]; call: TKirejiStep[] } {
		return activity(as, ...enterStepMode, ...buildStepBody(method, passes, params));
	}

	function willPassStepExecution(as: string, method: string, params: Record<string, unknown> = {}) {
		return stepActivity(as, method, true, params);
	}

	function willFailStepExecution(as: string, method: string, params: Record<string, unknown> = {}) {
		return stepActivity(as, method, false, params);
	}

	/**
	 * Pick a node type from the type combobox. Assumes the actions-bar is already expanded — compose with
	 * `expandActionsBar` when starting from a collapsed state. The type selector is a <shu-combobox>: wait for it to
	 * advertise that its options have loaded (`-ready`, a stable shadow-attached marker), focus it, type the label to
	 * filter, then Enter to pick.
	 *
	 * Waiting on the readiness marker rather than a rendered option is what keeps this reliable: the marker is
	 * attachment-checked and survives every render, whereas the dropdown list is a transient element the control
	 * tears down and rebuilds on each focus/blur/repaint. Enter picks from the control's filtered options in state, so
	 * the choice never depends on the ephemeral list being on screen; a blind Enter before the catalog loads would
	 * silently no-op, which the readiness wait rules out.
	 */
	function selectGraphLabel(label: string): TKirejiStep[] {
		const ready = `${IDS.APP.TYPE_SELECT}-ready`;
		return [
			registerTestIdStep(ready), // the control's derived readiness id, resolved through the shadow-walking test-id wait
			waitFor({ target: ready }),
			click({ target: IDS.APP.TYPE_SELECT }),
			setValue({ what: `"${label}"`, field: IDS.APP.TYPE_SELECT }),
			press({ key: '"Enter"' }),
		];
	}

	/** Open the actions bar, switch to Search mode (where the type selector lives), and pick a node type. */
	function chooseGraphLabel(label: string): TKirejiStep[] {
		return [...enterSearchMode, ...selectGraphLabel(label)];
	}

	return {
		enterStepMode,
		enterSearchMode,
		enterAskMode,
		expandActionsBar,
		collapseActionsBar,
		askExchange,
		selectQueryFirstRow,
		registerTestIds,
		runStep,
		passesStepExecution,
		failsStepExecution,
		willPassStepExecution,
		willFailStepExecution,
		chooseGraphLabel,
		selectGraphLabel,
	};
}
