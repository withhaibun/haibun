import { Timer } from '../schema/protocol.js';

export type TTagValue = number;
export type TTag = {
	key: string;
	sequence: number;
	featureNum: number;
	params: unknown;
	trace: boolean;
}; export const getRunTag = (sequence: TTagValue, featureNum: TTagValue, params = {}, trace = false) => {
	const key = Timer.key;
	const res: TTag = { key, sequence, featureNum, params, trace };
	['sequence', 'featureNum'].forEach((w) => {
		const val = (res as unknown)[w];
		if (parseInt(val) !== val) {
			throw Error(`non - numeric ${w} from ${JSON.stringify(res)} `);
		}
	});
	return res;
};

