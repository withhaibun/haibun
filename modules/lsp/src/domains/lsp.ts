/**
 * What the language server paints, holds and reports: the token types an editor's legend lists, a painted span, a step
 * placed on its line, the status of a document's workspace, and the tool call the editor makes.
 */
import type { TFeatureStep } from "@haibun/core/lib/astepper.js";

/** The token types, in the order of the editor's legend. Each token encodes its type as its index in this order. */
export const TOKEN_TYPES = ["keyword", "function", "parameter", "string", "number", "comment"] as const;
export type TTokenType = (typeof TOKEN_TYPES)[number];

/** One painted span: its line, where it starts, how long it is, and what it is. */
export type TToken = { line: number; char: number; length: number; type: TTokenType };

/** A step a document resolves for a line, with its column range where the document states one, as a kireji string does. */
export type TPlacedStep = { step: TFeatureStep; startOffset?: number; length?: number };

/** A document's workspace as the editor shows it: its base, its config, how many backgrounds it resolves against, and how
 *  many features it holds, where they were counted. */
export type TWorkspaceStatus = { base: string; config: string | null; backgroundCount: number; featureCount?: number };

/** The base a document outside a workspace reports. */
export const OUTSIDE_A_WORKSPACE = "Default";

/** A tool call the editor makes: the tool's name and its arguments. */
export type TExecuteToolParams = { name: string; arguments: Record<string, unknown> };

/** The source each diagnostic names. */
export const DIAGNOSTIC_SOURCE = "haibun";

/** The type names that mark a TypeScript document as a kireji feature. */
export const KIREJI_TYPE_NAMES = ["TKirejiStep", "TKirejiExport"] as const;
