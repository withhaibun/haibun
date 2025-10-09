import { remote, Browser } from 'webdriverio';
import { spawn, ChildProcess } from 'child_process';
import { TWorld } from '@haibun/core/lib/defs.js';

export type TPlatformName = 'Android' | 'iOS';
export type TAutomationName = 'UiAutomator2' | 'XCUITest';

export interface TMobileCapabilities {
  platformName: TPlatformName;
  'appium:app': string;
  'appium:automationName': TAutomationName;
  'appium:deviceName'?: string;
  'appium:platformVersion'?: string;
  'appium:udid'?: string;
  'appium:newCommandTimeout'?: number;
  'appium:noReset'?: boolean;
  'appium:fullReset'?: boolean;
  // BrowserStack capabilities (for future use)
  'bstack:options'?: {
    userName?: string;
    accessKey?: string;
    deviceName?: string;
    osVersion?: string;
  };
}

export interface TDriverOptions {
  host: string;
  port: number;
  path: string;
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
  capabilities: TMobileCapabilities;
}

export interface TDriverFactoryOptions {
  capabilities: TMobileCapabilities;
  host?: string;
  port?: number;
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
  timeout?: number;
  useBrowserStack?: boolean;
}

/**
 * Factory for managing Appium server and WebDriver.IO driver instances
 * Handles automatic Appium server startup/shutdown and driver lifecycle
 */
export class DriverFactory {
  private static instance?: DriverFactory;
  private appiumProcess?: ChildProcess;
  private drivers: Map<string, Browser> = new Map();
  private serverStarted = false;
  private options: TDriverFactoryOptions;
  private world: TWorld;

  private constructor(world: TWorld, options: TDriverFactoryOptions) {
    this.world = world;
    this.options = options;
  }

  static getDriverFactory(
    world: TWorld,
    options: TDriverFactoryOptions
  ): DriverFactory {
    if (!DriverFactory.instance) {
      DriverFactory.instance = new DriverFactory(world, options);
    }
    return DriverFactory.instance;
  }

