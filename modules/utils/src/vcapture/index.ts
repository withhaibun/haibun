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
const { testToRun, includeDirs, captureOptions } = parseVCaptureArgs(args, printHelp);

runContainer(testToRun, includeDirs, captureOptions);

function printHelp(exitCode = 1) {
	console[exitCode === 1 ? 'error' : 'info'](`Usage: ${process.argv[1]} [--feature-filter] [--cli-env=<name=value,...>] [--pass-env=<VAR=FOO>] [--pass-env ...] [--recreate[=boolean]] [--tts[=boolean]] [--no-capture] [--help] [--res=WxH] script filter features files ...`);
	process.exit(exitCode);
}
