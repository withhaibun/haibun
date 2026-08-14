import { describe, it, expect, beforeEach } from "vitest";
import { resolveUi, ENTITY_COMPONENT, COLLECTION_COMPONENT } from "./resolve-ui.js";
import { setSiteMetadata, type SiteMetadata } from "./rels-cache.js";

const META: SiteMetadata = {
	types: [],
	idFields: {},
	rels: {},
	edgeRanges: {},
	properties: {},
	queryable: {},
	validTimeFields: {},
	summary: {},
	propertyDefinitions: {},
	ui: {
		Affordances: { component: "shu-affordances-panel" },
		Pinned: { component: "shu-x", pinnedOnly: true },
		Slotted: { component: "shu-y", slot: "action-bar-chat" },
	},
};

describe("resolveUi", () => {
	beforeEach(() => setSiteMetadata(META));

	it("prefers the product's stamped _component", () => {
		expect(resolveUi({ _component: "shu-polymorphic-graph-view", _type: "Affordances" }).component).toBe("shu-polymorphic-graph-view");
	});

	it("falls back to the type's registered UI component", () => {
		expect(resolveUi({ _type: "Affordances" }).component).toBe("shu-affordances-panel");
	});

	it("defaults a collection (carrying items) to the thread column", () => {
		expect(resolveUi({ _type: "Unknown", items: [{}] }).component).toBe(COLLECTION_COMPONENT);
	});

	it("defaults a single entity to the entity column", () => {
		expect(resolveUi({ _type: "Unknown" }).component).toBe(ENTITY_COMPONENT);
		expect(resolveUi({}).component).toBe(ENTITY_COMPONENT);
	});

	// A slotted panel is about the type, not about one record of it: the petitions panel sits in the permissions area
	// for every proposal there is. Rendering a record with it mounts a panel that has none of a record view's methods.
	it("does not render a record with the panel its type mounts in a slot", () => {
		expect(resolveUi({ _type: "Slotted" }).component).toBe(ENTITY_COMPONENT);
		expect(resolveUi({ _type: "Slotted", items: [{}] }).component).toBe(COLLECTION_COMPONENT);
	});

	it("still honours a stamped _component on a slotted type", () => {
		expect(resolveUi({ _component: "shu-y", _type: "Slotted" }).component).toBe("shu-y");
	});

	it("passes through slot and pinnedOnly from the type's UI", () => {
		expect(resolveUi({ _type: "Slotted" }).slot).toBe("action-bar-chat");
		expect(resolveUi({ _type: "Pinned" }).pinnedOnly).toBe(true);
		expect(resolveUi({ _type: "Affordances" }).pinnedOnly).toBe(false);
		expect(resolveUi({ _type: "Affordances" }).slot).toBeUndefined();
	});
});
