import { OK, TFeatureStep } from '@haibun/core/lib/defs.js';
import { actionNotOK } from '@haibun/core/lib/util/index.js';
import { TStepperSteps } from '@haibun/core/lib/astepper.js';
import type HaibunMobileStepper from './haibun-mobile-stepper.js';
import { MOBILE_TESTID, MOBILE_ACCESSIBILITY, MOBILE_XPATH } from './domains.js';
import { DOMAIN_STRING } from '@haibun/core/lib/domain-types.js';

const MOBILE_ELEMENT = `${MOBILE_TESTID} | ${MOBILE_ACCESSIBILITY} | ${MOBILE_XPATH} | ${DOMAIN_STRING}`;

async function locateByDomain(mobile: HaibunMobileStepper, featureStep: TFeatureStep, where: string) {
  const stepValue = featureStep.action.stepValuesMap[where];
  const value = stepValue.value as string;
  const driver = await mobile.getDriver();
  return await driver.$(value);
}

export const interactionSteps = (mobile: HaibunMobileStepper): TStepperSteps => ({

  tap: {
    gwta: `tap {target: ${MOBILE_ELEMENT}}`,
    action: async ({ target }: { target: string }, featureStep: TFeatureStep) => {
      try {
        const element = await locateByDomain(mobile, featureStep, 'target');
        await element.waitForDisplayed({ timeout: mobile.timeout });
        await element.click();
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
        await element.waitForDisplayed({ timeout: mobile.timeout });
        await element.setValue(text);
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
        await element.waitForDisplayed({ timeout: mobile.timeout });
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
        await element.waitForDisplayed({ timeout: mobile.timeout });
        return OK;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return actionNotOK(`Element "${target}" not displayed: ${errorMessage}`);
      }
    },
  },

  shouldSeeElement: {
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

  shouldSeeText: {
    gwta: `see text {text}`,
    action: async ({ text }: { text: string }) => {
      try {
        const driver = await mobile.getDriver();
        const element = await driver.$(`~${text}`);
        const exists = await element.isDisplayed();
        return exists ? OK : actionNotOK(`Text "${text}" not found on screen`);
      } catch (error: unknown) {
        return actionNotOK(`Text "${text}" not found on screen`);
      }
    },
  },

  shouldSeeTextIn: {
    gwta: `in {target: ${MOBILE_ELEMENT}}, see {text}`,
    action: async ({ target, text }: { target: string; text: string }, featureStep: TFeatureStep) => {
      try {
        const element = await locateByDomain(mobile, featureStep, 'target');
        const elementText = await element.getText();
        return elementText.includes(text)
          ? OK
          : actionNotOK(`Expected "${target}" to contain "${text}", but got "${elementText}"`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return actionNotOK(`Failed to verify text in "${target}": ${errorMessage}`);
      }
    },
  },

  elementTextIs: {
    gwta: `{target: ${MOBILE_ELEMENT}} text is {text}`,
    action: async ({ target, text }: { target: string; text: string }, featureStep: TFeatureStep) => {
      try {
        const element = await locateByDomain(mobile, featureStep, 'target');
        const elementText = await element.getText();
        return elementText === text
          ? OK
          : actionNotOK(`Expected "${target}" text to be "${text}", but got "${elementText}"`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return actionNotOK(`Failed to get text from "${target}": ${errorMessage}`);
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
        await driver.hideKeyboard();
        return OK;
      } catch (error: unknown) {
        // Keyboard might not be visible, that's OK
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
});
