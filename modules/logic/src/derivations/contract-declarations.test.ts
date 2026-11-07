/**
 * The declarations check refuses a contract whose terms the registry doesn't list: a relation the steppers don't declare, a statement
 * whose arguments don't match its relation's arity, a parameter the pattern doesn't name, and a field that the declared types don't hold.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { doesntHold, field, holds, parameter, PRINCIPAL, type TRelation, type TStepContract } from "@haibun/core/lib/steps/domains/contract.js";
import { Access, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { actionOK } from "@haibun/core/lib/domains/util.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";
import { ARITY, contractFindings, UNDECLARED_FIELD, UNDECLARED_RELATION, UNNAMED_PARAMETER } from "./contract-declarations.js";

const GRANT = {
	selectors: ["grant"],
	schema: z.object({ id: z.string(), revoked: z.string() }),
	description: "A grant a holder acts under",
	topology: { persistedAs: "Grant", id: "id", accessLevel: Access.private, properties: { id: LinkRelations.IDENTIFIER.rel } },
};
const REVOKED: TRelation = { name: "revoked_grant", arity: 1, rules: "" };
const UNDECLARED: TRelation = { name: "undeclared", arity: 1, rules: "" };

/** A stepper that declares a grant type, the relation `revoked_grant`, and one step with `contract`. */
const declaring = (contract: TStepContract): AStepper =>
	new (class Declaring extends AStepper implements IHasCycles {
		description = "Declares a step with the contract a case states.";
		cycles: IStepperCycles = { getConcerns: () => ({ domains: [GRANT], relations: [REVOKED] }) };
		steps: TStepperSteps = { revoke: { description: TEST_STEP, gwta: "revoke {grant: grant}", contract, action: async () => actionOK() } };
	})();

describe("the declarations check of contracts", () => {
	it("holds a contract whose relations, parameters and fields the registry lists", () => {
		expect(contractFindings([declaring({ requires: [doesntHold(REVOKED, parameter("grant"))], changes: [field(GRANT, "revoked")] })])).toEqual([]);
	});

	it("refuses each term the registry doesn't list", () => {
		const refused: [TStepContract, string][] = [
			[{ states: [holds(UNDECLARED, parameter("grant"))] }, UNDECLARED_RELATION],
			[{ requires: [holds(REVOKED, parameter("grant"), PRINCIPAL)] }, ARITY],
			[{ requires: [holds(REVOKED, parameter("door"))] }, UNNAMED_PARAMETER],
			[{ changes: [{ persistedAs: "Grant", key: "expired" }] }, UNDECLARED_FIELD],
		];
		for (const [contract, finding] of refused)
			expect(
				contractFindings([declaring(contract)]).map(({ finding: found }) => found.split(" (")[0]),
				finding,
			).toEqual([finding]);
	});
});
