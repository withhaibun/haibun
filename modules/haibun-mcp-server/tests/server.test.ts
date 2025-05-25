import request from 'supertest';
import { app, startTestServer, closeServer } from '../src/server';
import http from 'http';
import path from 'path';

// Mock Haibun core parts
// Mock implementations need to be created before they are used by server.ts routes during tests.
// The actual server.ts imports these, so mocks must be at the top level.

// Keep track of the actual Runner class for potential partial mocking if needed
const ActualRunner = jest.requireActual('@haibun/core/build/lib/runner.js').Runner;
const mockRun = jest.fn().mockResolvedValue({ ok: true, featureResults: [], shared: new Map() }); // Default mock for run

jest.mock('@haibun/core/build/lib/runner.js', () => {
  return {
    Runner: jest.fn().mockImplementation((world) => {
      // console.log('Mock Runner instantiated with world:', world);
      return {
        run: mockRun, // Use the hoisted mockRun
        // Mock other Runner methods if needed by server.ts
      };
    }),
  };
});

const mockGetSteppers = jest.fn().mockResolvedValue([]); // Default to no steppers
const mockCreateSteppers = jest.fn().mockImplementation(async (stepperConstructors) => {
  // Simulate instantiation based on constructor names or types
  return stepperConstructors.map((SC: any) => {
    if (typeof SC === 'function' && SC.prototype && SC.prototype.steps) { // if it's a class like Vars Stepper
        return new SC();
    }
    // Fallback for simplified mocks or different structures
    return { constructor: { name: SC.name || 'UnknownStepper' }, steps: {} };
  });
});
const mockSetStepperWorlds = jest.fn().mockResolvedValue(undefined);

jest.mock('@haibun/core/build/lib/util/workspace-lib.js', () => ({
  getSteppers: mockGetSteppers,
}));

jest.mock('@haibun/core/build/lib/util/index.js', () => ({
  createSteppers: mockCreateSteppers,
  setStepperWorlds: mockSetStepperWorlds,
  // Ensure other exports from this module that server.ts might use are also mocked or actual
  ...jest.requireActual('@haibun/core/build/lib/util/index.js'), // Keep others
}));


// Mock fs module
const mockFs = {
  ...jest.requireActual('fs'), // Keep actual for non-mocked parts
  writeFileSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue(Buffer.from('fake-image-data').toString('base64')),
  existsSync: jest.fn().mockReturnValue(true), // Default to true, can be overridden per test
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
};
jest.mock('fs', () => mockFs);


