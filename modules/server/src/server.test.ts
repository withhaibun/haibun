import fetch from 'node-fetch';

import { Executor } from "@haibun/core/build/lib/Executor";
import { getDefaultWorld } from "@haibun/core/build/lib/util";
import { getTestEnv, testRun } from "@haibun/core/build/lib/TestSteps";

import server from "./server";

const serverLoc = [process.cwd(), "build", "server"].join("/");

describe("server", () => {
  it("listens on serve files", async () => {
    const { world, vstep, steppers } = await getTestEnv(
      [serverLoc],
      "serve files from test",
      getDefaultWorld().world
    );
    const res = await Executor.doFeatureStep(vstep, world);

    const server = steppers[0] as any;
    expect(res.ok).toBe(true);
    expect(server.webserver).toBeDefined();
    const content = await fetch('http://localhost:8123/testfile')
    expect(await content.text()).toEqual('content');
    
    await server.close();
  });
  it("restricts characters used in static mount folder", async () => {
    const { world, vstep, steppers } = await getTestEnv(
      [serverLoc],
      "serve files from l*(*$**",
      getDefaultWorld().world
    );

    const res = await Executor.doFeatureStep(vstep, world);
    expect(res.ok).toBe(false);

    (steppers[0] as any).close();
  });
  it("doesn't re-mount same static mount", async () => {
    const { result, steppers } = await testRun(
      "/test/static-no-remount",
      [server],
      getDefaultWorld().world
    );

    expect(result.ok).toBe(true);
    const serverStep = steppers![1] as any;

    await serverStep.close();
  });
  it("doesn't permit different static mount", async () => {
    const { result, steppers } = await testRun(
      "/test/static-fails",
      [server],
      getDefaultWorld().world
    );

    expect(result.ok).toBe(false);
    const serverStep = steppers![1] as any;

    await serverStep.close();
  });
});
