/**
 * The order in which the steppers that implement a cycle method run it: by the position each states in `cyclesWhen`. The
 * order is derived once for each set of steppers and each method, and the sync and async cycles read the same order.
 */
import { CycleWhen, hasCycles, type AStepper, type IHasCycles, type IStepperCycles } from "../domains/stepper.js";
import { heldPerEntries } from "./held-per-entries.js";

/** A stepper that implements cycles. */
export type TCycling = AStepper & IHasCycles;

/** The position a stepper states for a method, or the unstated position where it doesn't state one. */
function positionOf(stepper: TCycling, method: keyof IStepperCycles): number {
	const stated = stepper.cyclesWhen?.[method];
	return stated === undefined ? CycleWhen.UNSTATED : stated;
}

/** Each method's order over a set of steppers, held while the set holds the same steppers. */
const ordersOf = heldPerEntries(
	(steppers: readonly AStepper[]) => steppers,
	(): Map<keyof IStepperCycles, readonly TCycling[]> => new Map(),
);

/** The steppers that implement `method`, in the order they run it. A sort is stable, so steppers at one position run in
 *  the order they are loaded. */
export function cycleOrder(steppers: readonly AStepper[], method: keyof IStepperCycles): readonly TCycling[] {
	const orders = ordersOf(steppers);
	const held = orders.get(method);
	if (held !== undefined) return held;
	const ordered = steppers.filter(hasCycles).filter((stepper) => stepper.cycles[method] !== undefined);
	ordered.sort((a, b) => positionOf(a, method) - positionOf(b, method));
	orders.set(method, ordered);
	return ordered;
}
