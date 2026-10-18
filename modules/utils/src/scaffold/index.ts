#!/usr/bin/env node

import { scaffoldHaibun } from "./adapters/scaffold.js";

try {
	await scaffoldHaibun(".", { out: console.info });
} catch (e) {
	console.error(e);
}
