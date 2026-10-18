/**
 * The principal is the identity that performs the current action, such as a comment's author or an artifact's creator.
 * These functions read it from the active context, and callers don't pass it. The credential and delegation layer
 * establishes it by running a statement as a principal through `runActingAs`. Core doesn't implement credential signing
 * or verification.
 */
import type { TWorld } from "../actuality/domains/world.js";
import { actingAs } from "../capability-context.js";
import { activeSitePrincipal } from "../domains/host-id.js";

const PRINCIPAL = "principal";

/** Returns the principal this call acts as. A boundary sets it from the proof it verified, and a tick sets the
 *  principal that started its ticker. Otherwise returns the principal setPrincipal stored in the world, or undefined. A
 *  proof applies only to the call that carried it, so the async context scopes the principal to that call. */
export function currentPrincipal(world: TWorld): string | undefined {
	const proven = actingAs();
	if (proven) return proven;
	const p = world.runtime.keys?.[PRINCIPAL];
	return typeof p === "string" && p.length > 0 ? p : undefined;
}

/** Returns the acting principal, else the site principal this instance acts as. A caller attributes a record it writes now to the returned principal. */
export function actingPrincipal(world: TWorld): string {
	return currentPrincipal(world) ?? activeSitePrincipal(world);
}

/** Returns the acting principal, and throws when one isn't established. An authored action requires an acting principal. */
export function requirePrincipal(world: TWorld): string {
	const p = currentPrincipal(world);
	if (!p) throw new Error("an acting principal isn't established, and an authored action requires one. Run the action through runActingAs, or set a principal with setPrincipal");
	return p;
}

export function setPrincipal(world: TWorld, principal: string): void {
	(world.runtime.keys ??= {})[PRINCIPAL] = principal;
}
