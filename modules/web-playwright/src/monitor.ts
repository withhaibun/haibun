import { basename, join } from 'path';
import { chromium, Page } from 'playwright';
import WebPlaywright from './web-playwright.js';
import { OK, TWorld } from '@haibun/core/build/lib/defs.js';
import { TLogLevel, TLogArgs, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { logToElement } from './logToMonitor.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';
import { guessMediaType } from '@haibun/domain-storage/build/domain-storage.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';

export const createMonitorCreator = (webPlaywright: WebPlaywright) => async () => {
	WebPlaywright.monitorPage = await (await (await chromium.launch({ headless: false })).newContext()).newPage();
	await WebPlaywright.monitorPage.goto('about:blank');
	const element = 'haibun-monitor';
	await WebPlaywright.monitorPage.setContent(monitor(element));
	const subscriber = {
		out: async (level: TLogLevel, args: TLogArgs, messageContext?: TMessageContext) => {
			try {
				await WebPlaywright.monitorPage.locator(`#${element}`).evaluate(logToElement, {
					level,
					message: args,
					messageContext: JSON.stringify({ ...(messageContext || {}) }, null, 2),
				});
			} catch (e) {
				if (!webPlaywright.logElementError || webPlaywright.logElementError !== e.message) {
					console.error('error in logToElement', e.message);
					webPlaywright.logElementError = e.message;
				}
			}
		},
	};
	webPlaywright.getWorld().logger.addSubscriber(subscriber);
	webPlaywright.closers.push(async () => {
		webPlaywright.getWorld().logger.removeSubscriber(subscriber);
	});

	WebPlaywright.monitorPage.on('response', async (response) => {
		const url = response.url();
		const contentType = response.headers()['content-type'];
		if (
			contentType &&
			(contentType.includes('text/html') ||
				contentType.includes('application/javascript') ||
				contentType.includes('text/javascript'))
		) {
			try {
				const buffer = await response.body();
				webPlaywright.resourceMap.set(url, buffer);
			} catch (e) {
				console.log('error saving response', url, e);
			}
		}
	});
	return OK;
};
export async function writeMonitor(world: TWorld, storage: AStorage, page: Page, resourceMap) {
	const content = await page.content();
	const monitorLoc = await storage.getCaptureLocation({ ...world, mediaType: EMediaTypes.html });
	const outHtml = join(monitorLoc, 'monitor.html');
	await storage.writeFile(outHtml, content, EMediaTypes.html);

	for (const [url, buffer] of resourceMap) {
		const parsedUrl = new URL(url);
		const filename = basename(parsedUrl.pathname);
		if (filename) {
			const fnType = guessMediaType(filename);
			const artifactLoc = await storage.getCaptureLocation({ ...world, mediaType: fnType });
			const outFile = join(artifactLoc, filename);
			await storage.writeFile(outFile, buffer, fnType);
			//Modify the html file to point to the local files.
			const regex = new RegExp(url, 'g');
			const newContent = (await storage.readFile(outHtml, 'utf-8')).toString().replace(regex, outFile);
			await storage.writeFile(outHtml, newContent, EMediaTypes.html);
		}
	}
	return outHtml;
}

export const monitor = (element: string) => {
	return `
<style>
.haibun-loader {
	border: 4px solid #f3f3f3;
	border-top: 4px solid #3498db;
	border-radius: 50%;
	width: 20px;
	height: 20px;
	animation: spin 9.8s linear infinite;
}

.haibun-log-container {
	display: flex;
	flex-direction: row;
	width: 100%;
	align-items: flex-start;
}
.haibun-header {
  padding-left: 5px;
}
.haibun-details-div {
  min-widh: 150px;
}
.haibun-messages-div {
   margin-left: 50px;
	flex-grow: 1;
}
.haibun-artifact-div {
  display: block;
}

@keyframes spin {
	0% { transform: rotate(0deg); }
	100% { transform: rotate(360deg); }
}
</style>
<div class="haibun-header" style="position: fixed; top: 0; left: 0; width: 100%; background-color: white; z-index: 1000; display: flex; align-items: center;">
  <h1 style="margin-right: auto;">Haibun Monitor</h1>
  <div className="haibun-controls" style="padding: 10px; flex-grow: 1; max-width: 80%;">
    <label for="haibun-debug-level-select">Log level</label>
    <select id="haibun-debug-level-select">
      <option value="error">Error</option>
      <option value="info">Info</option>
      <option value="log" selected>Log</option>
      <option value="debug">Debug</option>
    </select>
  </div>
  </div>
  <div class="haibun-monitor-output" style="padding-top: 70px; box-sizing: border-box;">
		<div style="height: calc(100% - 110px); padding: 10px; overflow-y: scroll; overflow-x: auth;" id="${element}">
      <div class="haibun-disappears"><div class="haibun-loader"></div>Execution output will appear here.</div>
    </div>
  </div>
<script>

  const levelSelect = document.getElementById('haibun-debug-level-select');
  const levels = ['debug', 'log', 'info', 'error'];

  const updateStyles = (selectedLevel) => {
    const selectedIndex = levels.indexOf(selectedLevel);
    let css = '';

    levels.forEach((level, index) => {
      if (index < selectedIndex) {
        css += \`div.haibun-log-container.haibun-level-\${level} { display: none !important; }\n\`;
      } else {
        css += \`div.haibun-log-container.haibun-level-\${level} { display: flex !important; }\n\`;
      }
    });


  let styleElement = document.getElementById('haibun-dynamic-styles');
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'haibun-dynamic-styles';
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = css;
  }

  levelSelect.addEventListener('change', (event) => {
  console.log('change', event.target.value)
    updateStyles(event.target.value);
  });
// Initial style update
updateStyles(levelSelect.value);
</script>
`;
};
