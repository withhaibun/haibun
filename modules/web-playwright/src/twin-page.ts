import { chromium, Page } from "playwright";

import { AStorage } from '@haibun/domain-storage/AStorage.js';
import { WebPlaywright } from "./web-playwright.js";
import { TWorld } from "@haibun/core/lib/defs.js";
import { EMediaTypes } from "@haibun/domain-storage/media-types.js";
import { join } from "path";
import { actualURI } from "@haibun/core/lib/util/actualURI.js";


type TElementData = {
	tagName: string;
	attributes: { name: string; value: string }[];
	dataURL?: string;
};

export class TwinPage {
	twinPage: Page;
	currentURL: string;
	sequence = 0;
	world: TWorld;
	wroteElement = false;

	constructor(private wp: WebPlaywright, private storage: AStorage, private headless: boolean = true) { }
	updateWorld(world: TWorld) {
		this.world = world;
	}

	async initTwin() {
		const browser = await chromium.launch({ headless: this.headless });
		const context = await browser.newContext();
		this.twinPage = await context.newPage();
		await this.setupNewTwinPage('about:blank');
	}
	async setupNewTwinPage(currentURL: string) {
		this.wroteElement = false;
		await this.twinPage.evaluate((url) => document.body.innerHTML = `<h1>${url}</h1>\n`, currentURL);
	}

	async patchPage(page: Page & { __instrumented?: boolean }) {
		const currentURL = page.url();
		if (currentURL !== this.currentURL) {
			if (this.wroteElement) {
				await this.writePage();
			}
			await this.setupNewTwinPage(currentURL);
			this.currentURL = currentURL;
		}

		if (page.__instrumented) {
			return;
		}
		const methodsToInstrument: (keyof Page)[] = ['locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId'];

		const instrument = <T extends keyof Page>(method: T) => {
			const originalMethod = page[method] as (...args: unknown[]) => unknown;
			(page[method] as (...args: unknown[]) => unknown) = (...args: unknown[]) => {
				const patched = originalMethod.apply(page, args);
				this.duplicateTwinElement(patched).catch(error => {
					this.world.eventLogger.error(`Error duplicating element for ${String(method)} with args: ${JSON.stringify(args)}`);
					// Could emit error artifact if needed
				});
				return patched;
			};
		}

		for (const method of methodsToInstrument) {
			instrument(method);
		}
		page.__instrumented = true;
	}
	async writePage() {
		const twinLoc = await this.storage.getCaptureLocation({ ...this.world, mediaType: EMediaTypes.html });
		this.sequence++;
		const content = await this.twinPage.content();
		const fn = `twinned-${this.sequence}.html`;
		const outHtmlFile = join(twinLoc, fn);

		this.world.eventLogger.info(`Writing twin HTML to ${actualURI(outHtmlFile)}`);
		await this.storage.writeFile(outHtmlFile, content, EMediaTypes.html);
		void this.twinPage.evaluate(() => document.body.innerHTML = '');
	}
	duplicateTwinElement = async (locator) => {
		const elementData = await locator.evaluate(element => {
			if (!element) {
				return null;
			}

			const getElementData = (el: Element): TElementData => ({
				tagName: el.tagName,
				attributes: Array.from(el.attributes).map((attr: Attr) => ({
					name: attr.name,
					value: attr.value
				}))
			});

			const parents: TElementData[] = [];
			let parent = element.parentElement;
			while (parent && parent.tagName !== 'BODY') {
				console.log('getting parent', parent.tagName);
				parents.unshift(getElementData(parent));
				parent = parent.parentElement;
			}

			const data: { parents: TElementData[], outerHTML: string, dataURL?: string } = {
				parents,
				outerHTML: element.outerHTML
			};

			if (element.tagName === 'CANVAS') {
				data.dataURL = (element as HTMLCanvasElement).toDataURL();
			}

			return data;
		});

		if (!elementData) {
			throw Error(`Element ${locator} not found with locator`);
		}

		await this.twinPage.evaluate(data => {
			let currentParent: Element = document.body;

			const buildSelector = (elementData: TElementData) => {
				return elementData.tagName.toLowerCase() + elementData.attributes.map(a => `[${a.name}="${a.value}"]`).join('');
			};

			data.parents.forEach((p: TElementData) => {
				const selector = buildSelector(p);
				const existingElement = currentParent.querySelector(`:scope > ${selector}`);

				if (!existingElement) {
					const newElement = document.createElement(p.tagName);
					p.attributes.forEach(attr => {
						newElement.setAttribute(attr.name, attr.value);
					});
					currentParent.appendChild(newElement);
					currentParent = newElement;
				} else {
					currentParent = existingElement;
				}
			});

			const temp = document.createElement('div');
			temp.innerHTML = data.outerHTML;
			const newElementNode = temp.firstChild as Element;
			if (newElementNode) {
				const finalSelector = newElementNode.tagName.toLowerCase() + Array.from(newElementNode.attributes).map((a: Attr) => `[${a.name}="${a.value}"]`).join('');
				let elementToDrawOn: Element;
				const existingElement = currentParent.querySelector(`:scope > ${finalSelector}`);
				if (!existingElement) {
					currentParent.insertAdjacentHTML('beforeend', data.outerHTML);
					elementToDrawOn = currentParent.lastElementChild;
				} else {
					elementToDrawOn = existingElement;
				}

				if (data.dataURL && elementToDrawOn && elementToDrawOn.tagName === 'CANVAS') {
					const canvas = elementToDrawOn as HTMLCanvasElement;
					const ctx = canvas.getContext('2d');
					if (ctx) {
						const img = new Image();
						img.onload = () => {
							canvas.width = img.width;
							canvas.height = img.height;
							ctx.drawImage(img, 0, 0);
						};
						img.src = data.dataURL;
					}
				}
			}
		}, elementData);
		this.wroteElement = true;
	};
}
