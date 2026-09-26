import { describe, it, expect } from "vitest";
import { BAR_MODES } from "./schemas.js";
import { SLASH_COMMANDS, STOP_COMMAND, commandList, readSlashCommand } from "./slash-command.js";

describe("a slash command in an input line", () => {
	it("names each mode the bar's schema declares, and stop", () => {
		expect(SLASH_COMMANDS).toEqual([...BAR_MODES, STOP_COMMAND]);
		expect(commandList()).toBe("/search, /ask, /step, /stop");
	});

	it("reads a mode and the rest of the line, keeping the rest's own spacing", () => {
		expect(readSlashCommand("/ask what is  this?")).toEqual({ kind: "mode", mode: "ask", rest: "what is  this?" });
		expect(readSlashCommand("/step")).toEqual({ kind: "mode", mode: "step", rest: "" });
	});

	it("reads stop, a double slash as the line with one slash, and an unknown command by its name", () => {
		expect(readSlashCommand("/stop")).toEqual({ kind: "stop" });
		expect(readSlashCommand("//etc/hosts")).toEqual({ kind: "literal", text: "/etc/hosts" });
		expect(readSlashCommand("/nope now")).toEqual({ kind: "unknown", name: "nope" });
	});

	it("doesn't read a line that doesn't open with a slash", () => {
		expect(readSlashCommand("ask /step")).toBeUndefined();
	});
});
