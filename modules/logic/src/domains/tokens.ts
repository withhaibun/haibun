/**
 * What a token of a formula's Unicode rendering is: a predicate, a constant or a function, a variable, or a symbol. Declared
 * apart from the logic engine's schemas, so a page that renders a formula's tokens reads the roles without them.
 */
export const TOKEN_ROLE = { predicate: "predicate", constant: "constant", variable: "variable", symbol: "symbol" } as const;
export type TTokenRole = (typeof TOKEN_ROLE)[keyof typeof TOKEN_ROLE];
