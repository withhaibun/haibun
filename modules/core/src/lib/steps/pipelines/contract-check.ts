/**
 * The check of a call against its step's contract. Before the action runs, the call's arguments and principal are checked
 * against the contract's `requires`; once the action returns products, they are checked against its `states`. A value whose
 * domain refers to a stored type is the check's reference to its record by the record's typed CURIE, and the check reads the
 * record from the store. A statement that
 * is refuted or unknown refuses the call. The refusal states two sentences: what was refused and the statement's sentence with its
 * verdict and the triple that determined it, then the remedy the verdict determines. The step's record holds the facts each check
 * read, as N3, from which a why view requests EYE's proof of the check.
 */
import { proverOf, type TWorld } from "../../actuality/domains/world.js";
import { VERDICT, type TActionResult } from "../../domains/protocol.js";
import { actionNotOK } from "../../domains/util.js";
import { isPersisted } from "../../domains/resources.js";
import { normalizeDomainKey, refTargetOf } from "../../domains/domains.js";
import { curieOf, referenceTo } from "../../records/domains/unit.js";
import { actingFor, inCall } from "../../domains/capability-context.js";
import {
	ACTUALITY_PRINCIPAL,
	ASSUMED_CHECK,
	CONTRACT_CHECK,
	checkN3,
	contractChecking,
	contractProducts,
	holds,
	parameter,
	requiredRelation,
	type TContractCall,
	type TContractCheck,
} from "../domains/contract.js";
import { stepParts } from "../domains/phrase.js";
import type { TStatementRefusal } from "../../transport/domains/rpc-wire.js";
import type { TStepperStep } from "../domains/stepper.js";

/** What a refusal states was refused at each check. */
const REFUSED_AT: Record<TContractCheck, string> = {
	[CONTRACT_CHECK.requires]: "The call is refused before its action runs: its contract requires",
	[CONTRACT_CHECK.states]: "The call's products are refused and aren't kept: its contract states",
};

/** The remedy of a refused statement, by its verdict. */
const REMEDY_OF = {
	[VERDICT.refuted]: "Call the step with values for which the statement holds, since the records the check read refute it.",
	[VERDICT.unknown]: "Record the facts the statement reads, since the records the check read don't derive it or its negation.",
} as const;

/** A check of a call: the check's facts as N3, and the refusal of the call where a statement doesn't hold. */
export type TContractOutcome = { readonly checked: string; readonly refused?: { readonly reason: string; readonly statement: TStatementRefusal } };

/** Returns the check of a call against its contract's `check` statements, or undefined where the contract doesn't state one. */
export async function contractChecked(world: TWorld, step: TStepperStep, check: TContractCheck, call: TContractCall): Promise<TContractOutcome | undefined> {
	const checking = contractChecking(step, check);
	if (checking.statements.length === 0) return undefined;
	const domainOf = new Map(stepParts(step).map(({ name, domain }) => [name, domain]));
	const parameters = Object.fromEntries(Object.entries(call.parameters).map(([name, value]) => [name, checkedValue(world, domainOf.get(name), value)]));
	const products = call.products === undefined ? {} : { products: checkedValue(world, contractProducts(step).domain, call.products) };
	const { verdicts, facts } = await proverOf(world).checkContract(world, checking, { ...call, parameters, ...products });
	const checked = checkN3(check, facts);
	const refusing = verdicts.find(({ verdict }) => verdict !== VERDICT.proved);
	if (refusing === undefined) return { checked };
	const { verdict, decidedBy, sentence } = refusing;
	if (verdict !== VERDICT.refuted && verdict !== VERDICT.unknown)
		throw new Error(`a contract's check states ${verdict} for a statement, and a check states proved, refuted or unknown`);
	const statement = { statement: sentence, verdict, decidedBy, remedy: REMEDY_OF[verdict] };
	return { checked, refused: { reason: `${REFUSED_AT[check]} that ${sentence}, which is ${verdict}: ${decidedBy}. ${statement.remedy}`, statement } };
}

/** Returns the check of the records an assumed step's call wrote against the fields each one's type states every member has
 *  (`required`): a field the record holds is proved, and a field the extraction didn't produce is unknown. The check doesn't
 *  refuse the call, since the open world doesn't read an absent field as false. Undefined where the call didn't write a record of a
 *  type that states one. */
export async function assumedChecked(world: TWorld): Promise<string | undefined> {
	const written = inCall()?.step?.writes?.written;
	const requiredOf = new Map(
		Object.values(world.domains).flatMap(({ topology }) => (isPersisted(topology) && topology.required ? [[topology.persistedAs, topology.required]] : [])),
	);
	const records = new Map((written === undefined ? [] : written).map((name) => [curieOf(name), name]));
	const parameters = Object.fromEntries([...records].map(([curie, { label, id }]) => [curie, referenceTo(label, id)]));
	const statements = [...records].flatMap(([curie, { label }]) => {
		const keys = requiredOf.get(label);
		return keys === undefined ? [] : keys.map((key) => holds(requiredRelation(key), parameter(curie)));
	});
	if (statements.length === 0) return undefined;
	const { facts } = await proverOf(world).checkContract(world, { statements, complete: [] }, { parameters });
	return checkN3(ASSUMED_CHECK, facts);
}

/** Returns the result of a call its contract's check refused, with the checks the call ran. */
export const contractRefusal = ({ reason, statement }: NonNullable<TContractOutcome["refused"]>, checks: readonly string[]): TActionResult =>
	actionNotOK(reason, { contract: { statement, checks: checks.join("\n") } });

/** Returns a call's value as its check reads it: the reference to the record a value names by its id, where the value's domain
 *  refers to a stored type, else the value. */
function checkedValue(world: TWorld, domain: string | undefined, value: unknown): unknown {
	const registered = domain === undefined ? undefined : world.domains[normalizeDomainKey(domain)];
	const target = registered === undefined ? undefined : refTargetOf(registered, world.domains);
	const topology = target === undefined ? undefined : world.domains[target]?.topology;
	const id = typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" ? value.id : undefined;
	return isPersisted(topology) && id !== undefined ? referenceTo(topology.persistedAs, id) : value;
}

/** Returns the principal a call's check reads: the principal the call proved, else `ACTUALITY_PRINCIPAL` where the call holds
 *  every action as actuality's own, else undefined. */
export function callPrincipal(): string | undefined {
	const principal = inCall()?.principal;
	if (principal !== undefined) return principal;
	return actingFor()?.root === true ? ACTUALITY_PRINCIPAL : undefined;
}
