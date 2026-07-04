import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createStepTool } from "./step-registry.js";
import { actionOK } from "./util/index.js";
import type { TWorld } from "./world.js";
import type { TStepperStep } from "./astepper.js";

/** A domain with date fields and a defaulted field — the shape every persisted type carries (generatedAtTime etc.). */
const RecordSchema = z
	.object({
		subject: z.string(),
		dateSent: z.coerce.date(),
		generatedAtTime: z.coerce.date().default(() => new Date()),
	})
	.strict();

const worldWith = (schema: z.ZodType): TWorld =>
	({
		domains: {
			"test-record": { selectors: ["test-record"], schema, description: "A dated test record." },
		},
	}) as unknown as TWorld;

const stepDef = { gwta: "create record {data: test-record}", action: async () => actionOK() } as unknown as TStepperStep;

describe("step tool input schemas", () => {
	it("a domain-typed param surfaces the domain's full JSON Schema with input semantics: dates as string/date-time, defaulted fields optional", () => {
		const tool = createStepTool("TestStepper", "createRecord", stepDef, worldWith(RecordSchema));
		const data = tool.inputSchema.properties?.data as { properties?: Record<string, { type?: string; format?: string }>; required?: string[] };
		expect(data.properties?.subject).toMatchObject({ type: "string" });
		expect(data.properties?.dateSent).toMatchObject({ type: "string", format: "date-time" });
		expect(data.required).toContain("dateSent");
		expect(data.required).not.toContain("generatedAtTime");
	});

	it("a domain declaring a type with no JSON Schema representation throws at registration, naming the domain and the type", () => {
		const unrepresentable = z.object({ handle: z.bigint() });
		expect(() => createStepTool("TestStepper", "createRecord", stepDef, worldWith(unrepresentable))).toThrow(/test-record.*bigint.*no JSON Schema representation/);
	});
});
