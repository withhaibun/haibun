import { Timer } from "../schema/protocol.js";
import { DEFAULT_HOST_ID } from "./host-id.js";

export type TTagValue = number;
export type TTag = {
	key: string;
	/**
	 * Stable non-negative integer identifying the haibun instance. Prepended
	 * to every feature-step seqPath so observations from different hosts
	 * cannot collide. Single-host deployments use DEFAULT_HOST_ID (0).
	 */
	hostId: number;
	featureNum: number;
	featureName?: string;
	params: unknown;
	trace: boolean;
};
export const getRunTag = (featureNum: TTagValue, featureName?: string, params = {}, trace = false, hostId: number = DEFAULT_HOST_ID) => {
	const key = Timer.key;
	const res: TTag = { key, hostId, featureNum, featureName, params, trace };
	["featureNum", "hostId"].forEach((w) => {
		const val = (res as Record<string, unknown>)[w];
		if (parseInt(String(val)) !== val) {
			throw Error(`non - numeric ${w} from ${JSON.stringify(res)} `);
		}
	});
	return res;
};
