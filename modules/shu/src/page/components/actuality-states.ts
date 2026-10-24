/**
 * The next step of an empty or unavailable state of a view that reads actuality: the monitor, whose read writes actuality to
 * this device, and the control that reads actuality again where a view couldn't read it.
 */
import { html } from "lit";
import { readAgainControl, type TEmptyState, type TLeadsOn } from "./empty-state.js";
import { paneHref } from "./ref-navigation.js";
import type { ActualitySource } from "../client-cache/ports.js";
import { SHU_TAG } from "../../domains/elements.js";

/** The label of the monitor's pane. */
export const MONITOR_LABEL = "Monitor";

/** The monitor, which reads actuality. */
export const actualityStepsNext = (): TLeadsOn =>
	html`Read actuality in <a href=${paneHref({ paneType: "component", tag: SHU_TAG.MONITOR_COLUMN, label: MONITOR_LABEL })}>the monitor</a>.`;

/** Why a view couldn't read actuality, and the control that reads it again, or undefined where it was read. */
export const actualityUnavailable = (run: ActualitySource): TEmptyState | undefined =>
	run.unavailable === null ? undefined : { message: run.unavailable, next: readAgainControl(() => void run.readAt()) };
