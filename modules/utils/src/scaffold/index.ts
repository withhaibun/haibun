#!/usr/bin/env node

import { scaffoldHaibun } from "./scaffold.js";

try {
    scaffoldHaibun('.', console.info);
} catch (e) {
    console.error(e);
}
