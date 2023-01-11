import ContextFeatureImporter from "./ContextFeatureImporter";
import { TControl, TEvent } from "./defs";
import { WEB_PAGE, SELECTOR } from '@haibun/domain-webpage/build/domain-webpage';
import TestLogger from '@haibun/core/build/lib/TestLogger';

const START_RECORDING = {
    '@context': '#haibun/control',
    control: 'startRecording',
    href: 'http://test',
    ctime: 1667409774024
}

const KEYDOWN_INPUT = {
    '@context': '#haibun/event',
    selector: '#wpPassword1',
    value: 'a',
    tagName: 'INPUT',
    action: 'keydown',
    keyCode: '65',
    href: null,
    ctime: 1667394698264
}
const KEYDOWN_INPUT2 = {
    '@context': '#haibun/event',
    selector: '#wpPassword1',
    value: 'a',
    tagName: 'INPUT',
    action: 'keydown',
    keyCode: '65',
    href: null,
    ctime: 1667394699264
}

const CLICK_LABEL = {
    '@context': '#haibun/event',
    selector: 'div > .mw-htmlform-field-HTMLCheckField > .mw-input > .mw-ui-checkbox > label',
    tagName: 'LABEL',
    action: 'click',
    keyCode: null,
    href: null,
    ctime: 1667394732780
}

const CLICK_CHECKBOX = {
    '@context': '#haibun/event',
    selector: '#wpRemember',
    value: '1',
    tagName: 'INPUT',
    action: 'click',
    keyCode: null,
    href: null,
    ctime: 1667394732780
}

const SUBMIT_FORM = {
    '@context': '#haibun/event',
    selector: '#bodyContent > #mw-content-text > .mw-ui-container > #userloginForm > .mw-htmlform',
    tagName: 'FORM',
    action: 'submit',
    keyCode: null,
    href: null,
    ctime: 1667394872514
}


describe('context code2haibun', () => {
    it('throws with no background page', async () => {
        const cfi = new ContextFeatureImporter(new TestLogger());
        expect(async () => await cfi.eventToStatement(<TEvent>SUBMIT_FORM)).rejects.toThrow();
    });
    it('gets click', async () => {
        const cfi = new ContextFeatureImporter(new TestLogger());
        await cfi.controlToStatement(<TControl>START_RECORDING);
        await cfi.eventToStatement(<TEvent>CLICK_LABEL);
        const res = cfi.getResult();
        expect(res).toEqual({
            "ok": true,
            "backgrounds": {
                [`${WEB_PAGE}1`]: {
                    [`[HERE]`]: "http://test",
                    [`${SELECTOR}1`]: "div > .mw-htmlform-field-HTMLCheckField > .mw-input > .mw-ui-checkbox > label"
                }
            },
            "feature": `On the \`${WEB_PAGE}1\` webpage\nclick \`${SELECTOR}1\``
        });
    });
    it('keystrokes', async () => {
        const cfi = new ContextFeatureImporter(new TestLogger());
        await cfi.controlToStatement(<TControl>START_RECORDING);
        await cfi.eventToStatement(<TEvent>KEYDOWN_INPUT);
        await cfi.eventToStatement(<TEvent>KEYDOWN_INPUT2);
        const res = cfi.getResult();
        expect(res).toEqual({
            "ok": true,
            "backgrounds": {
                [`${WEB_PAGE}1`]: {
                    [`[HERE]`]: "http://test",
                    [`${SELECTOR}1`]: "#wpPassword1",
                }
            },
            "feature": `On the \`${WEB_PAGE}1\` webpage\ninput \"aA\" for \`${SELECTOR}1\``
        }
        );
    });
});

