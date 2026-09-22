// @vitest-environment jsdom
// A record's view names its type as a link to the type's own view, which holds the description, and lists the record's fields.
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { ShuEntityColumn, foldedTargets } from "./shu-entity-column.js";
import { setConcernCatalog } from "../rels-cache.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { toRegisteredDomain, objectCoercer } from "@haibun/core/lib/domains.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";

const typeDomain = (persistedAs: string, selector: string, description: string) => {
	const schema = z.object({ id: z.string(), name: z.string(), note: z.string(), generatedAtTime: z.string() });
	return toRegisteredDomain({
		selectors: [selector],
		schema,
		coerce: objectCoercer(schema),
		description,
		topology: {
			persistedAs,
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel, note: LinkRelations.CONTEXT.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
		},
	});
};

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
		setConcernCatalog(buildConcernCatalog({ widget: typeDomain("Widget", "widget", "A widget.") }));
		if (!customElements.get("shu-entity-column")) customElements.define("shu-entity-column", ShuEntityColumn);
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
	});

	it("names the type as a link to the type's own view, which holds its description, and leaves the description there", async () => {
		const html = await render("Widget");
		expect(html).toContain('data-testid="entity-type-link"');
		expect(html).toContain('rel="type-ref"');
		expect(html).toContain(">Widget</a>");
		expect(html).not.toContain("A widget.");
	});

	it("names no type for an ad-hoc result view with no registered type", async () => {
		expect(await render("Result")).not.toContain('data-testid="entity-type-link"');
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
		expect(html).toContain('rel="type-ref"');
		expect(html).toContain("AquaticAnimalImportPermit");
		// Who may see the record is shown as its field, under no heading of its own.
		expect(html).toContain('data-testid="entity-governance"');
		expect(html).not.toContain(">Governance<");
	});
});
