/**
 * Runs a cycle method of every stepper that implements it, in the order the steppers state for it.
 */
import type { AStepper, StepperMethodArgs, IStepperCycles } from "../domains/stepper.js";
import { cycleOrder } from "../derivations/cycle-order.js";
import { constructorName } from "../../domains/util.js";

/** What a cycle method returns, once its promise settles. */
type TCycleResult<K extends keyof IStepperCycles> = Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>;

/** The arguments of a call of a cycle method: an empty list for a method that doesn't take an argument. */
const argumentsOf = <K extends keyof IStepperCycles>(args: StepperMethodArgs[K]): unknown[] => (args === undefined ? [] : [args]);

/** The phase of the process in progress: the start's phase, or the cycle method of the stepper that runs. */
let phase = "the start";

/** Notes the phase of the process in progress, which a warning that the event loop was held names. */
export const enterPhase = (name: string): void => {
	phase = name;
};

/** Returns the phase of the process in progress. */
export const phaseInProgress = (): string => phase;

/** Runs `method` of each stepper that implements it, one after another, and returns each result in that order. */
export const doStepperCycle = async <K extends keyof IStepperCycles>(steppers: AStepper[], method: K, args: StepperMethodArgs[K]): Promise<TCycleResult<K>[]> => {
	const results: TCycleResult<K>[] = [];
	for (const cycling of cycleOrder(steppers, method)) {
		const cycle = cycling.cycles[method] as (...a: unknown[]) => Promise<TCycleResult<K>>;
		enterPhase(`${constructorName(cycling)}.${method}`);
		results.push(await cycle.apply(cycling, argumentsOf<K>(args)));
	}
	return results;
};

/** Runs `method` of each stepper that implements it without waiting for a result, as the events hub calls `onEvent`. */
export const doStepperCycleSync = <K extends keyof IStepperCycles>(steppers: AStepper[], method: K, args: StepperMethodArgs[K]): void => {
	for (const cycling of cycleOrder(steppers, method)) {
		const cycle = cycling.cycles[method] as (...a: unknown[]) => void;
		cycle.apply(cycling, argumentsOf<K>(args));
	}
};
