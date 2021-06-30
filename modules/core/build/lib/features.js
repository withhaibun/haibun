"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findFeature = exports.expandFeatures = exports.findUpper = exports.expandBackgrounds = exports.getSteps = void 0;
const util_1 = require("./util");
function getSteps(value) {
    return value
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => !s.startsWith('#') && s.length);
}
exports.getSteps = getSteps;
// Expand backgrounds by prepending 'upper' features to 'lower' features
async function expandBackgrounds(features, before = '') {
    const expanded = [];
    for (const { path, feature } of features) {
        let res = feature;
        let r = findUpper(path, features);
        while (r.upper.length > 0 && r.rem !== '/') {
            r = findUpper(r.rem, features);
            for (const s of r.upper) {
                res = s.feature + '\n' + res;
            }
        }
        expanded.push({ path, feature: res });
    }
    return expanded;
}
exports.expandBackgrounds = expandBackgrounds;
const upperPath = (path) => {
    const r = path.split('/');
    return '/' + r.slice(1, r.length - 1).join('/');
};
function findUpper(path, features) {
    const rem = upperPath(path);
    const upper = features.filter((f) => {
        const p = upperPath(f.path);
        return p === rem;
    });
    return { rem, upper };
}
exports.findUpper = findUpper;
async function expandFeatures(features, backgrounds) {
    const expanded = [];
    for (const feature of features) {
        feature.feature = await expandIncluded(feature, backgrounds);
        expanded.push(feature);
    }
    return expanded;
}
exports.expandFeatures = expandFeatures;
async function expandIncluded(feature, backgrounds) {
    const lines = feature.feature
        .split('\n')
        .map((l) => {
        if (util_1.getActionable(l).match(/^Backgrounds: .*$/)) {
            return doIncludes(l, backgrounds);
        }
        else if (util_1.getActionable(l).match(/^Scenarios: .*$/)) {
            return doIncludes(l, backgrounds);
        }
        return l;
    })
        .join('\n');
    return lines;
}
function doIncludes(input, backgrounds) {
    const includes = input.replace(/^.*?: /, '').split(',');
    let ret = '';
    for (const l of includes) {
        const toFind = l.trim();
        const bg = findFeature(toFind, backgrounds);
        if (bg.length !== 1) {
            throw Error(`can't find single "${toFind}" from ${backgrounds.map((b) => b.path).join(', ')}`);
        }
        ret += `\n${bg[0].feature.trim()}\n`;
    }
    return ret;
}
function findFeature(name, features) {
    return features.filter(f => f.path.endsWith(`/${name}`));
}
exports.findFeature = findFeature;
//# sourceMappingURL=features.js.map