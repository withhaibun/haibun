/**
 * Writes a Principal individual at public: the published, durable descriptor a DID resolves to, such as a site principal or
 * an agent. It writes through the store port, and only public material: a publicKeyMultibase, never a private key. Every stepper
 * that names a principal writes it through this module, so one DID is one Principal node, whatever roles it holds.
 */
import type { TWorld } from "../actuality/domains/world.js";
import { Access, PRINCIPAL_DOMAIN, PRINCIPAL_LABEL, type TPrincipal } from "./resources.js";

/** Writes the Principal, merged into the one the store holds of its DID. Throws where the world doesn't register the Principal
 *  domain or doesn't hold a store, naming what is missing: a stepper that writes principals declares the Principal domain in
 *  its concerns, and runs where actuality holds a store. */
export async function persistPrincipalIndividual(world: TWorld, p: TPrincipal): Promise<void> {
	if (world.domains[PRINCIPAL_DOMAIN] === undefined)
		throw new Error(`writing the principal ${p.id} requires the ${PRINCIPAL_DOMAIN} domain. Declare principalDomainDefinition in the concerns of the stepper that writes it`);
	await world.shared.getStore().merge({ "@type": PRINCIPAL_LABEL, ...p, accessLevel: Access.public });
}
