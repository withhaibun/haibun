import { withAction, type TKirejiStep } from "@haibun/core/kireji/withAction.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import type WebPlaywright from "@haibun/web-playwright";
import { SHU_TEST_IDS } from "../test-ids.js";

export function flattenTestIds(obj: Record<string, unknown>): string[] {
	const result: string[] = [];
	for (const [, value] of Object.entries(obj)) {
		if (typeof value === "string") result.push(value);
		else if (typeof value === "object" && value !== null) result.push(...flattenTestIds(value as Record<string, unknown>));
	}
	return result;
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
 * Variable references — e.g. `id: "credentialId"` — must be passed at the
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
	const { setAs } = withAction(new VariablesStepper());

	/** Set every leaf string in `idSets` as a `page-test-id` variable. */
	function registerTestIds(...idSets: Array<Record<string, unknown> | ReadonlyArray<string>>): TKirejiStep[] {
		const flat = idSets.flatMap((set) => (Array.isArray(set) ? [...set] : flattenTestIds(set as Record<string, unknown>)));
		return [...new Set(flat)].map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
	}

	/** Ensure the actions-bar is expanded. Uses MODE_SELECT (always present when the bar is open, regardless of Ask availability) so this works without an LLM provider. The `where … , …` form is idempotent — the click is skipped when MODE_SELECT is already on the page. */
	const expandActionsBar: TKirejiStep[] = [`where not has test id ${IDS.APP.MODE_SELECT}, click ${IDS.APP.TWISTY}`, waitFor({ target: IDS.APP.MODE_SELECT })];

	const enterStepMode: TKirejiStep[] = [...expandActionsBar, selectionOption({ option: '"Step"', field: IDS.APP.MODE_SELECT }), waitFor({ target: IDS.APP.STEP_SELECT })];

	/** Expand the actions-bar and switch to Ask mode. Symmetric to enterStepMode. */
	const enterAskMode: TKirejiStep[] = [...expandActionsBar, selectionOption({ option: '"Ask"', field: IDS.APP.MODE_SELECT }), waitFor({ target: IDS.APP.CHAT_INPUT })];

	/** Type a prompt into the Ask area's chat-input and submit. */
	// The turn must FULLY complete (cookie written + server-side recordChatComments persisted) before later steps re-mount the chat, or the turn is lost. The session combo (app-session-select) only renders after handleChat's post-stream block runs refreshSessionList, so waiting for it blocks until completion — far more reliable than network-idle on a long-lived stream.
	function askExchange(prompt: string): TKirejiStep[] {
		return [click({ target: IDS.APP.CHAT_INPUT }), typeText({ text: `"${prompt}"` }), click({ target: IDS.APP.CHAT_SUBMIT }), waitFor({ target: IDS.APP.CHAT_OUTPUT }), waitFor({ target: IDS.APP.CHAT_TEXT }), waitFor({ target: IDS.APP.SESSION_SELECT })];
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

	// Dynamic per-invocation testids (`${method}-${callIndex}-...`) must be
	// declared under the `page-test-id` domain before any waitFor/setValue
	// uses them, since the shared variable resolver maps bare names to test
	// ids by lookup, not by string shape.
	const registerTestId = (id: string): TKirejiStep => setAs({ what: id, domain: "page-test-id", value: `"${id}"` });

	function runStep(method: string, passes: boolean, params: Record<string, unknown> = {}): TKirejiStep[] {
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
		return [
			...[runTarget, doneTarget, resultTarget, errorTarget, ...inputTargets].map(registerTestId),
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
	}

	function passesStepExecution(method: string, params: Record<string, unknown> = {}): TKirejiStep[] {
		return runStep(method, true, params);
	}

	function failsStepExecution(method: string, params: Record<string, unknown> = {}): TKirejiStep[] {
		return runStep(method, false, params);
	}

	/** Pick a node type from the type combobox. Assumes the actions-bar is already expanded — compose with `expandActionsBar` when starting from a collapsed state. The type selector is a <shu-combobox>: click to focus+open, type the label to filter, Enter to pick the exact-label match. */
	function selectGraphLabel(label: string): TKirejiStep[] {
		return [
			waitFor({ target: IDS.APP.TYPE_SELECT }),
			click({ target: IDS.APP.TYPE_SELECT }),
			setValue({ what: `"${label}"`, field: IDS.APP.TYPE_SELECT }),
			press({ key: '"Enter"' }),
		];
	}

	/** Open the actions bar and pick a node type. Convenience for the collapsed→labelled flow. */
	function chooseGraphLabel(label: string): TKirejiStep[] {
		return [...expandActionsBar, ...selectGraphLabel(label)];
	}

	return {
		enterStepMode,
		enterAskMode,
		expandActionsBar,
		askExchange,
		selectQueryFirstRow,
		registerTestIds,
		runStep,
		passesStepExecution,
		failsStepExecution,
		chooseGraphLabel,
		selectGraphLabel,
	};
}
