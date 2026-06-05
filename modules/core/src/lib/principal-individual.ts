/**
 * Persist a Principal individual — the public, durable descriptor a DID resolves to (site principal, subkey,
 * or VC issuer). Crypto-free: writes through the abstract store, public material only (publicKeyMultibase,
 * never a private key). Shared by AuthorityStepper (subkey delegation) and the credentials Issuer
 * (shared-DID alignment) so one DID is one Principal node — its VC-issuance and capability roles converge.
 */
import type { TWorld } from "./world.js";
import { LinkRelations, PRINCIPAL_DOMAIN, PRINCIPAL_LABEL, type TPrincipal } from "./resources.js";

/**
 * Idempotent + best-effort: runs only when the Principal label is registered and a store is available
 * (e.g. after `create graph store`); the runtime grant stays the dispatch source of truth.
 *
 * Delegation is a single navigable `delegatedFrom` (sec:delegator) edge, never a Principal property —
 * so it is written AFTER the upsert (which replaces the subject's quads) and via the store's edge
 * primitive when available: graph-native stores (AGE) get one real, walkable edge through `createEdge`;
 * the in-memory quad store models edges as quads, so it falls back to `add`. Either way: exactly one edge.
 */
export async function persistPrincipalIndividual(world: TWorld, p: TPrincipal, delegatedFrom?: string): Promise<void> {
	if (!world.domains[PRINCIPAL_DOMAIN]) return;
	const store = world.shared?.getStore();
	if (!store) return;
	await store.upsertIndividual(PRINCIPAL_LABEL, p);
	if (!delegatedFrom) return;
	const rel = LinkRelations.DELEGATED_FROM.rel;
	if (store.createEdge) await store.createEdge(PRINCIPAL_LABEL, p.id, rel, PRINCIPAL_LABEL, delegatedFrom);
	else await store.add({ subject: p.id, predicate: rel, object: delegatedFrom, namedGraph: PRINCIPAL_LABEL });
}
