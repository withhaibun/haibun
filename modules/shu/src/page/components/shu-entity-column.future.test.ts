// @vitest-environment jsdom
/** A record whose valid time is after the time cursor renders dimmed in the entity column, and moving the cursor past it
 *  renders it plain (CA4D11). */
import { declareCatalog } from "../../test/catalog-fixture.js";
import { describe, it, expect, beforeEach } from "vitest";
import { ShuEntityColumn } from "./shu-entity-column.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { TIME_SYNC_CLASS } from "../../domains/elements.js";
import { persistedTypeDefinition } from "../../test/setup.js";
import { timeCursor } from "../root.js";

const MADE_AT = "2026-03-01T12:00:00.000Z";
const BEFORE = Date.parse(MADE_AT) - 60_000;
const AFTER = Date.parse(MADE_AT) + 60_000;

/** Whether the column renders its record dimmed. */
const dimmed = (el: ShuEntityColumn): boolean => el.shadowRoot?.querySelector(".entity-content")?.classList.contains(TIME_SYNC_CLASS.FUTURE) === true;

describe("an entity column's record after the time cursor", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		timeCursor.set(null);
		declareCatalog(buildConcernCatalog(mapDefinitionsToDomains([persistedTypeDefinition("Widget", { properties: { name: LinkRelations.NAME.rel } })])));
		if (!customElements.get("shu-spinner")) customElements.define("shu-spinner", class extends HTMLElement {});
	});

	it("renders dimmed while the cursor is before the record's valid time, and plain once the cursor passes it", async () => {
		const el = new ShuEntityColumn();
		document.body.appendChild(el);
		el.openProducts({ _type: "Widget", id: "w1", name: "a widget", generatedAtTime: MADE_AT });
		await el.updateComplete;
		expect(dimmed(el), "at the live edge a record isn't after the cursor").toBe(false);
		timeCursor.set(BEFORE);
		await el.updateComplete;
		expect(dimmed(el), "a record made after the cursor is dimmed").toBe(true);
		timeCursor.set(AFTER);
		await el.updateComplete;
		expect(dimmed(el), "a record made before the cursor is plain").toBe(false);
	});
});