  /**
   * Start the Appium server if not using BrowserStack or external server
   */
  async startAppiumServer(): Promise<void> {
    if (this.serverStarted || this.options.useBrowserStack) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.world.logger.info('Starting Appium server...');

        const host = this.options.host || '127.0.0.1';
        const port = this.options.port || 4723;

        // Start Appium as a child process
        // Users should have 'appium' installed globally or in node_modules
        this.appiumProcess = spawn('npx', ['appium', '--address', host, '--port', port.toString()], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let serverReady = false;

        this.appiumProcess.stdout?.on('data', (data) => {
          const output = data.toString();
          if (this.options.logLevel === 'debug') {
            this.world.logger.debug(`[Appium] ${output}`);
          }

          // Check if server is ready
          if (output.includes('Appium REST http interface listener started') && !serverReady) {
            serverReady = true;
            this.serverStarted = true;
            this.world.logger.info(`Appium server started on ${host}:${port}`);
            resolve();
          }
        });

        this.appiumProcess.stderr?.on('data', (data) => {
          const error = data.toString();
          if (this.options.logLevel === 'debug' || this.options.logLevel === 'trace') {
            this.world.logger.debug(`[Appium Error] ${error}`);
          }
        });

        this.appiumProcess.on('error', (error) => {
          this.world.logger.error(`Failed to start Appium server: ${error.message}`);
          reject(error);
        });

        this.appiumProcess.on('exit', (code) => {
          if (code !== 0 && !serverReady) {
            reject(new Error(`Appium server exited with code ${code}`));
          }
        });

        // Timeout after 30 seconds
        setTimeout(() => {
          if (!serverReady) {
            reject(new Error('Appium server failed to start within 30 seconds'));
          }
        }, 30000);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.world.logger.error(`Failed to start Appium server: ${errorMessage}`);
        reject(error);
      }
    });
  }

  /**
   * Stop the Appium server
   */
  async stopAppiumServer(): Promise<void> {
    if (this.appiumProcess && this.serverStarted) {
      return new Promise((resolve) => {
        this.world.logger.info('Stopping Appium server...');

        this.appiumProcess!.on('exit', () => {
          this.serverStarted = false;
          this.world.logger.info('Appium server stopped');
          resolve();
        });

        this.appiumProcess!.kill();

        // Force kill after 5 seconds if not stopped
        setTimeout(() => {
          if (this.appiumProcess) {
            this.appiumProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      });
    }
  }

  /**
   * Create and return a driver for the given tag (test context)
   */
  async getDriver(tag: string): Promise<Browser> {
    if (this.drivers.has(tag)) {
      return this.drivers.get(tag)!;
    }

    // Ensure Appium server is running
    await this.startAppiumServer();

    const driverOptions: TDriverOptions = {
      host: this.options.host || '127.0.0.1',
      port: this.options.port || 4723,
      path: '/wd/hub',
      logLevel: this.options.logLevel || 'info',
      capabilities: this.options.capabilities,
    };

    // Override for BrowserStack
    if (this.options.useBrowserStack) {
      driverOptions.host = 'hub-cloud.browserstack.com';
      driverOptions.port = 443;
      driverOptions.path = '/wd/hub';
    }

    this.world.logger.debug(`Creating driver with capabilities: ${JSON.stringify(driverOptions.capabilities)}`);

    try {
      const driver = await remote(driverOptions);

      // Set timeouts
      if (this.options.timeout) {
        await driver.setTimeout({
          implicit: this.options.timeout,
        });
      }

      this.drivers.set(tag, driver);
      this.world.logger.info(`Driver created for tag: ${tag}`);

      return driver;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.world.logger.error(`Failed to create driver: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get existing driver for a tag
   */
  getExistingDriver(tag: string): Browser | undefined {
    return this.drivers.get(tag);
  }

  /**
   * Check if driver exists for tag
   */
  hasDriver(tag: string): boolean {
    return this.drivers.has(tag);
  }

  /**
   * Close a specific driver
   */
  async closeDriver(tag: string): Promise<void> {
    const driver = this.drivers.get(tag);
    if (driver) {
      try {
        this.world.logger.debug(`Closing driver for tag: ${tag}`);
        await driver.deleteSession();
        this.drivers.delete(tag);
        this.world.logger.info(`Driver closed for tag: ${tag}`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.world.logger.error(`Error closing driver for ${tag}: ${errorMessage}`);
      }
    }
  }

  /**
   * Close all drivers and stop server
   */
  async closeAll(): Promise<void> {
    // Close all drivers
    const closeTasks = Array.from(this.drivers.keys()).map((tag) =>
      this.closeDriver(tag)
    );
    await Promise.all(closeTasks);

    // Stop Appium server
    await this.stopAppiumServer();

    // Reset singleton
    DriverFactory.instance = undefined;
  }

  /**
   * Reset app to initial state (useful between scenarios)
   */
  async resetApp(tag: string): Promise<void> {
    const driver = this.getExistingDriver(tag);
    if (driver) {
      try {
        this.world.logger.debug(`Resetting app for tag: ${tag}`);
        // Reset is done by terminating and reactivating the app
        await driver.terminateApp(this.options.capabilities['appium:app']);
        await driver.activateApp(this.options.capabilities['appium:app']);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.world.logger.error(`Error resetting app: ${errorMessage}`);
        // Don't throw - some apps may not support reset
      }
    }
  }

  /**
   * Terminate and relaunch app (more aggressive than reset)
   */
  async relaunchApp(tag: string): Promise<void> {
    const driver = this.getExistingDriver(tag);
    if (driver) {
      try {
        this.world.logger.debug(`Relaunching app for tag: ${tag}`);
        await driver.terminateApp(this.options.capabilities['appium:app']);
        await driver.activateApp(this.options.capabilities['appium:app']);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.world.logger.error(`Error relaunching app: ${errorMessage}`);
      }
    }
  }
}
