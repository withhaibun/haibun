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

const selectLevels = () => {
	const levelSelect = document.getElementById('haibun-debug-level-select');
	const levels = ['debug', 'log', 'info', 'error'];

	const updateStyles = (selectedLevel) => {
		const selectedIndex = levels.indexOf(selectedLevel);
		let css = '';

		levels.forEach((level, index) => {
			if (index < selectedIndex) {
				css += `div.haibun-log-container.haibun-level-${level} { display: none !important; }\n`;
			} else {
				css += `div.haibun-log-container.haibun-level-${level} { display: flex !important; }\n`;
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
		const target = (event.target as HTMLSelectElement)
		console.log('change', target.value)
		updateStyles(target.value);
	});
	// Initial style update
	updateStyles((levelSelect as HTMLSelectElement).value);

	// haibunVideo
	const haibunVideo: HTMLElement = document.querySelector('#haibun-video');

	function setDefaultPosition() {
		haibunVideo.style.transform = `scale(1)`;
		haibunVideo.style.top = `90px`;
		haibunVideo.style.right = `35px`;
	}
	function setExpandedPosition() {
		haibunVideo.style.transform = `scale(2)`;
		haibunVideo.style.top = `200px`;
		haibunVideo.style.right = `200px`;
	}

	setExpandedPosition();

	haibunVideo.addEventListener('mouseover', () => {
		setExpandedPosition();
	});

	haibunVideo.addEventListener('mouseout', () => {
		setDefaultPosition();
	});
};

export const monitor = (element: string) => {
	return `
<head>
<link rel="preconnect" href="https://fonts.googleapis.com">
 <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
 <link href="https://fonts.googleapis.com/css2?family=Roboto&family=Roboto+Mono&display=swap" rel="stylesheet">

<style>
/* main css */
body {
  font-family: 'Roboto', sans-serif; /* Clean, readable sans-serif */
  line-height: 1.6;
  margin: 20px;
  color: #333;
  background-color: #f8f8f8;
}

h1, h2, h3 {
  font-family: 'Roboto', sans-serif;
  color: #222;
  line-height: 1.2;
  font-weight: 600;
}

h1 {
  font-size: 2em;
  margin-bottom: 0.5em;
}

h2 {
  font-size: 1.6em;
  margin-bottom: 0.4em;
}

h3 {
  font-size: 1.3em;
  margin-bottom: 0.3em;
}

p {
  margin-bottom: 1em;
  font-size: 0.95em; /* Slightly smaller for body text */
}

a {
  color: #007bff;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

ul, ol {
  margin-bottom: 1em;
  font-size: 0.95em;
}

li {
  margin-bottom: 0.5em;
}

code, pre {
  background-color: #e8e8e8;
  padding: 5px 10px;
  border-radius: 3px;
  font-family: 'Roboto Mono', monospace; /* Monospace for code */
  font-size: 0.85em;
  line-height: 1.4;
  overflow-x: auto;
}

pre {
  white-space: pre-wrap;
}

blockquote {
  border-left: 3px solid #ddd;
  padding-left: 10px;
  margin-left: 0;
  margin-bottom: 1em;
  font-style: italic;
  font-size: 0.95em;
}

/* elements */
.haibun-loader {
	border: 4px solid #f3f3f3;
	border-top: 4px solid #3498db;
	border-radius: 50%;
	width: 20px;
	height: 20px;
	animation: spin 9.8s linear infinite;
}
.details-type {
	background-color:rgb(208, 182, 154);
	margin: 4px;
	padding: 0 4px 0 4px;
	border-radius: .5rem;
}
.disappeared {
	display: none;
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

#haibun-video {
	display: none;
  opacity: 0.5;
	position: fixed;
	z-index: 1001;
	color: white;
	align-items: center;
	justify-content: center;
}
#haibun-video:hover {
  opacity: 1;
}

@keyframes spin {
	0% { transform: rotate(0deg); }
	100% { transform: rotate(360deg); }
}
</style>
</head>
<body>
<div class="haibun-header" style="position: fixed; height: 7vh; top: 0; left: 0; width: 100%; background-color: white; z-index: 1000; display: flex; align-items: center;">
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
	<div id="haibun-video">Video Content</div>
  <div style="height: calc(100% - 8vh); padding-top: 8vh; overflow-y: scroll; overflow-x: auth;" id="${element}">
	  <div class="haibun-disappears"><div class="haibun-loader"></div>Execution output will appear here.</div>
	</div>
<script>
${selectLevels.toString().replace(/\(\) => \{/, '').replace(/}$/, '')}
</script>
</body>
`;
};
