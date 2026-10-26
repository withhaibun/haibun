/**
 * The logic area's composition root: the engine port and the reasoner port, each made once per process on its first request.
 * The engine's runtime starts in about 100 ms and every actuality of the process proves through it. Every reasoning of the
 * process waits its turn at the same reasoner.
 */
import { eyeReasoner } from "./adapters/eye.js";
import { startSwipl } from "./adapters/swipl.js";
import type { TLogicEngine, TReasoner } from "./ports.js";

let started: Promise<TLogicEngine> | undefined;
let reasoning: TReasoner | undefined;

/** Returns the process's engine, starting it on the first request. */
export const logicEngine = (): Promise<TLogicEngine> => {
	if (started === undefined) started = startSwipl();
	return started;
};

/** Returns the process's reasoner, making it on the first request. */
export const reasoner = (): TReasoner => {
	if (reasoning === undefined) reasoning = eyeReasoner();
	return reasoning;
};
