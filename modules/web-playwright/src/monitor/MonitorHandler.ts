import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { BrowserContext, chromium, Page } from 'playwright';

import { TWorld } from '@haibun/core/lib/defs.js';
import { TLogLevel, TLogArgs, TMessageContext, ILogOutput } from '@haibun/core/lib/interfaces/logger.js';
import { AStorage } from '@haibun/domain-storage/AStorage.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';
import { getPackageLocation } from '@haibun/core/lib/util/workspace-lib.js';
import { sleep } from '@haibun/core/lib/util/index.js';
import { actualURI } from '@haibun/core/lib/util/actualURI.js';
import { TAnyFixme } from '@haibun/core/lib/fixme.js';
import { TPromptResponse, TPrompt } from '@haibun/core/lib/prompter.js';
import { BasePromptManager } from '@haibun/core/lib/base-prompt-manager.js';
import { TLogEntry } from './monitor.js';
import WebPlaywright from '../web-playwright.js';

declare global {
	interface Window {
		showPromptControls: (prompt: string) => void;
		hidePromptControls: () => void;
		receiveLogData: (entry: TLogEntry) => void;
		showStatementInput: () => void;
		hideStatementInput: () => void;
		submitStatement: (statement: string) => void;
		haibunSubmitStatement: (statement: string) => void;
	}
}

let shownError = false;
const monitorLocation = join(getPackageLocation(import.meta), '..', '..', 'web', 'monitor.html');

class ButtonPrompter extends BasePromptManager {
	private monitorHandler: MonitorHandler;
	private buttonPrompts: Map<string, TPrompt> = new Map();

	constructor(monitorHandler: MonitorHandler) {
		super();
		this.monitorHandler = monitorHandler;
	}

	protected showPrompt(prompt: TPrompt): void {
		this.buttonPrompts.set(prompt.id, prompt);
		void this.monitorHandler.inMonitor<string>(
			(prompts) => window.showPromptControls(prompts),
			JSON.stringify(Array.from(this.buttonPrompts.values()))
		);

		// Show statement input for debugger prompts that allow arbitrary input
		if (prompt.options?.includes('*')) {
			void this.monitorHandler.inMonitor(() => window.showStatementInput());
		}
	}

	protected hidePrompt(id: string): void {
		this.buttonPrompts.delete(id);
		void this.monitorHandler.inMonitor<string>(
			(prompts) => window.showPromptControls(prompts),
			JSON.stringify(this.buttonPrompts)
		);

		// Hide statement input when no prompts with '*' option remain
		const hasStatementPrompts = Array.from(this.buttonPrompts.values()).some(p => p.options?.includes('*'));
		if (!hasStatementPrompts) {
			void this.monitorHandler.inMonitor(() => window.hideStatementInput());
		}
	}

	// Expose resolve and cancel as public methods
	public resolve(id: string, response: TPromptResponse) {
		super.resolve(id, response);
	}
	public cancel(id: string, reason?: string) {
		super.cancel(id, reason);
	}

	// Public getter for accessing prompts
	public getPrompts(): Map<string, TPrompt> {
		return this.buttonPrompts;
	}
}

export class MonitorHandler {
	subscriber: ILogOutput;
	monitorPage: Page;
	buttonPrompter: ButtonPrompter;
	steppers: TAnyFixme[]; // Store steppers for statement execution
	context: BrowserContext;
	capturedMessages: TLogEntry[] = [];

	constructor(private world: TWorld, private storage: AStorage, private headless: boolean) {
	}
	async updateWorld(world: TWorld) {
		this.world = world;
		await this.inMonitor<string>((monitorLoc) => {
			let base = document.querySelector('base');
			if (!base) {
				base = document.createElement('base');
				document.head.appendChild(base);
			}
			base.href = `${monitorLoc}/`;
		}, resolve(await this.getMonitorLoc()));
	}

