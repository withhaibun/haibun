import { describe, it, expect } from "vitest";
import { z } from "zod";
import { QuadStore } from "./quad-store.js";
import { individualCrudSteps, generateIndividualCrudFromDomains } from "./individual-crud.js";

const WidgetSchema = z.object({ name: z.string(), size: z.number(), color: z.string().optional() });

describe("individual CRUD on QuadStore", () => {
	it("upsert and get via generated steps", async () => {
		const store = new QuadStore();
		store.registerIndividualType("Widget", WidgetSchema, "name");
		const steps = individualCrudSteps("Widget", "my-widget", "my-widget-list", () => store);

		const createResult = await steps.createWidget.action({ data: { name: "cog", size: 7, color: "red" } });
		expect(createResult.ok).toBe(true);

		const getResult = await steps.getWidget.action({ id: "cog" });
		expect(getResult.ok).toBe(true);
		expect(getResult.products).toMatchObject({ name: "cog", size: 7, color: "red" });
	});

	it("get returns error for missing individual", async () => {
		const store = new QuadStore();
		const steps = individualCrudSteps("Widget", "my-widget", "my-widget-list", () => store);
		const result = await steps.getWidget.action({ id: "missing" });
		expect(result.ok).toBe(false);
	});

	it("delete removes individual", async () => {
		const store = new QuadStore();
		store.registerIndividualType("Widget", WidgetSchema, "name");
		const steps = individualCrudSteps("Widget", "my-widget", "my-widget-list", () => store);
		await steps.createWidget.action({ data: { name: "cog", size: 7 } });
		await steps.deleteWidget.action({ id: "cog" });
		const result = await steps.getWidget.action({ id: "cog" });
		expect(result.ok).toBe(false);
	});

	it("list returns all individuals", async () => {
		const store = new QuadStore();
		store.registerIndividualType("Widget", WidgetSchema, "name");
		const steps = individualCrudSteps("Widget", "my-widget", "my-widget-list", () => store);
		await steps.createWidget.action({ data: { name: "a", size: 1 } });
		await steps.createWidget.action({ data: { name: "b", size: 2 } });
		const result = await steps.listWidgets.action({});
		expect(result.ok).toBe(true);
		expect(result.products?.vertices).toHaveLength(2);
	});

	it("gwta patterns are correct", () => {
		const store = new QuadStore();
		const steps = individualCrudSteps("Widget", "my-widget", "my-widget-list", () => store);
		expect(steps.createWidget.gwta).toBe("create widget {data: my-widget}");
		expect(steps.getWidget.gwta).toBe("get widget {id: string}");
		expect(steps.deleteWidget.gwta).toBe("delete widget {id: string}");
		expect(steps.listWidgets.gwta).toBe("list widgets");
	});

	it("validates against Zod schema on create", async () => {
		const store = new QuadStore();
		store.registerIndividualType("Widget", WidgetSchema, "name");
		const steps = individualCrudSteps("Widget", "my-widget", "my-widget-list", () => store);
		await expect(steps.createWidget.action({ data: { name: 123, size: "bad" } })).rejects.toThrow();
	});
});

describe("generateIndividualCrudFromDomains", () => {
	it("generates CRUD for all persisted domains, skips non-persisted domains", () => {
		const store = new QuadStore();
		const domains = {
			"my-widget": { schema: WidgetSchema, topology: { persistedAs: "Widget", id: "name" } },
			"my-gadget": { schema: z.object({ id: z.string() }), topology: { persistedAs: "Gadget", id: "id" } },
			"query-schema": { schema: z.string() },
		};
		const steps = generateIndividualCrudFromDomains(domains, () => store);
		expect(steps.createWidget).toBeDefined();
		expect(steps.getGadget).toBeDefined();
		expect(Object.keys(steps)).toHaveLength(8); // 4 CRUD × 2 persisted types
	});
});
