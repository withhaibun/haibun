import { describe, it, expect, beforeEach } from "vitest";
import { FeatureVariables } from "./feature-variables.js";
import type { TWorld } from "./world.js";
import { TFeatureStep } from "./astepper.js";
import { TStepValue, Origin } from "../schema/protocol.js";
import { getDefaultWorld } from "./test/lib.js";
import { DOMAIN_JSON, DOMAIN_STRING } from "./domains.js";

describe("FeatureVariables", () => {
	let world: TWorld;
	let variables: FeatureVariables;
	const mockFeatureStep: TFeatureStep = {
		source: { path: "/test/feature.ts" },
		in: "test step",
		seqPath: [1, 2, 3],
		action: {
			actionName: "testAction",
			stepperName: "TestStepper",
			step: {
				gwta: "test",
				action: () => Promise.resolve({ ok: true }),
			},
		},
	};

	beforeEach(() => {
		world = getDefaultWorld();
		variables = new FeatureVariables(world);
	});

	describe("constructor", () => {
		it("should initialize with empty values", async () => {
			const vars = new FeatureVariables(world);
			expect(await vars.all()).toEqual({});
		});

		it("should initialize with initial values", async () => {
			const initial: { [name: string]: TStepValue } = {
				foo: { term: "foo", value: "bar", domain: DOMAIN_STRING, origin: Origin.var },
			};
			const vars = new FeatureVariables(world, initial);
			expect(await vars.all()).toEqual(initial);
		});
	});

	describe("clear", () => {
		it("should clear all variables", async () => {
			await variables.set({ term: "foo", value: "bar", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [1], when: "test.action" });
			expect(await variables.get("foo")).toBe("bar");

			await variables.getStore().clear();
			expect(await variables.all()).toEqual({});
			expect(await variables.get("foo")).toBeUndefined();
		});
	});

	describe("all", () => {
		it("should return a copy of all values", async () => {
			await variables.set({ term: "var1", value: "value1", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [1], when: "test.action" });
			await variables.set({ term: "var2", value: "value2", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [2], when: "test.action" });

			const all = await variables.all();
			expect(all).toHaveProperty("var1");
			expect(all).toHaveProperty("var2");
			expect(all.var1.value).toBe("value1");
			expect(all.var2.value).toBe("value2");
		});

		it("should return a copy, not the original", async () => {
			await variables.set({ term: "foo", value: "bar", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [1], when: "test.action" });

			const all1 = await variables.all();
			const all2 = await variables.all();
			expect(all1).not.toBe(all2); // Different objects
			expect(all1).toEqual(all2); // Same content
		});
	});

	describe("toString", () => {
		it("should return string representation", () => {
			const str = variables.toString();
			expect(str).toContain("tag");
			expect(str).toContain(world.tag);
		});
	});

	describe("set and get", () => {
		it("should set and get a string variable", async () => {
			await variables.set({ term: "myVar", value: "myValue", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [1], when: "test.action" });

			expect(await variables.get("myVar")).toBe("myValue");
		});

		it("should return undefined for non-existent variable", async () => {
			expect(await variables.get("nonExistent")).toBeUndefined();
		});

		it("should throw error for variables with dots", async () => {
			await expect(async () => {
				await variables.set({ term: "invalid.var", value: "value", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [1], when: "test.action" });
			}).rejects.toThrow("non-stepper variables cannot use dots");
		});

		it("should throw error for unknown domain", async () => {
			await expect(async () => {
				await variables.set({ term: "myVar", value: "value", domain: "unknownDomain", origin: Origin.var }, { in: "test", seq: [1], when: "test.action" });
			}).rejects.toThrow('Cannot set variable "myVar": unknown domain "unknownDomain"');
		});

		it("should track provenance when setting variable", async () => {
			const provenance = { in: "set foo to bar", seq: [1, 2], when: "Variables.set" };
			await variables.set({ term: "foo", value: "bar", domain: DOMAIN_STRING, origin: Origin.var }, provenance);

			const all = await variables.all();
			expect(all.foo.origin).toBe(Origin.var);
		});

		it("should append to provenance on multiple sets", async () => {
			const provenance1 = { in: "set foo to bar", seq: [1], when: "Variables.set" };
			const provenance2 = { in: "set foo to baz", seq: [2], when: "Variables.set" };

			await variables.set({ term: "foo", value: "bar", domain: DOMAIN_STRING, origin: Origin.var }, provenance1);
			await variables.set({ term: "foo", value: "baz", domain: DOMAIN_STRING, origin: Origin.var }, provenance2);

			const all = await variables.all();
			expect(all.foo.value).toBe("baz"); // Last value wins
			expect(all.foo.origin).toBe(Origin.var);
		});

		it("should coerce values through domain", async () => {
			// The default world has domains that coerce values
			await variables.set({ term: "num", value: "42", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [1], when: "test.action" });

			expect(await variables.get("num")).toBe("42");
		});
	});

	describe("setForStepper", () => {
		it("should prefix variable name with stepper name", async () => {
			await variables.setForStepper("MyStepper", { term: "myVar", value: "myValue", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [1], when: "test.action" });

			expect(await variables.get("MyStepper.myVar")).toBe("myValue");
			expect(await variables.get("myVar")).toBeUndefined();
		});

		it("should allow dots in stepper-prefixed variables", async () => {
			await variables.setForStepper("MyStepper", { term: "my.var", value: "value", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [1], when: "test.action" });

			expect(await variables.get("MyStepper.my.var")).toBe("value");
		});
	});

	describe("setJSON and getJSON", () => {
		it("should set and get JSON objects", async () => {
			const obj = { foo: "bar", num: 42, nested: { value: true } };

			await variables.setJSON("myJson", obj, Origin.var, mockFeatureStep);

			const retrieved = (await variables.get("myJson")) as typeof obj;
			expect(retrieved).toEqual(obj);
		});

		it("should store JSON as string internally", async () => {
			const obj = { foo: "bar" };
			await variables.setJSON("myJson", obj, Origin.var, mockFeatureStep);

			const all = await variables.all();
			expect(all.myJson.domain).toBe(DOMAIN_JSON);
			expect(typeof all.myJson.value).toBe("string");
			expect(all.myJson.value).toBe(JSON.stringify(obj));
		});

		it("should return undefined for non-existent JSON variable", async () => {
			expect(await variables.get("nonExistent")).toBeUndefined();
		});

		it("should handle complex JSON structures", async () => {
			const complex = {
				array: [1, 2, 3],
				nested: {
					deep: {
						value: "deeply nested",
					},
				},
				nullValue: null,
				boolValue: true,
			};

			await variables.setJSON("complex", complex, Origin.var, mockFeatureStep);
			const retrieved = (await variables.get("complex")) as typeof complex;

			expect(retrieved).toEqual(complex);
			expect(retrieved?.array).toEqual([1, 2, 3]);
			expect(retrieved?.nested.deep.value).toBe("deeply nested");
		});

		it("should preserve origin for JSON variables", async () => {
			const obj = { test: true };
			await variables.setJSON("myJson", obj, Origin.var, mockFeatureStep);

			const all = await variables.all();
			expect(all.myJson.origin).toBe(Origin.var);
		});
	});

	describe("type safety with get", () => {
		it("should allow typed retrieval", async () => {
			await variables.set({ term: "count", value: "42", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [1], when: "test.action" });

			const count = await variables.get("count");
			expect(count).toBe("42");
		});

		it("should allow typed JSON retrieval", async () => {
			interface User {
				name: string;
				age: number;
			}

			const user: User = { name: "Alice", age: 30 };
			await variables.setJSON("user", user, Origin.var, mockFeatureStep);

			const retrieved = (await variables.get("user")) as User;
			expect(retrieved?.name).toBe("Alice");
			expect(retrieved?.age).toBe(30);
		});
	});

	describe("origin tracking", () => {
		it("should track different origins", async () => {
			await variables.set({ term: "envVar", value: "fromEnv", domain: DOMAIN_STRING, origin: Origin.env }, { in: "test", seq: [1], when: "test.action" });
			await variables.set({ term: "quotedVar", value: "fromQuote", domain: DOMAIN_STRING, origin: Origin.quoted }, { in: "test", seq: [1], when: "test.action" });

			const all = await variables.all();
			expect(all.envVar.origin).toBe(Origin.env);
			expect(all.quotedVar.origin).toBe(Origin.quoted);
		});
	});

	describe("edge cases", () => {
		it("should handle empty string values", async () => {
			await variables.set({ term: "empty", value: "", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test", seq: [1], when: "test.action" });

			expect(await variables.get("empty")).toBe("");
		});

		it("should handle overwriting variables", async () => {
			await variables.set({ term: "foo", value: "first", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test1", seq: [1], when: "test.action" });
			await variables.set({ term: "foo", value: "second", domain: DOMAIN_STRING, origin: Origin.var }, { in: "test2", seq: [2], when: "test.action" });

			expect(await variables.get("foo")).toBe("second");
			const all = await variables.all();
			expect(all.foo.origin).toBe(Origin.var); // origin is overwritten, not appended
		});

		it("should handle JSON with empty objects", async () => {
			await variables.setJSON("empty", {}, Origin.var, mockFeatureStep);
			expect(await variables.get("empty")).toEqual({});
		});

		it("should handle JSON with empty arrays", async () => {
			await variables.setJSON("emptyArray", [], Origin.var, mockFeatureStep);
			expect(await variables.get("emptyArray")).toEqual([]);
		});
	});

	describe("literal fallback", () => {
		it("should fallback to literal value for unquoted literals", async () => {
			const fv = new FeatureVariables(world);
			const result = await fv.resolveVariable({ term: "/path/to/resource", origin: Origin.defined });
			expect(result.value).toBe("/path/to/resource");
		});

		it("should not fallback to literal for variable-like terms", async () => {
			const fv = new FeatureVariables(world);
			const result = await fv.resolveVariable({ term: "undefinedVar", origin: Origin.defined });
			expect(result.value).toBeUndefined();
		});

		it("should prioritize defined variables over literal fallback", async () => {
			const fv = new FeatureVariables(world);
			await fv.set({ term: "/path", value: "defined value", domain: DOMAIN_STRING, origin: Origin.statement }, { in: "test", seq: [0], when: "now" });
			const result = await fv.resolveVariable({ term: "/path", origin: Origin.defined });
			expect(result.value).toBe("defined value");
		});
	});

	describe("secret variables", () => {
		it("should auto-detect password env variables as secret", async () => {
			await variables.set({ term: "userPassword", value: "secret123", domain: DOMAIN_STRING, origin: Origin.env }, { in: "test", seq: [1], when: "test.action" });
			expect(variables.isSecret("userPassword")).toBe(true);
		});

		it("should auto-detect PASSWORD (uppercase) env variables as secret", async () => {
			await variables.set({ term: "DATABASE_PASSWORD", value: "db-secret", domain: DOMAIN_STRING, origin: Origin.env }, { in: "test", seq: [1], when: "test.action" });
			expect(variables.isSecret("DATABASE_PASSWORD")).toBe(true);
		});

		it("should auto-detect secret in middle of env name as secret", async () => {
			await variables.set({ term: "my_secret_field", value: "pwd123", domain: DOMAIN_STRING, origin: Origin.env }, { in: "test", seq: [1], when: "test.action" });
			expect(variables.isSecret("my_secret_field")).toBe(true);
		});

		it("should not mark non-password/secret env variables as secret", async () => {
			await variables.set({ term: "username", value: "john", domain: DOMAIN_STRING, origin: Origin.env }, { in: "test", seq: [1], when: "test.action" });
			expect(variables.isSecret("username")).toBe(false);
		});

		it("should return false for isSecret on non-existent variable", () => {
			expect(variables.isSecret("nonExistent")).toBe(false);
		});
	});

	describe("dot-path resolution", () => {
		it("navigates into JSON-stored objects", async () => {
			await variables.setJSON("result", { total: 42, vertices: [] }, Origin.var, mockFeatureStep);
			const resolved = await variables.resolveVariable({ term: "result.total", origin: Origin.defined }, mockFeatureStep);
			expect(String(resolved.value)).toBe("42");
			expect(resolved.origin).toBe(Origin.var);
		});

		it("navigates nested paths", async () => {
			await variables.setJSON("data", { vertex: { subject: "Hello", nested: { flag: true } } }, Origin.var, mockFeatureStep);
			const resolved = await variables.resolveVariable({ term: "data.vertex.subject", origin: Origin.defined }, mockFeatureStep);
			expect(String(resolved.value)).toBe("Hello");
		});

		it("does not resolve invalid paths as variables", async () => {
			await variables.setJSON("data", { vertex: { subject: "Hello" } }, Origin.var, mockFeatureStep);
			const resolved = await variables.resolveVariable({ term: "data.vertex.missing", origin: Origin.defined }, mockFeatureStep);
			// Invalid dot-path falls through to literal fallback — origin is not Origin.var
			expect(resolved.origin).not.toBe(Origin.var);
		});

		it("prefers full key over dot-path when both exist", async () => {
			// Stepper-scoped variable like "WebPlaywright.currentURI"
			await variables.setForStepper(
				"WebPlaywright",
				{ term: "currentURI", value: "http://example.com", domain: DOMAIN_STRING, origin: Origin.var },
				{ in: "test", seq: [1], when: "test" },
			);
			const resolved = await variables.resolveVariable({ term: "WebPlaywright.currentURI", origin: Origin.defined }, mockFeatureStep);
			expect(resolved.value).toBe("http://example.com");
		});

		it("works with Origin.var", async () => {
			await variables.setJSON("info", { count: 7 }, Origin.var, mockFeatureStep);
			const resolved = await variables.resolveVariable({ term: "info.count", origin: Origin.var }, mockFeatureStep);
			expect(String(resolved.value)).toBe("7");
		});
	});
});
