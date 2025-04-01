#!/usr/bin/env node

import sourceMapSupport from 'source-map-support';
import { runCli } from './lib.js';

sourceMapSupport.install();

process.on('unhandledRejection', console.error);

runCli(process.argv.slice(2), process.env).catch(console.error);
