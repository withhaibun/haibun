/**
 * The principal: the identity acting now (a comment's author, an artifact's creator). Read from
 * the active context, never passed by callers. Established by the credential/delegation layer
 * (which runs a statement as a principal through `runActingAs`); core stays crypto-free.
 */
import type { TWorld } from "./world.js";
import { actingAs } from "./capability-context.js";
import { activeSitePrincipal } from "./host-id.js";

const PRINCIPAL = "principal";

/** Whoever is acting: the one who proved themselves at the boundary this call came through, and otherwise whoever the
 *  run itself is acting as. A proof is about the call that carried it, so it states who is acting inside that call. */
export function currentPrincipal(world: TWorld): string | undefined {
	const proven = actingAs();
	if (proven) return proven;
	const p = world.runtime.keys?.[PRINCIPAL];
	return typeof p === "string" && p.length > 0 ? p : undefined;
}

/** Whoever is acting, and otherwise the site this instance acts as: the party a record written now is attributed to. */
export function actingPrincipal(world: TWorld): string {
	return currentPrincipal(world) ?? activeSitePrincipal(world);
}

/** The active principal, or throw: an authored action requires an acting principal. */
export function requirePrincipal(world: TWorld): string {
	const p = currentPrincipal(world);
	if (!p) throw new Error("an acting principal isn't established, and an authored action requires one");
	return p;
}

export function setPrincipal(world: TWorld, principal: string): void {
	(world.runtime.keys ??= {})[PRINCIPAL] = principal;
}
