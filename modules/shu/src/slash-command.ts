/**
 * A slash command in an input line of the actions bar. A leading slash names one of the bar's modes, or `stop`, and the
 * rest of the line is entered in that mode's input line. A leading double slash enters the line with one slash, as text.
 */
import { BAR_MODES } from "./schemas.js";

const SLASH = "/";
/** The command that stops the running turn, as the ask pane's Stop control does. */
export const STOP_COMMAND = "stop";
export type TBarMode = (typeof BAR_MODES)[number];

/** The commands a leading slash names: each mode the bar's schema declares, and stop. */
export const SLASH_COMMANDS: readonly string[] = [...BAR_MODES, STOP_COMMAND];

export type TSlashCommand = { kind: "mode"; mode: TBarMode; rest: string } | { kind: "stop" } | { kind: "literal"; text: string } | { kind: "unknown"; name: string };

/** An input line of a mode, which enters text as the reader typing it does. */
export type TInputLine = { enter(text: string): void | Promise<void> };

const isBarMode = (name: string): name is TBarMode => (BAR_MODES as readonly string[]).includes(name);

/** Reads the command a line opens with. Returns undefined for a line that doesn't open with a slash. */
export function readSlashCommand(line: string): TSlashCommand | undefined {
	if (!line.startsWith(SLASH)) return undefined;
	if (line.startsWith(SLASH + SLASH)) return { kind: "literal", text: line.slice(SLASH.length) };
	const [, name, rest] = /^\/(\S*)\s*([\s\S]*)$/.exec(line) ?? ["", "", ""];
	if (isBarMode(name)) return { kind: "mode", mode: name, rest };
	return name === STOP_COMMAND ? { kind: "stop" } : { kind: "unknown", name };
}

/** The commands, as a refusal of an unknown one lists them. */
export const commandList = (): string => SLASH_COMMANDS.map((command) => `${SLASH}${command}`).join(", ");
