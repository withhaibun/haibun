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
    await server.close();
  });
  xit("doesn't permit different static mount", async () => {
    // FIXME
    const { result, steppers } = await testRun(
      "/test/static-fails",
      [server],
      getDefaultWorld().world
    );

    console.log(result);

    expect(result.ok).toBe(false);
    const sserver = steppers![1] as any;
    
    await sserver.close();
  });
});
