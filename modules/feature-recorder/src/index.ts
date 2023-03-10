import sourceMapSupport from 'source-map-support';
import { record } from "./recorder.js";

sourceMapSupport.install();

const url = process.argv[2];
if (!url) {
    console.error("Please provide a url to record");
    process.exit(1);
}

const res = await record(url, ['record']);
console.log('🤑', JSON.stringify(res, null, 2));