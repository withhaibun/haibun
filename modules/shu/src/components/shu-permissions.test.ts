// @vitest-environment jsdom
/**
 * What a reader is told about their own authority: the key their page signs as, the actions delegated to it, where each
 * was recorded, and who this deployment knows.
 */
import { describe, it, expect } from "vitest";
import { ShuPermissions, type TPermissionsSummary } from "./shu-permissions.js";
import "./shu-page-key.js";
import type { TAuthority } from "../controllers/index.js";
import { pageAuthorityFails, pageHolding } from "../controllers/authority-controller.test-fake.js";

const PAGE = "did:key:zDnaePage";
const held: TAuthority = {
	controller: PAGE,
	holds: ["Instance:read", "comment.grant"],
	grantedBy: {},
	principals: [{ id: "did:site:0" }, { id: "did:site:0:kihan-session" }],
};

/** The records this view offers a way to, by the name each is shown under. */
const refTexts = (el: ShuPermissions, kind?: string): string[] =>
	Array.from(el.shadowRoot?.querySelectorAll(kind ? `shu-ref[kind="${kind}"]` : "shu-ref") ?? []).map((r) => r.getAttribute("text") ?? "");

async function mounted(authority = held) {
	pageHolding(authority);
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

	it("shows the key this page signs as, which is what a holder delegates to", async () => {
		const el = await mounted();
		expect(el.shadowRoot?.querySelector("shu-page-key")?.getAttribute("controller")).toBe(PAGE);
	});

	it("opens what a reader holds as the record of the delegation that granted it, which leads on to what that was delegated from", async () => {
		const delegation = { persistedAs: "Capability", id: "urn:uuid:page-delegation" };
		const el = await mounted({ ...held, grantedBy: { "Instance:read": delegation, "comment.grant": delegation } });
		const link = Array.from(el.shadowRoot?.querySelectorAll("shu-ref") ?? []).find((r) => r.getAttribute("text") === "Instance:read");
		expect(link?.getAttribute("kind"), "the ordinary way a record opens here").toBe("entity");
		expect(link?.getAttribute("linkTarget"), "the delegation the reader acts under").toContain("urn:uuid:page-delegation");
		expect(refTexts(el, "entity"), "and every action it holds leads there").toEqual(expect.arrayContaining(["Instance:read", "comment.grant"]));
	});

	it("links an action without a record here, such as one allowed without a delegation, to what it allows rather than to a record", async () => {
		const el = await mounted();
		expect(refTexts(el, "entity"), "the records don't account for what it holds").not.toContain("comment.grant");
		expect(refTexts(el, "action"), "so it opens the steps it allows").toContain("comment.grant");
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
		expect(refTexts(el, "entity"), "and doesn't link them until a reader asks for them").toEqual([]);
		Array.from(el.shadowRoot?.querySelectorAll("button") ?? [])
			.find((b) => b.textContent?.includes("principals"))
			?.click();
		await el.updateComplete;
		expect(refTexts(el, "entity"), "each named, and each a way to its own record").toEqual(["did:site:0", "did:site:0:kihan-session"]);
	});

	it("a failure is text a reader can take away, and says so with a control", async () => {
		pageAuthorityFails(new Error("graphQuery: step not registered"));
		const el = new ShuPermissions();
		document.body.append(el);
		await el.updateComplete;
		await new Promise((resolve) => setTimeout(resolve, 0));
		await el.updateComplete;
		expect(el.shadowRoot?.textContent, "what went wrong, in the panel rather than only in a console").toContain("graphQuery: step not registered");
		const copy = el.shadowRoot?.querySelector("shu-copy-button") as (HTMLElement & { source: string }) | null;
		expect(copy?.source, "and it can be taken away as text").toBe("graphQuery: step not registered");
	});

	it("says plainly when this page's key doesn't hold a delegation", async () => {
		const el = await mounted({ controller: PAGE, holds: [], grantedBy: {}, principals: [] });
		expect(el.shadowRoot?.textContent).toContain("this page's key doesn't hold a delegation");
	});
});

describe("what the indicator is told", () => {
	it("counts each thing the panel lists", async () => {
		const heard: TPermissionsSummary[] = [];
		document.addEventListener("permissions-summary", (e) => heard.push((e as CustomEvent<TPermissionsSummary>).detail));
		await mounted();
		expect(heard.at(-1), "one count per thing it lists, so each thing it shows is counted").toEqual({ holds: 2, principals: 2 });
	});
});
