#!/usr/bin/env node

import { TAnyFixme } from "@haibun/core/build/lib/fixme.js";
import { parseVCaptureArgs, runContainer } from "./vcapture-lib.js";

process.on('unhandledRejection', (err: TAnyFixme) => {
	console.error('cli Unhandled Rejection:', err);
	if (err && err.stack) {
		console.error(err.stack);
	} else {
		console.error(err);
	}
});

const args = process.argv.slice(2);
const { testToRun, includeDirs, runOptions } = parseVCaptureArgs(args, printHelp);

runContainer(testToRun, includeDirs, runOptions);

function printHelp(exitCode = 1) {
	console.error(`Usage: ${process.argv[1]} [--feature-filter] [--pass-env=<ENV=VAR,...>] [--recreate[=boolean]] [--tts[=boolean]] [--no-capture] [--help] [--res=WxH] script filter features files ...`);
	process.exit(exitCode);
}
