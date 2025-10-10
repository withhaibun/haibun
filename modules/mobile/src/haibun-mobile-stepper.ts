import { Browser } from 'webdriverio';
import { pathToFileURL } from 'url';

import { TWorld, TStepResult } from '@haibun/core/lib/defs.js';
import { AStepper, IHasCycles, IHasOptions } from '@haibun/core/lib/astepper.js';
import { getStepperOption, stringOrError, intOrError, boolOrError, findStepperFromOption, optionOrError } from '@haibun/core/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/AStorage.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';
import { EExecutionMessageType } from '@haibun/core/lib/interfaces/logger.js';

import { DriverFactory, TDriverFactoryOptions, TPlatformName, TAutomationName, TMobileCapabilities } from './DriverFactory.js';
import { cycles, captureScreenshot } from './cycles.js';
import { mobileSteps } from './mobileSteps.js';

export default class HaibunMobileStepper extends AStepper implements IHasOptions, IHasCycles {
	cycles = cycles(this);
	static STORAGE = 'STORAGE';

	options = {
		PLATFORMNAME: {
			desc: 'The mobile platform to test (Android or iOS)',
			parse: (input: string) => optionOrError(input, ['Android', 'iOS']),
			required: true,
		},
		APP: {
			desc: 'The absolute path to the .apk (Android) or .app (iOS) file. Not required if APP_PACKAGE is provided.',
			parse: (input: string) => stringOrError(input),
		},
		APP_PACKAGE: {
			desc: 'Android: Package name of an already-installed app (e.g., com.example.app)',
			parse: (input: string) => stringOrError(input),
		},
		APP_ACTIVITY: {
			desc: 'Android: Activity name to launch (e.g., .MainActivity). Used with APP_PACKAGE.',
			parse: (input: string) => stringOrError(input),
		},
		BUNDLE_ID: {
			desc: 'iOS: Bundle identifier of an already-installed app (e.g., com.example.app)',
			parse: (input: string) => stringOrError(input),
		},
		[HaibunMobileStepper.STORAGE]: {
			desc: 'Storage for screenshots and artifacts',
			parse: (input: string) => stringOrError(input),
			required: true,
		},
		DEVICE_NAME: {
			desc: 'Device name or emulator/simulator name',
			parse: (input: string) => stringOrError(input),
		},
		PLATFORM_VERSION: {
			desc: 'Platform version (e.g., "13.0" for Android, "17.0" for iOS)',
			parse: (input: string) => stringOrError(input),
		},
		UDID: {
			desc: 'Device UDID for real devices',
			parse: (input: string) => stringOrError(input),
		},
		APPIUM_HOST: {
			desc: 'Appium server host (default: 127.0.0.1)',
			parse: (input: string) => stringOrError(input),
		},
		APPIUM_PORT: {
			desc: 'Appium server port (default: 4723)',
			parse: (input: string) => intOrError(input),
		},
		TIMEOUT: {
			desc: 'Element timeout in milliseconds (default: 15000)',
			parse: (input: string) => intOrError(input),
		},
		RESET_BEHAVIOR: {
			desc: 'How to reset app between scenarios: none, reset, or relaunch (default: reset)',
			parse: (input: string) => optionOrError(input, ['none', 'reset', 'relaunch']),
		},
		NO_RESET: {
			desc: 'Do not reset app state before session (true or false)',
			parse: (input: string) => boolOrError(input),
		},
		FULL_RESET: {
			desc: 'Perform a full reset (reinstall app) before session (true or false)',
			parse: (input: string) => boolOrError(input),
		},
		USE_BROWSERSTACK: {
			desc: 'Use BrowserStack for testing (true or false)',
			parse: (input: string) => boolOrError(input),
		},
		BROWSERSTACK_USERNAME: {
			desc: 'BrowserStack username',
			parse: (input: string) => stringOrError(input),
			dependsOn: ['USE_BROWSERSTACK'],
		},
		BROWSERSTACK_ACCESS_KEY: {
			desc: 'BrowserStack access key',
			parse: (input: string) => stringOrError(input),
			dependsOn: ['USE_BROWSERSTACK'],
		},
		LOG_LEVEL: {
			desc: 'Appium/WebDriver log level (trace, debug, info, warn, error, silent)',
			parse: (input: string) => optionOrError(input, ['trace', 'debug', 'info', 'warn', 'error', 'silent']),
		},
	};

