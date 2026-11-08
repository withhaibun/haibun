/**
 * The check of a call against its step's contract. Before the action runs, the call's arguments and principal are checked
 * against the contract's `requires`; once the action returns products, they are checked against its `states`. A statement that
 * is refuted or unknown refuses the call, and the refusal names the statement, its verdict and the triple that determined it.
 * The step's record holds the proof of the check, which EYE states.
 */
import { proverOf, type TWorld } from "../../actuality/domains/world.js";
import { VERDICT, type TActionResult } from "../../domains/protocol.js";
import { actionNotOK } from "../../domains/util.js";
import { CONTRACT_CHECK, contractStatements, statementNotation, type TContractCall, type TContractCheck, type TStepContract } from "../domains/contract.js";

/** What a refusal states was refused at each check. */
const REFUSED_AT: Record<TContractCheck, string> = {
	[CONTRACT_CHECK.requires]: "The call is refused before its action runs: its contract requires",
	[CONTRACT_CHECK.states]: "The call's products are refused and aren't kept: its contract states",
};

/** Returns the refusal of a call whose contract's `check` statements don't all hold, or undefined where every one holds or the
 *  contract doesn't state one. */
export async function contractRefusal(world: TWorld, step: { readonly contract?: TStepContract }, check: TContractCheck, call: TContractCall): Promise<TActionResult | undefined> {
	const statements = contractStatements(step, check);
	if (statements.length === 0) return undefined;
	const { verdicts, proof } = await proverOf(world).checkContract(statements, call);
	const refusing = verdicts.find(({ verdict }) => verdict !== VERDICT.proved);
	if (refusing === undefined) return undefined;
	const { verdict, decidedBy } = refusing;
	if (verdict !== VERDICT.refuted && verdict !== VERDICT.unknown)
		throw new Error(`a contract's check states ${verdict} for a statement, and a check states proved, refuted or unknown`);
	if (proof === undefined) throw new Error(`a contract's check refused ${statementNotation(refusing.statement)} without its proof, and a refusal names its proof`);
	const statement = { statement: statementNotation(refusing.statement), verdict, decidedBy };
	return actionNotOK(`${REFUSED_AT[check]} ${statement.statement}, which is ${verdict}: ${decidedBy}.`, { contract: { statement, proof } });
}
