"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("../lib/util");
const Conformance = class Conformance {
    constructor() {
        this.steps = {
            must: {
                match: /(?!\n|. )\b([A-Z].*? must .*?\.)/,
                action: async (input) => util_1.actionNotOK('not implemented'),
            },
        };
    }
};
exports.default = Conformance;
//# sourceMappingURL=conformance.js.map