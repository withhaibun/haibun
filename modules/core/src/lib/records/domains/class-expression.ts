/**
 * A class expression's parts, the one filter language of records: a named class, `and`, `or`, `{property} some {expression}`,
 * `{property} value {individual}` and `{property} value {literal}`, each property also as `inverse {property}`, and a datatype
 * restriction with OWL 2's facets. Writes an expression in Manchester syntax (W3C OWL 2 Manchester Syntax), which the
 * instance reads, so a page states an expression without reading one.
 */
import { itemAt } from "../../domains/item-at.js";
import type { TSearchCondition } from "../../steps/domains/quad-types.js";
import { XSD_BOOLEAN, XSD_DATE, XSD_DATE_TIME, XSD_DECIMAL, XSD_INTEGER, XSD_STRING } from "../../domains/vocabularies.js";

/** A property as a restriction names it, read in its own direction or inverted. */
export type TRestricted = { property: string; inverse: boolean };
/** A literal as an expression writes it: its lexical form, and its datatype where it isn't a string. */
export type TLiteral = { lexical: string; datatype?: string };
/** OWL 2's facets a datatype restriction states: the comparisons of an ordered datatype, and a string's pattern. */
export const FACET = { atLeast: ">=", above: ">", atMost: "<=", below: "<", pattern: "pattern" } as const;
export type TFacet = (typeof FACET)[keyof typeof FACET];
/** A datatype restriction: the datatype, and each facet with its literal. */
export type TDataRange = { datatype: string; facets: { facet: TFacet; literal: TLiteral }[] };
/** A class expression as its parts. */
export type TClassExpression =
	| { named: string }
	| { and: TClassExpression[] }
	| { or: TClassExpression[] }
	| (TRestricted & { some: TClassExpression })
	| (TRestricted & { value: string })
	| (TRestricted & { literal: TLiteral })
	| (TRestricted & { range: TDataRange });

/** The prefix of a datatype an expression names. */
export const XSD_PREFIX = "xsd:";
/** The datatypes a restriction or a literal names. */
export const DATATYPE = { string: XSD_STRING, dateTime: XSD_DATE_TIME, date: XSD_DATE, integer: XSD_INTEGER, decimal: XSD_DECIMAL, boolean: XSD_BOOLEAN } as const;
/** The keywords of Manchester syntax an expression writes. */
export const KEYWORD = { and: "and", or: "or", some: "some", value: "value", inverse: "inverse" } as const;

/** A literal as Manchester syntax, DL notation and a reading write it: quoted, with its datatype where it isn't a string. */
export const literalText = ({ lexical, datatype }: TLiteral): string => `${JSON.stringify(lexical)}${datatype === undefined ? "" : `^^${datatype}`}`;

/** A restriction of `property` to the literal `lexical`, of `datatype` where it isn't a string. */
export const hasValue = (property: string, lexical: string, datatype?: string): TClassExpression => ({
	property,
	inverse: false,
	literal: datatype === undefined ? { lexical } : { lexical, datatype },
});
/** A restriction of `property` to a value of `datatype` that satisfies each facet. */
export const rangeOf = (property: string, datatype: string, facets: TDataRange["facets"]): TClassExpression => ({ property, inverse: false, range: { datatype, facets } });
/** The members of every one of `parts`, or the one part where there is one. */
export const allOf = (parts: readonly TClassExpression[]): TClassExpression => (parts.length === 1 ? itemAt(parts, 0) : { and: [...parts] });
/** The members of any one of `parts`, or the one part where there is one. */
export const anyOf = (parts: readonly TClassExpression[]): TClassExpression => (parts.length === 1 ? itemAt(parts, 0) : { or: [...parts] });

/** Returns an expression in Manchester syntax, with parentheses around a nested `and` or `or`. */
export function manchesterOf(expression: TClassExpression): string {
	const nested = (part: TClassExpression): string => ("and" in part || "or" in part ? `(${manchesterOf(part)})` : manchesterOf(part));
	if ("named" in expression) return expression.named;
	if ("and" in expression) return expression.and.map(nested).join(` ${KEYWORD.and} `);
	if ("or" in expression) return expression.or.map(nested).join(` ${KEYWORD.or} `);
	const role = expression.inverse ? `${KEYWORD.inverse} ${expression.property}` : expression.property;
	if ("some" in expression) return `${role} ${KEYWORD.some} ${nested(expression.some)}`;
	if ("range" in expression) {
		const { datatype, facets } = expression.range;
		return `${role} ${KEYWORD.some} ${datatype}${facets.length === 0 ? "" : `[${facets.map(({ facet, literal }) => `${facet} ${literalText(literal)}`).join(", ")}]`}`;
	}
	return `${role} ${KEYWORD.value} ${"literal" in expression ? literalText(expression.literal) : expression.value}`;
}

/** The datatype an ordering facet compares a lexical form by: a number, a time or a date. Text isn't ordered in OWL 2. */
function orderedDatatypeOf(lexical: string): string | undefined {
	if (/^-?\d+$/.test(lexical)) return DATATYPE.integer;
	if (/^-?\d+\.\d+$/.test(lexical)) return DATATYPE.decimal;
	if (/^\d{4}-\d{2}-\d{2}T/.test(lexical)) return DATATYPE.dateTime;
	return /^\d{4}-\d{2}-\d{2}$/.test(lexical) ? DATATYPE.date : undefined;
}

/** The facet of each ordering comparison of a store's filter. */
const FACET_OF = { gte: FACET.atLeast, gt: FACET.above, lte: FACET.atMost, lt: FACET.below } as const;

/** Returns the expression a store's filter compiles from, or undefined where a comparison orders text, which OWL 2 doesn't. */
export function conditionExpression({ predicate, operator, value, value2, values }: TSearchCondition): TClassExpression | undefined {
	if (operator === "eq") return hasValue(predicate, value);
	if (operator === "in") return anyOf((values === undefined ? [value] : values).map((each) => hasValue(predicate, each)));
	if (operator === "contains") return rangeOf(predicate, DATATYPE.string, [{ facet: FACET.pattern, literal: { lexical: value } }]);
	const bounds =
		operator === "between"
			? [
					{ facet: FACET.atLeast, lexical: value },
					{ facet: FACET.atMost, lexical: value2 === undefined ? value : value2 },
				]
			: [{ facet: FACET_OF[operator], lexical: value }];
	const datatype = orderedDatatypeOf(value);
	if (datatype === undefined) return undefined;
	return rangeOf(
		predicate,
		datatype,
		bounds.map(({ facet, lexical }) => ({ facet, literal: { lexical } })),
	);
}
