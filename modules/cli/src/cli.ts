#!/usr/bin/env node

import sourceMapSupport from 'source-map-support';
import { runCli } from './lib.js';
import { TAnyFixme } from '@haibun/core/build/lib/fixme.js';

sourceMapSupport.install();

process.on('unhandledRejection', (err: TAnyFixme) => {
	console.error('cli Unhandled Rejection:', err);
	if (err && err.stack) {
		console.error(err.stack);
	} else {
		console.error(err);
	}
});

runCli(process.argv.slice(2), process.env).catch((err) => {
	console.error('cli Error:', err);
	if (err && err.stack) {
		console.error(err.stack);
	} else {
		console.error(err);
	}
});
