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
const playwright_1 = require("playwright");
const Logger_1 = __importStar(require("@haibun/core/build/lib/Logger"));
const BrowserFactory_1 = require("./BrowserFactory");
describe("BrowserFactory", () => {
    it("gets type and device", () => {
        const bf = new BrowserFactory_1.BrowserFactory(new Logger_1.default(Logger_1.LOGGER_NONE));
        bf.setBrowserType("webkit.Blackberry PlayBook");
        expect(bf.browserType).toBe(playwright_1.webkit);
        expect(bf.device).toBe("Blackberry PlayBook");
    });
    it("missing type", () => {
        const bf = new BrowserFactory_1.BrowserFactory(new Logger_1.default(Logger_1.LOGGER_NONE));
        expect(() => bf.setBrowserType("amazingnothing")).toThrowError();
    });
});
//# sourceMappingURL=BrowserFactory.test.js.map