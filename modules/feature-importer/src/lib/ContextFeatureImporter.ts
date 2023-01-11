import { TWithContext } from "@haibun/context/build/Context";
import BaseFeatureImporter from "./BaseFeatureImporter";
import { TControl, TEvent, TFeatureParsed } from "./defs";
import { WEB_PAGE, SELECTOR } from '@haibun/domain-webpage/build/domain-webpage';

const ignoreControls = ['viewportSize', 'onBeforeNavigate'];
export default class ContextFeatureImporter extends BaseFeatureImporter {
    stored: { [tag: string]: number } = {};
    tags: { [tag: string]: string | number } = {};
    backgrounds: { [pageName: string]: { [tag: string]: string | number } } = {};
    statements: string[] = [];
    inputBuffered: { input: string, selector: string } | undefined = undefined;

    getResult() {
        this.finishBuffered();
        return <TFeatureParsed>{
            ok: true,
            backgrounds: this.backgrounds,
            feature: this.statements.join('\n')
        }
    }
    finishBuffered() {
        if (this.inputBuffered) {
            const { input, selector } = this.inputBuffered;
            this.addStatement(`input "${input}" for ${this.variableQuoted(this.bg(SELECTOR, selector))}`, false);
            this.inputBuffered = undefined;
        }
    }
    async controlToStatement(contexted: TControl) {
        const { control } = contexted;
        if (control === 'startRecording') {
            this.reset();
            const tag = this.setCurrentPage(contexted.href!);
            this.addStatement(`On the ${this.variableQuoted(tag)} ${WEB_PAGE}`);
        } else if (control === 'recordCurrentUrl') {
            const tag = this.setCurrentPage(contexted.href!);
            this.addStatement(`On the ${this.variableQuoted(tag)} ${WEB_PAGE}`);
        } else if (ignoreControls.includes(control)) {
        } else if (control === 'stopRecording') {
            console.log(this.getResult());
        } else if (control === 'navigation') {
            console.log('navigation');
        } else {
            throw Error(`Unknown control ${JSON.stringify(control)}`);
        }
    }
    reset() {
        this.statements = [];
        this.backgrounds = {};
    }
    async eventToStatement(event: TEvent) {
        const { action } = event;
        if (action === 'change') {
            this.finishBuffered();
        } else if (action === 'click') {
            this.addStatement(`click ${this.variableQuoted(this.bg(SELECTOR, event.selector))}`);
        } else if (action === 'dblclick') {
            this.addStatement(`double-click ${this.variableQuoted(this.bg(SELECTOR, event.selector))}`);
        } else if (action === 'keydown') {
            this.inputBuffered = {
                input: event.value + String.fromCharCode(parseInt(event.keyCode, 10)),
                selector: event.selector
            }
        } else if (action === 'submit') {
            this.addStatement(`submit ${this.variableQuoted(this.bg(SELECTOR, event.selector))}`);
        } else {
            console.log('🤑 unknown', JSON.stringify(event, null, 2));
            // throw Error(`Unknown event action ${action} from ${JSON.stringify(event)}`);
        }

    }
    addStatement(statement: string, debuffer = true) {
        this.logger.log(`adding statement: ${statement}`)
        if (debuffer) {
            this.finishBuffered();
        }
        this.statements.push(statement);
    }
    async contextToStatement(context: TWithContext) {
        const { '@context': contextType, ...rest } = context;
        switch (contextType) {
            case '#haibun/event':
                return this.eventToStatement(rest as TEvent);
            case '#haibun/control':
                return this.controlToStatement(rest as TControl);
            case '#haibun/info':
                return this.infoStatement(rest as TControl);
            default:
                throw Error('known context type');
        }
    }
    async infoStatement(info: TControl) {
        console.log('info', info);
    }
    // goto(where: string) {
    //     currentPageTag = bg(PAGE, where, true);
    //     this.feature.push(`go to ${vq(currentPageTag)}`);
    // },
    // setViewportSize({ width, height }: { width: number, height: number }) {
    //     this.feature.push(`Set viewport to ${bq(WIDTH, width)}, ${bq(HEIGHT, height)}`);
    // },
    // waitForSelector(sel: string) {
    //     this.feature.push(`wait for ${bq(SELECTOR, sel)}`);
    // },
}

