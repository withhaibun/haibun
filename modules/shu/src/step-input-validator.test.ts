import { describe, it, expect } from "vitest";
import { validateStepInput } from "./step-input-validator.js";

describe("validateStepInput", () => {
	it("returns no errors when every required field passes its schema", () => {
		const schema = {
			type: "object",
			properties: { issuer: { type: "string", format: "uri" }, name: { type: "string" } },
			required: ["issuer"],
		};
		const errors = validateStepInput({ issuer: "did:web:tethys.osf", name: "Tethys" }, schema);
		expect(errors).toEqual([]);
	});

	it("flags a non-URI value at a `format: uri` field with a helpful message that names the bad value", () => {
		const schema = { type: "object", properties: { issuer: { type: "string", format: "uri" } }, required: ["issuer"] };
		const errors = validateStepInput({ issuer: "name1" }, schema);
		expect(errors).toHaveLength(1);
		expect(errors[0].field).toBe("issuer");
		expect(errors[0].message).toMatch(/must be a uri/);
		expect(errors[0].message).toContain("name1");
	});

	it("flags a missing required field per-path so the form can render the message next to the field", () => {
		const schema = { type: "object", properties: { issuer: { type: "string", format: "uri" } }, required: ["issuer"] };
		const errors = validateStepInput({}, schema);
		expect(errors).toEqual([{ field: "issuer", message: "required" }]);
	});

	it("recurses into nested objects and reports the full dot-path of the failing field", () => {
		const schema = {
			type: "object",
			properties: {
				credential: {
					type: "object",
					properties: { subject: { type: "string", format: "uri" } },
					required: ["subject"],
				},
			},
			required: ["credential"],
		};
		const errors = validateStepInput({ credential: { subject: "subj1" } }, schema);
		expect(errors).toHaveLength(1);
		expect(errors[0].field).toBe("credential.subject");
		expect(errors[0].message).toContain("must be a uri");
	});

	it("validates each array element against the `items` schema and tags errors with the index", () => {
		const schema = { type: "object", properties: { type: { type: "array", items: { type: "string" } } } };
		const errors = validateStepInput({ type: ["VerifiableCredential", 42] }, schema);
		expect(errors.some((e) => e.field === "type[1]" && e.message.includes("must be a string"))).toBe(true);
	});

	it("rejects enum violations and lists the allowed values", () => {
		const schema = { type: "object", properties: { status: { type: "string", enum: ["pending", "completed"] } } };
		const errors = validateStepInput({ status: "weird" }, schema);
		expect(errors[0].message).toMatch(/must be one of: pending, completed/);
	});

	it("accepts an `undefined inputSchema` as 'nothing to validate' (no errors)", () => {
		const errors = validateStepInput({ foo: "bar" }, undefined);
		expect(errors).toEqual([]);
	});
});
