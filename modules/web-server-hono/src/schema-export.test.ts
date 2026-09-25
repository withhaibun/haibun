import { describe, it, expect } from "vitest";
import { z } from "zod";

import { RouteTypeSchema, ROUTE_TYPES } from "./defs.js";

describe("JSON Schema / OpenAPI exports", () => {
	describe("RouteTypeSchema", () => {
		it("should convert to valid JSON Schema", () => {
			const jsonSchema = z.toJSONSchema(RouteTypeSchema);

			expect(jsonSchema).toBeDefined();
			expect(jsonSchema.type).toBe("string");
			expect(jsonSchema.enum).toBeDefined();
		});

		it("should define valid enum values for HTTP methods", () => {
			const jsonSchema = z.toJSONSchema(RouteTypeSchema) as { enum?: string[] };

			// Verify all defined route types are in the enum
			for (const routeType of ROUTE_TYPES) {
				expect(jsonSchema.enum).toContain(routeType);
			}
		});
	});

	describe("OpenAPI compatibility", () => {
		it("RouteTypeSchema should produce OpenAPI-compatible enum", () => {
			const jsonSchema = z.toJSONSchema(RouteTypeSchema);

			// OpenAPI uses 'enum' directly on the type
			expect(jsonSchema.type).toBe("string");
			expect(jsonSchema.enum).toBeDefined();
			expect(Array.isArray(jsonSchema.enum)).toBe(true);
			expect(jsonSchema.enum?.length).toBe(ROUTE_TYPES.length);
		});
	});
});