	async initMonitorContext() {
		const browser = await chromium.launch({
			headless: this.headless,
			// args: ['--start-maximized']
		});
		this.context = await browser.newContext({ viewport: null });
	}
	firstPage = true;
	createMonitorPage = async (wp: WebPlaywright) => {
		// Reset captured messages for each new monitor page
		this.capturedMessages = [];

		this.monitorPage = await this.context.newPage();

		// Pass the view mode preference to the page context
		const viewMode = this.firstPage ? 'document' : 'timeline';
		await this.monitorPage.addInitScript((mode) => {
			(window as TAnyFixme).HAIBUN_VIEW_MODE = mode;
		}, viewMode);

		this.firstPage = false;
		this.buttonPrompter = new ButtonPrompter(this);
		await this.monitorPage.exposeFunction('haibunResolvePrompt', (id: string, response: TPromptResponse) => {
			this.buttonPrompter.resolve(id, response);
		});

		await this.monitorPage.exposeFunction('haibunSubmitStatement', (statement: string) => {
			// Find the first prompt that accepts arbitrary input and resolve it with the statement
			const statementPrompt = Array.from(this.buttonPrompter.getPrompts().values())
				.find(p => p.options?.includes('*'));
			if (statementPrompt) {
				this.buttonPrompter.resolve(statementPrompt.id, statement);
			}
		});
		await this.waitForMonitorPage();
		await this.monitorPage.goto(pathToFileURL(monitorLocation).toString(), { waitUntil: 'networkidle' });

		this.subscriber = {
			out: (level: TLogLevel, message: TLogArgs, messageContext?: TMessageContext) => {
				const logEntry: TLogEntry = {
					level,
					message,
					messageContext,
					timestamp: Date.now()
				}

				this.capturedMessages.push(logEntry)
				void this.inMonitor<string>((entry) => {
					window.receiveLogData(JSON.parse(entry) as TLogEntry)
				}, JSON.stringify(logEntry));
			}
		};
		this.world.logger.addSubscriber(this.subscriber);
		wp.closers.push(() => this.world.logger.removeSubscriber(this.subscriber));
		this.world.prompter.subscribe(this.buttonPrompter);
	}
	async getMonitorLoc() {
		return await this.storage.getCaptureLocation({ ...this.world, mediaType: EMediaTypes.html });
	}

	async writeMonitor() {
		if (!this.monitorPage || this.monitorPage.isClosed()) {
			this.world.logger.error('Monitor page is closed, cannot write monitor file.');
			return;
		}
		await sleep(500);

		await this.inMonitor(() => {
			const promptControls = document.getElementById('haibun-prompt-controls-container');
			if (promptControls && promptControls.parentNode) {
				promptControls.parentNode.removeChild(promptControls);
			}
			const base = document.querySelector('base');
			if (base) {
				base.parentNode?.removeChild(base);
			}
		});

		const content = (await this.monitorPage.content()) + `
<script>
window.haibunStaticPage = true;
document.getElementById('haibun-log-display-area').innerHTML = '';
</script>
<script id="haibun-log-data" type="application/json">
${JSON.stringify(this.capturedMessages)}
</script>
`;
		const outHtmlFile = join(await this.getMonitorLoc(), 'monitor.html');
		const monitorPath = actualURI(outHtmlFile);
		this.world.logger.info(`Writing monitor HTML to ${monitorPath}`);
		await this.storage.writeFile(outHtmlFile, content, EMediaTypes.html);
		const outMessages = join(await this.getMonitorLoc(), 'monitor.json');
		await this.storage.writeFile(outMessages, JSON.stringify(this.capturedMessages, null, 2), EMediaTypes.html);
	}
	async inMonitor<T>(toRun: (p: T) => void, context?: TAnyFixme) {
		await this.monitorPage.evaluate(toRun, context).catch(e => {
			if (!shownError) {
				console.error(e)
				shownError = true;
			}
		});
	}

	async waitForMonitorPage() {
		let waitForMonitor = 0;
		while (!existsSync(monitorLocation) && waitForMonitor < 20) {
			if (waitForMonitor++ === 1) this.world.logger.info(`Waiting up to ${20 * .5} seconds for monitor.html`);
			await sleep(500);
		}
	}
}
