/**
 * The vocabularies haibun names, each once: its namespace by its prefix, and the terms code names by their IRIs. A derivation
 * that writes or reads RDF names a term through these, with N3.js's DataFactory where it builds RDF/JS terms, so an IRI isn't
 * written out where it is used.
 */

/** The namespace of each vocabulary, by its prefix. */
export const NAMESPACE = {
	rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
	rdfs: "http://www.w3.org/2000/01/rdf-schema#",
	owl: "http://www.w3.org/2002/07/owl#",
	xsd: "http://www.w3.org/2001/XMLSchema#",
	sec: "https://w3id.org/security#",
	odrl: "http://www.w3.org/ns/odrl/2/",
	cred: "https://www.w3.org/2018/credentials#",
	log: "http://www.w3.org/2000/10/swap/log#",
	math: "http://www.w3.org/2000/10/swap/math#",
	string: "http://www.w3.org/2000/10/swap/string#",
	r: "http://www.w3.org/2000/10/swap/reason#",
	as: "https://www.w3.org/ns/activitystreams#",
	foaf: "http://xmlns.com/foaf/0.1/",
	dcterms: "http://purl.org/dc/terms/",
	prov: "https://www.w3.org/ns/prov#",
	http: "http://www.w3.org/2011/http#",
	did: "https://www.w3.org/ns/did#",
	sosa: "http://www.w3.org/ns/sosa/",
	schema: "https://schema.org/",
	oa: "http://www.w3.org/ns/oa#",
	skos: "http://www.w3.org/2004/02/skos/core#",
	cito: "http://purl.org/spar/cito/",
	earl: "http://www.w3.org/ns/earl#",
	otel: "https://opentelemetry.io/schemas/",
} as const;

/** The IRI of each of a vocabulary's terms, by its local name. A vocabulary is named by its prefix, so a call reads only
 *  its arguments and a bundle leaves out each vocabulary its code doesn't read. */
const termsIn = <T extends string>(prefix: keyof typeof NAMESPACE, names: readonly T[]): Readonly<Record<T, string>> =>
	Object.fromEntries(names.map((name) => [name, `${NAMESPACE[prefix]}${name}`])) as Record<T, string>;

export const RDF = /* @__PURE__ */ termsIn("rdf", ["type", "Property", "first", "rest", "nil"]);
export const RDFS = /* @__PURE__ */ termsIn("rdfs", ["Class", "subClassOf", "subPropertyOf", "domain", "range"]);
export const OWL = /* @__PURE__ */ termsIn("owl", ["Class", "ObjectProperty", "unionOf", "sameAs", "equivalentProperty"]);
export const XSD = /* @__PURE__ */ termsIn("xsd", ["string", "dateTime", "date", "integer", "decimal", "boolean"]);
export const LOG = /* @__PURE__ */ termsIn("log", ["includes", "notIncludes", "implies", "equalTo"]);
export const MATH = /* @__PURE__ */ termsIn("math", ["greaterThan", "lessThan", "notLessThan", "notGreaterThan"]);
export const STRING = /* @__PURE__ */ termsIn("string", [
	"matches",
	"scrape",
	"startsWith",
	"endsWith",
	"concatenation",
	"greaterThan",
	"lessThan",
	"notLessThan",
	"notGreaterThan",
]);
/** The N3 proof vocabulary, which EYE writes where it explains what it derived. */
export const REASON = /* @__PURE__ */ termsIn("r", ["Proof", "Inference", "Extraction", "gives", "evidence", "rule", "component", "because", "source"]);
/** ZCAP-LD's terms, as a capability's JSON-LD expands them. */
export const SEC = /* @__PURE__ */ termsIn("sec", ["allowedAction", "invocationTarget", "controller", "expires", "parentCapability"]);
/** ODRL 2.2's terms a capability's meaning reads. */
export const ODRL = /* @__PURE__ */ termsIn("odrl", ["action", "target", "assignee", "assigner", "constraint", "leftOperand", "operator", "rightOperand", "lt", "dateTime"]);

/** The compact IRIs served JSON-LD names, `prefix:name`, each a const of its own, so a bundle holds only those its code reads,
 *  each once. */
export const RDF_STATEMENT = "rdf:Statement";
export const RDF_PROPERTY = "rdf:Property";
export const RDFS_CLASS = "rdfs:Class";
export const XSD_INTEGER = "xsd:integer";
export const XSD_DECIMAL = "xsd:decimal";
export const XSD_DOUBLE = "xsd:double";
export const XSD_BOOLEAN = "xsd:boolean";
export const XSD_DATE = "xsd:date";
export const XSD_DATE_TIME = "xsd:dateTime";
export const PROV_ACTIVITY = "prov:Activity";
export const PROV_AGENT = "prov:Agent";
export const PROV_ENTITY = "prov:Entity";
export const SOSA_OBSERVATION = "sosa:Observation";
