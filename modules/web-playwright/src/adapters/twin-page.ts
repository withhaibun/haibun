/** The twin of actuality's pages: a page in a browser of its own, which copies each element a step locates, and is written to a file at each new address. */
import { chromium, type Locator, type Page } from "playwright";
import { join } from "node:path";
import type { AStorage } from "@haibun/domain-storage/AStorage.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { actualURI } from "@haibun/core/lib/util/node/actualURI.js";
import type { TTwin } from "../ports.js";

type TElementData = {
	tagName: string;
	attributes: { name: string; value: string }[];
	dataURL?: string;
};

/** The page methods that locate an element; the twin copies each element they locate. */
const LOCATING_METHODS = ["locator", "getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByAltText", "getByTitle", "getByTestId"] as const;

export class TwinPage implements TTwin {
	currentURL?: string;
	sequence = 0;
	wroteElement = false;

	private constructor(
		private world: TWorld,
		private storage: AStorage,
		private twinPage: Page,
	) {}

	/** A twin of actuality's pages, drawn in a browser of its own. */
	static async create(world: TWorld, storage: AStorage, headless: boolean): Promise<TwinPage> {
		const browser = await chromium.launch({ headless });
		const twin = new TwinPage(world, storage, await (await browser.newContext()).newPage());
		await twin.setupNewTwinPage("about:blank");
		return twin;
	}

	async setupNewTwinPage(currentURL: string) {
		this.wroteElement = false;
		await this.twinPage.evaluate((url) => (document.body.innerHTML = `<h1>${url}</h1>\n`), currentURL);
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
		for (const method of LOCATING_METHODS) {
			const original = page[method] as (...args: unknown[]) => Locator;
			(page[method] as (...args: unknown[]) => unknown) = (...args: unknown[]) => {
				const located = original.apply(page, args);
				this.duplicateTwinElement(located).catch((error: unknown) => {
					this.world.eventLogger.error(`the twin didn't copy the element ${String(method)} located with ${JSON.stringify(args)}: ${String(error)}`);
				});
				return located;
			};
		}
		page.__instrumented = true;
	}
	async writePage() {
		const twinLoc = await this.storage.getCaptureLocation(this.world);
		this.sequence++;
		const content = await this.twinPage.content();
		const fn = `twinned-${this.sequence}.html`;
		const outHtmlFile = join(twinLoc, fn);

		this.world.eventLogger.info(`Writing twin HTML to ${actualURI(outHtmlFile)}`);
		await this.storage.writeFile(outHtmlFile, content);
		void this.twinPage.evaluate(() => (document.body.innerHTML = ""));
	}
	duplicateTwinElement = async (locator: Locator) => {
		const elementData = await locator.evaluate((element: Element) => {
			if (!element) {
				return null;
			}

			const getElementData = (el: Element): TElementData => ({
				tagName: el.tagName,
				attributes: Array.from(el.attributes).map((attr: Attr) => ({
					name: attr.name,
					value: attr.value,
				})),
			});

			const parents: TElementData[] = [];
			let parent = element.parentElement;
			while (parent && parent.tagName !== "BODY") {
				parents.unshift(getElementData(parent));
				parent = parent.parentElement;
			}

			const data: { parents: TElementData[]; outerHTML: string; dataURL?: string } = {
				parents,
				outerHTML: element.outerHTML,
			};

			if (element.tagName === "CANVAS") {
				data.dataURL = (element as HTMLCanvasElement).toDataURL();
			}

			return data;
		});

		if (!elementData) {
			throw new Error(`the twin can't copy ${String(locator)}: the locator doesn't find an element`);
		}

		await this.twinPage.evaluate((data) => {
			let currentParent: Element = document.body;

			const buildSelector = (elementData: TElementData) => {
				return elementData.tagName.toLowerCase() + elementData.attributes.map((a) => `[${a.name}="${a.value}"]`).join("");
			};

			data.parents.forEach((p: TElementData) => {
				const selector = buildSelector(p);
				const existingElement = currentParent.querySelector(`:scope > ${selector}`);

				if (!existingElement) {
					const newElement = document.createElement(p.tagName);
					p.attributes.forEach((attr) => {
						newElement.setAttribute(attr.name, attr.value);
					});
					currentParent.appendChild(newElement);
					currentParent = newElement;
				} else {
					currentParent = existingElement;
				}
			});

			const temp = document.createElement("div");
			temp.innerHTML = data.outerHTML;
			const newElementNode = temp.firstChild as Element;
			if (newElementNode) {
				const finalSelector =
					newElementNode.tagName.toLowerCase() +
					Array.from(newElementNode.attributes)
						.map((a: Attr) => `[${a.name}="${a.value}"]`)
						.join("");
				let elementToDrawOn: Element;
				const existingElement = currentParent.querySelector(`:scope > ${finalSelector}`);
				if (!existingElement) {
					currentParent.insertAdjacentHTML("beforeend", data.outerHTML);
					const inserted = currentParent.lastElementChild;
					if (!inserted) throw new Error(`the twin drew ${finalSelector} and doesn't hold an element after it`);
					elementToDrawOn = inserted;
				} else {
					elementToDrawOn = existingElement;
				}

				if (data.dataURL && elementToDrawOn && elementToDrawOn.tagName === "CANVAS") {
					const canvas = elementToDrawOn as HTMLCanvasElement;
					const ctx = canvas.getContext("2d");
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
