/**
 * The step registry the page runs on: unread until the page first reads actuality's steps, then read from the site, or
 * from the copy the device holds where the site doesn't respond. Each read again after actuality signals its steps
 * changed replaces what the page holds, and a view that follows the registry reads again at that move.
 */
import type { TStepDefinition, TStepDefinitions } from "@haibun/core/lib/step-discovery.js";

/** What the page reads of actuality's steps: the steps it may call, every step actuality declares, the domains, the concern
 *  catalog and the predicates the steps prove. A view of a step the page can't call, or of an action, reads `declared`. */
export type TStepList = Pick<TStepDefinitions, "domains" | "concerns" | "predicates"> & { steps: TStepDefinition[]; declared: TStepDefinition[] };

/** The step list of a read of actuality's step definitions, whose steps state whether the page may call each. */
export const stepListOf = ({ steps, ...read }: Pick<TStepDefinitions, "steps" | "domains" | "concerns" | "predicates">): TStepList => ({
	...read,
	steps: steps.filter((step) => step.callable),
	declared: steps,
});

/** Where a read came from: the site, or the device's copy of the site's response, saved at `savedAt`. */
export type TRegistryOrigin = { from: "site" } | { from: "device"; savedAt: number };

/** A read of actuality's steps, and its origin. */
export type TRegistryRead = TRegistryOrigin & { list: TStepList };

export const REGISTRY_STATUS = { UNREAD: "unread", READ: "read" } as const;
export type TRegistryState = { status: typeof REGISTRY_STATUS.UNREAD } | { status: typeof REGISTRY_STATUS.READ; read: TRegistryRead };

/** What moves the registry: the page's first read of actuality's steps, and each read again after they changed. */
export const REGISTRY_EVENT = { READ: "read", READ_AGAIN: "read-again" } as const;
export type TRegistryEvent = { type: (typeof REGISTRY_EVENT)[keyof typeof REGISTRY_EVENT]; read: TRegistryRead };

/** The registry before the page reads actuality's steps. */
export const INITIAL_REGISTRY: TRegistryState = { status: REGISTRY_STATUS.UNREAD };

/** Returns the registry after `event`. A read again replaces a read, and a first read of a registry the page holds, as a
 *  bundle's read that resolves after another's, replaces it as well. */
export const registryTransition = (_state: TRegistryState, event: TRegistryEvent): TRegistryState => ({ status: REGISTRY_STATUS.READ, read: event.read });