	driver?: Browser;
	driverFactory?: DriverFactory;
	hasFactory = false;
	storage?: AStorage;
	timeout = 15000;
	resetBehavior: 'none' | 'reset' | 'relaunch' = 'reset';
	factoryOptions?: TDriverFactoryOptions;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);

		// Get configuration
		const platformName = getStepperOption(this, 'PLATFORMNAME', world.moduleOptions) as TPlatformName;
		const app = getStepperOption(this, 'APP', world.moduleOptions);
		const appPackage = getStepperOption(this, 'APP_PACKAGE', world.moduleOptions);
		const appActivity = getStepperOption(this, 'APP_ACTIVITY', world.moduleOptions);
		const bundleId = getStepperOption(this, 'BUNDLE_ID', world.moduleOptions);
		const deviceName = getStepperOption(this, 'DEVICE_NAME', world.moduleOptions);
		const platformVersion = getStepperOption(this, 'PLATFORM_VERSION', world.moduleOptions);
		const udid = getStepperOption(this, 'UDID', world.moduleOptions);
		const host = getStepperOption(this, 'APPIUM_HOST', world.moduleOptions) || '127.0.0.1';
		const port = parseInt(getStepperOption(this, 'APPIUM_PORT', world.moduleOptions) || '4723');
		const noReset = getStepperOption(this, 'NO_RESET', world.moduleOptions) === 'true';
		const fullReset = getStepperOption(this, 'FULL_RESET', world.moduleOptions) === 'true';
		const useBrowserStack = getStepperOption(this, 'USE_BROWSERSTACK', world.moduleOptions) === 'true';
		const logLevel = (getStepperOption(this, 'LOG_LEVEL', world.moduleOptions) || 'info') as 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

		this.storage = findStepperFromOption(steppers, this, world.moduleOptions, HaibunMobileStepper.STORAGE);
		this.timeout = parseInt(getStepperOption(this, 'TIMEOUT', world.moduleOptions) || '15000');
		this.resetBehavior = (getStepperOption(this, 'RESET_BEHAVIOR', world.moduleOptions) || 'reset') as 'none' | 'reset' | 'relaunch';

		// Determine automation name based on platform
		const automationName: TAutomationName = platformName === 'Android' ? 'UiAutomator2' : 'XCUITest';

		// Build capabilities - support both app file path and installed app scenarios
		const capabilities: TMobileCapabilities = {
			platformName,
			'appium:automationName': automationName,
			'appium:newCommandTimeout': 300,
			'appium:noReset': noReset,
			'appium:fullReset': fullReset,
		};

		// Configure app launch: either by file path or by package/bundle identifier
		if (platformName === 'Android') {
			if (appPackage) {
				// Testing an already-installed Android app
				capabilities['appium:appPackage'] = appPackage;
				if (appActivity) {
					capabilities['appium:appActivity'] = appActivity;
				}
			} else if (app) {
				// Installing and testing from app file
				capabilities['appium:app'] = app;
			} else {
				throw new Error('Either APP or APP_PACKAGE must be provided for Android');
			}
		} else {
			// iOS
			if (bundleId) {
				// Testing an already-installed iOS app
				capabilities['appium:bundleId'] = bundleId;
			} else if (app) {
				// Installing and testing from app file
				capabilities['appium:app'] = app;
			} else {
				throw new Error('Either APP or BUNDLE_ID must be provided for iOS');
			}
		}

		if (deviceName) {
			capabilities['appium:deviceName'] = deviceName;
		}
		if (platformVersion) {
			capabilities['appium:platformVersion'] = platformVersion;
		}
		if (udid) {
			capabilities['appium:udid'] = udid;
		}

		// BrowserStack specific configuration
		if (useBrowserStack) {
			const bsUsername = getStepperOption(this, 'BROWSERSTACK_USERNAME', world.moduleOptions);
			const bsAccessKey = getStepperOption(this, 'BROWSERSTACK_ACCESS_KEY', world.moduleOptions);

			capabilities['bstack:options'] = {
				userName: bsUsername,
				accessKey: bsAccessKey,
				deviceName: deviceName,
				osVersion: platformVersion,
			};
		}

		this.factoryOptions = {
			capabilities,
			host,
			port,
			logLevel,
			timeout: this.timeout,
			useBrowserStack,
		};

		this.driverFactory = DriverFactory.getDriverFactory(world, this.factoryOptions);
		this.hasFactory = true;
	}

	async getDriver(): Promise<Browser> {
		if (!this.driver) {
			this.driver = await this.driverFactory!.getDriver(String(this.getWorld().tag));
		}
		return this.driver;
	}

	async getCaptureDir(type = ''): Promise<string> {
		const loc = { ...this.world, mediaType: EMediaTypes.image };
		const dir = await this.storage!.ensureCaptureLocation(loc, type);
		return dir;
	}

	async captureFailureScreenshot(event: EExecutionMessageType, step: TStepResult): Promise<void> {
		try {
			const { context, path } = await captureScreenshot(this, event, { step });
			this.getWorld().logger.log(`${event} screenshot to ${pathToFileURL(path)}`, context);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.getWorld().logger.debug(`captureFailureScreenshot error ${errorMessage}`);
		}
	}

	async captureScreenshotAndLog(event: string): Promise<void> {
		const { context } = await captureScreenshot(
			this,
			EExecutionMessageType.ACTION,
			{ seq: Date.now() }
		);
		this.getWorld().logger.log(`Screenshot: ${event}`, context);
	}

	steps = {
		...mobileSteps(this),
	};
}
