// @vitest-environment jsdom
// The details disclosure's summary is the type name; its body is the type's description.
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { ShuEntityColumn } from "./shu-entity-column.js";
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

describe("shu-entity-column type description", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		setConcernCatalog(buildConcernCatalog({ widget: typeDomain("Widget", "widget", "A widget.") }));
		if (!customElements.get("shu-entity-column")) customElements.define("shu-entity-column", ShuEntityColumn);
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
	});

	it("shows the type name as the disclosure summary and its description as the body", async () => {
		const html = await render("Widget");
		expect(html).toContain(">Widget</summary>");
		expect(html).toContain('data-testid="entity-type-description"');
		expect(html).toContain("A widget.");
	});

	it("is empty for an ad-hoc result view with no registered type", async () => {
		expect(await render("Result")).not.toContain('data-testid="entity-type-description"');
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

	it("marks field provenance from the served @context — the genuine vocabulary, not a rel guess", async () => {
		const el = document.createElement("shu-entity-column") as ShuEntityColumn;
		document.body.appendChild(el);
		el.openProducts({
			_type: "VerifiableCredential",
			id: "vc1",
			statusListIndex: "0",
			accessLevel: "private",
			"@context": { VerifiableCredential: { "@context": { statusListIndex: { "@id": "vcstatus:statusListIndex" }, accessLevel: { "@id": "hbn:accessLevel" } } } },
		});
		await el.updateComplete;
		const html = el.shadowRoot?.innerHTML ?? "";
		// vcstatus is a standard vocabulary → its prefix is shown; hbn is haibun's own → faint. (Not mis-attributed to `as`.)
		expect(html).toContain('data-testid="vocab-statusListIndex"');
		expect(html).toContain("vocab-standard");
		expect(html).toContain("vocab-haibun");
	});
});
