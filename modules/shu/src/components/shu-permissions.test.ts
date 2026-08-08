// @vitest-environment jsdom
/**
 * What a reader is told about their own authority: the actions they hold, who this deployment knows, and the grants
 * behind them. A grant reads by its controller and what it allows, and never by its token — a bearer token is the
 * credential, so a view that printed one would hand it to whoever was looking.
 */
import { describe, it, expect, vi } from "vitest";
import { ShuPermissions, type TPermissionsSummary } from "./shu-permissions.js";
import { AuthorityController, type TAuthority } from "../controllers/index.js";

if (!customElements.get("shu-permissions")) customElements.define("shu-permissions", ShuPermissions);

const held: TAuthority = {
	holds: ["Instance:read", "comment.grant"],
	principals: [{ id: "did:site:0" }, { id: "did:site:0:kihan-session" }],
	grants: [
		{ handle: "a1b2c3d4", controller: "did:site:0", allowedAction: ["Instance:read"], revoked: false, note: "the served app's own session", seqPath: "0.1.1" },
		{ handle: "e5f6a7b8", controller: "did:site:0:agent", allowedAction: ["comment.invoke"], revoked: true },
	],
};

/** The records this view offers a way to, by the name each is shown under. */
const refTexts = (el: ShuPermissions, kind?: string): string[] =>
	Array.from(el.shadowRoot?.querySelectorAll(kind ? `shu-ref[kind="${kind}"]` : "shu-ref") ?? []).map((r) => r.getAttribute("text") ?? "");

async function mounted(authority = held) {
	vi.spyOn(AuthorityController.prototype, "read").mockResolvedValue(authority);
	const el = new ShuPermissions();
	document.body.append(el);
	await el.updateComplete;
	await new Promise((resolve) => setTimeout(resolve, 0));
	await el.updateComplete;
	return el;
}

describe("what a reader may do here", () => {
	it("says what this reader holds, so a refusal is explicable", async () => {
		const el = await mounted();
		expect(refTexts(el), "each action it was granted, as a way to what granted it").toContain("Instance:read");
		expect(el.shadowRoot?.textContent, "and the rest of them").toContain("comment.grant");
	});

	it("an action opens the step that granted it, in a column like anything else", async () => {
		const el = await mounted();
		const link = Array.from(el.shadowRoot?.querySelectorAll("shu-ref") ?? []).find((r) => r.getAttribute("text") === "Instance:read");
		expect(link?.getAttribute("kind"), "the ordinary way a step opens here").toBe("seqPath");
		expect(link?.getAttribute("linkTarget"), "the step the grant records").toContain("[0,1,1]");
	});

	it("names an action no grant here accounts for, rather than offering a way to nowhere", async () => {
		const el = await mounted();
		const links = Array.from(el.shadowRoot?.querySelectorAll("shu-ref") ?? []).map((r) => r.getAttribute("text"));
		expect(links, "comment.grant is held, and the grant holding it is revoked").not.toContain("comment.grant");
		expect(el.shadowRoot?.textContent, "so it is stated plainly instead").toContain("comment.grant");
	});

	it("opens with the read access in force, labelled as what it is", async () => {
		const el = await mounted();
		el.levels = ["private", "public"];
		el.level = "public";
		el.requestUpdate();
		await el.updateComplete;
		const label = el.shadowRoot?.querySelector("label[for='read-access']");
		expect(label?.textContent?.trim()).toBe("read access");
		expect((el.shadowRoot?.querySelector("#read-access") as HTMLSelectElement | null)?.value, "showing the one in force").toBe("public");
	});

	it("says how many principals the deployment knows, and names them on asking", async () => {
		const el = await mounted();
		expect(el.shadowRoot?.textContent, "the count, so the panel opens the size of a panel").toContain("principals (2)");
		expect(refTexts(el, "entity"), "and none of them until they are asked for").toEqual([]);
		Array.from(el.shadowRoot?.querySelectorAll("button") ?? []).find((b) => b.textContent?.includes("principals"))?.click();
		await el.updateComplete;
		expect(refTexts(el, "entity"), "each named, and each a way to its own record").toContain("did:site:0:kihan-session");
	});

	it("a failure is text a reader can take away, and says so with a control", async () => {
		vi.spyOn(AuthorityController.prototype, "read").mockRejectedValue(new Error("graphQuery: step not registered"));
		const el = new ShuPermissions();
		document.body.append(el);
		await el.updateComplete;
		await new Promise((resolve) => setTimeout(resolve, 0));
		await el.updateComplete;
		expect(el.shadowRoot?.textContent, "what went wrong, in the panel rather than only in a console").toContain("graphQuery: step not registered");
		const copy = el.shadowRoot?.querySelector("shu-copy-button") as (HTMLElement & { source: string }) | null;
		expect(copy?.source, "and it can be taken away as text").toBe("graphQuery: step not registered");
	});

	it("shows the grants behind them on asking, by controller and what they allow, never by their token", async () => {
		const el = await mounted();
		const closed = el.shadowRoot?.textContent ?? "";
		expect(closed, "the count is there to open").toContain("grants (2)");
		expect(closed, "and the rows are not, until they are asked for").not.toContain("comment.invoke");

		Array.from(el.shadowRoot?.querySelectorAll("button") ?? []).find((b) => b.textContent?.includes("grants"))?.click();
		await el.updateComplete;
		const open = el.shadowRoot?.textContent ?? "";
		expect(refTexts(el, "entity"), "who granted it, as a way to that principal").toContain("did:site:0:agent");
		expect(open, "and what it allows").toContain("comment.invoke");
		expect(open, "what it was issued for, where it says").toContain("the served app's own session");
		expect(el.shadowRoot?.querySelector(".revoked"), "a revoked grant reads as revoked rather than as authority").not.toBeNull();
	});

	it("says plainly when this page was given no credential", async () => {
		const el = await mounted({ holds: [], principals: [], grants: [] });
		expect(el.shadowRoot?.textContent).toContain("gave this page no credential");
	});
});

