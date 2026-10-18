/**
 * The reader's authority on the page, as a view, the page's start and the browser extension read and use it
 * (`pipelines/page-authority.ts`), and as the page's root holds it (`authorityPort`).
 */
import type { TDelegation } from "@haibun/core/lib/domains/actions.js";
import type { TDelegations } from "@haibun/core/lib/domains/authority-types.js";
import type { TProveRequest } from "@haibun/core/lib/rpc-wire.js";
import { authorityScope, pageKeyStore } from "../root.js";
import * as Authority from "../pipelines/page-authority.js";
import type { TProvedRequest } from "../ports.js";
import type { TAuthority } from "../../ports.js";

export type { TPageAuthority } from "../pipelines/page-authority.js";

/** Reads what the page holds: its key, and what `read` returns as delegated to it, beside what `withoutDelegation` allows. */
export const openPageAuthority = (read: (() => Promise<TDelegations>) | undefined, withoutDelegation: string[]): Promise<Authority.TPageAuthority> =>
	Authority.openPageAuthority(authorityScope(), read, withoutDelegation);

/** Returns what the page holds once the read the page started ends, or undefined where the page didn't start one. */
export const pageAuthorityReady = (): Promise<Authority.TPageAuthority | undefined> => Authority.pageAuthorityReady(authorityScope());

/** Returns what the page holds, or undefined until it read it. */
export const pageAuthority = (): Authority.TPageAuthority | undefined => Authority.pageAuthority(authorityScope());

/** Returns each action the page holds. */
export const pageHolds = (): string[] => Authority.pageHolds(authorityScope());

/** Whether the page holds what `action` requires. */
export const pageMay = (action: string): boolean => Authority.pageMay(authorityScope(), action);

/** Holds a delegation the embedding page gave the page's key, in place of `replacing`. */
export const holdGiven = (delegation: TDelegation, replacing: TDelegation | undefined): void => Authority.holdGiven(authorityScope(), delegation, replacing);

/** Lets go of what the page holds, so it reads it again. */
export const forgetPageAuthority = (): void => Authority.forgetPageAuthority(authorityScope());

/** Returns the headers that prove only that the page holds its key. */
export const keyHeaders = (request: TProvedRequest): Promise<Record<string, string>> => Authority.keyHeaders(authorityScope(), request);

/** Returns the headers that prove `request` as its action, or undefined where the page doesn't hold a delegation that allows it. */
export const signedHeaders = (request: TProvedRequest & { action: string }): Promise<Record<string, string> | undefined> => Authority.signedHeaders(authorityScope(), request);

/** Returns what the page keeps beside its key under `name`, or undefined where it doesn't keep anything there. */
export const readKept = (name: string): Promise<unknown> => pageKeyStore().read(name);

/** Keeps `value` beside the page's key under `name`. */
export const keep = (name: string, value: unknown): Promise<void> => pageKeyStore().keep(name, value);

/** Returns the page's authority as the page's root holds it. */
export const authorityPort = (): TAuthority => ({
	may: pageMay,
	holds: pageHolds,
	ready: pageAuthorityReady,
	hold: holdGiven,
	forget: forgetPageAuthority,
	prove: (method, required): TProveRequest => Authority.callProof(authorityScope(), method, required),
	readingHeaders: (url, action) => Authority.readingHeaders(authorityScope(), url, action),
});
