/**
 * Actuality's steps as the page holds them (`page/machines/registry.ts`), as a view, a call and the page's start read them
 * (`page/derivations/steps.ts`, `page/pipelines/read-steps.ts`). A view that follows the steps holds a
 * `StepsChangedController`, which reads again each time the page reads them again.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { TDomainDiscoveryInfo, TStepDefinition } from "@haibun/core/lib/step-discovery.js";
import { SHOW_STEPS_ACTION, SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { pageConduit, pageEventStream, pageRegistry, registryReads } from "../root.js";
import { readSteps } from "../pipelines/read-steps.js";
import { REGISTRY_EVENT, REGISTRY_STATUS, type TRegistryOrigin, type TStepList } from "../machines/registry.js";
import * as Steps from "../derivations/steps.js";
import { acts, reads, type TLink } from "../domains/links.js";

/** Reads actuality's steps where the page doesn't hold them, and returns them. */
const stepList = (): Promise<TStepList> => readSteps({ registry: pageRegistry(), reads: registryReads(), conduit: pageConduit, stream: pageEventStream });

/** Returns the steps the page holds, or undefined before its first read. */
function heldList(): TStepList | undefined {
	const state = pageRegistry().state.get();
	return state.status === REGISTRY_STATUS.READ ? state.read.list : undefined;
}

/** Returns the steps the page holds. Throws before its first read, and names what reads them. */
function readList(what: string): TStepList {
	const list = heldList();
	if (list === undefined) throw new Error(`${what} is read after actuality's steps: call getAvailableSteps() first`);
	return list;
}

/** Returns actuality's steps, read where the page doesn't hold them. */
export const getAvailableSteps = async (): Promise<TStepDefinition[]> => (await stepList()).steps;

/** Returns actuality's domains, read where the page doesn't hold them. */
export const getAvailableDomains = async (): Promise<Record<string, TDomainDiscoveryInfo>> => (await stepList()).domains;

/** Returns the step `name` names, or undefined where the page doesn't hold it, as before its first read. */
export function findStep(name: string): TStepDefinition | undefined {
	const list = heldList();
	return list === undefined ? undefined : Steps.stepNamed(list, name);
}

/** Returns the method of the step `name` names. Throws where the page doesn't hold it. */
export const requireStep = (name: string): string => Steps.methodOf(readList(`the step ${name}`), name);

/** Returns the domain actuality declares under `key`, or undefined where it doesn't declare one or the page hasn't read it. */
export const findDomain = (key: string): TDomainDiscoveryInfo | undefined => heldList()?.domains[key];

/** Returns a link to a step a caller names at run time, by the step's declaration: a read where the step declares itself a
 *  read, and an act otherwise, as for a method the steppers don't provide. */
export const linkTo = (method: string, params?: Record<string, unknown>, summary?: string): TLink =>
	findStep(method)?.read === true ? reads(method, params, summary) : acts(method, params, summary);

/** Returns the steps that take a domain and the steps that return it. */
export const stepsJoining = (name: string): ReturnType<typeof Steps.stepsJoining> => Steps.stepsJoining(readList(`the steps joining ${name}`), name);

/** Returns the steps whose required action `action` allows. */
export const stepsAllowedBy = (action: string): TStepDefinition[] => Steps.stepsAllowedBy(readList(`the steps ${action} allows`), action);

/** Returns the steps of a type. */
export const stepsForContext = (label: string): TStepDefinition[] => Steps.stepsForContext(readList(`the steps of ${label}`), label);

/** Returns the domain options a type selector offers. */
export const domainOptions = async (): Promise<Steps.TDomainOption[]> => {
	const list = await stepList();
	return Steps.domainOptions(list.concerns, list.domains);
};

/** Returns where the registry the page runs on came from, or undefined before its first read. */
export function registryOrigin(): TRegistryOrigin | undefined {
	const state = pageRegistry().state.get();
	if (state.status !== REGISTRY_STATUS.READ) return undefined;
	const { read } = state;
	return read.from === "site" ? { from: "site" } : { from: "device", savedAt: read.savedAt };
}

/** Returns the action a call of `method` requires: discovery's own action for discovery, which the page holds without a
 *  read, and the action the step declares otherwise, or undefined where the page doesn't hold the step. */
export const requiredActionOf = (method: string): string | undefined => (method === SHOW_STEPS_METHOD ? SHOW_STEPS_ACTION : findStep(method)?.capability);

/** Calls `listener` each time the page reads actuality's steps again. Returns the call that stops it. */
export const onStepsChanged = (listener: () => Promise<void> | void): (() => void) =>
	pageRegistry().follow((move) => {
		if (move.event.type === REGISTRY_EVENT.READ_AGAIN) void listener();
	});

/** A view's handle on actuality's steps: the view reads them again each time the page reads them again. */
export class StepsChangedController implements ReactiveController {
	private stop: (() => void) | undefined;

	constructor(
		host: ReactiveControllerHost,
		private readonly readAgain: () => Promise<void> | void,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		this.stop = onStepsChanged(this.readAgain);
	}

	hostDisconnected(): void {
		this.stop?.();
		this.stop = undefined;
	}
}
