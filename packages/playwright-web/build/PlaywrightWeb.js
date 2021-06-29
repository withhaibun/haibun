"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const defs_1 = require("@haibun/core/build/lib/defs");
const BrowserFactory_1 = require("./BrowserFactory");
const util_1 = require("@haibun/core/build/lib/util");
const PlayWrightWeb = class PlaywrightWeb {
    constructor(world) {
        this.options = {
            STEP_CAPTURE: {
                desc: 'capture page image for every step',
                parse: (input) => true,
            },
        };
        this.steps = {};
        this.world = world;
        this.bf = new BrowserFactory_1.BrowserFactory(world.logger);
        const preSteps = {
            //                                      INPUT
            inputVariable: {
                gwta: 'input <(?<what>.+)> for (?<field>.+)',
                withPage: async (page, { what, field }) => {
                    const where = this.world.shared[field] || field;
                    const val = this.world.shared[what];
                    if (!val) {
                        throw Error(`no shared defined ${what}`);
                    }
                    await page.fill(where, val);
                    return defs_1.OK;
                },
            },
            input: {
                gwta: 'input "(?<what>.+)" for "(?<field>.+)"',
                withPage: async (page, { what, field }) => {
                    field = field.replace(/"/g, '');
                    const where = this.world.shared[field];
                    await page.fill(where, what);
                    return defs_1.OK;
                },
            },
            selectionOption: {
                gwta: 'select "(?<option>.+)" for `(?<id>.+)`',
                withPage: async (page, { option, id }) => {
                    const what = this.world.shared[id] || id;
                    const res = await page.selectOption(what, { label: option });
                    // FIXME have to use id value
                    // return res === [id] ? ok : {...notOk, details: { message: `received ${res} selecting from ${what} with id ${id}`}};
                    return defs_1.OK;
                },
            },
            //                ASSERTIONS
            seeText: {
                gwta: 'should see "(?<text>.+)"',
                withPage: async (page, { text }) => {
                    let textContent;
                    for (let a = 0; a < 2; a++) {
                        textContent = await page.textContent('body', { timeout: 1e9 });
                        if (textContent?.toString().includes(text)) {
                            return defs_1.OK;
                        }
                    }
                    return util_1.actionNotOK(`Did not find text in ${textContent?.length} characters starting with ${textContent?.trim().substr(0, 1e9)}`);
                },
            },
            beOnPage: {
                gwta: 'should be on the (?<name>.+) page',
                withPage: async (page, { name }) => {
                    await page.waitForNavigation();
                    const uri = this.world.shared[name];
                    let nowon;
                    nowon = await page.url();
                    if (nowon === uri) {
                        return defs_1.OK;
                    }
                    return util_1.actionNotOK(`expected ${uri} but on ${nowon}`);
                },
            },
            URIContains: {
                gwta: 'URI should include (?<what>.+)',
                withPage: async (page, { what }) => {
                    const uri = await page.url();
                    return uri.includes(what) ? defs_1.OK : util_1.actionNotOK(`current URI ${uri} does not contain ${what}`);
                },
            },
            URIStartsWith: {
                gwta: 'URI should start with (?<start>.+)',
                withPage: async (page, { start }) => {
                    const uri = await page.url();
                    return uri.startsWith(start) ? defs_1.OK : util_1.actionNotOK(`current URI ${uri} does not start with ${start}`);
                },
            },
            URIMatches: {
                gwta: 'URI should match (?<what>.+)',
                withPage: async (page, { what }) => {
                    const uri = await page.url();
                    return uri === what ? defs_1.OK : util_1.actionNotOK(`current URI ${uri} does not match ${what}`);
                },
            },
            //                  CLICK
            clickOn: {
                gwta: 'click on (?<name>.[^s]+)',
                withPage: async (page, { name }) => {
                    const what = this.world.shared[name] || `text=${name}`;
                    await page.click(what);
                    return defs_1.OK;
                },
            },
            clickCheckbox: {
                gwta: 'click the checkbox (?<name>.+)',
                withPage: async (page, { name }) => {
                    const what = this.world.shared[name] || name;
                    this.world.logger.log(`click ${name} ${what}`);
                    await page.click(what);
                    return defs_1.OK;
                },
            },
            clickShared: {
                gwta: 'click `(?<id>.+)`',
                withPage: async (page, { id }) => {
                    const name = this.world.shared[id];
                    await page.click(name);
                    return defs_1.OK;
                },
            },
            clickQuoted: {
                gwta: 'click "(?<name>.+)"',
                withPage: async (page, { name }) => {
                    await page.click(`text=${name}`);
                    return defs_1.OK;
                },
            },
            clickLink: {
                gwta: 'click the link (?<uri>.+)',
                withPage: async (page, { name }) => {
                    const field = this.world.shared[name] || name;
                    await page.click(field);
                    return defs_1.OK;
                },
            },
            clickButton: {
                gwta: 'click the button (?<id>.+)',
                withPage: async (page, { id }) => {
                    const field = this.world.shared[id] || id;
                    const a = await page.click(field);
                    return defs_1.OK;
                },
            },
            //                          NAVIGATION
            openPage: {
                gwta: 'open the (?<name>.+) page',
                withPage: async (page, { name }) => {
                    const uri = this.world.shared[name];
                    const response = await page.goto(uri);
                    return response?.ok ? defs_1.OK : util_1.actionNotOK(`response not ok`);
                },
            },
            goBack: {
                gwta: 'go back',
                withPage: async (page) => {
                    await page.goBack();
                    return defs_1.OK;
                },
            },
            pressBack: {
                gwta: 'press the back button',
                withPage: async (page) => {
                    // FIXME
                    await page.evaluate(() => {
                        console.log('going back', window.history);
                        window.history.go(-1);
                    });
                    await page.evaluate(() => {
                        console.log('went back', window.history);
                    });
                    // await page.focus('body');
                    // await page.keyboard.press('Alt+ArrowRight');
                    return defs_1.OK;
                },
            },
            //                          BROWSER
            usingBrowser: {
                gwta: 'using (?<browser>[^`].+[^`]) browser',
                action: async ({ browser }) => this.setBrowser(browser),
            },
            usingBrowserVar: {
                gwta: 'using `(?<id>.+)` browser',
                action: async ({ id }) => {
                    const browser = this.world.shared[id];
                    if (!browser) {
                        return util_1.actionNotOK(`browser var not found ${id}`);
                    }
                    return this.setBrowser(browser);
                },
            },
            //                          MISC
            takeScreenshot: {
                gwta: 'take a screenshot',
                withPage: async (page) => {
                    await page.screenshot({ path: `screenshot-${Date.now()}.png` });
                    return defs_1.OK;
                },
            },
            assertOpen: {
                gwta: '(?<what>.+) is expanded with the (?<using>.+)',
                withPage: async (page, { what, using }) => {
                    const v = this.world.shared[what];
                    const u = this.world.shared[using];
                    const isVisible = await page.isVisible(v);
                    if (!isVisible) {
                        await page.click(u);
                    }
                    return defs_1.OK;
                },
            },
            pauseSeconds: {
                gwta: 'pause for (?<text>.+)s',
                action: async ({ ms }) => {
                    const seconds = parseInt(ms, 10) * 1000;
                    await util_1.sleep(seconds);
                    return defs_1.OK;
                },
            },
        };
        const steps = Object.entries(preSteps).reduce((a, [p, step]) => {
            const stepper = step;
            if (!stepper.withPage) {
                return { ...a, [p]: step };
            }
            step.action = async (input) => {
                try {
                    return await this.pageRes(step.withPage, input, p);
                }
                catch (e) {
                    world.logger.log(e);
                    return util_1.actionNotOK(e.message, e);
                }
            };
            return { ...a, [p]: step };
        }, {});
        this.steps = steps;
    }
    async pageRes(method, input, p) {
        const page = await this.bf.getPage();
        this.world.runtime.page = page;
        const res = await method(page, input);
        return res;
    }
    setBrowser(browser) {
        try {
            this.bf.setBrowserType(browser);
            return defs_1.OK;
        }
        catch (e) {
            return util_1.actionNotOK(e.message);
        }
    }
    close() {
        this.bf.browser?.close();
    }
};
exports.default = PlayWrightWeb;
//# sourceMappingURL=PlaywrightWeb.js.map