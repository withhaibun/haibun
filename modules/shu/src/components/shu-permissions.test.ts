// @vitest-environment jsdom
/**
 * What a reader is told about their own authority: the actions they hold, where what they hold is recorded, and who this
 * deployment knows.
 */
import { describe, it, expect, vi } from "vitest";
import { ShuPermissions, type TPermissionsSummary } from "./shu-permissions.js";
import { AuthorityController, type TAuthority } from "../controllers/index.js";

if (!customElements.get("shu-permissions")) customElements.define("shu-permissions", ShuPermissions);

const held: TAuthority = {
	holds: ["Instance:read", "comment.grant"],
	principals: [{ id: "did:site:0" }, { id: "did:site:0:kihan-session" }],
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
		expect(el.shadowRoot?.textContent).toContain("Instance:read");
		expect(el.shadowRoot?.textContent, "and the rest of them").toContain("comment.grant");
	});

	it("opens what a reader holds as the record of it, which leads on to what that was granted from", async () => {
		// A deployment that records what it issues tells the reader where: the action is then a way into that record,
		// rather than a word naming authority whose origin the reader cannot reach.
		const el = await mounted({ ...held, heldAs: { persistedAs: "Capability", id: "urn:uuid:session-delegation" } });
		const link = Array.from(el.shadowRoot?.querySelectorAll("shu-ref") ?? []).find((r) => r.getAttribute("text") === "Instance:read");
		expect(link?.getAttribute("kind"), "the ordinary way a record opens here").toBe("entity");
		expect(link?.getAttribute("linkTarget"), "the delegation the reader acts under").toContain("urn:uuid:session-delegation");
		expect(refTexts(el, "entity"), "and every action it holds leads there, since one delegation granted them all").toEqual(
			expect.arrayContaining(["Instance:read", "comment.grant"]),
		);
	});

	it("names an action nothing here recorded, rather than offering a way to nowhere", async () => {
		const el = await mounted();
		expect(refTexts(el), "no record accounts for what it holds").not.toContain("comment.grant");
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

	it("says how many principals the deployment knows, and names each on asking as a way to its record", async () => {
		const el = await mounted();
		expect(el.shadowRoot?.textContent, "the count, so the panel opens the size of a panel").toContain("principals (2)");
		expect(refTexts(el, "entity"), "and none of them until they are asked for").toEqual([]);
		Array.from(el.shadowRoot?.querySelectorAll("button") ?? [])
			.find((b) => b.textContent?.includes("principals"))
			?.click();
		await el.updateComplete;
		expect(refTexts(el, "entity"), "each named, and each a way to its own record").toEqual(["did:site:0", "did:site:0:kihan-session"]);
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

	it("says plainly when this page was given no credential", async () => {
		const el = await mounted({ holds: [], principals: [] });
		expect(el.shadowRoot?.textContent).toContain("gave this page no credential");
	});
});

describe("what the indicator is told", () => {
	it("counts each thing the panel lists", async () => {
		const heard: TPermissionsSummary[] = [];
		document.addEventListener("permissions-summary", (e) => heard.push((e as CustomEvent<TPermissionsSummary>).detail));
		await mounted();
		expect(heard.at(-1), "one count per thing it lists, so nothing it shows is unaccounted for").toEqual({ holds: 2, principals: 2 });
	});
});
