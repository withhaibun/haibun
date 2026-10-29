import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Access, CLASS_LABEL } from "../../domains/resources.js";
import { mapDefinitionsToDomains } from "../../domains/domains.js";
import { classDomainDefinition } from "../domains/ontology.js";
import { DOMAIN_LABEL, DomainRecordSchema } from "../domains/domain-record.js";
import { domainRecords } from "./domain-records.js";

const domains = mapDefinitionsToDomains([
	classDomainDefinition,
	{ selectors: ["status"], schema: z.enum(["open", "closed"]), values: ["open", "closed"], description: "Where an item stands" },
	{ selectors: ["shu-monitor-column"], schema: z.object({}), description: "Actuality's monitor", ui: { component: "shu-monitor-column" } },
]);

describe("the Domain records", () => {
	it("derives a record for each registered domain, by its key, with what it declares", () => {
		const records = domainRecords(domains);
		expect(records.map(({ id }) => id).sort()).toEqual(Object.keys(domains).sort());
		const fields = (key: string) => DomainRecordSchema.parse(records.find(({ id }) => id === key)?.fields);
		expect(fields("status")).toMatchObject({ name: "status", description: "Where an item stands", values: ["open", "closed"] });
		expect(fields("shu-monitor-column").component, "a view names the component that draws it").toBe("shu-monitor-column");
		expect(fields("ontology-class").persisted, "a persisted domain names its type").toBe(CLASS_LABEL);
		expect(records.every(({ label, level }) => label === DOMAIN_LABEL && level === Access.public)).toBe(true);
	});
});
