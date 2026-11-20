/**
 * The help a command prints: each option or word it takes with what that does, as rows of aligned columns.
 */

/** An option or a word of a command, as its usage writes it, and what it does. */
export type THelpEntry = { readonly name: string; readonly does: string };

/** The name the command line is run by, as its help and its remedies write it. */
export const CLI = "haibun-cli";

/** Returns the rows as indented lines whose cells start at the same column. */
export function columns(rows: readonly (readonly string[])[]): string[] {
	const width = (at: number): number => Math.max(...rows.flatMap((row) => (at < row.length ? [String(row[at]).length] : [])));
	return rows.map((row) => `  ${row.map((cell, at) => cell.padEnd(width(at))).join("  ")}`.trimEnd());
}

/** Returns the entries as a usage's bracketed terms. */
export const terms = (entries: readonly THelpEntry[]): string => entries.map(({ name }) => `[${name}]`).join(" ");
