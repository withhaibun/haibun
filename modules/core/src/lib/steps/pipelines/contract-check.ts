/**
 * The check of a call against its step's contract. Before the action runs, the call's arguments and principal are checked
 * against the contract's `requires`; once the action returns products, they are checked against its `states`. A value whose
 * domain refers to a stored type is the check's reference to its record by the record's typed CURIE, and the check reads the
 * record from the store. A statement that
 * is refuted or unknown refuses the call, and the refusal names the statement, its verdict and the triple that determined it.
 * The step's record holds the proof of the check, which EYE states.
 */
import { proverOf, type TWorld } from "../../actuality/domains/world.js";
import { VERDICT, type TActionResult } from "../../domains/protocol.js";
import { actionNotOK } from "../../domains/util.js";
import { isPersisted } from "../../domains/resources.js";
import { normalizeDomainKey, refTargetOf } from "../../domains/domains.js";
import { referenceTo } from "../../records/domains/unit.js";
import { CONTRACT_CHECK, contractChecking, contractProducts, statementNotation, type TContractCall, type TContractCheck } from "../domains/contract.js";
import { stepParts } from "../domains/phrase.js";
import type { TStepperStep } from "../domains/stepper.js";

/** What a refusal states was refused at each check. */
const REFUSED_AT: Record<TContractCheck, string> = {
	[CONTRACT_CHECK.requires]: "The call is refused before its action runs: its contract requires",
	[CONTRACT_CHECK.states]: "The call's products are refused and aren't kept: its contract states",
};

/** Returns the refusal of a call whose contract's `check` statements don't all hold, or undefined where every one holds or the
 *  contract doesn't state one. */
export async function contractRefusal(world: TWorld, step: TStepperStep, check: TContractCheck, call: TContractCall): Promise<TActionResult | undefined> {
	const checking = contractChecking(step, check);
	if (checking.statements.length === 0) return undefined;
	const domainOf = new Map(stepParts(step).map(({ name, domain }) => [name, domain]));
	const parameters = Object.fromEntries(Object.entries(call.parameters).map(([name, value]) => [name, checkedValue(world, domainOf.get(name), value)]));
	const products = call.products === undefined ? {} : { products: checkedValue(world, contractProducts(step).domain, call.products) };
	const { verdicts, proof } = await proverOf(world).checkContract(world, checking, { ...call, parameters, ...products });
	const refusing = verdicts.find(({ verdict }) => verdict !== VERDICT.proved);
	if (refusing === undefined) return undefined;
	const { verdict, decidedBy } = refusing;
	if (verdict !== VERDICT.refuted && verdict !== VERDICT.unknown)
		throw new Error(`a contract's check states ${verdict} for a statement, and a check states proved, refuted or unknown`);
	if (proof === undefined) throw new Error(`a contract's check refused ${statementNotation(refusing.statement)} without its proof, and a refusal names its proof`);
	const statement = { statement: statementNotation(refusing.statement), verdict, decidedBy };
	return actionNotOK(`${REFUSED_AT[check]} ${statement.statement}, which is ${verdict}: ${decidedBy}.`, { contract: { statement, proof } });
}

/** Returns a call's value as its check reads it: the reference to the record a value names by its id, where the value's domain
 *  refers to a stored type, else the value. */
function checkedValue(world: TWorld, domain: string | undefined, value: unknown): unknown {
	const registered = domain === undefined ? undefined : world.domains[normalizeDomainKey(domain)];
	const target = registered === undefined ? undefined : refTargetOf(registered, world.domains);
	const topology = target === undefined ? undefined : world.domains[target]?.topology;
	const id = typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" ? value.id : undefined;
	return isPersisted(topology) && id !== undefined ? referenceTo(topology.persistedAs, id) : value;
}
