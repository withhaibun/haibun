// @vitest-environment jsdom
/**
 * A view that reads records shows a refused read through `<shu-refusal>`: the site's cause, and its remedy as a control.
 * A read that doesn't reach the site reads the records the page holds of a type the catalog declares, and otherwise offers
 * a read again (CA4F4).
 */
import { afterEach, describe, expect, it } from "vitest";
import { Access, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { RefusedCall, ServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { catalogOf, declareRegistry } from "../../test/catalog-fixture.js";
import { setupShuTest, stepsShown, type TShuTestHandle } from "../../test/setup.js";
import { provideLayout } from "../../test/jsdom-layout.js";
import "./shu-filter-column.js";
import "./shu-type-column.js";
import "./shu-thread-column.js";
import "./shu-domain-chain-view.js";
import type { ShuFilterColumn } from "./shu-filter-column.js";
import type { ShuTypeColumn } from "./shu-type-column.js";
import type { ShuThreadColumn } from "./shu-thread-column.js";
import type { ShuDomainChainView } from "./shu-domain-chain-view.js";

/** A read's step, as the show steps step describes it. */
const read = (stepperName: string, stepName: string) => ({ method: `${stepperName}-${stepName}`, stepperName, stepName, pattern: stepName, read: true, readsAt: Access.public });

/** The steps the views read through, and a catalog that declares the type they read. */
const SHOWN = stepsShown(
	[read("GraphSourceStepper", "graphQuery"), read("GraphStepper", "getRelated"), read("LogicStepper", "affordancesOnOffer")],
	{},
	catalogOf({ types: ["Email"], rels: { Email: { folder: LinkRelations.CONTEXT.rel } } }),
);
const SIGN_IN = { do: "sign-in", at: "https://example.org/sign-in" } as const;

/** A page whose site declares the views' steps, and fails each read as `fail` does. The page reads its registry before a
 *  view opens. */
function pageFailingReads(fail: (method: string) => never): TShuTestHandle {
	provideLayout();
	const handle = setupShuTest({ dispatch: (method) => (method === SHOW_STEPS_METHOD ? SHOWN : fail(method)) });
	declareRegistry(SHOWN);
	return handle;
}
const refusing = (method: string): never => {
	throw new RefusedCall({ error: `the site refuses ${method}`, remedy: SIGN_IN });
};
const unreachable = (method: string): never => {
	throw new ServerUnreachable(`/rpc/${method}`, new TypeError("Failed to fetch"));
};

/** Waits until `view` has rendered what its read returned. */
async function rendered(view: TView): Promise<TView> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await view.updateComplete;
	return view;
}

/** The refusal `view` renders. */
async function refusalIn(view: TView): Promise<ShadowRoot> {
	const refusal = view.shadowRoot?.querySelector("shu-refusal") as (Element & { updateComplete: Promise<unknown> }) | null;
	if (refusal === null || refusal === undefined) throw new Error(`<${view.tagName.toLowerCase()}> doesn't render a refusal`);
	await refusal.updateComplete;
	if (refusal.shadowRoot === null) throw new Error("the refusal doesn't render");
	return refusal.shadowRoot;
}

type TView = Element & { updateComplete: Promise<unknown> };

/** Each view, opened at a read its page fails, and whether the view reads the records the page holds where the site
 *  doesn't respond. */
const VIEWS: Array<[string, () => Promise<TView>, boolean]> = [
	[
		"the filter column",
		async () => {
			const view = document.body.appendChild(document.createElement("shu-filter-column")) as ShuFilterColumn;
			await view.openFiltered("folder", "INBOX", "Email");
			return view;
		},
		true,
	],
	[
		"the type column",
		async () => {
			const view = document.body.appendChild(document.createElement("shu-type-column")) as ShuTypeColumn;
			await view.open("Email");
			return view;
		},
		true,
	],
	[
		"the thread column",
		async () => {
			const view = document.body.appendChild(document.createElement("shu-thread-column")) as ShuThreadColumn;
			await view.open("Email", "m-1");
			return view;
		},
		false,
	],
	["the domain chain", async () => document.body.appendChild(document.createElement("shu-domain-chain-view")) as ShuDomainChainView, false],
];

describe("a refused read", () => {
	let handle: TShuTestHandle | undefined;
	afterEach(() => {
		handle?.teardown();
		document.body.innerHTML = "";
	});

	for (const [name, opened, readsHeld] of VIEWS) {
		it(`renders the site's refusal and its remedy in ${name}`, async () => {
			handle = pageFailingReads(refusing);
			const refusal = await refusalIn(await rendered(await opened()));
			expect(refusal.textContent).toContain("the site refuses");
			expect(refusal.querySelector(`a[href="${SIGN_IN.at}"]`)?.textContent).toBe("Sign in");
		});

		// A view that reads a type the catalog declares reads the records the page holds where the site doesn't respond, as
		// graph-data-controller.test.ts shows; jsdom doesn't lay out the result table that lists them.
		if (!readsHeld) {
			it(`offers a read again in ${name} where the read doesn't reach the site`, async () => {
				handle = pageFailingReads(unreachable);
				const refusal = await refusalIn(await rendered(await opened()));
				expect(refusal.querySelector("button")?.textContent).toBe("Read again");
			});
		}
	}
});
