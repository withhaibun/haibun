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
	prov: "http://www.w3.org/ns/prov#",
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

export const RDF = /* @__PURE__ */ termsIn("rdf", ["type", "Property", "first", "rest", "nil", "JSON"]);
export const RDFS = /* @__PURE__ */ termsIn("rdfs", ["Class", "subClassOf", "subPropertyOf", "domain", "range", "comment"]);
export const OWL = /* @__PURE__ */ termsIn("owl", [
	"Class",
	"ObjectProperty",
	"unionOf",
	"sameAs",
	"equivalentProperty",
	"disjointWith",
	"InverseFunctionalProperty",
	"Axiom",
	"annotatedSource",
	"annotatedProperty",
	"annotatedTarget",
]);
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
export const RDF_STATEMENT = "rdf:Statement" as const;
export const RDF_PROPERTY = "rdf:Property" as const;
export const RDFS_CLASS = "rdfs:Class" as const;
/** A set of values, which a registered domain is. */
export const RDFS_DATATYPE = "rdfs:Datatype" as const;
export const XSD_STRING = "xsd:string" as const;
export const XSD_INTEGER = "xsd:integer" as const;
export const XSD_DECIMAL = "xsd:decimal" as const;
export const XSD_DOUBLE = "xsd:double" as const;
export const XSD_BOOLEAN = "xsd:boolean" as const;
export const XSD_DATE = "xsd:date" as const;
export const XSD_DATE_TIME = "xsd:dateTime" as const;
export const PROV_ACTIVITY = "prov:Activity" as const;
export const PROV_AGENT = "prov:Agent" as const;
export const PROV_ENTITY = "prov:Entity" as const;
export const PROV_PLAN = "prov:Plan" as const;
export const FOAF_DOCUMENT = "foaf:Document" as const;
/** A mailbox, which FOAF declares an inverse functional property: two agents with one mailbox are one agent. */
export const FOAF_MBOX = "foaf:mbox" as const;
export const SOSA_OBSERVATION = "sosa:Observation" as const;
export const AS_APPLICATION = "as:Application" as const;
export const AS_ATTACHMENT = "as:attachment" as const;
export const AS_ATTRIBUTED_TO = "as:attributedTo" as const;
export const AS_AUDIENCE = "as:audience" as const;
export const AS_COLLECTION = "as:Collection" as const;
export const AS_CONTENT = "as:content" as const;
export const AS_CONTEXT = "as:context" as const;
export const AS_DOCUMENT = "as:Document" as const;
export const AS_IN_REPLY_TO = "as:inReplyTo" as const;
export const AS_MEDIA_TYPE = "as:mediaType" as const;
export const AS_NAME = "as:name" as const;
export const AS_NOTE = "as:Note" as const;
export const AS_OBJECT = "as:object" as const;
export const AS_ORDERED_COLLECTION = "as:OrderedCollection" as const;
export const AS_PAGE = "as:Page" as const;
export const AS_PUBLISHED = "as:published" as const;
export const AS_SERVICE = "as:Service" as const;
export const AS_TAG = "as:tag" as const;
export const AS_TARGET = "as:target" as const;
export const AS_TO = "as:to" as const;
export const AS_UPDATED = "as:updated" as const;
export const AS_URL = "as:url" as const;
export const CITO_CITES = "cito:cites" as const;
export const CITO_CITES_AS_EVIDENCE = "cito:citesAsEvidence" as const;
export const CRED_BINDING = "cred:Binding" as const;
export const CRED_CREDENTIAL_FORMAT = "cred:CredentialFormat" as const;
export const CRED_CREDENTIAL_STATUS = "cred:credentialStatus" as const;
export const CRED_CREDENTIAL_SUBJECT = "cred:credentialSubject" as const;
export const CRED_HOLDER = "cred:holder" as const;
export const CRED_ISSUER = "cred:issuer" as const;
export const CRED_READ_BY = "cred:readBy" as const;
export const CRED_THING = "cred:Thing" as const;
export const CRED_TOKEN_STATUS_LIST = "cred:TokenStatusList" as const;
export const CRED_VALID_FROM = "cred:validFrom" as const;
export const CRED_VALID_UNTIL = "cred:validUntil" as const;
export const CRED_VERIFIABLE_CREDENTIAL = "cred:VerifiableCredential" as const;
export const CRED_VERIFIABLE_CREDENTIAL_PROPERTY = "cred:verifiableCredential" as const;
export const CRED_VERIFIABLE_PRESENTATION = "cred:VerifiablePresentation" as const;
export const DCTERMS_CONFORMS_TO = "dcterms:conformsTo" as const;
export const DCTERMS_DESCRIPTION = "dcterms:description" as const;
export const DCTERMS_IDENTIFIER = "dcterms:identifier" as const;
export const DCTERMS_REPLACES = "dcterms:replaces" as const;
export const DCTERMS_REQUIRES = "dcterms:requires" as const;
export const EARL_ASSERTED_BY = "earl:assertedBy" as const;
export const EARL_ASSERTION = "earl:Assertion" as const;
export const EARL_ASSERTOR = "earl:Assertor" as const;
export const EARL_INFO = "earl:info" as const;
export const EARL_MODE_PROPERTY = "earl:mode" as const;
export const EARL_OUTCOME_PROPERTY = "earl:outcome" as const;
export const EARL_POINTER = "earl:pointer" as const;
export const EARL_RESULT = "earl:result" as const;
export const EARL_SUBJECT = "earl:subject" as const;
export const EARL_TEST = "earl:test" as const;
export const EARL_TEST_CASE = "earl:TestCase" as const;
export const EARL_TEST_RESULT = "earl:TestResult" as const;
export const EARL_TEST_SUBJECT = "earl:TestSubject" as const;
export const FOAF_PERSON = "foaf:Person" as const;
export const HTTP_REQUEST = "http:Request" as const;
export const OA_ANNOTATION = "oa:Annotation" as const;
export const OA_EXACT = "oa:exact" as const;
export const OA_FRAGMENT_SELECTOR = "oa:FragmentSelector" as const;
export const OA_HAS_BODY = "oa:hasBody" as const;
export const OA_HAS_SELECTOR = "oa:hasSelector" as const;
export const OA_HAS_SOURCE = "oa:hasSource" as const;
export const OA_HAS_TARGET = "oa:hasTarget" as const;
export const OA_PREFIX = "oa:prefix" as const;
export const OA_SPECIFIC_RESOURCE = "oa:SpecificResource" as const;
export const OA_SUFFIX = "oa:suffix" as const;
export const OA_TEXT_QUOTE_SELECTOR = "oa:TextQuoteSelector" as const;
export const OWL_DISJOINT_WITH = "owl:disjointWith" as const;
export const PROV_ENDED_AT_TIME = "prov:endedAtTime" as const;
export const PROV_GENERATED = "prov:generated" as const;
export const PROV_GENERATED_AT_TIME = "prov:generatedAtTime" as const;
export const PROV_INVALIDATED = "prov:invalidated" as const;
export const PROV_STARTED_AT_TIME = "prov:startedAtTime" as const;
export const PROV_USED = "prov:used" as const;
export const PROV_WAS_ASSOCIATED_WITH = "prov:wasAssociatedWith" as const;
export const PROV_WAS_ATTRIBUTED_TO = "prov:wasAttributedTo" as const;
export const PROV_WAS_DERIVED_FROM = "prov:wasDerivedFrom" as const;
export const PROV_WAS_ENDED_BY = "prov:wasEndedBy" as const;
export const PROV_WAS_GENERATED_BY = "prov:wasGeneratedBy" as const;
export const PROV_WAS_INFORMED_BY = "prov:wasInformedBy" as const;
export const PROV_WAS_STARTED_BY = "prov:wasStartedBy" as const;
export const RDF_VALUE = "rdf:value" as const;
export const RDFS_COMMENT = "rdfs:comment" as const;
export const RDFS_IS_DEFINED_BY = "rdfs:isDefinedBy" as const;
export const RDFS_LABEL = "rdfs:label" as const;
export const RDFS_SUB_CLASS_OF = "rdfs:subClassOf" as const;
export const RDFS_SUB_PROPERTY_OF = "rdfs:subPropertyOf" as const;
export const SCHEMA_ABOUT = "schema:about" as const;
export const SCHEMA_ACTION = "schema:Action" as const;
export const SCHEMA_ACTION_STATUS = "schema:actionStatus" as const;
export const SCHEMA_ACTIVE_ACTION_STATUS = "schema:ActiveActionStatus" as const;
export const SCHEMA_AGENT = "schema:agent" as const;
export const SCHEMA_AUTHOR = "schema:author" as const;
export const SCHEMA_DESCRIPTION = "schema:description" as const;
export const SCHEMA_DIGITAL_DOCUMENT = "schema:DigitalDocument" as const;
export const SCHEMA_DOMAIN_INCLUDES = "schema:domainIncludes" as const;
export const SCHEMA_DURATION = "schema:duration" as const;
export const SCHEMA_EMAIL_MESSAGE = "schema:EmailMessage" as const;
export const SCHEMA_ENCODING = "schema:encoding" as const;
export const SCHEMA_END_TIME = "schema:endTime" as const;
export const SCHEMA_ERROR = "schema:error" as const;
export const SCHEMA_HOW_TO = "schema:HowTo" as const;
export const SCHEMA_IS_PART_OF = "schema:isPartOf" as const;
export const SCHEMA_IS_RELATED_TO = "schema:isRelatedTo" as const;
export const SCHEMA_MENTIONS = "schema:mentions" as const;
export const SCHEMA_NAME = "schema:name" as const;
export const SCHEMA_OBJECT = "schema:object" as const;
export const SCHEMA_PERSON = "schema:Person" as const;
export const SCHEMA_RANGE_INCLUDES = "schema:rangeIncludes" as const;
export const SCHEMA_REPLACEE = "schema:replacee" as const;
export const SCHEMA_REPLACEMENT = "schema:replacement" as const;
export const SCHEMA_RESULT = "schema:result" as const;
export const SCHEMA_SAME_AS = "schema:sameAs" as const;
export const SCHEMA_SHA256 = "schema:sha256" as const;
export const SCHEMA_START_TIME = "schema:startTime" as const;
export const SCHEMA_STEP = "schema:step" as const;
export const SCHEMA_THING = "schema:Thing" as const;
export const SCHEMA_WEB_PAGE = "schema:WebPage" as const;
export const SEC_ALLOWED_ACTION = "sec:allowedAction" as const;
export const SEC_CAPABILITY = "sec:Capability" as const;
export const SEC_CAPABILITY_ACTION = "sec:capabilityAction" as const;
export const SEC_CAPABILITY_INVOCATION = "sec:CapabilityInvocation" as const;
export const SEC_CAPABILITY_PROPERTY = "sec:capability" as const;
export const SEC_CONTROLLER = "sec:Controller" as const;
export const SEC_CONTROLLER_PROPERTY = "sec:controller" as const;
export const SEC_DATA_INTEGRITY_PROOF = "sec:DataIntegrityProof" as const;
export const SEC_EXPIRATION = "sec:expiration" as const;
export const SEC_NONCE = "sec:nonce" as const;
export const SEC_PROOF = "sec:proof" as const;
export const SEC_PROOF_VALUE = "sec:proofValue" as const;
export const SEC_PUBLIC_KEY_MULTIBASE = "sec:publicKeyMultibase" as const;
export const SEC_REVOKED = "sec:revoked" as const;
export const SEC_VERIFICATION_METHOD = "sec:VerificationMethod" as const;
export const SKOS_BROADER = "skos:broader" as const;
export const SKOS_CONCEPT = "skos:Concept" as const;
export const SKOS_EXACT_MATCH = "skos:exactMatch" as const;
export const SKOS_PREF_LABEL = "skos:prefLabel" as const;
export const SOSA_HAS_RESULT = "sosa:hasResult" as const;
export const SOSA_MADE_BY_SENSOR = "sosa:madeBySensor" as const;
export const SOSA_OBSERVED_PROPERTY = "sosa:observedProperty" as const;
export const SOSA_PHENOMENON_TIME = "sosa:phenomenonTime" as const;
export const SOSA_RESULT_TIME = "sosa:resultTime" as const;
export const STRING_TEST_VALUE = "string:test-value" as const;
export const XSD_MAX_EXCLUSIVE = "xsd:maxExclusive" as const;
export const XSD_MAX_INCLUSIVE = "xsd:maxInclusive" as const;
export const XSD_MIN_EXCLUSIVE = "xsd:minExclusive" as const;
export const XSD_MIN_INCLUSIVE = "xsd:minInclusive" as const;
export const XSD_PATTERN = "xsd:pattern" as const;
export const DID_SERVICE = "did:service" as const;
export const DID_DID_DOCUMENT = "did:DIDDocument" as const;
export const DID_VERIFICATION_METHOD = "did:verificationMethod" as const;
