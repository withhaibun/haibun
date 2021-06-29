"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = __importDefault(require("playwright"));
(async () => {
    const browser = await playwright_1.default.webkit.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("https://www.example.com/");
    const dimensions = await page.evaluate(() => {
        return {
            deviceScaleFactor: window.devicePixelRatio,
        };
    });
    console.log(JSON.stringify(dimensions));
    await browser.close();
})();
//# sourceMappingURL=client.js.map