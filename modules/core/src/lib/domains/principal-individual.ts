/**
 * Writes a Principal individual: the public, durable descriptor a DID resolves to, such as a site principal or an agent.
 * It writes through the store port, and only public material: a publicKeyMultibase, never a private key. Every stepper
 * that names a principal writes it through this module, so one DID is one Principal node, whatever roles it holds.
 */
import type { TWorld } from "../actuality/domains/world.js";
import { PRINCIPAL_DOMAIN, PRINCIPAL_LABEL, type TPrincipal } from "./resources.js";

/** Idempotent + best-effort: runs only when the Principal label is registered and a store is available (e.g. after
 *  `create graph store`). */
export async function persistPrincipalIndividual(world: TWorld, p: TPrincipal): Promise<void> {
	if (!world.domains?.[PRINCIPAL_DOMAIN]) return;
	const store = world.shared?.getStore();
	if (!store) return;
	await store.upsertIndividual(PRINCIPAL_LABEL, p);
}
