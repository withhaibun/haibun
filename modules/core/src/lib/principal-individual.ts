/**
 * Persist a Principal individual: the public, durable descriptor a DID resolves to (a site principal, an agent, or a
 * VC issuer). Crypto-free: writes through the abstract store, public material only (publicKeyMultibase, never a
 * private key). Shared by every stepper that names a principal, so one DID is one Principal node: its VC-issuance and
 * capability roles converge.
 */
import type { TWorld } from "./world.js";
import { PRINCIPAL_DOMAIN, PRINCIPAL_LABEL, type TPrincipal } from "./resources.js";

/** Idempotent + best-effort: runs only when the Principal label is registered and a store is available (e.g. after
 *  `create graph store`). */
export async function persistPrincipalIndividual(world: TWorld, p: TPrincipal): Promise<void> {
	if (!world.domains?.[PRINCIPAL_DOMAIN]) return;
	const store = world.shared?.getStore();
	if (!store) return;
	await store.upsertIndividual(PRINCIPAL_LABEL, p);
}
