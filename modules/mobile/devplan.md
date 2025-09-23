A Haibun project for testing an application is a lightweight setup. It typically consists of a **`package.json`** file to manage versioned Haibun npm modules and define test scripts, a **`config.json`** to declare which steppers to use, and the **`features/`** and **`backgrounds/`** directories that contain the tests. This structure allows for extensive testing using pre-existing, versioned steppers without needing to write new stepper code.

-----

### Combining Steppers

Haibun's architecture is designed to combine multiple steppers in a single test run. This allows a test to orchestrate actions across different application layers. For example, a single feature could use:

  * A custom **`@haibun/mobile-appium`** stepper to interact with a mobile app.
  * **`@haibun/web-server-express`** to host a local web application.
  * **`@haibun/storage-fs`** to confirm that a file was created on the filesystem.

The **Resolver** phase automatically maps each step in a feature file to the specific stepper that implements it, enabling seamless integration.

-----

### The Haibun Architecture

Haibun processes tests in three distinct phases:

  * **Collector**: Finds and reads all project files, including `config.json`, features, and backgrounds.
  * **Resolver**: Connects plain-text steps from feature files to their code implementations within the loaded steppers.
  * **Executor**: Runs the resolved test plan, calling lifecycle hooks on the steppers at each stage.

-----

### The Role of a Haibun Stepper

A **stepper** is a self-contained plugin that provides a library of test commands for a specific system (e.g., a mobile app, a web browser, or a REST API).

#### Option Declaration and Validation

Steppers declare their available options in a static `options` object. This provides a self-documenting way to manage configuration, with features for descriptions, input parsing, and dependency validation.

#### Stepper Initialization and Cycles

A stepper's logic is managed through methods from the `IStepper` and `IStepperCycles` interfaces.

  * **`setWorld()`**: This method is called during setup for the stepper to retrieve its validated options and configure its internal state.
  * **`cycles`**: This property contains lifecycle hooks (like `startExecution` and `endExecution`) that the Executor calls, allowing the stepper to manage long-lived resources like an Appium session.

-----

### Authoring Tests

Haibun tests are designed to be both executable and readable.

  * **Features**: A `.feature` file blends **actionable steps** with **narrative prose**. The narrative explains the context, while the steps are implemented by the configured steppers. Comments are denoted with `;;`.
  * **Backgrounds**: These are reusable scripts that can define **selector dictionaries** or contain **reusable action sequences**. The `set` command used to create these dictionaries is a core feature, making it available without needing a specific implementation in every stepper.

-----

### Example Test Project

This example shows how a project would be configured to use a pre-built mobile stepper.

#### 1\. Project Configuration

**`config.json`**
This file lists all the steppers that the Resolver should make available for the tests.

```json
{
    "steppers": [
        "@haibun/core",
        "@haibun/mobile-appium"
    ]
}
```

**`package.json` (scripts section)**
Tests are run via npm scripts, which prefix the command with the necessary environment variables for stepper options.

```json
  "scripts": {
    "test:android": "HAIBUN_O_MOBILEAPPIUM_PLATFORMNAME=Android HAIBUN_O_MOBILEAPPIUM_APP=/path/to/app.apk haibun-cli"
  }
```

#### 2\. Mobile Appium Stepper Code (`MobileAppiumStepper.ts`)

This is the implementation of the stepper itself. It manages the Appium session and contains the logic for interacting with the mobile application.

```typescript
import { AStepper, IStepper, IStepperCycles, TWorld, TNamed, OK, KO, stringOrError } from '@haibun/core/build/lib/defs';
import { remote, Browser } from 'webdriverio';

export class MobileAppiumStepper extends AStepper implements IStepper {
    driver: Browser;
    elementMap: Map<string, string> = new Map();
    private wdioOptions: any = {};

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
            this.driver = await remote(this.wdioOptions);
        },
        startScenario: async () => {
            await this.driver.reset();
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
                    return { ...KO, details: `Element "${name}" not defined.` };
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
                    return { ...KO, details: `Element "${name}" not defined.` };
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
```

#### 3\. Test Files

**`backgrounds/login-selectors.feature`**
This background uses the `set` command to create a dictionary of locators.

```gherkin
;; This background file defines the locators for the login screen.
set Username input as accessibility ID to "username-input"
set Password input as accessibility ID to "password-input"
set Login button as accessibility ID to "login-button"
```

**`features/login.feature`**
This feature file uses steps that will be resolved to the `@haibun/mobile-appium` stepper.

```gherkin
Feature: User Login

Backgrounds: login-selectors

This feature tests the user's ability to log into the application.
First, the user is presented with the main login screen where they must enter their credentials.

Type "testuser" in Username input
Type "password123" in Password input

After entering credentials, the user must tap the final button to proceed.

Tap on Login button
```
