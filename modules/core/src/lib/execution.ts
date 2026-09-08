import type { z } from "zod";
import { z as zr } from "zod";

import type { TAnyFixme } from "./fixme.js";

// ============================================================================
// Specl (runtime config file)
// ============================================================================

export const RemoteStepperSchema = zr.object({ remote: zr.string(), token: zr.string().optional() });
export type TRemoteStepper = z.infer<typeof RemoteStepperSchema>;

export const StepperEntrySchema = zr.union([zr.string(), RemoteStepperSchema]);
export type TStepperEntry = z.infer<typeof StepperEntrySchema>;

export const SpeclSchema = zr.looseObject({
	$schema: zr.string().optional(),
	steppers: zr.array(StepperEntrySchema),
	runPolicy: zr.string().optional(),
	appParameters: zr.record(zr.string(), zr.record(zr.string(), zr.unknown())).optional(),
	options: zr.record(zr.string(), zr.unknown()).optional(),
	/** Paths, relative to this config, whose content the features depend on beyond the modules their steppers name:
	 *  an application's own sources, fixtures a feature reads. A pass is recorded against their content, so a change
	 *  to any of them runs the features again and a change elsewhere does not. */
	dependsOn: zr.array(zr.string()).optional(),
	/** External environments the features use, by name: a mail server, a model, a network service. A pass is recorded
	 *  against the declaration, so the features run again when what speaks to the environment changed or on request;
	 *  the environment's own state is not read. */
	environments: zr.array(zr.string()).optional(),
});

export type TSpecl = z.infer<typeof SpeclSchema>;

// ============================================================================
// Feature content (the .feature file shape)
// ============================================================================

export type TFeatureMeta = {
	base: string;
	name: string;
	path: string;
};

export type TFeature = TFeatureMeta & {
	content: string;
	/** For kireji files: maps BDD line number (1-indexed) to TypeScript step index (0-indexed) */
	kirejiLineMap?: Map<number, number>;
};

export type TFeatures = TFeature[];

export type TExpandedFeature = TFeatureMeta & {
	expanded: TExpandedLine[];
};

export type TExpandedLine = {
	line: string;
	rawLine?: string;
	lineNumber?: number;
	feature: TFeature;
};

export interface TSourceLocation {
	source: {
		/** Absolute path to the source file */
		path: string;
		/** 1-indexed line number in the source file */
		lineNumber?: number;
	};
}

/** A statement with its source location */
export type TStepInput = TSourceLocation & {
	in: string;
};

// ============================================================================
// Individual query result (runtime read shape with routing metadata)
// ============================================================================

/** A projected JSON-LD individual (carries `@id`/`@type`) plus its related-edge list, as returned by getRelated. */
export type TIndividualResult = Record<string, unknown> & {
	_edges?: Array<{ type: string; targetId: string }>;
};

// ============================================================================
// Route registry (tiny cross-concern contract)
// ============================================================================

/** Minimal route registry interface — implemented by IWebServer, consumed by http-observations. */
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

export type TOptionValue = TAnyFixme;
