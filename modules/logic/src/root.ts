/**
 * The logic area's composition root: the engine port, started once per process from the swipl-wasm adapter, since a
 * runtime's start takes about 100 ms and every actuality of the process proves through it.
 */
import { startSwipl } from "./adapters/swipl.js";
import type { TLogicEngine } from "./ports.js";

let started: Promise<TLogicEngine> | undefined;

/** Returns the process's engine, starting it on the first request. */
export const logicEngine = (): Promise<TLogicEngine> => {
	if (started === undefined) started = startSwipl();
	return started;
};
