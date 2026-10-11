// @vitest-environment jsdom
/**
 * A step's form: an input for each field of a composite parameter, the fields of the type a record's data is of once the
 * type is chosen, test ids that carry the caller's number, and a call's outcome. A value that doesn't parse refuses the
 * form's values without a call, a step the site refuses shows the site's refusal, and a result's rows read as one table.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { buildConcernCatalog, type TConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { rpcAnswer, HANDSHAKE_PATH } from "@haibun/core/lib/test/rpc-answer.js";
import { declareRegistry } from "../../test/catalog-fixture.js";
import { provideLayout } from "../../test/jsdom-layout.js";
import { persistedTypeDefinition, serveThePage, newPage, stepsShown } from "../../test/setup.js";
import { requiredActionOf } from "../controllers/registry-controller.js";
import { installCarriedEventStream, installServedConduit } from "../root.js";
import "./shu-step-caller.js";
import type { ShuStepCaller } from "./shu-step-caller.js";

/** A type a record of which the generic create writes. */
const NOTE = "Note";

type TStepSpec = Parameters<typeof stepsShown>[0][number];

const ISSUER: TStepSpec = {
	method: "IssueStepper-createIssuer",
	stepperName: "IssueStepper",
	stepName: "createIssuer",
	pattern: "create issuer {issuer: issuer}",
	paramDomains: { issuer: "issuer" },
	inputSchema: {
		type: "object",
		properties: { issuer: { type: "object", properties: { did: { type: "string" }, name: { type: "string" } }, required: ["did"] } },
		required: ["issuer"],
	},
};

/** Returns `answer(method)` for each call of a step, as the site's RPC does. */
function siteAnswering(answer: (method: string) => Response): () => void {
	const realFetch = globalThis.fetch;
	globalThis.fetch = (input: unknown): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
		if (url.endsWith(HANDSHAKE_PATH)) return Promise.resolve(rpcAnswer({ seqPath: [0, -1, 1] }, 200));
		const method = url.slice(url.lastIndexOf("/rpc/") + "/rpc/".length);
		return Promise.resolve(answer(method));
	};
	return () => {
		globalThis.fetch = realFetch;
	};
}

/** A caller of `step`, once it has read the step's definition from the page's registry and drawn its form. */
async function aCaller(step: TStepSpec, attributes: Record<string, string> = {}, concerns?: TConcernCatalog): Promise<ShuStepCaller> {
	declareRegistry(concerns === undefined ? stepsShown([step]) : stepsShown([step], {}, concerns));
	const caller = document.createElement("shu-step-caller") as ShuStepCaller;
	caller.setAttribute("step", step.method);
	for (const [name, value] of Object.entries(attributes)) caller.setAttribute(name, value);
	document.body.appendChild(caller);
	await new Promise((resolve) => setTimeout(resolve, 0));
	await caller.updateComplete;
	return caller;
}

const shown = (caller: ShuStepCaller): string => caller.shadowRoot?.innerHTML ?? "";
const errorText = (caller: ShuStepCaller): string => {
	const refusal = caller.shadowRoot?.querySelector('[data-testid$="-step-error"] shu-refusal');
	return refusal?.shadowRoot?.textContent ?? "";
};

/** Calls the step with `values`, and waits for the caller and its refusal to draw. */
async function called(caller: ShuStepCaller, values: Record<string, string>): Promise<void> {
	await caller.callStep(values);
	await caller.updateComplete;
	const refusal = caller.shadowRoot?.querySelector("shu-refusal") as (Element & { updateComplete: Promise<unknown> }) | null;
	if (refusal !== null && refusal !== undefined) await refusal.updateComplete;
}

