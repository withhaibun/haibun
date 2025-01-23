#!/usr/bin/env node

import sourceMapSupport from 'source-map-support';

import { runWith } from './runTests.js';

sourceMapSupport.install();

process.on('unhandledRejection', console.error);

runWith(process).catch(console.error);


