import express, { Request, Response } from 'express';
import { Runner } from '@haibun/core/build/lib/runner.js';
import { TWorld, TFeatureDomain, AStepper, TStepperStep, TExecutorResult, TFeatureResult, TStepResult } from '@haibun/core/build/lib/defs.js';
import Logger, { LOGGER_LEVELS } from '@haibun/core/build/lib/Logger.js';
import { WEB_PAGE, WEB_CONTROL } from '@haibun/core/build/lib/domain-types.js';
import path from 'path';
import fs from 'fs'; 

// utils from haibun
import { getSteppers } from '@haibun/core/build/lib/util/workspace-lib.js';
import { createSteppers, setStepperWorlds } from '@haibun/core/build/lib/util/index.js';


const app = express();
const port = process.env.MCP_PORT || 3000;

app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.send('Haibun MCP Server');
});

// Function to extract parameters from GWTA string
function extractParametersFromGwta(gwta: string | undefined): { name: string, type: string }[] {
  if (!gwta) return [];
  const params: { name: string, type: string }[] = [];
  const regex = /{([^}]+?)(?:\s+\$\{(\w+)\})?}/g; 
  let match;
  while ((match = regex.exec(gwta)) !== null) {
    const paramName = match[1];
    const domainType = match[2] || 'string'; 
    params.push({ name: paramName, type: domainType });
  }
  return params;
}

app.get('/mcp/tools', async (req: Request, res: Response) => {
  try {
    console.log('Discovering available Haibun steppers for MCP tools...');

    const logger = new Logger({ level: 'debug' });
    const world: TWorld = {
      logger,
      tag: { sequence: Date.now(), loop: 0, feature: 0, scenario: 0 },
      options: {
        DEST: path.join(process.cwd(), 'mcp-tool-discovery-results'),
        HAIBUN_LOG_LEVEL: 'debug',
        BASES: [
          path.join(process.cwd(), 'modules', 'core', 'build', 'steps'),
          path.join(process.cwd(), 'modules', 'web-playwright', 'build', 'steps'),
          path.join(process.cwd(), 'modules', 'core', 'build', 'lib'), // Fallback for core
          path.join(process.cwd(), 'modules', 'web-playwright', 'build'), // Fallback for web-playwright
          path.join(process.cwd(), 'modules', 'storage-fs', 'build'), // For StorageFS
        ].filter(basePath => { 
          const exists = fs.existsSync(basePath);
          if (!exists) console.warn(`MCP Tools: BASE path ${basePath} does not exist. It will be excluded.`);
          return exists;
        }),
      },
      moduleOptions: {},
      shared: new Map(),
      runtime: {},
      domains: [WEB_PAGE as TFeatureDomain, WEB_CONTROL as TFeatureDomain],
      timer: { since: () => 0, start: () => { }, stop: () => { } }
    };
    
    if (world.options.BASES.length === 0) {
        console.error('MCP Tools: No valid BASE paths found for stepper discovery.');
        return res.status(500).json({ error: 'Server configuration error: No valid stepper paths.' });
    }
    console.log('Using BASES for stepper discovery:', world.options.BASES);
    
    let availableSteppers: AStepper[] = [];
    try {
      const stepperNamesToLoad = ['vars', 'web-playwright', 'storage-fs']; 
      const foundStepperConstructors = await getSteppers(stepperNamesToLoad, world);
      availableSteppers = await createSteppers(foundStepperConstructors);
      await setStepperWorlds(availableSteppers, world);
      console.log(`Successfully loaded ${availableSteppers.length} steppers using getSteppers.`);
    } catch (e: any) {
        console.warn('Failed to load steppers using getSteppers/createSteppers. Error:', e.message);
        if (runner.steppers && runner.steppers.length > 0) { // runner is not defined here
            availableSteppers = []; // Corrected: runner is not in scope here
            console.log(`Using runner.steppers which has ${availableSteppers.length} steppers.`);
        } else {
            console.warn('runner.steppers is also empty or not available at this stage.');
        }
    }

    if (availableSteppers.length === 0) {
      console.warn('No steppers dynamically discovered or loaded. Check BASES, domains, and stepper build status.');
    }
    
    const mcpTools = [];
    let webPlaywrightFound = false;
    for (const stepperInst of availableSteppers) {
      const stepperName = stepperInst.constructor.name;
      if (stepperName === 'WebPlaywright') {
        webPlaywrightFound = true;
      }
      const toolInfo = {
        id: stepperName,
        description: `Haibun stepper: ${stepperName}`,
        steps: [] as { id: string, description: string | undefined, parameters: { name: string, type: string }[] }[],
      };

      if (stepperInst.steps) {
        for (const [stepKey, stepDef] of Object.entries(stepperInst.steps as Record<string, TStepperStep>)) {
          toolInfo.steps.push({
            id: `${stepperName}.${stepKey}`,
            description: stepDef.gwta,
            parameters: extractParametersFromGwta(stepDef.gwta),
          });
        }
      }
      mcpTools.push(toolInfo);
    }

    if (webPlaywrightFound) {
      mcpTools.push({
        id: "haibun_screenshot",
        description: "Captures a screenshot of the current web page (requires web-playwright to be active and a page to be open).",
        steps: [{ // Representing the tool itself as a single "step" for consistency in MCP UI if it expects steps
            id: "haibun_screenshot.take",
            description: "Takes a screenshot.",
            parameters: [
                { name: "filename", type: "string", description: "Optional server-side filename reference for the screenshot. The actual filename is generated by Haibun." }
            ]
        }]
      });
    }

    if (mcpTools.length === 0) {
      console.warn('No MCP tools could be formatted. Stepper discovery might have failed.');
      return res.json([
        { id: 'placeholder', description: 'Placeholder tool (dynamic discovery failed)', steps: [] },
      ]);
    }
    res.json(mcpTools);
  } catch (error: any) {
    console.error('Error discovering Haibun steppers:', error);
    res.status(500).json({ status: 'error', message: error.message || 'Internal server error during tool discovery', details: error.stack });
  }
});


