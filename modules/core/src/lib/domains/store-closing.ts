/**
 * The refusal of a store whose close has begun. A store that closes refuses each statement it receives after the close
 * begins, and states the refusal as this type. A caller separates a closing store from a statement that failed by the type,
 * without reading the refusal's text.
 */
export class StoreClosingError extends Error {
	constructor(refused: string) {
		super(`the store is closed or closing, and refuses ${refused}`);
		this.name = "StoreClosingError";
	}
}

/** Whether `err`, or an error it states as its cause, is a closing store's refusal. */
export function isStoreClosing(err: unknown): boolean {
	if (err instanceof StoreClosingError) return true;
	return err instanceof Error && err.cause !== undefined && err.cause !== err && isStoreClosing(err.cause);
}
