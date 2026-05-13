import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { TRegisteredDomain } from "./resources.js";
import { getCompositeFields, isPrimitiveZodType } from "./composite-domain.js";

function reg(schema: z.ZodType, topology?: TRegisteredDomain["topology"]): TRegisteredDomain {
	return { selectors: [], schema, coerce: (p) => String(p.value), topology };
}

const IssuerSchema = z.object({ did: z.string(), name: z.string().optional() });
const ProofSchema = z.object({ proofValue: z.string() });
const VcSchema = z.object({
	id: z.string().optional(),
	type: z.array(z.string()),
	issuer: z.string(),
	subject: z.string(),
	proof: z.object({ proofValue: z.string() }),
	validUntil: z.string().nullable(),
});

describe("isPrimitiveZodType", () => {
	it("recognises strings, numbers, booleans, literals, enums as primitive", () => {
		expect(isPrimitiveZodType(z.string())).toBe(true);
		expect(isPrimitiveZodType(z.number())).toBe(true);
		expect(isPrimitiveZodType(z.boolean())).toBe(true);
		expect(isPrimitiveZodType(z.literal("x"))).toBe(true);
		expect(isPrimitiveZodType(z.enum(["a", "b"]))).toBe(true);
	});

	it("does not consider object / array / union types primitive", () => {
		expect(isPrimitiveZodType(z.object({}))).toBe(false);
		expect(isPrimitiveZodType(z.array(z.string()))).toBe(false);
		expect(isPrimitiveZodType(z.union([z.string(), z.number()]))).toBe(false);
	});
});

describe("getCompositeFields", () => {
	it("returns null when the domain is not registered", () => {
		expect(getCompositeFields("missing", {})).toBeNull();
	});

	it("returns null for a domain whose schema is not an object", () => {
		const registry: Record<string, TRegisteredDomain> = { name: reg(z.string()) };
		expect(getCompositeFields("name", registry)).toBeNull();
	});

	it("enumerates every field of a composite schema with primitive / optional flags", () => {
		const registry: Record<string, TRegisteredDomain> = { issuer: reg(IssuerSchema) };
		const fields = getCompositeFields("issuer", registry);
		expect(fields).not.toBeNull();
		expect(fields).toHaveLength(2);
		const did = fields?.find((f) => f.fieldName === "did");
		const name = fields?.find((f) => f.fieldName === "name");
		expect(did).toMatchObject({ fieldName: "did", primitive: true, optional: false, fieldDomain: undefined });
		expect(name).toMatchObject({ fieldName: "name", primitive: true, optional: true });
	});

	it("matches a Zod field to another registered domain via topology.ranges", () => {
		const registry: Record<string, TRegisteredDomain> = {
			issuer: reg(IssuerSchema),
			proof: reg(ProofSchema),
			"verifiable-credential": reg(VcSchema, {
				vertexLabel: "VerifiableCredential",
				id: "id",
				properties: {},
				ranges: { issuer: "issuer", proof: "proof" },
			}),
		};
		const fields = getCompositeFields("verifiable-credential", registry);
		const issuer = fields?.find((f) => f.fieldName === "issuer");
		const proof = fields?.find((f) => f.fieldName === "proof");
		expect(issuer?.fieldDomain).toBe("issuer");
		expect(proof?.fieldDomain).toBe("proof");
	});

	it("drops a ranges entry that points at an unregistered domain (silent fall-back to primitive)", () => {
		const registry: Record<string, TRegisteredDomain> = {
			"verifiable-credential": reg(VcSchema, {
				vertexLabel: "VerifiableCredential",
				id: "id",
				properties: {},
				ranges: { issuer: "not-registered" },
			}),
		};
		const fields = getCompositeFields("verifiable-credential", registry);
		const issuer = fields?.find((f) => f.fieldName === "issuer");
		expect(issuer?.fieldDomain).toBeUndefined();
	});

	it("unwraps nullable wrappers and reports the field as optional", () => {
		const registry: Record<string, TRegisteredDomain> = { "verifiable-credential": reg(VcSchema) };
		const fields = getCompositeFields("verifiable-credential", registry);
		const validUntil = fields?.find((f) => f.fieldName === "validUntil");
		expect(validUntil?.optional).toBe(true);
		expect(validUntil?.primitive).toBe(true);
	});
});
