import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { chromium, Page } from 'playwright';

import { TWorld } from '@haibun/core/build/lib/defs.js';
import { TLogLevel, TLogArgs, TMessageContext, ILogOutput } from '@haibun/core/build/lib/interfaces/logger.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';
import { getPackageLocation } from '@haibun/core/build/lib/util/workspace-lib.js';
import { sleep } from '@haibun/core/build/lib/util/index.js';
import { actualURI } from '@haibun/core/build/lib/util/actualURI.js';
import { TAnyFixme } from '@haibun/core/build/lib/fixme.js';
import { TLogEntry } from './monitor.js';
import { IPrompter, TPromptResponse, TPrompt } from '@haibun/core/build/lib/prompter.js';

declare global {
	interface Window {
		showPromptControls: (prompt: string) => void;
		hidePromptControls: () => void;
		receiveLogData: (entry: TLogEntry) => void;
	}
}

const monitorLocation = join(getPackageLocation(import.meta), '..', '..', 'web', 'monitor.html');
const capturedMessages: TLogEntry[] = [];

class ButtonPrompter implements IPrompter {
	private currentPromptResolve?: (response: TPromptResponse) => void;

	constructor(private monitorHandler: MonitorHandler) { }

	async prompt(prompt: TPrompt): Promise<TPromptResponse> {
		return new Promise<TPromptResponse>((resolve, reject) => {
			this.currentPromptResolve = resolve;
			this.monitorHandler.inMonitor<string>(
				(message) => window.showPromptControls(message),
				JSON.stringify(prompt)
			).catch(reject);
		});
	}

	resolvePrompt(response: TPromptResponse) {
		if (this.currentPromptResolve) {
			this.currentPromptResolve(response);
			this.currentPromptResolve = undefined;
		}
	}
}

export class MonitorHandler {
	subscriber: ILogOutput;
	monitorPage: Page;
	monitorLoc: string;

	constructor(private world: TWorld, private storage: AStorage, private headless: boolean) {
	}

	async initMonitor() {
		this.monitorLoc = await this.storage.getCaptureLocation({ ...this.world, mediaType: EMediaTypes.html });
		this.world.logger.info(`Creating new monitor page`);
		const browser = await chromium.launch({ headless: this.headless });
		const context = await browser.newContext();
		this.monitorPage = await context.newPage();

		await this.monitorPage.exposeFunction('haibunResolvePrompt', (response: TPromptResponse) => {
			if (this.buttonPrompter) {
				this.buttonPrompter.resolvePrompt(response);
				void this.inMonitor(() => {
					window.hidePromptControls();
				});
			} else {
				this.world.logger.error('ButtonPrompter not initialized when haibunResolvePrompt was called.');
			}
		});

		await this.waitForMonitorPage();
		await this.monitorPage.goto(pathToFileURL(monitorLocation).toString(), { waitUntil: 'networkidle' });

		await this.inMonitor<string>((monitorLoc) => {
			const base = document.createElement('base');
			base.href = `${monitorLoc}/`;
			document.head.appendChild(base);
		}, resolve(this.monitorLoc));

		this.subscriber = {
			out: (level: TLogLevel, message: TLogArgs, messageContext?: TMessageContext) => {
				const logEntry: TLogEntry = {
					level,
					message,
					messageContext,
					timestamp: Date.now()
				}

				capturedMessages.push(logEntry)
				void this.inMonitor<string>((entry) => {
					window.receiveLogData(JSON.parse(entry) as TLogEntry)
				}, JSON.stringify(logEntry));
			}
		};
		this.buttonPrompter = new ButtonPrompter(this);
		this.world.prompter.subscribe(this.buttonPrompter);
	}

	private buttonPrompter?: ButtonPrompter;

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
		});

		const content = (await this.monitorPage.content()) + `
<script>
window.haibunStaticPage = true;
window.haibunCapturedMessages = ${JSON.stringify(capturedMessages, null, 2)};
document.getElementById('haibun-log-display-area').innerHTML = '';
</script>
`;
		await this.inMonitor(() => {
			const base = document.querySelector('base');
			if (base) {
				base.parentNode?.removeChild(base);
			}
		});

		const outHtmlFile = join(this.monitorLoc, 'monitor.html');
		const monitorPath = actualURI(outHtmlFile);
		this.world.logger.info(`Writing monitor HTML to ${monitorPath}`);
		await this.storage.writeFile(outHtmlFile, content, EMediaTypes.html);
		const outMessages = join(this.monitorLoc, 'monitor.json');
		await this.storage.writeFile(outMessages, JSON.stringify(capturedMessages, null, 2), EMediaTypes.html);
	}
	async inMonitor<T>(toRun: (p: T) => void, context?: TAnyFixme) {
		await this.monitorPage.evaluate(toRun, context);
	}

	async waitForMonitorPage() {
		let waitForMonitor = 0;
		while (!existsSync(monitorLocation) && waitForMonitor < 20) {
			if (waitForMonitor++ === 1) this.world.logger.info(`Waiting up to ${20 * .5} seconds for monitor.html`);
			await sleep(500);
		}
	}
}
