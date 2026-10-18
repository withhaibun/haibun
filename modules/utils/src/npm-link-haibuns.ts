#!/usr/bin/env node

import { linkDependencies } from "./adapters/npm-link.js";

console.log(`>> ${linkDependencies()}`);
