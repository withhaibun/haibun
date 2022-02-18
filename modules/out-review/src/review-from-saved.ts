#!/usr/bin/env node
import MFS from '@haibun/core/build/lib/util/mfs';
import OutReview from "./out-review";
import { TResult } from "@haibun/core/build/lib/defs";

const { readdirSync, readFileSync } = new MFS();
const base = process.argv[2];
go(base);

async function go(base: string) {
    const sequences = readdirSync(base);
    for (const seq in sequences) {
        const featureNums = readdirSync(`${base}/${seq}`)
        for (const featureNum in featureNums) {
            const members = readdirSync(`${base}/${seq}/${featureNum}`)
            const dir = `${base}/${seq}/${featureNum}`;
            const output = readFileSync(`${dir}/trace/trace.json`, 'utf-8');
            const result: TResult = JSON.parse(output);
            const outReview = new OutReview();
            const res = await outReview.getOutput(result, {});
        }
    }
}