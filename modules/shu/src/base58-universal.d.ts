/** The part of the base58 encoding a page uses to name its key as a did:key, declared because the package doesn't publish
 *  types. */
declare module "base58-universal" {
	export function encode(input: Uint8Array): string;
}
