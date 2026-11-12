/**
 * The declarations check refuses a contract whose terms the registry doesn't list: a relation the steppers don't declare, a statement
 * whose arguments don't match its relation's arity, a parameter the pattern doesn't name, a field that the declared types don't hold, a
 * change of a relation that statements don't name, and a relation whose sentences don't parse back to their statements' terms.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/steps/domains/stepper.js";
import { doesntHold, field, holds, parameter, PRINCIPAL, relationChange, type TRelation, type TStepContract } from "@haibun/core/lib/steps/domains/contract.js";
import { Access, EDGE, LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { actionOK } from "@haibun/core/lib/domains/util.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";
import { fromJsonText } from "@haibun/core/lib/domains/json-text.js";
import {
	ARITY,
	contractFindings,
	relationFindings,
	UNDECLARED_FIELD,
	UNDECLARED_RELATION,
	UNNAMED_PARAMETER,
	UNPARSED_SENTENCE,
	UNSTATED_RELATION,
} from "./contract-declarations.js";
import { sentenceTerm, statementSentence, statementTerm, type TLineTerm } from "@haibun/core/lib/steps/derivations/predicate-registry.js";
import { termText } from "./registry.js";

const GrantSchema = z.object({ id: z.string(), revoked: z.string() });
const GRANT = {
	selectors: ["grant"],
	schema: fromJsonText(GrantSchema),
	description: "A grant a holder acts under",
	topology: { persistedAs: "Grant", id: "id", accessLevel: Access.private, properties: { id: LinkRelations.IDENTIFIER.rel } },
};
const REVOKED: TRelation = { name: "revoked_grant", phrase: "{grant} is revoked", rules: "" };
const UNDECLARED: TRelation = { name: "undeclared", phrase: "{grant} is undeclared", rules: "" };

/** A stepper that declares a grant type, the relation `revoked_grant`, and one step with `contract`. */
const declaring = (contract: TStepContract): AStepper =>
	new (class Declaring extends AStepper implements IHasCycles {
		description = "Declares a step with the contract a case states.";
		cycles: IStepperCycles = { getConcerns: () => ({ domains: [GRANT], relations: [REVOKED] }) };
		steps: TStepperSteps = { revoke: { description: TEST_STEP, gwta: "revoke {grant: grant}", contract, action: async () => actionOK() } };
	})();

describe("the declarations check of contracts", () => {
	it("holds a contract whose relations, parameters and fields the registry lists, a field of a schema that reads JSON text among them", () => {
		const changes = [field({ schema: GrantSchema, topology: GRANT.topology }, "revoked"), relationChange(EDGE.mentions)];
		expect(contractFindings([declaring({ requires: [doesntHold(REVOKED, parameter("grant"))], changes })])).toEqual([]);
	});

	it("refuses each term the registry doesn't list", () => {
		const refused: [TStepContract, string][] = [
			[{ states: [holds(UNDECLARED, parameter("grant"))] }, UNDECLARED_RELATION],
			[{ requires: [holds(REVOKED, parameter("grant"), PRINCIPAL)] }, ARITY],
			[{ requires: [holds(REVOKED, parameter("door"))] }, UNNAMED_PARAMETER],
			[{ changes: [{ persistedAs: "Grant", key: "expired" }] }, UNDECLARED_FIELD],
			[{ complete: [{ persistedAs: "Grant", key: "expired" }] }, UNDECLARED_FIELD],
			[{ changes: [relationChange("expired")] }, UNSTATED_RELATION],
		];
		for (const [contract, finding] of refused)
			expect(
				contractFindings([declaring(contract)]).map(({ finding: found }) => found.split(" (")[0]),
				finding,
			).toEqual([finding]);
	});

	it("holds a relation whose sentences parse back to their statements' terms, and refuses one whose phrases another's parse or that name other places", () => {
		expect(relationFindings([REVOKED, UNDECLARED]), "each sentence, held or not, parses to its own term").toEqual([]);
		const shadowed: TRelation = { ...UNDECLARED, name: "shadowed", phrase: REVOKED.phrase };
		const negating: TRelation = { ...UNDECLARED, name: "negating", phrase: "didn't {grant} pass" };
		expect(relationFindings([REVOKED, shadowed, negating])).toEqual([
			{ method: "shadowed", finding: UNPARSED_SENTENCE },
			{ method: "negating", finding: UNPARSED_SENTENCE },
		]);
	});

	it("renders a negated statement inside the didn't combinator, and parses it back to its negated term", () => {
		const negated = doesntHold(REVOKED, parameter("grant"));
		expect(statementSentence(negated)).toBe("didn't grant is revoked");
		expect(termText(sentenceTerm([REVOKED], statementSentence(negated)) as TLineTerm)).toBe(termText(statementTerm(negated)));
	});
});
