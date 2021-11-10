#!/usr/bin/env node
import { TResult } from "@haibun/core/build/lib/defs";
import { readdirSync, readFileSync } from "fs";
import OutReview from "./out-review";

const dir = process.argv[2];
go();

async function go() {
    const all = readdirSync(dir);
    for (const a in all) {
        const output = readFileSync(`./${dir}/${a}/trace/trace.json`, 'utf-8');
        const result: TResult = JSON.parse(output);
        const outReview = new OutReview();
        const res = await outReview.getOutput(result, {});
    }
}