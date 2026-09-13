// @vitest-environment jsdom
// Body sub-resources MUST always render when present. Selecting an email, file, comment, credential, etc. shows its
// content (one iframe per active type, a switcher when several types exist), even when the entity has few scalar
// fields, which previously misclassified it as a "stub" and dropped the content. Regression guard for that.
import { describe, it, expect, beforeEach } from "vitest";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { provideLayout } from "../test/jsdom-layout.js";

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
		provideLayout();
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
		const html = await render("VerifiableCredential", { id: "vc1", issuer: "did:web:i", subject: "did:web:s" }, [
			{ id: "vb", content: '{"age_over_18":true}', mediaType: "application/json" },
		]);
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

	it("REGRESSION: a literal body-presentation field (content) renders as an inline block, not dropped and not a stub", async () => {
		const html = await render("SeqPath", { id: "0.1.2", content: "create issuer {issuer}" }, []);
		expect(html).toContain('data-testid="entity-body-content"'); // the literal-body block
		expect(html).toContain("create issuer {issuer}");
		expect(html).not.toContain('data-testid="entity-stub"'); // literal body content makes it a full view
	});
});

// A graph read names a record's bodies by id and media type and carries none of their text, which is read on request.
// The reading shown is chosen from that listing, whatever order the store lists the bodies in.
describe("the reading a record shows, chosen from a listing that carries no text", () => {
	beforeEach(() => {
		if (!customElements.get("shu-entity-column")) customElements.define("shu-entity-column", ShuEntityColumn);
	});

	const LISTED = [
		{ id: "b-plain", mediaType: "text/plain" },
		{ id: "b-html", mediaType: "text/html" },
		{ id: "b-md", mediaType: "text/markdown" },
	];
	const openListing = async (): Promise<ShuEntityColumn> => {
		const el = document.createElement("shu-entity-column") as ShuEntityColumn;
		document.body.appendChild(el);
		el.openProducts({ _type: "Email", _summary: "e1", id: "e1", from: "a@x", subject: "Hi", hasBody: LISTED });
		await el.updateComplete;
		return el;
	};
	const reading = (el: ShuEntityColumn) => el.shadowRoot?.querySelector('[data-testid="body-reading"]')?.textContent ?? "";
	const activeSwitch = (el: ShuEntityColumn) => el.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.BODY_READING}"][aria-pressed="true"]`)?.textContent ?? "";

	it("shows the markdown reading by default, though the store lists plain text and html before it", async () => {
		const el = await openListing();
		expect(reading(el), "the body the column reads is the markdown one").toContain("text/markdown");
		expect(activeSwitch(el)).toBe("text/markdown");
	});

	it("anchors a record's annotations on the reading shown, where the store lists plain text before markdown", async () => {
		const el = document.createElement("shu-entity-column") as ShuEntityColumn;
		document.body.appendChild(el);
		el.openProducts({
			_type: "Email",
			_summary: "e1",
			id: "e1",
			hasBody: [
				{ id: "b-plain", mediaType: "text/plain", content: "hiking this weekend" },
				{ id: "b-md", mediaType: "text/markdown", content: "**hiking** this weekend" },
			],
		});
		(el as unknown as { annotationsList: unknown[] }).annotationsList = [{ commentId: "c1", exact: "hiking this weekend", body: "a note" }];
		(el as unknown as { setState(p: Record<string, unknown>): void }).setState({ showAnnotations: true });
		await el.updateComplete;
		const annotated = el.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.ANNOTATED_BODY}"]`) as unknown as { mediaType: string } | null;
		expect(annotated?.mediaType, "the annotated reading is the markdown one the column shows").toBe("text/markdown");
	});

	it("reads and shows the reading a reader switches to, whose text was not read yet", async () => {
		const el = await openListing();
		const switchToHtml = el.shadowRoot?.querySelector<HTMLElement>(`[data-testid="${SHU_TEST_IDS.COLUMN_BROWSER.BODY_READING}"][data-body-id="b-html"]`);
		if (!switchToHtml) throw new Error("the column offers no html reading to switch to");
		switchToHtml.click();
		await el.updateComplete;
		expect(reading(el), "the column reads the html body now").toContain("text/html");
		expect(activeSwitch(el)).toBe("text/html");
	});
});

// The annotate toggle uses the pane-icon toggle system (aria-pressed = active), and colours its glyph only when
// annotations exist, so a reader tells at a glance whether a document carries notes, before opening the gutter.
describe("annotate toggle button", () => {
	beforeEach(() => {
		if (!customElements.get("shu-entity-column")) customElements.define("shu-entity-column", ShuEntityColumn);
	});

	const openWithAnnotatableBody = async (annotations: unknown[]): Promise<ShuEntityColumn> => {
		const el = document.createElement("shu-entity-column") as ShuEntityColumn;
		document.body.appendChild(el);
		el.openProducts({ _type: "File", _summary: "notes.md", id: "f1", hasBody: [{ id: "fb", content: "# Notes\n\nbody text", mediaType: "text/markdown" }] });
		// Seed annotations directly, then force the plain-body (iframe) path so the assertion doesn't depend on the
		// inline annotator mounting in jsdom. The button's colour reflects annotation COUNT regardless of the path.
		(el as unknown as { annotationsList: unknown[] }).annotationsList = annotations;
		(el as unknown as { setState(p: Record<string, unknown>): void }).setState({ showAnnotations: false });
		await el.updateComplete;
		return el;
	};

	const button = (el: ShuEntityColumn): HTMLElement | null => el.shadowRoot?.querySelector('[data-testid="annotate-enter"]') ?? null;

	it("is a pane-icon toggle, greyscale (no has-annotations) and not pressed when the document has no notes", async () => {
		const btn = button(await openWithAnnotatableBody([]));
		expect(btn).not.toBeNull();
		expect(btn?.classList.contains("pane-icon")).toBe(true);
		expect(btn?.classList.contains("has-annotations")).toBe(false);
		expect(btn?.getAttribute("aria-pressed")).toBe("false");
	});

	it("gains has-annotations (colour) when the document carries notes", async () => {
		const btn = button(await openWithAnnotatableBody([{ commentId: "c1", exact: "body", body: "a note" }]));
		expect(btn?.classList.contains("has-annotations")).toBe(true);
	});
});
