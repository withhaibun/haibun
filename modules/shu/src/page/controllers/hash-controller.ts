/** The page's hash, as a view and the page's reads read, write and follow it (`page/pipelines/page-hash.ts`). */
import { pageHashHeld, pageLocation } from "../root.js";
import * as PageHash from "../pipelines/page-hash.js";
import { isOffline } from "../../rpc-registry.js";

const scope = (): PageHash.THashScope => ({ location: pageLocation(), held: pageHashHeld(), carried: isOffline() });

/** Calls `listener` at each arrival at a hash and each write of one. Returns the call that stops it. */
export const onHashChanged = (listener: () => void): (() => void) => PageHash.onHashChanged(scope(), listener);

/** Returns the page's hash. */
export const getHash = (): string => PageHash.getHash(scope());

/** Writes `hash` as the page's hash, and doesn't call the views that follow it. */
export const pushHash = (hash: string): void => PageHash.pushHash(scope(), hash);

/** Returns the value of the parameter `name` in the page's hash, or undefined where the hash doesn't state it. */
export const hashParam = (name: string): string | undefined => PageHash.hashParam(scope(), name);

/** Sets each parameter of `values` in the page's hash, removes each undefined one, and calls each view that follows it. */
export const mergeHashParams = (values: Readonly<Record<string, string | undefined>>): void => PageHash.mergeHashParams(scope(), values);

/** Returns the page's address without the hash, or undefined for a page that carries a record of actuality. */
export const pageAddress = (): string | undefined => PageHash.pageAddress(scope());