app.post('/mcp/execute', async (req: Request, res: Response) => {
  const { toolId, parameters: execParams, feature } = req.body; 
  console.log(`Received request for toolId: ${toolId}`);
  if (execParams) console.log(`Parameters:`, execParams);
  if (feature) console.log(`Feature string provided:`, feature);

  const logger = new Logger({ level: 'debug' });
  const destDir = path.join(process.cwd(), 'mcp-run-results');
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  const tempFeaturesDir = path.join(process.cwd(), 'modules', 'haibun-mcp-server', 'temp-features');
  if (!fs.existsSync(tempFeaturesDir)) {
    fs.mkdirSync(tempFeaturesDir, { recursive: true });
  }
  const tempFeatureFile = path.join(tempFeaturesDir, `mcp-exec-${Date.now()}.feature`);

  let featureStringToUse = feature;
  let steppersToRun = ['vars', 'web-playwright', 'storage-fs']; // Default steppers

  if (toolId === 'haibun_screenshot') {
    const screenshotFilenameParam = execParams?.filename || `screenshot-${Date.now()}.png`;
    // Filename for Playwright is auto-generated. This param is for client/server reference.
    console.log(`Executing haibun_screenshot. Reference filename: ${screenshotFilenameParam}`);
    featureStringToUse = `
Feature: MCP Screenshot
  Scenario: Capture page
    When I take a screenshot 
    # Note: The filename is generated by web-playwright, not passed from here.
`;
    // Ensure web-playwright and storage-fs are included for screenshots
    if (!steppersToRun.includes('web-playwright')) steppersToRun.push('web-playwright');
    if (!steppersToRun.includes('storage-fs')) steppersToRun.push('storage-fs');

  } else if (!featureStringToUse) {
    // If no feature string for general tools, create a simple one (mostly for testing)
    featureStringToUse = `Feature: MCP Execution for ${toolId}\n  Scenario: Run ${toolId}\n    Given I set "mcp_tool" to "${toolId}"`;
    console.warn(`No feature string provided for execution, using default: ${featureStringToUse}`);
  }
  
  fs.writeFileSync(tempFeatureFile, featureStringToUse);

  const coreSteppersPath = path.join(process.cwd(), 'modules', 'core', 'build', 'steps');
  const webPlaywrightSteppersPath = path.join(process.cwd(), 'modules', 'web-playwright', 'build', 'steps');
  const storageFsSteppersPath = path.join(process.cwd(), 'modules', 'storage-fs', 'build'); // storage-fs might not have a /steps subdir

  const world: TWorld = {
    bases: [tempFeaturesDir, coreSteppersPath, webPlaywrightSteppersPath, storageFsSteppersPath].filter(fs.existsSync),
    logger,
    options: { 
      DEST: destDir,
      HAIBUN_LOG_LEVEL: 'debug',
      BASES: [tempFeaturesDir, coreSteppersPath, webPlaywrightSteppersPath, storageFsSteppersPath].filter(fs.existsSync),
      // For StorageFS, if it needs explicit base dir for its operations (usually covered by DEST)
      HAIBUN_STORAGE_FS_BASE_DIR: destDir 
    },
    moduleOptions: execParams || {}, 
    shared: new Map(),
    tag: { sequence: Date.now(), loop: 0, feature: 0, scenario: 0 },
    runtime: {},
    featureFilter: [path.basename(tempFeatureFile)],
    domains: [WEB_PAGE as TFeatureDomain, WEB_CONTROL as TFeatureDomain],
    timer: { since: () => 0, start: () => {}, stop: () => {} }
  };

  if (world.bases.length < 3) { // tempFeaturesDir + core + web-playwright/storage-fs
      console.error('MCP Execute: Not enough BASE paths found. Stepper/feature dirs might be missing.', world.bases);
      fs.unlinkSync(tempFeatureFile); 
      return res.status(500).json({ status: 'error', message: 'Server configuration error: Missing feature or stepper paths.' });
  }
  console.log('MCP Execute using BASES:', world.bases);
  console.log('MCP Execute using featureFilter:', world.featureFilter);
  console.log('MCP Execute with steppers:', steppersToRun);

  try {
    const runner = new Runner(world);
    const result: TExecutorResult = await runner.run(steppersToRun, world.featureFilter);
    
    console.log('Haibun feature execution result:', JSON.stringify(result, null, 2));

    if (toolId === 'haibun_screenshot') {
      if (result.ok) {
        let foundScreenshotPath: string | null = null;
        // Search for the screenshot artifact path in the results
        result.featureResults?.forEach((fResult: TFeatureResult) => {
          fResult.stepResults.forEach((sResult: TStepResult) => {
            if (sResult.actionResult?.messageContext?.artifact?.artifactType === 'image' && sResult.actionResult.messageContext.artifact.path) {
              foundScreenshotPath = sResult.actionResult.messageContext.artifact.path;
            }
          });
        });

        if (foundScreenshotPath) {
          const fullScreenshotPath = path.join(world.options.DEST, foundScreenshotPath);
          if (fs.existsSync(fullScreenshotPath)) {
            const imageBase64 = fs.readFileSync(fullScreenshotPath, { encoding: 'base64' });
            // fs.unlinkSync(fullScreenshotPath); // Optionally delete after reading
            return res.json({ 
              status: 'success', 
              imageData: imageBase64, 
              filename: execParams?.filename || path.basename(foundScreenshotPath),
              path: foundScreenshotPath // Relative path
            });
          } else {
            console.error('Screenshot file not found at expected path:', fullScreenshotPath);
            return res.status(500).json({ status: 'error', message: 'Screenshot taken, but file not found on server.' });
          }
        } else {
          console.error('Screenshot artifact path not found in Haibun results.');
          return res.status(500).json({ status: 'error', message: 'Screenshot action completed, but no image artifact found.' });
        }
      } else {
        console.error('Screenshot feature execution failed:', result);
        return res.status(500).json({ status: 'error', message: 'Failed to execute screenshot feature.', details: result });
      }
    } else { // For other tools
      if (result.ok) {
        res.json({ status: 'success', output: result });
      } else {
        res.status(500).json({ status: 'error', message: 'Haibun execution failed', details: result });
      }
    }
  } catch (error: any) {
    console.error('Error during Haibun execution:', error);
    res.status(500).json({ status: 'error', message: error.message || 'Internal server error during execution', details: error.stack });
  } finally {
    if (fs.existsSync(tempFeatureFile)) {
      fs.unlinkSync(tempFeatureFile);
    }
  }
});

export function startServer() {
  app.listen(port, () => {
    console.log(`Haibun MCP Server listening on port ${port}`);
  });
  const resultsDir = path.join(process.cwd(), 'mcp-run-results');
  if (!fs.existsSync(resultsDir)){
    fs.mkdirSync(resultsDir, { recursive: true });
  }
}
