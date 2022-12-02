#!/usr/bin/env node

import { scaffoldHaibun } from "./scaffold";


try {
    scaffoldHaibun('.', console.info);
} catch (e) {
    console.error(e);
}
