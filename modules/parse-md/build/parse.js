"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = void 0;
const fs_1 = require("fs");
const node_fetch_1 = __importDefault(require("node-fetch"));
const turndown_1 = __importDefault(require("turndown"));
async function parse(specl, base, steppers) {
    const { refs } = specl;
    const { docs } = refs;
    let conditions = [];
    for (const stepper of steppers) {
        for (const doc in docs) {
            let content;
            const loc = `${base}/refs/${doc}.md`;
            try {
                content = fs_1.readFileSync(loc, "utf-8");
            }
            catch (e) {
                console.info(`fetching ${loc} from ${docs[doc].src}`);
                const response = await node_fetch_1.default(docs[doc].src);
                content = await response.text();
                const turndownService = new turndown_1.default();
                const markdown = turndownService.turndown(content);
                fs_1.writeFileSync(loc, markdown);
            }
            for (const [name, step] of Object.entries(stepper.steps)) {
                const matches = content.matchAll(step.match);
                for (const match of matches) {
                    const [m] = match;
                    conditions.push({
                        doc,
                        condition: m,
                        index: match.index,
                    });
                }
            }
            fs_1.writeFileSync(`${base}/features/${doc}.md`, conditions.map(c => c.condition).join('\n'));
        }
        console.info('wrote', Object.keys(docs));
    }
}
exports.parse = parse;
//# sourceMappingURL=parse.js.map