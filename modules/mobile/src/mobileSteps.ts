import { OK, TFeatureStep } from '@haibun/core/lib/defs.js';
import { actionNotOK } from '@haibun/core/lib/util/index.js';
import { TStepperSteps } from '@haibun/core/lib/astepper.js';
import { EExecutionMessageType } from '@haibun/core/lib/interfaces/logger.js';
import type HaibunMobileStepper from './haibun-mobile-stepper.js';
import { MOBILE_TESTID, MOBILE_ACCESSIBILITY, MOBILE_XPATH } from './domains.js';
import { DOMAIN_STRING } from '@haibun/core/lib/domain-types.js';
import { getAccessibilityTree } from './lib/lib.js';

const MOBILE_ELEMENT = `${MOBILE_TESTID} | ${MOBILE_ACCESSIBILITY} | ${MOBILE_XPATH} | ${DOMAIN_STRING}`;

async function withStaleRetry<T>(action: () => Promise<T>, maxRetries = 2): Promise<T> {
	let lastError: Error | undefined;
	for (let i = 0; i <= maxRetries; i++) {
		try {
			return await action();
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes('stale element') && i < maxRetries) {
				lastError = error instanceof Error ? error : new Error(String(error));
				await new Promise(resolve => setTimeout(resolve, 200));
				continue;
			}
			throw error;
		}
	}
	throw lastError || new Error('Failed after retries');
}

async function locateByDomain(mobile: HaibunMobileStepper, featureStep: TFeatureStep, where: string) {
	const stepValue = featureStep.action.stepValuesMap[where];
	const value = stepValue.value as string;
	const domain = stepValue.domain;
	const driver = await mobile.getDriver();
	const capabilities = await driver.capabilities;
	const platformName = capabilities.platformName?.toLowerCase();

	if (domain === MOBILE_TESTID) {
		if (platformName === 'android') {
			return await driver.$(`android=new UiSelector().resourceId("${value}")`);
		} else {
			return await driver.$(`~${value}`);
		}
	} else if (domain === MOBILE_ACCESSIBILITY) {
		return await driver.$(`~${value}`);
	} else if (domain === MOBILE_XPATH) {
		return await driver.$(value);
	} else if (domain === DOMAIN_STRING) {
		// For string domain, use text-based selectors
		if (platformName === 'android') {
			return await driver.$(`android=new UiSelector().text("${value}")`);
		} else {
			// iOS: Use predicate string for text matching
			return await driver.$(`-ios predicate string:label == "${value}" OR name == "${value}"`);
		}
	} else {
		throw Error(`unknown domain: ${domain}`);
	}
}

