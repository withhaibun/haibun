import type { TModuleOptions } from "./world.js";

let held: TModuleOptions | undefined;

/** Holds the module options that this process was given, the environment's over the config's, so a feature file reads them as it
 *  loads, before any stepper exists. The command line holds them once it has processed the environment and the config. */
export function holdModuleOptions(options: TModuleOptions): void {
	held = options;
}

/** Returns the value of a module option that the environment or the config states, or undefined where both leave it unstated. Throws
 *  where options aren't held yet, which is a read before the command line has processed the environment. */
export function heldModuleOption(name: string): string | undefined {
	if (held === undefined)
		throw new Error(
			`${name} is read before this process holds its module options. Read it as a feature loads, which is after the command line processes the environment and the config.`,
		);
	return held[name];
}

/** Returns the value of a module option that a feature can't run without. Throws where the environment and the config both leave it unstated. */
export function requiredModuleOption(name: string): string {
	const value = heldModuleOption(name);
	if (value === undefined || value === "") throw new Error(`${name} isn't set. Set it in the moduleOptions of the config of this group, or in the environment.`);
	return value;
}
