import { Timer } from '../schema/protocol.js';

export type TTagValue = number;
export type TTag = {
	key: string;
	featureNum: number;
	featureName?: string;
	params: unknown;
	trace: boolean;
}; export const getRunTag = (featureNum: TTagValue, featureName?: string, params = {}, trace = false) => {
	const key = Timer.key;
	const res: TTag = { key, featureNum, featureName, params, trace };
	['featureNum'].forEach((w) => {
		const val = (res as unknown)[w];
		if (parseInt(val) !== val) {
			throw Error(`non - numeric ${w} from ${JSON.stringify(res)} `);
		}
	});
	return res;
};