export const mobileSteps = (mobile: HaibunMobileStepper): TStepperSteps => ({

	tap: {
		gwta: `tap {target: ${MOBILE_ELEMENT}}`,
		action: async ({ target }: { target: string }, featureStep: TFeatureStep) => {
			try {
				await withStaleRetry(async () => {
					const element = await locateByDomain(mobile, featureStep, 'target');
					await element.click();
				});
				return OK;
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Failed to tap "${target}": ${errorMessage}`);
			}
		},
	},

	inputText: {
		gwta: `input {text} in {field: ${MOBILE_ELEMENT}}`,
		action: async ({ text, field }: { text: string; field: string }, featureStep: TFeatureStep) => {
			try {
				const element = await locateByDomain(mobile, featureStep, 'field');
				await element.addValue(text);
				return OK;
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Failed to input text in "${field}": ${errorMessage}`);
			}
		},
	},

	clearText: {
		gwta: `clear {field: ${MOBILE_ELEMENT}}`,
		action: async ({ field }: { field: string }, featureStep: TFeatureStep) => {
			try {
				const element = await locateByDomain(mobile, featureStep, 'field');
				await element.clearValue();
				return OK;
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Failed to clear "${field}": ${errorMessage}`);
			}
		},
	},

	waitFor: {
		gwta: `wait for {target: ${MOBILE_ELEMENT}}`,
		action: async ({ target }: { target: string }, featureStep: TFeatureStep) => {
			try {
				const element = await locateByDomain(mobile, featureStep, 'target');
				await element.isDisplayed();
				return OK;
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Element "${target}" not displayed: ${errorMessage}`);
			}
		},
	},

	seeElement: {
		gwta: `see {target: ${MOBILE_ELEMENT}}`,
		action: async ({ target }: { target: string }, featureStep: TFeatureStep) => {
			try {
				const element = await locateByDomain(mobile, featureStep, 'target');
				const isDisplayed = await element.isDisplayed();
				return isDisplayed ? OK : actionNotOK(`Element "${target}" is not visible`);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Element "${target}" not found: ${errorMessage}`);
			}
		},
	},

	seeElementIn: {
		gwta: `in {target: ${MOBILE_ELEMENT}}, see {value: ${MOBILE_ELEMENT}}`,
		action: async ({ target, value }: { target: string; value: string }, featureStep: TFeatureStep) => {
			try {
				const element = await locateByDomain(mobile, featureStep, 'target');
				const elementText = await element.getText();
				return elementText.includes(value)
					? OK
					: actionNotOK(`Expected "${target}" to contain "${value}", but got "${elementText}"`);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Failed to verify value in "${target}": ${errorMessage}`);
			}
		},
	},

	swipeUp: {
		gwta: 'swipe up',
		action: async () => {
			try {
				const driver = await mobile.getDriver();
				const { width, height } = await driver.getWindowSize();
				await driver.performActions([
					{
						type: 'pointer',
						id: 'finger1',
						parameters: { pointerType: 'touch' },
						actions: [
							{ type: 'pointerMove', duration: 0, x: width / 2, y: height * 0.8 },
							{ type: 'pointerDown', button: 0 },
							{ type: 'pause', duration: 100 },
							{ type: 'pointerMove', duration: 600, x: width / 2, y: height * 0.2 },
							{ type: 'pointerUp', button: 0 },
						],
					},
				]);
				return OK;
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Failed to swipe up: ${errorMessage}`);
			}
		},
	},

	swipeDown: {
		gwta: 'swipe down',
		action: async () => {
			try {
				const driver = await mobile.getDriver();
				const { width, height } = await driver.getWindowSize();
				await driver.performActions([
					{
						type: 'pointer',
						id: 'finger1',
						parameters: { pointerType: 'touch' },
						actions: [
							{ type: 'pointerMove', duration: 0, x: width / 2, y: height * 0.2 },
							{ type: 'pointerDown', button: 0 },
							{ type: 'pause', duration: 100 },
							{ type: 'pointerMove', duration: 600, x: width / 2, y: height * 0.8 },
							{ type: 'pointerUp', button: 0 },
						],
					},
				]);
				return OK;
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Failed to swipe down: ${errorMessage}`);
			}
		},
	},

	goBack: {
		gwta: 'go back',
		action: async () => {
			try {
				const driver = await mobile.getDriver();
				await driver.back();
				return OK;
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Failed to go back: ${errorMessage}`);
			}
		},
	},

	hideKeyboard: {
		gwta: 'hide keyboard',
		action: async () => {
			try {
				const driver = await mobile.getDriver();
				const capabilities = await driver.capabilities;
				const platformName = capabilities.platformName?.toLowerCase();

				if (platformName === 'android') {
					await driver.pressKeyCode(4);
					await driver.pause(500);
				} else {
					await driver.hideKeyboard();
					await driver.pause(500);
				}

				return OK;
			} catch (error: unknown) {
				return OK;
			}
		},
	},

	takeScreenshot: {
		gwta: 'take screenshot',
		action: async () => {
			try {
				await mobile.captureScreenshotAndLog('manual-screenshot');
				return OK;
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Failed to take screenshot: ${errorMessage}`);
			}
		},
	},

	getScreenContents: {
		gwta: 'get screen contents',
		action: async () => {
			try {
				const driver = await mobile.getDriver();
				const screenSource = await driver.getPageSource();
				const messageContext = {
					incident: EExecutionMessageType.ACTION,
					artifact: {
						artifactType: 'html' as const,
						html: screenSource || ''
					}
				};
				mobile.getWorld().logger.info('Screen source captured', messageContext);
				return OK;
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Failed to get screen contents: ${errorMessage}`);
			}
		},
	},

	takeMobileSnapshot: {
		gwta: 'take mobile snapshot',
		action: async () => {
			try {
				const driver = await mobile.getDriver();
				const snapshot = await getAccessibilityTree(driver);
				const artifact = {
					artifactType: 'json' as const,
					json: {
						elementCount: snapshot.length,
						elements: snapshot
					}
				};
				const messageContext = {
					incident: EExecutionMessageType.ACTION,
					tag: mobile.getWorld().tag,
					artifact
				};
				mobile.getWorld().logger.info(`Accessibility snapshot captured: ${snapshot.length} elements`, messageContext);
				return OK;
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return actionNotOK(`Failed to take accessibility snapshot: ${errorMessage}`);
			}
		},
	},
});
