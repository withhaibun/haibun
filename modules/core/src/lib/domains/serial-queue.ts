/** Work that runs one at a time, in the order it is given: each piece starts once the piece before it settled, whether it returned
 *  or threw. */
export type TSerialQueue = <T>(run: () => Promise<T>) => Promise<T>;

/** Returns a queue of its own. */
export function serialQueue(): TSerialQueue {
	let turn: Promise<unknown> = Promise.resolve();
	return <T>(run: () => Promise<T>): Promise<T> => {
		const ran = turn.then(run, run);
		turn = ran.catch(() => undefined);
		return ran;
	};
}
