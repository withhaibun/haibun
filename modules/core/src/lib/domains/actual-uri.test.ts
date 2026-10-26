import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_DEST } from "./protocol.js";
import { actualURI } from "./actual-uri.js";

describe("the address of a file a run reports", () => {
	it("is from the directory where a recording's container mounts the project, where the option names it, and otherwise from the working directory", () => {
		expect(actualURI({ DEST: DEFAULT_DEST }, "capture/report.html")).toEqual(pathToFileURL(resolve("capture/report.html")));
		expect(actualURI({ DEST: DEFAULT_DEST, HOST_PROJECT_DIR: "/home/person/project" }, "capture/report.html")).toEqual(pathToFileURL("/home/person/project/capture/report.html"));
	});
});
