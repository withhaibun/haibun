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
import { planOf, producerRules, stepSignatures, unmetReason } from "../derivations/goals.js";
import { logicEngine } from "../root.js";
import { lintFindings } from "./goals.js";

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
		fillCart: { gwta: "fill a cart", productsDomain: "cart", action },
		placeOrder: { gwta: "place an order from {cart: cart}", productsDomain: "order", action },
		printReceipt: { gwta: "print a receipt for {order: order}", productsDomain: "receipt", action },
		loopA: { gwta: "turn {b: loop-b} to a", productsDomain: "loop-a", action },
		loopB: { gwta: "turn {a: loop-a} to b", productsDomain: "loop-b", action },
		audit: { gwta: "audit {ledger: ledger}", action },
	};
}

const signatures = stepSignatures([new Shop()]);
const byMethod = new Map(signatures.map((one) => [one.method, one]));
const prove = async (goal: string, facts: { domain: string; id: string }[], held: string[]) => {
	const [proof] = (await logicEngine()).goals(
		producerRules(
			signatures,
			domains,
			facts.map((fact) => ({ ...fact, value: {} })),
			held,
		),
		[goal],
	);
	if (proof === undefined) throw new Error(`the engine didn't return a proof of ${goal}`);
	return proof;
};
const stepsOf = (proof: Awaited<ReturnType<typeof prove>>) => proof.plans.map((plan) => planOf(plan, byMethod).steps.map((step) => step.stepName));

describe("goals over producer rules", () => {
	it("leaves a plan of the steps a goal takes, in the order their products are taken", async () => {
		const proof = await prove("receipt", [], RUN_AUTHORITY);
		expect(proof.factIds).toEqual([]);
		expect(stepsOf(proof)).toEqual([["fillCart", "placeOrder", "printReceipt"]]);
	});

	it("binds a fact that holds and leaves only the steps after it", async () => {
		const proof = await prove("receipt", [{ domain: "order", id: "o1" }], RUN_AUTHORITY);
		expect(stepsOf(proof)).toEqual([["printReceipt"]]);
		expect(planOf(proof.plans[0] ?? { argument: "" }, byMethod).bindings).toEqual([{ kind: "fact", domain: "order", factId: "o1" }]);
	});

	it("proves a goal by a fact of its domain", async () => {
		expect((await prove("receipt", [{ domain: "receipt", id: "r1" }], RUN_AUTHORITY)).factIds).toEqual(["r1"]);
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
