import { z } from "zod";
import type { IStepperCycles } from "../astepper.js";
import { AccessLevelSchema, type TDomainDefinition } from "../resources.js";
import { listedSchema } from "../domains.js";
import { FAKE_HOLDER_DOMAIN } from "./fake-authority.js";

/** The names of the domains that test steps declare for their parameters and products. */
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
	{ selectors: [TEST_DOMAIN.readAt], schema: z.object({ at: z.string() }).strict(), description: "The access level of a step's read" },
	{ selectors: [TEST_DOMAIN.echoed], schema: z.object({ echoed: z.string() }).strict(), description: "A message a step echoed" },
	{ selectors: [TEST_DOMAIN.pong], schema: z.object({ pong: z.boolean() }).strict(), description: "A step's response to a ping" },
	{ selectors: [TEST_DOMAIN.count], schema: z.object({ count: z.number() }).strict(), description: "A count a step returned" },
	{ selectors: [TEST_DOMAIN.accessLevel], schema: AccessLevelSchema, description: "The expected access level of a read" },
	{ selectors: [TEST_DOMAIN.action], schema: z.string().min(1), description: "The action a signed invocation names" },
	{ selectors: [TEST_DOMAIN.accessLevels], schema: listedSchema(AccessLevelSchema, "access level"), description: "The expected access levels of a stream's events" },
	FAKE_HOLDER_DOMAIN,
];

/** Returns cycles that declare the test domains as a test stepper's concerns. */
export const declaresTestDomains = (): IStepperCycles => ({ getConcerns: () => ({ domains: testDomainDefinitions }) });
