// @vitest-environment jsdom
// A record's view names its type as a link to the type's own view, which holds the description, and lists the record's fields.
import { describe, it, expect, beforeEach } from "vitest";
import { ShuEntityColumn, foldedTargets } from "./shu-entity-column.js";
import { setConcernCatalog } from "../rels-cache.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { refHref } from "./ref-navigation.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { RECORD_JSON } from "./json-disclosure.js";
import { persistedTypeDefinition } from "../test-setup.js";

/** The href of a link to a type's view, as the column's markup serializes it. */
const typeHref = (domain: string) => `href="${refHref(REF_DENOTES.type, { domain })}"`;

const render = async (type: string): Promise<string> => {
	const el = document.createElement("shu-entity-column") as ShuEntityColumn;
	document.body.appendChild(el);
	el.openProducts({ _type: type, id: "x1", name: "Example", note: "n" });
	await el.updateComplete;
	return el.shadowRoot?.innerHTML ?? "";
};

describe("shu-entity-column type and fields", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		setConcernCatalog(
			buildConcernCatalog(
				mapDefinitionsToDomains([persistedTypeDefinition("Widget", { description: "A widget.", properties: { name: LinkRelations.NAME.rel, note: LinkRelations.CONTEXT.rel } })]),
			),
		);
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
	});

	it("names the type as a link to the type's own view, which holds its description, and leaves the description there", async () => {
		const html = await render("Widget");
		expect(html).toContain(`data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ENTITY_TYPE_LINK}"`);
		expect(html).toContain(typeHref("Widget"));
		expect(html).toContain(">Widget</a>");
		expect(html).not.toContain("A widget.");
	});

	it("doesn't name a type for an ad-hoc result view without a registered type", async () => {
		expect(await render("Result")).not.toContain(`data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ENTITY_TYPE_LINK}"`);
	});

	it("shows non-summary fields in a visible fields section (not buried in the collapsed disclosure)", async () => {
		const el = document.createElement("shu-entity-column") as ShuEntityColumn;
		document.body.appendChild(el);
		el.openProducts({ _type: "Widget", id: "x1", name: "Example", note: "what it was invoked for", meta: { a: 1 } });
		await el.updateComplete;
		const html = el.shadowRoot?.innerHTML ?? "";
		expect(html).toContain('data-testid="entity-fields"');
		expect(html).toContain('data-testid="entity-field-note"');
		expect(html).toContain("what it was invoked for");
		// an object-valued field renders as formatted JSON
		expect(html).toContain('data-testid="field-json-meta"');
	});

	it("shows each field's value in full, and the whole record last, as JSON in disclosures", async () => {
		const error = `page.goto: Protocol error (Page.navigate): ${"a reason that runs well past any line ".repeat(4)}ends here`;
		const el = document.createElement("shu-entity-column") as ShuEntityColumn;
		document.body.appendChild(el);
		el.openProducts({ _type: "Widget", id: "x1", name: "Example", note: error });
		await el.updateComplete;
		expect(el.shadowRoot?.querySelector('[data-testid="entity-field-note"]')?.textContent, "the value isn't cut").toContain(error);
		const record = el.shadowRoot?.querySelector(`.entity-content > [data-testid="${RECORD_JSON}"]:last-child`);
		expect(record?.querySelector(".json-disclosure")?.textContent, "the record is last, as JSON").toContain(`"${error}"`);
	});

	it("folds a field table that holds many fields behind a summary naming how many, and leaves a small one open", async () => {
		const open = async (fields: Record<string, unknown>) => {
			const el = document.createElement("shu-entity-column") as ShuEntityColumn;
			document.body.appendChild(el);
			el.openProducts({ _type: "Widget", id: "x1", name: "Example", ...fields });
			await el.updateComplete;
			return el.shadowRoot?.innerHTML ?? "";
		};
		const many = await open(Object.fromEntries(Array.from({ length: 8 }, (_, at) => [`field${at}`, `value ${at}`])));
		expect(many).toContain('data-testid="entity-fields-disclosure"');
		expect(many, "the summary names how many fields the table holds").toMatch(/<summary class="fields-summary">9 fields<\/summary>/);
		expect(await open({ extra: "one" }), "a small table stays open").not.toContain('data-testid="entity-fields-disclosure"');
	});

	it("shows a reference group's first targets and folds the rest behind a disclosure naming how many", () => {
		const targets = ["a", "b", "c", "d", "e", "f"];
		expect(foldedTargets(targets)).toBe('a, b, c, d<details class="ref-more"><summary class="ref-more-count">2 more</summary>e, f</details>');
		expect(foldedTargets(targets.slice(0, 4)), "a group within the threshold is listed whole").toBe("a, b, c, d");
	});

	it("marks field provenance from the served @context: the genuine vocabulary, not a rel guess", async () => {
		const el = document.createElement("shu-entity-column") as ShuEntityColumn;
		document.body.appendChild(el);
		el.openProducts({
			_type: "VerifiableCredential",
			id: "vc1",
			type: ["VerifiableCredential", "AquaticAnimalImportPermit"],
			statusListIndex: "0",
			accessLevel: "private",
			"@context": {
				VerifiableCredential: { "@context": { type: { "@id": "@type" }, statusListIndex: { "@id": "vcstatus:statusListIndex" }, accessLevel: { "@id": "hbn:accessLevel" } } },
			},
		});
		await el.updateComplete;
		const html = el.shadowRoot?.innerHTML ?? "";
		// vcstatus is a standard vocabulary → its prefix is shown; hbn is haibun's own → faint. (Not mis-attributed to `as`.)
		expect(html).toContain('data-testid="vocab-statusListIndex"');
		expect(html).toContain("vocab-standard");
		expect(html).toContain("vocab-haibun");
		// rdf:type renders as the standard @type keyword, each class an explorable link.
		expect(html).toContain(">@type</td>");
		expect(html).toContain(typeHref("AquaticAnimalImportPermit"));
		// Who may see the record is shown as its field, without a heading of its own.
		expect(html).toContain('data-testid="entity-governance"');
		expect(html).not.toContain(">Governance<");
	});
});
