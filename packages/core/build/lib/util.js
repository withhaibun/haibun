"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStepperOption = exports.getStepperOptions = exports.applyExtraOptions = exports.processEnv = exports.getDefaultWorld = exports.sleep = exports.isLowerCase = exports.describeSteppers = exports.getActionable = exports.getOptionsOrDefault = exports.getDefaultOptions = exports.getNamedMatches = exports.recurse = exports.getSteppers = exports.actionOK = exports.actionNotOK = exports.resultOutput = exports.use = void 0;
const fs_1 = require("fs");
const defs_1 = require("./defs");
const Logger_1 = __importStar(require("./Logger"));
// FIXME tired of wrestling with ts/import issues
async function use(module) {
    const re = (await Promise.resolve().then(() => __importStar(require(module)))).default;
    return re;
}
exports.use = use;
async function resultOutput(type, result, shared) {
    if (type) {
        let out = undefined;
        if (type === 'AsXUnit') {
            const AsXUnit = (await Promise.resolve().then(() => __importStar(require('../output/AsXUnit')))).default;
            out = new AsXUnit();
        }
        if (out) {
            const res = await out.getOutput(result, {});
            return res;
        }
    }
    if (!result.ok) {
        return { ...result, results: result.results?.filter((r) => !r.ok).map((r) => (r.stepResults = r.stepResults.filter((s) => !s.ok))) };
    }
    return result;
}
exports.resultOutput = resultOutput;
function actionNotOK(message, details) {
    return {
        ok: false,
        message,
        details,
    };
}
exports.actionNotOK = actionNotOK;
function actionOK(details) {
    return { ok: true, details };
}
exports.actionOK = actionOK;
async function getSteppers({ steppers = [], world, addSteppers = [] }) {
    const allSteppers = [];
    for (const s of steppers) {
        const loc = s.startsWith('.') ? s : `../steps/${s}`;
        const S = await use(loc);
        const stepper = new S(world);
        allSteppers.push(stepper);
    }
    for (const S of addSteppers) {
        const stepper = new S(world);
        allSteppers.push(stepper);
    }
    return allSteppers;
}
exports.getSteppers = getSteppers;
async function recurse(dir, filters) {
    const files = fs_1.readdirSync(dir);
    let all = [];
    for (const file of files) {
        const here = `${dir}/${file}`;
        if (fs_1.statSync(here).isDirectory()) {
            all = all.concat(await recurse(here, filters));
        }
        else if (filters.every((filter) => file.match(filter))) {
            all.push({ path: here.replace(filters[0], ''), feature: fs_1.readFileSync(here, 'utf-8') });
        }
    }
    return all;
}
exports.recurse = recurse;
function getNamedMatches(regexp, what) {
    const named = regexp.exec(what);
    return named?.groups;
}
exports.getNamedMatches = getNamedMatches;
function getDefaultOptions() {
    return {
        mode: 'all',
        steppers: ['vars'],
        options: {},
    };
}
exports.getDefaultOptions = getDefaultOptions;
function getOptionsOrDefault(base) {
    const f = `${base}/config.json`;
    if (fs_1.existsSync(f)) {
        try {
            const specl = JSON.parse(fs_1.readFileSync(f, 'utf-8'));
            if (!specl.options) {
                specl.options = {};
            }
            return specl;
        }
        catch (e) {
            console.error('missing or not valid project config file.');
            process.exit(1);
        }
    }
    return getDefaultOptions();
}
exports.getOptionsOrDefault = getOptionsOrDefault;
function getActionable(value) {
    return value.replace(/#.*/, '').trim();
}
exports.getActionable = getActionable;
function describeSteppers(steppers) {
    return steppers
        .map((stepper) => {
        return Object.keys(stepper.steps).map((name) => {
            return `${stepper.constructor.name}:${name}`;
        });
    })
        .join(' ');
}
exports.describeSteppers = describeSteppers;
// from https://stackoverflow.com/questions/1027224/how-can-i-test-if-a-letter-in-a-string-is-uppercase-or-lowercase-using-javascrip
function isLowerCase(str) {
    return str.toLowerCase() && str != str.toUpperCase();
}
exports.isLowerCase = isLowerCase;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.sleep = sleep;
function getDefaultWorld() {
    return {
        world: {
            shared: {},
            logger: new Logger_1.default(Logger_1.LOGGER_NONE),
            runtime: {},
            options: {},
        },
    };
}
exports.getDefaultWorld = getDefaultWorld;
function processEnv(env, options) {
    const protoOptions = { options: { ...options }, extraOptions: {} };
    let splits = [{}];
    const pfx = `${defs_1.HAIBUN}_`;
    Object.entries(env)
        .filter(([k]) => k.startsWith(pfx))
        .map(([k, v]) => {
        const opt = k.replace(pfx, '');
        if (opt === 'SPLIT_SHARED') {
            const [what, s] = v.split('=');
            splits = s.split(',').map((w) => ({ [what]: w }));
        }
        else if (opt === 'STEP_DELAY') {
            protoOptions.options.step_delay = parseInt(v, 10);
        }
        else if (opt === 'CLI') {
            protoOptions.options.cli = true;
        }
        else if (opt === 'STAY') {
            protoOptions.options.stay = v;
        }
        else {
            protoOptions.extraOptions[k] = v;
        }
    });
    return { splits, protoOptions };
}
exports.processEnv = processEnv;
// has side effects
function applyExtraOptions(protoOptions, steppers, world) {
    if (!protoOptions.extraOptions) {
        return;
    }
    Object.entries(protoOptions.extraOptions).map(([k, v]) => {
        const conc = getStepperOptions(k, v, steppers);
        if (!conc) {
            throw Error(`no option ${k}`);
        }
        delete protoOptions.extraOptions[k];
        world.options[k] = conc;
    });
    if (Object.keys(protoOptions.extraOptions).length > 0) {
        throw Error(`no options provided for ${protoOptions.extraOptions}`);
    }
}
exports.applyExtraOptions = applyExtraOptions;
function getPre(stepper) {
    return ['HAIBUN', 'O', stepper.constructor.name.toUpperCase()].join('_') + '_';
}
function getStepperOptions(key, value, steppers) {
    for (const stepper of steppers) {
        const pre = getPre(stepper);
        const int = key.replace(pre, '');
        if (key.startsWith(pre) && stepper.options[int]) {
            return stepper.options[int].parse(value);
        }
    }
}
exports.getStepperOptions = getStepperOptions;
function getStepperOption(stepper, name, options) {
    const key = getPre(stepper) + name;
    return options[key];
}
exports.getStepperOption = getStepperOption;
//# sourceMappingURL=util.js.map