import axios from 'axios';
import { startTestServer as startMcpServer, closeServer as closeMcpServer } from '../src/index';
import { WebServerExpress } from '@haibun/web-server-express/build/web-server-express.js';
import { TWorld, TFeatureDomain } from '@haibun/core/build/lib/defs.js';
import Logger from '@haibun/core/build/lib/Logger.js';
import { WEB_PAGE } from '@haibun/core/build/lib/domain-types.js';
import path from 'path';
import http from 'http';

const MCP_SERVER_PORT = 3004; // Ensure this is different from unit test and default server port
const TEST_WEB_SERVER_PORT = 4005;
const MCP_SERVER_URL = `http://localhost:${MCP_SERVER_PORT}`;
const TEST_PAGE_PATH = '/test-page/index.html'; // Relative to WWW_ROOT
const TEST_PAGE_URL = `http://localhost:${TEST_WEB_SERVER_PORT}${TEST_PAGE_PATH}`;

let mcpServerInstance: http.Server;
let testWebServer: WebServerExpress;
let testWebServerWorld: TWorld;

// Helper to create a feature string for a single action
const createFeatureForStep = (step: string, description: string = "MCP E2E Action") => `
Feature: ${description}
  Scenario: Execute a single step via MCP
    ${step}
`;

beforeAll(async () => {
  // Start Haibun MCP Server
  mcpServerInstance = await startMcpServer(MCP_SERVER_PORT);
  console.log(`MCP Server started for E2E tests on port ${MCP_SERVER_PORT}`);

  // Start web-server-express to serve test page
  const logger = new Logger({ level: 'debug' }); // Use 'none' or 'error' for less verbose logs
  testWebServerWorld = {
    logger,
    tag: { sequence: Date.now(), loop: 0, feature: 0, scenario: 0 },
    options: {
      PORT: TEST_WEB_SERVER_PORT.toString(),
      WWW_ROOT: path.join(__dirname, 'www'), // Serve content from tests/www
      HAIBUN_LOG_LEVEL: 'debug',
      DEST: path.join(__dirname, 'e2e-webserver-results'), // dest for webserver if it creates any
      BASES: [path.join(__dirname, 'www')], // Base for web server features if any
    },
    moduleOptions: {
        // Options for WebServerExpress itself if needed, e.g. HAIBUN_O_WEB_SERVER_EXPRESS_PORT
        HAIBUN_O_WEB_SERVER_EXPRESS_PORT: TEST_WEB_SERVER_PORT.toString(),
        HAIBUN_O_WEB_SERVER_EXPRESS_WWW_ROOT: path.join(__dirname, 'www'),
    },
    shared: new Map(),
    runtime: {},
    domains: [WEB_PAGE as TFeatureDomain], // WebServerExpress might use this
    timer: { since: () => 0, start: () => {}, stop: () => {} }
  };

  testWebServer = new WebServerExpress();
  // WebServerExpress needs to be initialized with its world and steppers if it uses any internally for setup
  // For basic serving, setWorld might be enough.
  await testWebServer.setWorld(testWebServerWorld, []); // Pass empty steppers array if it doesn't need others for startup
  // ensureStarted is not a standard method. Typically, new Stepper().setWorld() then steppers are used by Runner.
  // For WebServerExpress, its own start mechanism is usually tied to Haibun's runtime calling its 'action' for a 'listen' step.
  // For E2E, we need to manually trigger its listening state.
  // Looking at WebServerExpress source: it has `listen` and `close` methods for direct control.
  try {
    await testWebServer.listen(); // This starts the server
    console.log(`Test Web Server started on port ${TEST_WEB_SERVER_PORT}, serving from ${testWebServerWorld.options.WWW_ROOT}`);
  } catch (e) {
    console.error('Failed to start Test Web Server for E2E tests', e);
    // If web server fails, we might want to stop MCP server and fail all tests
    await closeMcpServer();
    throw e; // Propagate error to fail test suite
  }
}, 30000); // Increased timeout for starting servers

afterAll(async () => {
  // Stop Haibun MCP Server
  if (mcpServerInstance) {
    await closeMcpServer();
    console.log('MCP Server stopped for E2E tests.');
  }
  // Stop web-server-express
  if (testWebServer) {
    await testWebServer.close(); // Use the direct close method
    console.log('Test Web Server stopped.');
  }
}, 30000);

