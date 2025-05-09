import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { chromium, Page } from 'playwright';

import { HOST_PROJECT_DIR, TWorld } from '@haibun/core/build/lib/defs.js';
import { TLogLevel, TLogArgs, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { sleep } from '@haibun/core/build/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';
import { getPackageLocation } from '@haibun/core/build/lib/util/workspace-lib.js';

const monitorLocation = join(getPackageLocation(import.meta), '..', '..', 'web', 'monitor.html');
const capturedMessages = [];

export const createMonitorPageAndSubscriber = (headless: boolean) => async () => {
	console.info(`Creating new monitor page`);
	const browser = await chromium.launch({ headless });
	const context = await browser.newContext();
	const monitorPage = await context.newPage();

	await waitForMonitorPage();
	await monitorPage.goto(pathToFileURL(monitorLocation).toString(), { waitUntil: 'networkidle' });

	await monitorPage.evaluate(() => {
		document.body.dataset.haibunRuntime = 'true';
	});

	const subscriber = {
		out: async (level: TLogLevel, message: TLogArgs, messageContext?: TMessageContext) => {
			capturedMessages.push({ level, message, messageContext })
			if (!monitorPage || monitorPage.isClosed()) {
				console.error("Monitor page closed, cannot send logs.");
				return;
			}
			try {
				await monitorPage.evaluate((entry) => {
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
					console.log('Problematic messageContext object before stringify:', messageContext);
				}
				// Handle page closure or other evaluate errors
				else if (e instanceof Error && !e.message.includes('Target page, context or browser has been closed')) {
					console.error('Error sending log to monitor via evaluate:', e.message);
				}
				throw (e);
			}
		},
	};

	return { monitorPage, subscriber };
};

// Function to write the final monitor HTML (adapted)
export async function writeMonitor(world: TWorld, storage: AStorage, page: Page) {
	if (!page || page.isClosed()) {
		world.logger.error('Monitor page is closed, cannot write monitor file.');
		return;
	}
	await sleep(500); // Allow final rendering

	await page.evaluate(() => {
		delete document.body.dataset.haibunRuntime;
	});


	const content = await page.content();

	const monitorLoc = await storage.getCaptureLocation({ ...world, mediaType: EMediaTypes.html });
	const outHtml = join(monitorLoc, 'monitor.html');
	const hostPath = process.env[HOST_PROJECT_DIR];
	const monitorPath = pathToFileURL(hostPath ? resolve(hostPath, outHtml) : resolve(outHtml));
	world.logger.info(`Wrote monitor HTML to ${monitorPath}`);
	await storage.writeFile(outHtml, content, EMediaTypes.html);
	const outMessages = join(monitorLoc, 'monitor.json');
	await storage.writeFile(outMessages, JSON.stringify(capturedMessages, null, 2), EMediaTypes.html);
}

async function waitForMonitorPage() {
	let waitForMonitor = 0;
	while (!existsSync(monitorLocation) && waitForMonitor < 20) {
		if (waitForMonitor++ === 1) console.info(`Waiting up to ${20 * .5} seconds for monitor.html`);
		await sleep(500);
	}
}
