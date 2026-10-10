/** The page's blips, as a view records one where it happens (`page/pipelines/client-blips.ts`). */
import { pageBlips } from "../root.js";
import { recordClientBlip as recordIn, type TBlipChannel } from "../pipelines/client-blips.js";
import { CLIENT_RING } from "../../domains/elements.js";

/** Returns the page's blip channel, whose ring holds the latest `CLIENT_RING` blips. */
export const pageBlipChannel = (): TBlipChannel => pageBlips(CLIENT_RING);

/** Records one occurrence of `name`, declared in `domains/blips.ts`, with its value and attributes. */
export const recordClientBlip = (name: string, value: number | undefined, attributes: Record<string, unknown> | undefined): void => recordIn(pageBlipChannel(), name, value, attributes);
