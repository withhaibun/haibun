/** The page's hydration (`page/pipelines/hydrate.ts`), as the page's start reads it and a view and a read look it up. */
import { installHydration, pageHydration, pageHydrationElement } from "../root.js";
import { readHydration } from "../pipelines/hydrate.js";
import { HYDRATION_ID } from "../../domains/elements.js";
import type { TCachePayload, TCarriedLabelFont } from "../../domains/hydration.js";
import type { TActualityId } from "@haibun/core/lib/rpc-wire.js";

/** Reads the page's hydration element, before any call, and holds what it parses. */
export const hydrateFromDom = (): void => void installHydration(readHydration(pageHydrationElement(HYDRATION_ID)));

/** Returns the actuality whose records the page reads. */
export const hydratedActualityId = (): TActualityId => pageHydration().actualityId();

/** Whether the page carries a record of actuality, which a site doesn't serve. */
export const isOffline = (): boolean => pageHydration().carried() !== undefined;

/** Returns the record of actuality the page carries, or undefined for a page a site serves. */
export const hydratedCache = (): TCachePayload | undefined => pageHydration().carried();

/** Returns the address the page opens at for a reader who arrives without one, or undefined where it doesn't state one. */
export const getHydratedViewHash = (): string | undefined => pageHydration().opensAt();

/** Returns the font of the labels the page carries. Throws for a page that doesn't carry it, since a page a site serves reads
 *  the site's font, and the writer of a report (`pipelines/monitor-report.ts`) states it. */
export function carriedLabelFont(): TCarriedLabelFont {
	const font = pageHydration().labelFont();
	if (font === undefined) throw new Error("this report lacks its label font: write it again with MonitorStepper");
	return font;
}

/** Returns what the page carries of a view's products, by the step that produces them. */
export const carriedProducts = (method: string): unknown => pageHydration().carriedProducts(method);

/** Returns the build the page's code is from, as a person reads it. */
export function pageBuild(): string {
	const { build } = pageHydration().settings();
	return `haibun ${build.version}, page code built ${build.builtAt}`;
}

/** Returns what every reader holds here without presenting anything. */
export const deploymentAllowedWithoutDelegation = (): string[] => pageHydration().settings().allowedWithoutDelegation;

/** Returns the rounds of tool calls an ask starts with, or undefined where the deployment doesn't set them. */
export const deploymentAskToolLimit = (): number | undefined => pageHydration().askToolLimit();

/** Returns the origin of the page this deployment lets embed shu, or undefined where it doesn't let one. */
export const deploymentEmbedderOrigin = (): string | undefined => pageHydration().settings().embedderOrigin;

/** Whether this deployment verifies a delegation. */
export const deploymentVerifiesDelegations = (): boolean => pageHydration().settings().verifiesDelegations;

/** Returns how long after the stream breaks the page opens it again, or undefined where the deployment doesn't set it. */
export const deploymentStreamReconnectMs = (): number | undefined => pageHydration().settings().streamReconnectAfterMs;

/** Returns the timeout on a request the page awaits. */
export const responseTimeoutMs = (): number => pageHydration().settings().responseTimeoutMs;