describe("acting on what holds here", () => {
	it("breaks a grant by the name the listing gives it, and reads what holds afterwards", async () => {
		const revoke = vi.spyOn(AuthorityController.prototype, "revoke").mockResolvedValue(undefined);
		const read = vi.spyOn(AuthorityController.prototype, "read").mockResolvedValue(held);
		const el = new ShuPermissions();
		document.body.append(el);
		await el.updateComplete;
		await new Promise((resolve) => setTimeout(resolve, 0));
		Array.from(el.shadowRoot?.querySelectorAll("button") ?? [])
			.find((b) => b.textContent?.includes("grants"))
			?.click();
		await el.updateComplete;

		const breaking = Array.from(el.shadowRoot?.querySelectorAll("button") ?? []).filter((b) => b.textContent?.includes("revoke"));
		expect(breaking.length, "one for each grant that still holds, and none for one already revoked").toBe(1);
		breaking[0].click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(revoke, "named by its handle, never by a credential").toHaveBeenCalledWith("a1b2c3d4");
		expect(read.mock.calls.length, "and what holds is read again rather than assumed").toBeGreaterThan(1);
	});

	it("says what it was refused, where breaking a grant is not this reader's to do", async () => {
		vi.spyOn(AuthorityController.prototype, "read").mockResolvedValue(held);
		vi.spyOn(AuthorityController.prototype, "revoke").mockRejectedValue(new Error("capability Authority:revoke required"));
		const el = new ShuPermissions();
		document.body.append(el);
		await el.updateComplete;
		await new Promise((resolve) => setTimeout(resolve, 0));
		Array.from(el.shadowRoot?.querySelectorAll("button") ?? [])
			.find((b) => b.textContent?.includes("grants"))
			?.click();
		await el.updateComplete;
		Array.from(el.shadowRoot?.querySelectorAll("button") ?? [])
			.find((b) => b.textContent?.includes("revoke"))
			?.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await el.updateComplete;
		expect(el.shadowRoot?.textContent, "which is what a reader needs to know to ask for it").toContain("capability Authority:revoke required");
	});

	it("every principal and every grant's holder is a way to that record", async () => {
		vi.spyOn(AuthorityController.prototype, "read").mockResolvedValue(held);
		const el = new ShuPermissions();
		document.body.append(el);
		await el.updateComplete;
		await new Promise((resolve) => setTimeout(resolve, 0));
		for (const section of ["principals", "grants"]) {
			Array.from(el.shadowRoot?.querySelectorAll("button") ?? [])
				.find((b) => b.textContent?.includes(section))
				?.click();
			await el.updateComplete;
		}
		expect(refTexts(el, "entity").length, "two principals and the principal that granted each grant").toBe(4);
		expect(refTexts(el, "seqPath"), "and where each grant was granted, which opens as a step").toContain("0.1.1");
	});
});

describe("what the indicator is told", () => {
	it("counts each thing the panel lists, and says so again whenever it reads again", async () => {
		vi.spyOn(AuthorityController.prototype, "read").mockResolvedValue(held);
		const revoke = vi.spyOn(AuthorityController.prototype, "revoke").mockResolvedValue(undefined);
		const heard: TPermissionsSummary[] = [];
		document.addEventListener("permissions-summary", (e) => heard.push((e as CustomEvent<TPermissionsSummary>).detail));
		const el = new ShuPermissions();
		document.body.append(el);
		await el.updateComplete;
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(heard.at(-1), "one count per thing it lists, so nothing it shows is unaccounted for").toEqual({ holds: 2, principals: 2, grants: 2 });

		Array.from(el.shadowRoot?.querySelectorAll("button") ?? [])
			.find((b) => b.textContent?.includes("grants"))
			?.click();
		await el.updateComplete;
		Array.from(el.shadowRoot?.querySelectorAll("button") ?? [])
			.find((b) => b.textContent?.includes("revoke"))
			?.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(revoke).toHaveBeenCalled();
		expect(heard.length, "and again after what holds has changed, so the indicator is never behind the panel").toBeGreaterThan(1);
	});
});
