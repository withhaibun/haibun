import { remote, Browser } from 'webdriverio';

import { actionNotOK, getStepperOption, stringOrError } from '@haibun/core/lib/util/index.js';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { TWorld, IStepperCycles, TNamed, OK } from '@haibun/core/lib/defs.js';

export default class HaibunMobileStepper extends AStepper {
	driver: Browser;
	elementMap: Map<string, string> = new Map();
	private wdioOptions = {};

	options = {
		PLATFORMNAME: {
			desc: 'The mobile platform to test (e.g., "Android", "iOS")',
			parse: (input: string) => stringOrError(input),
			required: true,
		},
		APP: {
			desc: 'The absolute path to the .apk or .app file',
			parse: (input: string) => stringOrError(input),
			required: true,
		},
	};

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.wdioOptions = {
			port: 4723,
			path: '/wd/hub',
			capabilities: {
				platformName: getStepperOption(this, 'PLATFORMNAME', world.moduleOptions),
				'appium:app': getStepperOption(this, 'APP', world.moduleOptions),
				'appium:automationName': getStepperOption(this, 'PLATFORMNAME', world.moduleOptions) === 'Android' ? 'UiAutomator2' : 'XCUITest'
			}
		};
	}

	cycles: IStepperCycles = {
		startExecution: async () => {
		},
		startScenario: async () => {
		},
		endExecution: async () => {
			if (this.driver) {
				await this.driver.deleteSession();
			}
		},
	};

	steps = {
		'Tap on {name}': {
			action: async ({ name }: TNamed) => {
				const selector = this.elementMap.get(name);
				if (!selector) {
					return actionNotOK(`Element "${name}" not defined.`);
				}
				const element = await this.driver.$(selector);
				// Advice: Always wait for an element to be visible before interacting.
				await element.waitForDisplayed({ timeout: 15000 });
				await element.click();
				return OK;
			},
		},
		'Type {text} in {name}': {
			action: async ({ text, name }: TNamed) => {
				const selector = this.elementMap.get(name);
				if (!selector) {
					return actionNotOK(`Element "${name}" not defined.`);
				}
				const element = await this.driver.$(selector);
				// Advice: Waiting is crucial for reliability with input fields.
				await element.waitForDisplayed({ timeout: 15000 });
				await element.setValue(text);
				return OK;
			}
		}
	};
}
