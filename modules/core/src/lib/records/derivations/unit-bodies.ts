/**
 * Moves a unit's content fields into the Bodies its records own. A record's content fields of one kind are the forms of one Body,
 * named by `bodyIdOf` from the record's id, and the record owns it through `hasBody`. A store writes the Bodies before the records
 * that own them. The core quad store and the graph store call it on each unit they write. Both stores then hold a record's content
 * in the same Bodies.
 */
import { BODY_DIGEST, BODY_LABEL, HAS_BODY_EDGE, LinkRelations } from "../../domains/resources.js";
import { bodyDigestOf, bodyIdOf, bodyOfForms, formsByKind } from "./bodies.js";
import { edgeWriteOf, type TPartDeclaration } from "./edge-declarations.js";
import type { TPart, TUnitParts } from "./unit-parts.js";
import { BodyTextSchema } from "../domains/body.js";

/** Returns the Bodies of a part, then the part. Each Body holds the forms of one kind that the part states as text. The part
 *  returned doesn't hold those content fields, and holds an edge to each Body. A Body states the level its record states, and its
 *  text is the form `bodyOfForms` chooses. A content field that doesn't hold text stays a field. */
function withBodiesOf(part: TPart, declaration: TPartDeclaration | undefined): TPart[] {
	if (part.label === BODY_LABEL) return [withDigest(part)];
	if (declaration?.contents === undefined) return [part];
	const level = part.fields[LinkRelations.ACCESS_LEVEL.rel];
	const fields: Record<string, unknown> = { ...part.fields };
	const bodies = [...formsByKind(part.label, declaration.contents)].flatMap(([kind, declared]): TPart[] => {
		const stated = declared.filter(({ field }) => typeof fields[field] === "string" && fields[field] !== "");
		if (stated.length === 0) return [];
		const forms = stated.map(({ field, mediaType }) => ({ mediaType, content: String(fields[field]) }));
		for (const { field } of stated) delete fields[field];
		const text = bodyOfForms(forms, `${part.label} "${part.id}"'s Body "${kind}"`);
		const body = { ...text, [BODY_DIGEST]: bodyDigestOf(text), ...(level === undefined ? {} : { [LinkRelations.ACCESS_LEVEL.rel]: level }) };
		const contentOf = { label: part.label, id: part.id, changed: stated.map(({ field }) => field) };
		return [{ label: BODY_LABEL, id: bodyIdOf(part.id, kind, declared), fields: body, edges: [], contentOf }];
	});
	if (bodies.length === 0) return [part];
	const edges = bodies.map(({ id }) => ({ rel: HAS_BODY_EDGE, label: BODY_LABEL, id, ...edgeWriteOf({ reference: false, functional: false }) }));
	return [...bodies, { ...part, fields, edges: [...part.edges, ...edges] }];
}

/** The fields of a Body that state its forms. */
const BODY_FORM_FIELDS = ["content", "mediaType", "representations"] as const;

/** Returns a Body written as a record of its own with the digest of the forms it states. A write of its level alone leaves its
 *  digest as the store holds it, and a write that states a form states its text and its media type, from which its digest is
 *  drawn. */
function withDigest(part: TPart): TPart {
	if (!BODY_FORM_FIELDS.some((field) => part.fields[field] !== undefined)) return part;
	const parsed = BodyTextSchema.safeParse(part.fields);
	if (!parsed.success)
		throw new Error(
			`the Body "${part.id}" is written with some of its forms and without its text and its media type, so its digest isn't drawn from them. Write the Body's text and media type with its forms`,
		);
	return { ...part, fields: { ...part.fields, [BODY_DIGEST]: bodyDigestOf(parsed.data) } };
}

/** Returns a unit whose records' content fields are Bodies they own, each written before the record that owns it. */
export const withBodies = (unit: TUnitParts, declarationOf: (label: string) => TPartDeclaration | undefined): TUnitParts => ({
	...unit,
	parts: unit.parts.flatMap((part) => withBodiesOf(part, declarationOf(part.label))),
});

/** Returns parts whose Bodies each state the level of the record that owns them, where a Body doesn't state its own: the level
 *  `levelOf` reads of the owner in the store that writes the parts. A reader reads a record's content at the record's level, and
 *  a Body written at that level doesn't need a second write of its level. */
export function withOwnerLevels<T extends { part: TPart }>(parts: readonly T[], levelOf: (owner: T) => unknown): T[] {
	const owners = new Map(parts.map((held) => [`${held.part.label} ${held.part.id}`, held]));
	return parts.map((held) => {
		const { contentOf, fields } = held.part;
		const owner = contentOf === undefined ? undefined : owners.get(`${contentOf.label} ${contentOf.id}`);
		if (owner === undefined || fields[LinkRelations.ACCESS_LEVEL.rel] !== undefined) return held;
		return { ...held, part: { ...held.part, fields: { ...fields, [LinkRelations.ACCESS_LEVEL.rel]: levelOf(owner) } } };
	});
}
