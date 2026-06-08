// @vitest-environment jsdom
// Body sub-resources MUST always render when present. Selecting an email, file, comment, credential, etc. shows its
// content (one iframe per active type, a switcher when several types exist) — even when the entity has few scalar
// fields, which previously misclassified it as a "stub" and dropped the content. Regression guard for that.
import { describe, it, expect, beforeEach } from "vitest";
import { ShuEntityColumn } from "./shu-entity-column.js";

type Body = { id: string; content: string; mediaType: string };

const render = async (type: string, fields: Record<string, unknown>, bodies: Body[]): Promise<string> => {
	const el = document.createElement("shu-entity-column") as ShuEntityColumn;
	document.body.appendChild(el);
	el.openProducts({ _type: type, _summary: fields.id ?? type, ...fields, hasBody: bodies });
	await el.updateComplete;
	return el.shadowRoot?.innerHTML ?? "";
};

describe("entity body content renders for every type and view that should show it", () => {
	beforeEach(() => {
		if (!customElements.get("shu-entity-column")) customElements.define("shu-entity-column", ShuEntityColumn);
	});

	it("email with html + plain bodies: shows the body iframe and a switcher button per type", async () => {
		const html = await render("Email", { id: "e1", from: "a@x", subject: "Hi" }, [
			{ id: "b-html", content: "<p>hello</p>", mediaType: "text/html" },
			{ id: "b-text", content: "hello", mediaType: "text/plain" },
		]);
		expect(html).toContain('data-testid="email-body-iframe"');
		expect(html).toContain('class="content-switcher"'); // the rendered switcher container, not the CSS rule
		expect(html).toContain("text/html");
		expect(html).toContain("text/plain");
	});

	it("file with a single markdown body: shows the iframe (no switcher needed for one type)", async () => {
		const html = await render("File", { id: "f1", name: "notes.md" }, [{ id: "fb", content: "# Notes", mediaType: "text/markdown" }]);
		expect(html).toContain('data-testid="email-body-iframe"');
		expect(html).not.toContain('class="content-switcher"');
	});

	it("comment with a markdown body shows its content", async () => {
		const html = await render("Comment", { id: "c1", attributedTo: "did:web:x" }, [{ id: "cb", content: "looks good", mediaType: "text/markdown" }]);
		expect(html).toContain('data-testid="email-body-iframe"');
	});

	it("credential with a json body shows its content", async () => {
		const html = await render("VerifiableCredential", { id: "vc1", issuer: "did:web:i", subject: "did:web:s" }, [{ id: "vb", content: '{"age_over_18":true}', mediaType: "application/json" }]);
		expect(html).toContain('data-testid="email-body-iframe"');
	});

	it("REGRESSION: an entity with only an id plus a body still renders the content (not hidden as a stub)", async () => {
		const html = await render("File", { id: "only-id" }, [{ id: "ob", content: "# Body is the substance", mediaType: "text/markdown" }]);
		expect(html).toContain('data-testid="email-body-iframe"');
		expect(html).not.toContain('data-testid="entity-stub"');
	});

	it("skips bodies with no content or no mediaType (renders nothing rather than an empty iframe)", async () => {
		const html = await render("File", { id: "f2", name: "x" }, [{ id: "empty", content: "", mediaType: "text/markdown" }]);
		expect(html).not.toContain('data-testid="email-body-iframe"');
	});
});
