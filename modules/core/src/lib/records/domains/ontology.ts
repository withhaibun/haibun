/**
 * Declares the ontology's two types. A Class record describes a declared type or a class one names as its superclass. A
 * Property record describes a link relation, or a term that a type's standard context declares. Core derives
 * both from the declarations, so each type states `heldBy: declarations`.
 */
import { RDFS_CLASS, RDF_PROPERTY } from "../../domains/vocabularies.js";
import { z } from "zod";
import { Access, CLASS_LABEL, DOMAIN_PERSISTED_TYPE, HELD_BY, LinkRelations, PROPERTY_LABEL, PersistedVertexSchema, type TDomainDefinition } from "../../domains/resources.js";

const CLASS_DOMAIN = "ontology-class";
const PROPERTY_DOMAIN = "ontology-property";
/** The term that relates a Class or a Property record to the IRI of the term it describes. */
const EXACT_MATCH = "skos:exactMatch";

/** The fields and relations of the ontology's records. The projection that writes them and every view that reads them use these names. */
export const ONTOLOGY_FIELD = {
	name: "name",
	uri: "uri",
	abstract: "abstract",
	classIri: "classIri",
	subClassOf: "subClassOf",
	subPropertyOf: "subPropertyOf",
	/** The classes that declare a property, whose union is its domain. */
	domain: "domain",
	/** The classes an edge reaches, whose union is its range. With `domain` it relates each property to the classes it connects. */
	range: "range",
	/** The field a property names within its type, where the property is a type's field or edge. */
	field: "field",
	/** Whether a type's data holds a property. A term of a standard vocabulary that a type doesn't model states false. */
	inData: "inData",
	/** A class's designation: agent, activity, observation or artifact, from its subClassOf chain to a PROV or SOSA class. */
	category: "category",
	/** What a declared type's records are, from the declaration that states the type. */
	description: "description",
	generatedAtTime: "generatedAtTime",
	accessLevel: "accessLevel",
} as const;

export const ClassSchema = PersistedVertexSchema.extend({
	[ONTOLOGY_FIELD.name]: z.string(),
	[ONTOLOGY_FIELD.classIri]: z.string().optional(),
	[ONTOLOGY_FIELD.category]: z.string(),
	// A class a type declares carries its declaration's description; a class a type names as its superclass from a standard
	// vocabulary isn't described by a declaration.
	[ONTOLOGY_FIELD.description]: z.string().min(1).optional(),
	[ONTOLOGY_FIELD.generatedAtTime]: z.string(),
});

export const PropertySchema = PersistedVertexSchema.extend({
	[ONTOLOGY_FIELD.name]: z.string(),
	[ONTOLOGY_FIELD.uri]: z.string().optional(),
	[ONTOLOGY_FIELD.abstract]: z.boolean().optional(),
	[ONTOLOGY_FIELD.field]: z.string().optional(),
	[ONTOLOGY_FIELD.inData]: z.boolean(),
	[ONTOLOGY_FIELD.generatedAtTime]: z.string(),
});

export const classDomainDefinition: TDomainDefinition = {
	selectors: [CLASS_DOMAIN],
	schema: ClassSchema,
	description: "A type the declarations state, or a class a type names as its superclass. It links its superclasses and the records of the type it names.",
	topology: {
		persistedAs: CLASS_LABEL,
		type: RDFS_CLASS,
		id: ONTOLOGY_FIELD.name,
		heldBy: HELD_BY.declarations,
		accessLevel: Access.public,
		displayLabel: ONTOLOGY_FIELD.name,
		properties: {
			[ONTOLOGY_FIELD.name]: LinkRelations.IDENTIFIER.rel,
			[ONTOLOGY_FIELD.classIri]: { rel: LinkRelations.TAG.rel, iri: EXACT_MATCH },
			// Grouped-as, so a filter reads the classes of one designation.
			[ONTOLOGY_FIELD.category]: LinkRelations.CONTEXT.rel,
			[ONTOLOGY_FIELD.description]: LinkRelations.DESCRIPTION.rel,
			[ONTOLOGY_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[ONTOLOGY_FIELD.accessLevel]: LinkRelations.ACCESS_LEVEL.rel,
		},
		edges: { [ONTOLOGY_FIELD.subClassOf]: { rel: LinkRelations.SUB_CLASS_OF.rel, range: CLASS_LABEL } },
		// A Class record's name is a type's name, so the record describes the records of that type.
		ranges: { [ONTOLOGY_FIELD.name]: DOMAIN_PERSISTED_TYPE },
	},
};

export const propertyDomainDefinition: TDomainDefinition = {
	selectors: [PROPERTY_DOMAIN],
	schema: PropertySchema,
	description: "A link relation, a type's field, or a standard vocabulary's term. It links its superproperties and the classes it connects.",
	topology: {
		persistedAs: PROPERTY_LABEL,
		type: RDF_PROPERTY,
		id: ONTOLOGY_FIELD.name,
		heldBy: HELD_BY.declarations,
		accessLevel: Access.public,
		displayLabel: ONTOLOGY_FIELD.name,
		properties: {
			[ONTOLOGY_FIELD.name]: LinkRelations.IDENTIFIER.rel,
			[ONTOLOGY_FIELD.uri]: { rel: LinkRelations.TAG.rel, iri: EXACT_MATCH },
			[ONTOLOGY_FIELD.abstract]: LinkRelations.TAG.rel,
			[ONTOLOGY_FIELD.field]: LinkRelations.TAG.rel,
			[ONTOLOGY_FIELD.inData]: LinkRelations.TAG.rel,
			[ONTOLOGY_FIELD.generatedAtTime]: LinkRelations.GENERATED_AT_TIME.rel,
			[ONTOLOGY_FIELD.accessLevel]: LinkRelations.ACCESS_LEVEL.rel,
		},
		edges: {
			[ONTOLOGY_FIELD.subPropertyOf]: { rel: LinkRelations.SUB_PROPERTY_OF.rel, range: PROPERTY_LABEL },
			[ONTOLOGY_FIELD.domain]: { rel: LinkRelations.DOMAIN.rel, range: CLASS_LABEL },
			[ONTOLOGY_FIELD.range]: { rel: LinkRelations.RANGE.rel, range: CLASS_LABEL },
		},
	},
};
