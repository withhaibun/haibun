import { z } from "zod";
import type { IStepperCycles } from "../astepper.js";
import { AccessLevelSchema, type TDomainDefinition } from "../resources.js";
import { listedSchema } from "../domains.js";
import { FAKE_HOLDER_DOMAIN } from "./fake-authority.js";

/** The domains test steppers take and answer in, named as every step names the domain of its parameters and products. */
export const TEST_DOMAIN = {
	readAt: "test-read-at",
	echoed: "test-echoed",
	pong: "test-pong",
	count: "test-count",
	accessLevel: "test-access-level",
	action: "test-action",
	accessLevels: "test-access-levels",
} as const;

export const testDomainDefinitions: TDomainDefinition[] = [
	{ selectors: [TEST_DOMAIN.readAt], schema: z.object({ at: z.string() }).strict(), description: "The level a step read at" },
	{ selectors: [TEST_DOMAIN.echoed], schema: z.object({ echoed: z.string() }).strict(), description: "A message a step echoed" },
	{ selectors: [TEST_DOMAIN.pong], schema: z.object({ pong: z.boolean() }).strict(), description: "A ping a step answered" },
	{ selectors: [TEST_DOMAIN.count], schema: z.object({ count: z.number() }).strict(), description: "A count a step answered" },
	{ selectors: [TEST_DOMAIN.accessLevel], schema: AccessLevelSchema, description: "The level a read is expected at" },
	{ selectors: [TEST_DOMAIN.action], schema: z.string().min(1), description: "The action an invocation is signed for" },
	{ selectors: [TEST_DOMAIN.accessLevels], schema: listedSchema(AccessLevelSchema, "access level"), description: "The levels a stream is expected to send events at" },
	FAKE_HOLDER_DOMAIN,
];

/** The cycles of a test stepper whose steps answer in the test domains. */
export const declaresTestDomains = (): IStepperCycles => ({ getConcerns: () => ({ domains: testDomainDefinitions }) });
