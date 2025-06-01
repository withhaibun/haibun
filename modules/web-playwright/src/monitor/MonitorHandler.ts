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

const monitorLocation = join(getPackageLocation(import.meta), '..', '..', 'web', 'monitor.html');
const capturedMessages = [];

type TEntry = { level: TLogLevel, message: TLogArgs, ctx?: TMessageContext, timestamp: number, messageContextString?: string };

export class MonitorHandler {
	subscriber: ILogOutput;
	monitorPage: Page;
	monitorLoc: string;

	constructor(private world: TWorld, private storage: AStorage, private headless: boolean) {
	}

	async initMonitor() {
		this.monitorLoc = await this.storage.getCaptureLocation({ ...this.world, mediaType: EMediaTypes.html });
		console.info(`Creating new monitor page`);
		const browser = await chromium.launch({ headless: this.headless });
		const context = await browser.newContext();
		this.monitorPage = await context.newPage();

		await this.waitForMonitorPage();
		await this.monitorPage.goto(pathToFileURL(monitorLocation).toString(), { waitUntil: 'networkidle' });

		await this.inMonitor<string>((monitorLoc) => {
			const base = document.createElement('base');
			base.href = `${monitorLoc}/`;
			document.head.appendChild(base);
		}, resolve(this.monitorLoc));

		this.subscriber = {
			out: (level: TLogLevel, message: TLogArgs, messageContext?: TMessageContext) => {
				capturedMessages.push({ level, message, messageContext })
				if (!this.monitorPage || this.monitorPage.isClosed()) {
					console.error("Monitor page closed, cannot send logs.");
					return;
				}
				try {
					// this is async but we don't need to wait for it
					void this.inMonitor<TEntry>((entry) => {
						// This code runs in the browser context (monitor.html)
						if (window.receiveLogData) {
							// Parse the context string back into an object inside the browser.
							const contextObject = entry.messageContextString ? JSON.parse(entry.messageContextString) : undefined;

							window.receiveLogData({
								level: entry.level,
								message: entry.message,
								messageContext: contextObject,
								timestamp: entry.timestamp
							});
						} else {
							throw Error('window.receiveLogData not defined in monitor page');
						}
					}, {
						// Data being sent from Node.js to the browser
						level,
						message,
						messageContextString: messageContext ? JSON.stringify(messageContext) : undefined,
						timestamp: Date.now()
					});

				} catch (e) {
					// Specific check for the serialization error
					if (e instanceof Error && e.message.includes('Unexpected value')) {
						console.error('Error sending log to monitor via evaluate: Serialization failed. Check the structure of messageContext.', e.message);
						console.error('Problematic messageContext object before stringify:', messageContext);
					} else if (e instanceof Error && !e.message.includes('Target page, context or browser has been closed')) {
						console.error('Error sending log to monitor via evaluate:', e.message);
					}
					throw (e);
				}
			},
		};
	}

	async writeMonitor() {
		if (!this.monitorPage || this.monitorPage.isClosed()) {
			this.world.logger.error('Monitor page is closed, cannot write monitor file.');
			return;
		}
		await sleep(500); // Allow final rendering

		const content = (await this.monitorPage.content()).replace('<head>', `
<head>
<script>
window.haibunStaticPage = true;
window.haibunCapturedMessages = ${JSON.stringify(capturedMessages, null, 2)};
</script>
`);
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
			if (waitForMonitor++ === 1) console.info(`Waiting up to ${20 * .5} seconds for monitor.html`);
			await sleep(500);
		}
	}
}
