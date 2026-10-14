import { Timer } from "../schema/protocol.js";
import { DEFAULT_HOST_ID, resolveHostId } from "./host-id.js";

type TTagValue = number;
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
	(["featureNum", "hostId"] as const).forEach((w) => {
		const val = res[w];
		if (parseInt(String(val)) !== val) {
			throw Error(`the tag field ${w} isn't a whole number in ${JSON.stringify(res)}; state it as a whole number`);
		}
	});
	return res;
};

/** The tag of actuality's run outside a feature, on the host this process resolves. */
export const getDefaultTag = (desc?: string): TTag => getRunTag(0, undefined, desc ? { desc } : undefined, false, resolveHostId());
