import { describe, it, expect } from "vitest";
import { z } from "zod";
import { QuadStore } from "./quad-store.js";
import { vertexCrudSteps, generateVertexCrudFromDomains } from "./vertex-crud.js";

const WidgetSchema = z.object({ name: z.string(), size: z.number(), color: z.string().optional() });

describe("vertex CRUD on QuadStore", () => {
	it("upsert and get via generated steps", async () => {
		const store = new QuadStore();
		store.registerVertexType("Widget", WidgetSchema, "name");
		const steps = vertexCrudSteps("Widget", "my-widget", () => store);

		const createResult = await steps.createWidget.action({ data: { name: "cog", size: 7, color: "red" } });
		expect(createResult.ok).toBe(true);

		const getResult = await steps.getWidget.action({ id: "cog" });
		expect(getResult.ok).toBe(true);
		expect(getResult.products?.vertex).toMatchObject({ name: "cog", size: 7, color: "red" });
	});

	it("get returns error for missing vertex", async () => {
		const store = new QuadStore();
		const steps = vertexCrudSteps("Widget", "my-widget", () => store);
		const result = await steps.getWidget.action({ id: "missing" });
		expect(result.ok).toBe(false);
	});

	it("delete removes vertex", async () => {
		const store = new QuadStore();
		store.registerVertexType("Widget", WidgetSchema, "name");
		const steps = vertexCrudSteps("Widget", "my-widget", () => store);
		await steps.createWidget.action({ data: { name: "cog", size: 7 } });
		await steps.deleteWidget.action({ id: "cog" });
		const result = await steps.getWidget.action({ id: "cog" });
		expect(result.ok).toBe(false);
	});

	it("list returns all vertices", async () => {
		const store = new QuadStore();
		store.registerVertexType("Widget", WidgetSchema, "name");
		const steps = vertexCrudSteps("Widget", "my-widget", () => store);
		await steps.createWidget.action({ data: { name: "a", size: 1 } });
		await steps.createWidget.action({ data: { name: "b", size: 2 } });
		const result = await steps.listWidgets.action({});
		expect(result.ok).toBe(true);
		expect(result.products?.vertices).toHaveLength(2);
	});

	it("gwta patterns are correct", () => {
		const store = new QuadStore();
		const steps = vertexCrudSteps("Widget", "my-widget", () => store);
		expect(steps.createWidget.gwta).toBe("create widget {data: my-widget}");
		expect(steps.getWidget.gwta).toBe("get widget {id: string}");
		expect(steps.deleteWidget.gwta).toBe("delete widget {id: string}");
		expect(steps.listWidgets.gwta).toBe("list widgets");
	});

	it("validates against Zod schema on create", async () => {
		const store = new QuadStore();
		store.registerVertexType("Widget", WidgetSchema, "name");
		const steps = vertexCrudSteps("Widget", "my-widget", () => store);
		await expect(steps.createWidget.action({ data: { name: 123, size: "bad" } })).rejects.toThrow();
	});
});

describe("generateVertexCrudFromDomains", () => {
	it("generates CRUD for all vertex domains, skips non-vertex domains", () => {
		const store = new QuadStore();
		const domains = {
			"my-widget": { schema: WidgetSchema, meta: { vertexLabel: "Widget", idField: "name" } },
			"my-gadget": { schema: z.object({ id: z.string() }), meta: { vertexLabel: "Gadget", idField: "id" } },
			"query-schema": { schema: z.string() },
		};
		const steps = generateVertexCrudFromDomains(domains, () => store);
		expect(steps.createWidget).toBeDefined();
		expect(steps.getGadget).toBeDefined();
		expect(Object.keys(steps)).toHaveLength(8); // 4 CRUD × 2 vertex types
	});
});
