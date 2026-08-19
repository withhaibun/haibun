/**
 * The principal — the identity acting now (a comment's author, an artifact's creator). Read from
 * the active context, never passed by callers. Established by the credential/delegation layer
 * (which calls `withPrincipal`); core stays crypto-free.
 */
import type { TWorld } from "./world.js";
import { actingAs } from "./capability-context.js";

const PRINCIPAL = "principal";

/** Whoever is acting: the one who proved themselves at the boundary this call came through, and otherwise whoever the
 *  run itself is acting as. A proof is about the call that carried it, so it says who is acting inside that call. */
export function currentPrincipal(world: TWorld): string | undefined {
	const proven = actingAs();
	if (proven) return proven;
	const p = world.runtime.keys?.[PRINCIPAL];
	return typeof p === "string" && p.length > 0 ? p : undefined;
}

/** The active principal, or throw — an authored action requires an acting principal. */
export function requirePrincipal(world: TWorld): string {
	const p = currentPrincipal(world);
	if (!p) throw new Error("no principal established — an authored action requires an acting principal");
	return p;
}

export function setPrincipal(world: TWorld, principal: string): void {
	(world.runtime.keys ??= {})[PRINCIPAL] = principal;
}

/** Run `fn` with `principal` active, restoring the prior value afterward. */
export async function withPrincipal<T>(world: TWorld, principal: string, fn: () => Promise<T> | T): Promise<T> {
	const keys = (world.runtime.keys ??= {});
	const prev = keys[PRINCIPAL];
	keys[PRINCIPAL] = principal;
	try {
		return await fn();
	} finally {
		if (prev !== undefined) keys[PRINCIPAL] = prev;
		else delete keys[PRINCIPAL];
	}
}
