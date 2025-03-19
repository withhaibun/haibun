import { basename, join } from 'path';
import { chromium, Page } from 'playwright';
import WebPlaywright from './web-playwright.js';
import { OK } from '@haibun/core/build/lib/defs.js';
import { TLogLevel, TLogArgs, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { logToElement } from './logToElement.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';
import { guessMediaType } from '@haibun/domain-storage/build/domain-storage.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';

export const createDashboardCreator = (webPlaywright: WebPlaywright) => async () => {
	WebPlaywright.dashboardPage = await (await (await chromium.launch({ headless: false })).newContext()).newPage();
	await WebPlaywright.dashboardPage.goto('about:blank');
	const element = 'haibun-dashboard';
	await WebPlaywright.dashboardPage.setContent(dashboard(element));
	const subscriber = {
		out: async (level: TLogLevel, args: TLogArgs, messageContext?: TMessageContext) => {
			try {
				await WebPlaywright.dashboardPage.locator(`#${element}`).evaluate(logToElement, {
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

	WebPlaywright.dashboardPage.on('response', async (response) => {
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
export async function writeDashboard(storage: AStorage, loc: string, page: Page, resourceMap) {
	const content = await page.content();
	const outHtml = join(loc, 'dashboard.html');
	storage.writeFile(outHtml, content, EMediaTypes.html);

	for (const [url, buffer] of resourceMap) {
		const parsedUrl = new URL(url);
		const filename = basename(parsedUrl.pathname);
		if (filename) {
			const fnType = guessMediaType(filename);
			const outFile = join(loc, filename);
			storage.writeFile(outFile, buffer, fnType);
			//Modify the html file to point to the local files.
			const regex = new RegExp(url, 'g');
			const newContent = (await storage.readFile(outHtml, 'utf-8')).toString().replace(regex, outFile);
			storage.writeFile(outHtml, newContent, EMediaTypes.html);
		}
	}
	return outHtml;
}

export const dashboard = (element: string) => {
	return `
<div class="haibun-header" style="position: fixed; top: 0; left: 0; width: 100%; background-color: white; z-index: 1000; display: flex; align-items: center;">
  <h1 style="margin-right: auto;">Haibun Dashboard</h1>
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
  <div class="haibun-dashboard-output" style="padding-top: 100px; box-sizing: border-box;">
    <div style="height: calc(100% - 100px); width: 100%; overflow: auto" id="${element}"></div>
    <div class="haibun-disappears"><div class="haibun-loader"></div>Execution output will appear here.</div>
  </div>
<script>
// when the select is changed, the .haibun-level-{level} css visbility should change so all levels "lower" than current aren't visibleo
// order: debug, log, info, error

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
