import type { z } from "zod";
import { z as zr } from "zod";

import { MODULE_OPTION_PREFIX } from "../../domains/protocol.js";

// ============================================================================
// Specl (runtime config file)
// ============================================================================

const RemoteStepperSchema = zr.object({ remote: zr.string() });
const StepperEntrySchema = zr.union([zr.string(), RemoteStepperSchema]);
export type TStepperEntry = z.infer<typeof StepperEntrySchema>;

/** What makes a config a group of features, which `haibun-cli --groups` finds, selects and runs. A config states it for itself: a
 *  config that extends a group is a group where it states `group`, which takes the base's group with what it states replacing it. */
const GroupSchema = zr.object({
	/** The bases the group runs, the first holding its features, by path from the config's directory or by a package's export, such as
	 *  `@haibun/shu/waypoints`. Without it, the group runs the config's directory alone. */
	bases: zr.array(zr.string()).optional(),
	/** The features the group runs, by the filters a command line gives. Without it, the group runs each feature of its bases. */
	filter: zr.array(zr.string()).optional(),
	/** The set of groups this group runs in, which `--set` names. Without it, the group runs in the set a call that doesn't name one runs. */
	set: zr.string().optional(),
	/** The configs, by path from this config's directory, whose groups run before this one. */
	after: zr.array(zr.string()).optional(),
	/** The paths, from the config's directory, that are removed before the group runs: a store or a browser's profile that its features
	 *  fill and keep across their own processes, which an earlier run leaves. */
	clears: zr.array(zr.string()).optional(),
});
export type TGroupDeclaration = z.infer<typeof GroupSchema>;

export const SpeclSchema = zr.looseObject({
	$schema: zr.string().optional(),
	/** The config this config extends, by its path from this config or by a package's export, such as
	 *  `@haibun/cli/config.base.json`: it adds its steppers, options, module options, parameters, `dependsOn` paths and
	 *  environments to the base's. A stepper the base lists isn't listed again here, and a key this config states replaces the base's. */
	extends: zr.string().optional(),
	steppers: zr.array(StepperEntrySchema),
	runPolicy: zr.string().optional(),
	appParameters: zr.record(zr.string(), zr.record(zr.string(), zr.unknown())).optional(),
	/** The base options a run of this config takes, by name without the `HAIBUN_` prefix, such as `CONTINUE_AFTER_ERROR`. The
	 *  environment states an option over what the config states. */
	options: zr.record(zr.string(), zr.string()).optional(),
	/** The variables of the process environment a run sets where the environment doesn't set them: what a service reads from its
	 *  deployment's environment, which a group's features state for the service they start. */
	env: zr.record(zr.string(), zr.string()).optional(),
	group: GroupSchema.optional(),
	/** The steppers' options a base states for every run of it, by the name the environment gives them. The environment
	 *  states an option over what the config states, so a deployment's `.env` or a caller changes it without an edit. */
	moduleOptions: zr.record(zr.string().startsWith(MODULE_OPTION_PREFIX, `a module option is named ${MODULE_OPTION_PREFIX}{STEPPER}_{OPTION}`), zr.string()).optional(),
	/** Paths, relative to this config or named by a package's export, whose content the features depend on beyond the modules
	 *  their steppers name: an application's own sources, fixtures a feature reads. A pass is recorded against their content, so
	 *  a change to any of them runs the features again and a change elsewhere does not. */
	dependsOn: zr.array(zr.string()).optional(),
	/** External environments the features use, by name: a mail server, a model, a network service. A pass is recorded
	 *  against the declaration, so the features run again when what speaks to the environment changed or on request;
	 *  the environment's own state is not read. A run reads the .env file of its starting directory, which holds the
	 *  environments' values, only where its configuration declares one. */
	environments: zr.array(zr.string()).optional(),
});

export type TSpecl = z.infer<typeof SpeclSchema>;

/** Whether a name in a config, a base or a dependency names a package's export, such as `@haibun/shu/waypoints`, rather than a path. */
export const namesPackage = (name: string): boolean => name.startsWith("@");

// ============================================================================
// Feature content (the .feature file shape)
// ============================================================================

type TFeatureMeta = { base: string; name: string; path: string };

export type TFeature = TFeatureMeta & {
	content: string;
	/** For kireji files: maps BDD line number (1-indexed) to TypeScript step index (0-indexed) */
	kirejiLineMap?: Map<number, number>;
};

export type TFeatures = TFeature[];

/** The features and the backgrounds a set of bases holds. */
export type TFeaturesBackgrounds = { features: TFeature[]; backgrounds: TFeature[] };

export type TExpandedFeature = TFeatureMeta & { expanded: TExpandedLine[] };

export type TExpandedLine = { line: string; rawLine?: string; lineNumber?: number; feature: TFeature };

export interface TSourceLocation {
	source: {
		/** Absolute path to the source file */
		path: string;
		/** 1-indexed line number in the source file */
		lineNumber?: number;
	};
}

/** A statement with its source location */
export type TStepInput = TSourceLocation & { in: string };

// ============================================================================
// Individual query result (runtime read shape with routing metadata)
// ============================================================================

/** A projected JSON-LD individual (carries `@id`/`@type`) plus its related-edge list, as returned by getRelated. */
export type TIndividualResult = Record<string, unknown> & { _edges?: Array<{ type: string; targetId: string }> };

// ============================================================================
// Route registry (tiny cross-concern contract)
// ============================================================================

/** Minimal route registry interface, implemented by IWebServer, consumed by http-observations. */
export interface IRouteRegistry {
	readonly mounted: Record<string, Record<string, string>>;
}

/** Extract all registered route paths from a route registry. */
export function registeredPaths(registry: IRouteRegistry): Set<string> {
	return new Set(Object.values(registry.mounted).flatMap((m) => Object.keys(m)));
}

// ============================================================================
// Misc
// ============================================================================

/** An option's value as its parse returns it. */
export type TOptionValue = string | number | boolean | object;
