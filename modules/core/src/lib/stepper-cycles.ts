import { AStepper, IHasCycles, StepperMethodArgs, IStepperCycles } from "./astepper.js";

export const doStepperCycle = async <K extends keyof IStepperCycles>(
	steppers: AStepper[],
	method: K,
	args: StepperMethodArgs[K],
	guidance = "",
): Promise<Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>[]> => {
	const results: Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>[] = [];
	const hasCycles = (steppers as unknown[] as (AStepper & IHasCycles)[])
		.filter((c) => c.cycles && c.cycles[method])
		.sort((a, b) => {
			const key = method as keyof typeof a.cyclesWhen;
			const aVal = a.cyclesWhen?.[key];
			const bVal = b.cyclesWhen?.[key];
			return (aVal ?? 0) - (bVal ?? 0);
		});
	for (const cycling of hasCycles) {
		const cycle = cycling.cycles[method];
		if (cycle) {
			const paramsForApply = args === undefined ? [] : [args];
			const result = await (cycle as (...a: unknown[]) => Promise<unknown>).apply(cycling, paramsForApply);
			results.push(result as Awaited<ReturnType<NonNullable<IStepperCycles[K]>>>);
		}
	}
	return results;
};

export const doStepperCycleSync = <K extends keyof IStepperCycles>(steppers: AStepper[], method: K, args: StepperMethodArgs[K]): void => {
	const hasCycles = (steppers as unknown[] as (AStepper & IHasCycles)[]).filter((c) => c.cycles && c.cycles[method]);
	for (const cycling of hasCycles) {
		const cycle = cycling.cycles[method];
		if (cycle) {
			const paramsForApply = args === undefined ? [] : [args];
			(cycle as (...a: unknown[]) => void).apply(cycling, paramsForApply);
		}
	}
};
