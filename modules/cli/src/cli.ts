#!/usr/bin/env node

import sourceMapSupport from "source-map-support";
import { runCli } from "./pipelines/run-cli.js";
import { cliPorts } from "./root.js";

sourceMapSupport.install();

process.on("unhandledRejection", (err) => {
	console.error("cli Unhandled Rejection:", err);
	console.error(err instanceof Error ? err.stack : err);
	process.exitCode = 1;
});

runCli(process.argv.slice(2), process.env, cliPorts()).catch((err) => {
	console.error("cli Error:", err);
	console.error(err instanceof Error ? err.stack : err);
	process.exitCode = 1;
});
