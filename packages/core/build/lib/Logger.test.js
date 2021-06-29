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
const Logger_1 = __importStar(require("./Logger"));
describe('log levels', () => {
    test('logs none with none', () => {
        expect(Logger_1.default.shouldLog(Logger_1.LOGGER_LEVELS['none'], 'debug')).toBe(false);
        expect(Logger_1.default.shouldLog(Logger_1.LOGGER_LEVELS['none'], 'info')).toBe(false);
    });
    test('logs log with log', () => {
        expect(Logger_1.default.shouldLog(Logger_1.LOGGER_LEVELS['log'], 'log')).toBe(true);
    });
    test('does not log debug with log', () => {
        expect(Logger_1.default.shouldLog(Logger_1.LOGGER_LEVELS['log'], 'debug')).toBe(false);
    });
});
//# sourceMappingURL=Logger.test.js.map