describe('Haibun MCP Server', () => {
  let runningServer: http.Server;
  const testPort = 3001; // Use a different port for testing

  beforeAll(async () => {
    runningServer = await startTestServer(testPort);
  });

  afterAll(async () => {
    await closeServer();
  });

  beforeEach(() => {
    // Clear mocks before each test to ensure test isolation
    jest.clearAllMocks();
    // Reset specific mocks to default behaviors if needed
    mockRun.mockResolvedValue({ ok: true, featureResults: [], shared: new Map() });
    mockGetSteppers.mockResolvedValue([]);
    mockFs.existsSync.mockReturnValue(true); // Default to true
    mockFs.readFileSync.mockReturnValue(Buffer.from('fake-image-data').toString('base64'));

  });

  it('should respond to GET /', async () => {
    const response = await request(runningServer).get('/');
    expect(response.status).toBe(200);
    expect(response.text).toBe('Haibun MCP Server');
  });

  describe('/mcp/tools', () => {
    it('should return a list of tools including haibun_screenshot if WebPlaywright is found', async () => {
      // Mock that getSteppers finds WebPlaywright and Vars constructors
      const MockWebPlaywrightStepper = class WebPlaywright {
        steps = {
          takeScreenshot: { gwta: 'take a screenshot' },
          gotoPage: { gwta: 'go to the {name} ${WEB_PAGE}'}
        };
        constructor() {}
        async setWorld() {}
        getWorld() {return {};}
      };
      const MockVarsStepper = class Vars {
        steps = { set: { gwta: 'set {what} to {value}' } };
        constructor() {}
        async setWorld() {}
        getWorld() {return {};}
      };

      mockGetSteppers.mockResolvedValue([MockWebPlaywrightStepper, MockVarsStepper]);
      
      // Mock that BASES paths exist
      mockFs.existsSync.mockImplementation((p) => {
        // Assume all paths passed to filter in server.ts exist for this test
        if (typeof p === 'string' && (p.includes(path.join('modules', 'core', 'build')) || p.includes(path.join('modules', 'web-playwright', 'build')) || p.includes(path.join('modules', 'storage-fs', 'build')))) {
          return true;
        }
        return false; // For other paths if any
      });

      const response = await request(runningServer).get('/mcp/tools');
      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
      
      const toolIds = response.body.map((t: any) => t.id);
      expect(toolIds).toContain('WebPlaywright');
      expect(toolIds).toContain('Vars');
      expect(toolIds).toContain('haibun_screenshot');

      const webPlaywrightTool = response.body.find((t: any) => t.id === 'WebPlaywright');
      expect(webPlaywrightTool.steps).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'WebPlaywright.takeScreenshot', description: 'take a screenshot', parameters: [] }),
        expect.objectContaining({ id: 'WebPlaywright.gotoPage', description: 'go to the {name} ${WEB_PAGE}', parameters: [{name: "name", type: "WEB_PAGE"}] })
      ]));
      
      const screenshotTool = response.body.find((t: any) => t.id === 'haibun_screenshot');
      expect(screenshotTool.steps[0].parameters).toEqual(
          expect.arrayContaining([expect.objectContaining({ name: 'filename' })])
      );
    });

    it('should return placeholder if no steppers are found', async () => {
        mockGetSteppers.mockResolvedValue([]); // No steppers found
        mockFs.existsSync.mockReturnValue(true); // Assume paths exist
        const response = await request(runningServer).get('/mcp/tools');
        expect(response.status).toBe(200);
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'placeholder' })
          ])
        );
    });
  });

  describe('/mcp/execute', () => {
    it('should execute a generic tool (stepper) successfully', async () => {
      mockRun.mockResolvedValue({ ok: true, shared: new Map(), featureResults: [{ path: 'test.feature', ok: true, stepResults: []}] });
      mockFs.existsSync.mockReturnValue(true); // For BASES and temp feature file dir

      const response = await request(runningServer)
        .post('/mcp/execute')
        .send({ 
            toolId: 'Vars.set', 
            parameters: { HAIBUN_VAR_what: 'myVar', HAIBUN_VAR_value: '123' },
            feature: 'Feature: Test\nScenario: Test\n  Given I set "myVar" to "123"' 
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.output.ok).toBe(true);
      expect(mockFs.writeFileSync).toHaveBeenCalled(); // Temp feature file created
      const RunnerMock = require('@haibun/core/build/lib/runner.js').Runner;
      expect(RunnerMock).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
      expect(mockFs.unlinkSync).toHaveBeenCalled(); // Temp feature file deleted
    });
    
    it('should handle generic tool execution failure from Haibun', async () => {
        mockRun.mockResolvedValue({ ok: false, shared: new Map(), failure: { stage: 'Execute', error: { message: 'Test Haibun Error'}} });
        mockFs.existsSync.mockReturnValue(true);

        const response = await request(runningServer)
          .post('/mcp/execute')
          .send({ 
              toolId: 'Vars.fail', 
              feature: 'Feature: Test\nScenario: Test\n  Given I do something that fails' 
          });
  
        expect(response.status).toBe(500);
        expect(response.body.status).toBe('error');
        expect(response.body.message).toBe('Haibun execution failed');
        expect(response.body.details.ok).toBe(false);
        expect(mockFs.unlinkSync).toHaveBeenCalled();
      });

    it('should execute haibun_screenshot tool successfully', async () => {
      const mockScreenshotPathRel = 'image/screenshot-123.png';
      mockRun.mockResolvedValue({ 
        ok: true, 
        shared: new Map(),
        featureResults: [{
            path: 'mcp-screenshot.feature',
            ok: true,
            stepResults: [{
                ok: true,
                in: 'When I take a screenshot',
                path: 'mcp-screenshot.feature',
                seq: 0,
                actionResult: {
                    ok: true,
                    name: 'takeScreenshot',
                    messageContext: {
                        artifact: { artifactType: 'image', path: mockScreenshotPathRel }
                    }
                }
            }]
        }]
      });
      mockFs.existsSync.mockImplementation((p) => {
        if (typeof p === 'string' && p.endsWith(mockScreenshotPathRel)) return true; // Screenshot file exists
        return true; // Other paths (BASES, temp dirs)
      });
      mockFs.readFileSync.mockReturnValue(Buffer.from('fake-image-data-screenshot').toString('base64'));

      const response = await request(runningServer)
        .post('/mcp/execute')
        .send({ toolId: 'haibun_screenshot', parameters: { filename: 'mytest.png' } });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
      expect(response.body.imageData).toBe(Buffer.from('fake-image-data-screenshot').toString('base64'));
      expect(response.body.filename).toBe('mytest.png');
      expect(mockFs.readFileSync).toHaveBeenCalledWith(path.join(process.cwd(), 'mcp-run-results', mockScreenshotPathRel), { encoding: 'base64' });
      expect(mockFs.unlinkSync).toHaveBeenCalled(); // Temp feature file deleted
    });

    it('should handle haibun_screenshot when screenshot artifact is not found', async () => {
        mockRun.mockResolvedValue({ ok: true, shared: new Map(), featureResults: [] }); // No artifact
        mockFs.existsSync.mockReturnValue(true);

        const response = await request(runningServer)
          .post('/mcp/execute')
          .send({ toolId: 'haibun_screenshot' });
    
        expect(response.status).toBe(500);
        expect(response.body.status).toBe('error');
        expect(response.body.message).toBe('Screenshot artifact path not found in Haibun results.');
        expect(mockFs.unlinkSync).toHaveBeenCalled();
      });

      it('should handle haibun_screenshot when screenshot file does not exist', async () => {
        const mockScreenshotPathRel = 'image/screenshot-notfound.png';
        mockRun.mockResolvedValue({ 
          ok: true, 
          shared: new Map(),
          featureResults: [{
              path: 'mcp-screenshot.feature', ok: true, stepResults: [{
                  ok: true, in: 'When I take a screenshot', path: 'mcp-screenshot.feature', seq: 0,
                  actionResult: { ok: true, name: 'takeScreenshot', messageContext: { artifact: { artifactType: 'image', path: mockScreenshotPathRel }}}
              }]
          }]
        });
        mockFs.existsSync.mockImplementation((p) => {
          if (typeof p === 'string' && p.endsWith(mockScreenshotPathRel)) return false; // Screenshot file does NOT exist
          return true; // Other paths
        });
  
        const response = await request(runningServer)
          .post('/mcp/execute')
          .send({ toolId: 'haibun_screenshot' });
      
        expect(response.status).toBe(500);
        expect(response.body.status).toBe('error');
        expect(response.body.message).toBe('Screenshot taken, but file not found on server.');
        expect(mockFs.unlinkSync).toHaveBeenCalled();
      });
  });
});
