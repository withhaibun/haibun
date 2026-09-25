import { z } from "zod";
import type { IStepperCycles } from "../astepper.js";
import type { TDomainDefinition } from "../resources.js";

/** The domains test steppers answer in, named as every step names the domain of its products. */
export const TEST_DOMAIN = { readAt: "test-read-at", echoed: "test-echoed", pong: "test-pong", count: "test-count" } as const;

export const testDomainDefinitions: TDomainDefinition[] = [
	{ selectors: [TEST_DOMAIN.readAt], schema: z.object({ at: z.string() }), description: "The level a step read at" },
	{ selectors: [TEST_DOMAIN.echoed], schema: z.object({ echoed: z.string() }), description: "A message a step echoed" },
	{ selectors: [TEST_DOMAIN.pong], schema: z.object({ pong: z.boolean() }), description: "A ping a step answered" },
	{ selectors: [TEST_DOMAIN.count], schema: z.object({ count: z.number() }), description: "A count a step answered" },
];

/** The cycles of a test stepper whose steps answer in the test domains. */
export const declaresTestDomains = (): IStepperCycles => ({ getConcerns: () => ({ domains: testDomainDefinitions }) });