describe('Haibun MCP Server - E2E Tests', () => {
  let webPlaywrightNavigateToolId: string | undefined;
  let webPlaywrightTypeTextToolId: string | undefined;
  let webPlaywrightClickToolId: string | undefined;
  let webPlaywrightSeeTextInToolId: string | undefined;

  it('should list tools via /mcp/tools and find necessary web-playwright tools', async () => {
    const response = await axios.get(`${MCP_SERVER_URL}/mcp/tools`);
    expect(response.status).toBe(200);
    const tools = response.data;
    expect(Array.isArray(tools)).toBe(true);
    
    const webPlaywrightTool = tools.find((t: any) => t.id === 'WebPlaywright');
    expect(webPlaywrightTool).toBeDefined();

    // Find specific step IDs needed for subsequent tests
    // Note: The exact GWTA strings and thus descriptions/IDs might vary slightly based on tool formatting.
    // We need to find the step that navigates, types, clicks, and sees text.
    
    // Example step: "go to the {name} ${WEB_PAGE}"
    const navStep = webPlaywrightTool.steps.find((s: any) => s.description?.includes('go to the {name}'));
    expect(navStep).toBeDefined();
    webPlaywrightNavigateToolId = navStep.id;

    // Example step: "input {what} for {field}" or "type {text}"
    // Preferring a more general type step if available, like "type {text} in {selector}"
    let typeStep = webPlaywrightTool.steps.find((s: any) => s.description?.includes('type {text} in {selector}')); // Hypothetical, check actual
    if (!typeStep) {
        typeStep = webPlaywrightTool.steps.find((s: any) => s.description?.includes('input {what} for {field}'));
    }
    expect(typeStep).toBeDefined();
    webPlaywrightTypeTextToolId = typeStep.id;
    
    // Example step: "click on {name}" or "click {selector}"
    const clickStep = webPlaywrightTool.steps.find((s: any) => s.description?.includes('click on') || s.description?.includes('click the button') || s.description?.includes('clicks {selector}')); // More flexible search
    expect(clickStep).toBeDefined();
    webPlaywrightClickToolId = clickStep.id;

    // Example step: "in {selector}, see {text}"
    const seeTextInStep = webPlaywrightTool.steps.find((s: any) => s.description?.includes('in {selector}, see {text}'));
    expect(seeTextInStep).toBeDefined();
    webPlaywrightSeeTextInToolId = seeTextInStep.id;

    const screenshotTool = tools.find((t: any) => t.id === 'haibun_screenshot');
    expect(screenshotTool).toBeDefined();
  });

  it('should run a web interaction scenario via /mcp/execute', async () => {
    // Ensure tool IDs were found in the previous test
    expect(webPlaywrightNavigateToolId).toBeDefined();
    expect(webPlaywrightTypeTextToolId).toBeDefined();
    expect(webPlaywrightClickToolId).toBeDefined();
    expect(webPlaywrightSeeTextInToolId).toBeDefined();

    let response;
    const featureBase = 'Feature: MCP E2E Web Interaction\n  Scenario: Interact with test page\n';

    // 1. Navigate to test page
    console.log(`E2E: Navigating to ${TEST_PAGE_URL} using tool ${webPlaywrightNavigateToolId}`);
    const navigateFeature = createFeatureForStep(`    When I go to the "${TEST_PAGE_URL}" ${WEB_PAGE}`, "Navigate");
    // Parameters for "go to the {name} ${WEB_PAGE}" are part of the feature string itself.
    // The 'parameters' field in the MCP request is for moduleOptions.
    response = await axios.post(`${MCP_SERVER_URL}/mcp/execute`, {
      toolId: webPlaywrightNavigateToolId, // This helps MCP server select/verify steppers, but feature is prime
      feature: navigateFeature,
      // parameters: { name: TEST_PAGE_URL } // This depends on how `webPlaywrightNavigateToolId` expects params.
                                          // If it's a direct step like "gotoPage", it takes {name}.
                                          // For GWTA, it's embedded.
    });
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('success');
    if (!response.data.output?.ok) console.error('Navigation step failed:', response.data.output);
    expect(response.data.output?.ok).toBe(true);


    // 2. Type text into an input field
    const textToType = 'Hello from E2E test';
    console.log(`E2E: Typing "${textToType}" into #testInput using tool ${webPlaywrightTypeTextToolId}`);
    // Assuming webPlaywrightTypeTextToolId corresponds to "input {what} for {field}"
    const typeFeature = createFeatureForStep(`    When I input "${textToType}" for "#testInput"`, "Type Text");
    response = await axios.post(`${MCP_SERVER_URL}/mcp/execute`, {
      toolId: webPlaywrightTypeTextToolId,
      feature: typeFeature,
      // parameters: { what: textToType, field: '#testInput' },
    });
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('success');
    if (!response.data.output?.ok) console.error('Type step failed:', response.data.output);
    expect(response.data.output?.ok).toBe(true);


    // 3. Click a button
    console.log(`E2E: Clicking #testButton using tool ${webPlaywrightClickToolId}`);
    // Assuming webPlaywrightClickToolId corresponds to "click on {name}" or similar
    const clickFeature = createFeatureForStep(`    When I click on "#testButton"`, "Click Button");
    response = await axios.post(`${MCP_SERVER_URL}/mcp/execute`, {
      toolId: webPlaywrightClickToolId,
      feature: clickFeature,
      // parameters: { name: '#testButton' },
    });
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('success');
    if (!response.data.output?.ok) console.error('Click step failed:', response.data.output);
    expect(response.data.output?.ok).toBe(true);
    
    // 4. Verify text has changed
    const expectedTextAfterClick = 'Button Clicked!';
    console.log(`E2E: Verifying text in #displayText is "${expectedTextAfterClick}" using tool ${webPlaywrightSeeTextInToolId}`);
    // Assuming webPlaywrightSeeTextInToolId corresponds to "in {selector}, see {text}"
    const verifyTextFeature = createFeatureForStep(`    Then in "#displayText", I see "${expectedTextAfterClick}"`, "Verify Text");
    response = await axios.post(`${MCP_SERVER_URL}/mcp/execute`, {
      toolId: webPlaywrightSeeTextInToolId,
      feature: verifyTextFeature,
      // parameters: { selector: '#displayText', text: expectedTextAfterClick },
    });
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('success');
    if (!response.data.output?.ok) console.error('Verify text step failed:', response.data.output);
    expect(response.data.output?.ok).toBe(true);

    // 5. Take a screenshot
    console.log('E2E: Taking a screenshot using haibun_screenshot');
    response = await axios.post(`${MCP_SERVER_URL}/mcp/execute`, {
      toolId: 'haibun_screenshot',
      parameters: { filename: 'e2e-test-screenshot.png' }, // Optional reference filename
    });
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('success');
    expect(response.data.imageData).toBeDefined();
    expect(response.data.imageData.length).toBeGreaterThan(100); 
    if (!response.data.imageData) console.error('Screenshot data missing:', response.data);

  }, 60000); // Increased timeout for multi-step web interaction
});
