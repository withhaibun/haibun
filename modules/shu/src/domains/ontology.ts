/** The schema's two types, and how a term outside a prefixed vocabulary is named. */
import { CLASS_LABEL, PROPERTY_LABEL } from "@haibun/core/lib/domains/resources.js";

/** The two types a schema's graph draws, Class and Property. */
export const SCHEMA_TYPES: readonly string[] = [CLASS_LABEL, PROPERTY_LABEL];

/** The vocabulary of a term whose IRI isn't a CURIE and isn't haibun's, which a view groups under this mark. */
export const UNPREFIXED_VOCABULARY = "?";
