/**
 * Goals over producer rules: the engine proves a goal by a fact of its domain, leaves a plan where only steps would prove it,
 * and refutes a goal that a step the caller may call doesn't return or that its own proof takes again. The step graph's lint
 * reads the same signatures.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AStepper, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { Access, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { OK } from "@haibun/core/lib/domains/protocol.js";
import { RUN_AUTHORITY } from "@haibun/core/lib/domains/capability-context.js";
import { LINT_FINDING } from "@haibun/core/lib/domains/goal-resolution.js";
import { FACTS_HELD, planOf, producerRules, stepSignatures, unmetReason } from "../derivations/goals.js";
import { atom, factsTerm } from "../derivations/terms.js";
import { logicEngine } from "../root.js";
import { lintFindings } from "./goals.js";
import { proved } from "./prove.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";

const action = async () => OK;
const value = (selector: string) => ({ selectors: [selector], schema: z.object({ id: z.string() }), description: selector });
const thing = (selector: string) => ({
	selectors: [selector],
	schema: z.unknown(),
	description: selector,
	topology: { persistedAs: selector, id: "id", accessLevel: Access.private, properties: { id: LinkRelations.IDENTIFIER.rel } },
});

const domains = mapDefinitionsToDomains([value("cart"), value("order"), value("receipt"), value("loop-a"), value("loop-b"), value("orphan"), thing("ledger")]);

class Shop extends AStepper {
	description = "Fills a cart, places an order from it, and prints its receipt.";
	steps: TStepperSteps = {
		fillCart: { description: TEST_STEP, gwta: "fill a cart", productsDomain: "cart", action },
		placeOrder: { description: TEST_STEP, gwta: "place an order from {cart: cart}", productsDomain: "order", action },
		printReceipt: { description: TEST_STEP, gwta: "print a receipt for {order: order}", productsDomain: "receipt", action },
		loopA: { description: TEST_STEP, gwta: "turn {b: loop-b} to a", productsDomain: "loop-a", action },
		loopB: { description: TEST_STEP, gwta: "turn {a: loop-a} to b", productsDomain: "loop-b", action },
		audit: { description: TEST_STEP, gwta: "audit {ledger: ledger}", action },
	};
}

const signatures = stepSignatures([new Shop()]);
const byMethod = new Map(signatures.map((one) => [one.method, one]));
/** Proves a goal where a fact holds of each domain given, which the proof reads once. */
const prove = async (goal: string, domainsHeld: string[], held: string[]) => {
	let reads = 0;
	const ended = await proved(await logicEngine(), `goals(${producerRules(signatures, domains, held)}, [${atom(goal)}])`, () => {
		reads += 1;
		return Promise.resolve(
			factsTerm([FACTS_HELD], [domainsHeld.map((domain) => ({ subject: `fact-${domain}`, predicate: FACTS_HELD.predicate, object: domain, namedGraph: FACTS_HELD.namedGraph }))]),
		);
	});
	expect(reads).toBe(1);
	const proof = "goals" in ended ? ended.goals[0] : undefined;
	if (proof === undefined) throw new Error(`the engine didn't return a proof of ${goal}`);
	return proof;
};
const latest = new Map([["order", "o1"]]);
const stepsOf = (proof: Awaited<ReturnType<typeof prove>>) => proof.plans.map((plan) => planOf(plan, byMethod, latest).steps.map((step) => step.stepName));

describe("goals over producer rules", () => {
	it("leaves a plan of the steps a goal takes, in the order their products are taken", async () => {
		const proof = await prove("receipt", [], RUN_AUTHORITY);
		expect(proof.held).toBe(false);
		expect(stepsOf(proof)).toEqual([["fillCart", "placeOrder", "printReceipt"]]);
	});

	it("binds a fact that holds and leaves only the steps after it", async () => {
		const proof = await prove("receipt", ["order"], RUN_AUTHORITY);
		expect(stepsOf(proof)).toEqual([["printReceipt"]]);
		expect(planOf(proof.plans[0] ?? { argument: "" }, byMethod, latest).bindings).toEqual([{ kind: "fact", domain: "order", factId: "o1" }]);
	});

	it("proves a goal by a fact of its domain", async () => {
		expect((await prove("receipt", ["receipt"], RUN_AUTHORITY)).held).toBe(true);
	});

	it("refutes a goal whose producer the caller may not call, naming the sub-goal", async () => {
		const proof = await prove("receipt", [], ["Shop:printReceipt", "Shop:placeOrder"]);
		expect(proof.plans).toEqual([]);
		expect(unmetReason(proof)).toContain("doesn't return cart");
	});

	it("refutes a goal that its own proof takes again", async () => {
		const proof = await prove("loop-a", [], RUN_AUTHORITY);
		expect(proof.unmet.map((node) => ("do" in node ? node.domain : node.unmet))).toEqual(["loop-a", "loop-b", "loop-a"]);
		expect(unmetReason(proof)).toContain("is taken again below its own proof");
	});

	it("lints a record type that a step takes and doesn't return, and a domain that a step doesn't take or return", async () => {
		const found = lintFindings(await logicEngine(), [new Shop()], domains);
		expect(found).toEqual(
			expect.arrayContaining([
				{ kind: LINT_FINDING.UNSUPPLIED_STEP, stepperName: "Shop", stepName: "audit", inputDomain: "ledger" },
				{ kind: LINT_FINDING.UNPRODUCED_DOMAIN, domain: "ledger" },
				{ kind: LINT_FINDING.UNREACHABLE_DOMAIN, domain: "orphan" },
			]),
		);
		expect(found.filter((finding) => "domain" in finding && finding.domain === "cart")).toEqual([]);
	});
});
