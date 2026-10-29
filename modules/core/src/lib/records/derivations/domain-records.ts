/**
 * The Domain records core derives from the declarations: one for each registered domain, by its key.
 */
import { Access, isPersisted, type TRegisteredDomain } from "../../domains/resources.js";
import { DOMAIN_FIELD, DOMAIN_LABEL } from "../domains/domain-record.js";
import { ONTOLOGY_GENERATED_AT } from "./ontology.js";
import type { THeldRecord } from "./read-records.js";

/** Returns a record for each registered domain: its key, its description, its values where it is a set, the component that draws
 *  it where it is a view, the type it is persisted as and its topology. Every record states the ontology's time, since the
 *  declarations don't change while they hold. */
export function domainRecords(domains: Record<string, TRegisteredDomain>): THeldRecord[] {
	return Object.entries(domains).map(([key, { description, values, ui, topology }]) => ({
		id: key,
		label: DOMAIN_LABEL,
		fields: {
			[DOMAIN_FIELD.name]: key,
			[DOMAIN_FIELD.description]: description,
			...(values === undefined ? {} : { [DOMAIN_FIELD.values]: values }),
			...(typeof ui?.component === "string" ? { [DOMAIN_FIELD.component]: ui.component } : {}),
			...(isPersisted(topology) ? { [DOMAIN_FIELD.persisted]: topology.persistedAs } : {}),
			...(topology === undefined ? {} : { [DOMAIN_FIELD.topology]: topology }),
			[DOMAIN_FIELD.generatedAtTime]: ONTOLOGY_GENERATED_AT,
			[DOMAIN_FIELD.accessLevel]: Access.public,
		},
		edges: [],
		level: Access.public,
	}));
}
