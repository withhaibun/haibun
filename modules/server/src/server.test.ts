import { Resolver } from "@haibun/core/build/lib/Resolver";
import { TVStep } from "@haibun/core/build/lib/defs";
import { Executor } from "@haibun/core/build/lib/Executor";
import { getDefaultWorld, getSteppers } from "@haibun/core/build/lib/util";

const serverLoc = [process.cwd(), "build", "server"].join("/");

describe("server", () => {
  it("listens on serve files", async () => {
    const { world } = getDefaultWorld();
    const steppers = await getSteppers({ steppers: [serverLoc], world });
    const resolver = new Resolver(steppers, "", world);
    const test = "serve files at test";
    const actions = resolver.findSteps(test);
    const tvstep: TVStep = {
      in: test,
      seq: 0,
      actions,
    };

    await Executor.doFeatureStep(tvstep, world.logger);
    const server = steppers[0] as any;
    expect(server.app).toBeDefined();
    await server.close();
  });
});
