// @vitest-environment jsdom
/**
 * A field whose type declares it an edge names a record, so it renders as a link to that record wherever a view shows
 * it: a thread card's sender, a key a delegation names, an item an items table lists. A field declared as anything else
 * is its text.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { LinkRelations, PRINCIPAL_LABEL } from "@haibun/core/lib/resources.js";
import { REF_DENOTES } from "@haibun/core/lib/typed-links.js";
import { setSiteMetadata, type SiteMetadata } from "../rels-cache.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { provideLayout } from "../test/jsdom-layout.js";
import { fieldRef } from "./shu-ref.js";
import "./shu-ref-element.js";
import { ShuThreadColumn } from "./shu-thread-column.js";
import { ShuPageKey } from "./shu-page-key.js";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { paneHref } from "./ref-navigation.js";

const [EMAIL, PERSON, NOTE] = ["Email", "Person", "Note"];
const [SENDER, SUBJECT] = ["from", "subject"];
const ADDRESS = "sender@example.com";
const KEY = "did:key:z6MkexampleKey";
/** The IRI prefix of the records a case names. */
const RECORDS = "ex:";
const META: SiteMetadata = {
	types: [EMAIL, PERSON, NOTE],
	idFields: { [EMAIL]: "messageId", [PERSON]: "id", [NOTE]: "id" },
	rels: { [EMAIL]: { messageId: LinkRelations.IDENTIFIER.rel, [SENDER]: LinkRelations.ATTRIBUTED_TO.rel, [SUBJECT]: LinkRelations.NAME.rel }, [PERSON]: {}, [NOTE]: {} },
	edgeRanges: { [EMAIL]: { [SENDER]: [PERSON] } },
	properties: { [EMAIL]: ["messageId", SENDER, SUBJECT], [PERSON]: ["id"], [NOTE]: ["id"] },
	queryable: {},
	validTimeFields: {},
	summary: {},
	ui: {},
	propertyDefinitions: {},
};

/** The references rendered under `root`, as the kind and target each names. */
const refsIn = (root: ParentNode) => [...root.querySelectorAll("shu-ref")].map((ref) => [ref.getAttribute("kind"), JSON.parse(ref.getAttribute("linkTarget") ?? "{}")]);

beforeEach(() => {
	provideLayout();
	setSiteMetadata(META);
	document.body.innerHTML = "";
});

describe("a field a type declares an edge", () => {
	it("links the record it names, and a field declared as anything else is its text", () => {
		const host = document.body.appendChild(document.createElement("div"));
		render([fieldRef(EMAIL, SENDER, ADDRESS), fieldRef(EMAIL, SUBJECT, "hello")], host);
		expect(refsIn(host)).toEqual([[REF_DENOTES.individual, { persistedAs: PERSON, id: ADDRESS }]]);
		expect(host.textContent, "and the subject reads as its text").toContain("hello");
	});

	it("links a thread card's sender, the field its type declares with the attribution rel", async () => {
		const thread = document.body.appendChild(new ShuThreadColumn());
		thread.openItems([{ "@id": `${RECORDS}email/m-1`, "@type": EMAIL, messageId: "m-1", [SENDER]: ADDRESS, [SUBJECT]: "hello" }], EMAIL);
		await thread.updateComplete;
		const sender = thread.shadowRoot?.querySelector(`[data-testid="${SHU_TEST_IDS.THREAD.SENDER}"]`);
		expect(sender?.getAttribute("linkTarget") && JSON.parse(sender.getAttribute("linkTarget") ?? "{}")).toEqual({ persistedAs: PERSON, id: ADDRESS });
	});
});

describe("a key a delegation names", () => {
	it("links the Principal it is recorded as", async () => {
		const key = document.body.appendChild(new ShuPageKey());
		key.setAttribute("controller", KEY);
		await key.updateComplete;
		expect(refsIn(key.shadowRoot as ParentNode)).toEqual([[REF_DENOTES.individual, { persistedAs: PRINCIPAL_LABEL, id: KEY }]]);
	});
});

describe("an items table", () => {
	it("links each item that names its type and identity to that record", async () => {
		const column = document.body.appendChild(new ShuEntityColumn());
		column.openProducts({ _type: NOTE, _summary: "n-1", id: "n-1", title: "a note", listed: [{ "@id": `${RECORDS}note/n-2`, "@type": NOTE, title: "another" }] });
		await column.updateComplete;
		const linked = [...(column.shadowRoot?.querySelectorAll(".items-table a") ?? [])].map((anchor) => anchor.getAttribute("href"));
		expect(linked).toEqual([paneHref({ paneType: "entity", persistedAs: NOTE, id: "n-2" })]);
	});
});