describe("shu-step-caller", () => {
	let restore: (() => void) | undefined;
	beforeAll(provideLayout);
	beforeEach(() => {
		newPage();
		document.body.innerHTML = "";
		// The conduit reads through the `fetch` each test replaces; the carried event stream stands in for the SSE source.
		installServedConduit("", requiredActionOf);
		serveThePage();
		installCarriedEventStream();
	});
	afterEach(() => restore?.());

	it("renders an input for each field of a composite parameter, rather than for its JSON", async () => {
		const caller = await aCaller(ISSUER);
		expect(shown(caller)).toContain('name="issuer.did"');
		expect(shown(caller)).toContain('name="issuer.name"');
		expect(shown(caller)).not.toMatch(/name="issuer"[^.]/);
	});

	it("renders the fields of the type a record's data is of, once the type is chosen", async () => {
		const concerns = buildConcernCatalog(mapDefinitionsToDomains([persistedTypeDefinition(NOTE, { properties: { title: LinkRelations.NAME.rel } })]));
		const caller = await aCaller(
			{
				method: "StoreStepper-createTyped",
				stepperName: "StoreStepper",
				stepName: "createTyped",
				pattern: "create {label: persisted-type} {data: record-data}",
				paramDomains: { label: "persisted-type", data: "record-data" },
				recordData: { data: "label" },
				inputSchema: { type: "object", properties: { label: { type: "string" }, data: { type: "object" } }, required: ["label", "data"] },
			},
			{},
			concerns,
		);
		const select = caller.shadowRoot?.querySelector<HTMLSelectElement>('select[name="label"]');
		if (!select) throw new Error("the type isn't offered as a choice");
		expect(
			[...select.options].map((option) => option.value),
			"the declared types are offered",
		).toContain(NOTE);
		select.value = NOTE;
		select.dispatchEvent(new Event("change"));
		await caller.updateComplete;
		expect(shown(caller), "the chosen type's fields").toContain('name="data.title"');
		expect(shown(caller)).toContain('name="data.id"');
	});

	it("carries its number among its step's callers in its inputs' test ids, joined with `-` so a variable doesn't read them as paths", async () => {
		const caller = await aCaller(ISSUER, { "call-index": "1" });
		expect(shown(caller)).toContain('data-testid="create-issuer-1-step-input-issuer-did"');
		expect(shown(caller)).toContain('data-testid="create-issuer-1-step-input-issuer-name"');
	});

	it("refuses a value that doesn't parse as its parameter's type, without a call", async () => {
		let calls = 0;
		restore = siteAnswering(() => {
			calls++;
			return rpcAnswer({}, 200);
		});
		const caller = await aCaller({
			method: "Test-take",
			stepperName: "Test",
			stepName: "take",
			pattern: "take {payload}",
			paramDomains: { payload: "string" },
			inputSchema: { type: "object", properties: { payload: { type: "object" } }, required: ["payload"] },
		});
		await called(caller, { payload: "aaaa" });
		expect(errorText(caller)).toMatch(/invalid input/i);
		expect(calls, "the step isn't called").toBe(0);
		expect(caller.executed).toBe(true);
	});

	it("shows the site's refusal of a call, and stops showing that it calls", async () => {
		const REFUSED = 'IssueStepper-issueCredential: "type" must include `VerifiableCredential`.';
		restore = siteAnswering((method) => (method === "IssueStepper-issueCredential" ? rpcAnswer({ error: REFUSED }, 422) : rpcAnswer({}, 200)));
		const caller = await aCaller({
			method: "IssueStepper-issueCredential",
			stepperName: "IssueStepper",
			stepName: "issueCredential",
			pattern: "issue credential {credential}",
			paramDomains: { credential: "string" },
			inputSchema: { type: "object", properties: { credential: { type: "object" } }, required: ["credential"] },
		});
		await called(caller, { credential: JSON.stringify({ type: ["bogus"] }) });
		expect(errorText(caller)).toContain('"type" must include');
		expect(caller.dataset.testid).toBe("issue-credential-0-step-error");
		expect(shown(caller)).not.toMatch(/class="loading"/);
	});

	it("renders a result's rows as one table whose columns are every row's fields, a field a row lacks an empty cell", async () => {
		restore = siteAnswering(() => rpcAnswer({ goals: [{ goal: "issued", factIds: ["f1"] }, { goal: "revoked" }, { goal: "suspended", michi: 2 }] }, 200));
		const caller = await aCaller({
			method: "GoalStepper-showGoals",
			stepperName: "GoalStepper",
			stepName: "showGoals",
			pattern: "show goals",
			outputSchema: { type: "object", properties: { goals: { type: "array", items: { type: "object" } } } },
		});
		await called(caller, {});
		const table = caller.shadowRoot?.querySelector("table");
		expect([...(table?.querySelectorAll("th") ?? [])].map((th) => th.textContent)).toEqual(["goal", "factIds", "michi"]);
		expect([...(table?.querySelectorAll("tbody tr") ?? [])].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent))).toEqual([
			["issued", '["f1"]', ""],
			["revoked", "", ""],
			["suspended", "", "2"],
		]);
		expect(caller.dataset.testid).toBe("show-goals-0-step-result");
	});

	it("shows a refusal of a response too large to serialize, rather than calling without end", async () => {
		restore = siteAnswering(() =>
			rpcAnswer({ ok: false, error: "GraphStepper-graphQuery: response too large to serialize (Invalid string length). Narrow the query or return a summary." }, 413),
		);
		const caller = await aCaller({
			method: "GraphStepper-graphQuery",
			stepperName: "GraphStepper",
			stepName: "graphQuery",
			pattern: "graph query {query}",
			paramDomains: { query: "string" },
			inputSchema: { type: "object", properties: { query: { type: "object" } }, required: ["query"] },
		});
		await called(caller, { query: JSON.stringify({ all: true }) });
		expect(errorText(caller)).toContain("response too large");
		expect(shown(caller)).not.toMatch(/class="loading"/);
	});

	it("refuses to draw a step that actuality doesn't declare", async () => {
		declareRegistry(stepsShown([]));
		const caller = document.createElement("shu-step-caller") as ShuStepCaller;
		caller.setAttribute("step", "Absent-step");
		document.body.appendChild(caller);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await caller.updateComplete;
		const refusal = caller.shadowRoot?.querySelector("shu-refusal") as (Element & { updateComplete: Promise<unknown> }) | null;
		await refusal?.updateComplete;
		expect(refusal?.shadowRoot?.textContent).toContain("Absent-step, which actuality doesn't declare");
	});
});
