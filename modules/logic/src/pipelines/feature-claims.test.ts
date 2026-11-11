/**
 * A feature's claim over its steps' contracts. A step that places a node under its parent states that the node is below the
 * parent, and `below` is transitive, so the claim that a background's last node is below its first holds for every parent the
 * first names. Where the step's contract doesn't state it, the claim is unknown, and names the first link the chain doesn't derive.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { holds, parameter, PRODUCTS, RELATION_NAMESPACE, type TRelation, type TStepContract } from "@haibun/core/lib/steps/domains/contract.js";
import { failWithDefaults, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import { actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import LogicStepper from "../logic-stepper.js";

const BELOW = `<${RELATION_NAMESPACE}below>`;
const BELOW_RELATION: TRelation = { name: "below", phrase: "{a} is below {b}", rules: `{ (?a ?b) ${BELOW} true . (?b ?c) ${BELOW} true } => { (?a ?c) ${BELOW} true } .` };
const NODE_DOMAIN = "claim-node";
const NODE_PRODUCTS = "claim-placed-node";

/** Places a node under a parent, under `contract`. */
const placing = (contract: TStepContract) =>
	class Placing extends AStepper implements IHasCycles {
		description = "Places a node under a parent.";
		cycles: IStepperCycles = {
			getConcerns: () => ({
				domains: [
					{ selectors: [NODE_DOMAIN], schema: z.string(), description: "A node a line names", written: true },
					{ selectors: [NODE_PRODUCTS], schema: z.object({ id: z.string() }), description: "A placed node" },
				],
				relations: [BELOW_RELATION],
			}),
		};
		steps = {
			place: {
				description: TEST_STEP,
				gwta: `place a node under {parent: ${NODE_DOMAIN}}`,
				contract,
				action: ({ parent }: { parent: string }) => Promise.resolve(actionOKWithProducts({ id: `${parent}/node` })),
			},
		} as const satisfies TStepperSteps;
	};

const BACKGROUNDS = [
	{
		path: "/backgrounds/nodes.feature",
		content: ["set top from place a node under ground", "set first from place a node under top", "set second from place a node under first"].join("\n"),
	},
];

describe("a feature's claim over its steps' contracts", () => {
	it("holds where the chain of contracts derives it, for every value of the parameters a step doesn't take from another", { timeout: 60_000 }, async () => {
		const stated = placing({ products: NODE_PRODUCTS, states: [holds(BELOW_RELATION, PRODUCTS, parameter("parent"))] });
		const claimed = await passWithDefaults('feature "nodes" entails "below(second, top)"', [Haibun, VariablesStepper, LogicStepper, stated], undefined, BACKGROUNDS);
		expect(claimed.ok, JSON.stringify(claimed.failure)).toBe(true);
	});

	it("is unknown where a contract doesn't state a link, and names the first link the chain doesn't derive", { timeout: 60_000 }, async () => {
		const claimed = await failWithDefaults(
			'feature "nodes" entails "below(first, top)"',
			[Haibun, VariablesStepper, LogicStepper, placing({ products: NODE_PRODUCTS })],
			undefined,
			BACKGROUNDS,
		);
		expect(claimed.failure?.error.message).toContain("unknown");
		expect(claimed.failure?.error.message).toContain("below(first, top), which the contract of `place a node under top` doesn't state");
	});
});
