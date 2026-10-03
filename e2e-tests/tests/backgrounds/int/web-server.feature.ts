import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import { serviceHost } from "@haibun/shu/test/step-ui.js";
import { DEFAULT_PORT } from "@haibun/web-server-hono/server-hono.js";

const { set } = withAction(new VariablesStepper());

/** The address a feature reaches its own web server at: the port actuality's web server option names, else its default. */
export const WEB_SERVER = serviceHost(String(DEFAULT_PORT));

export const backgrounds: TKirejiExport = {
	"Web server": [set({ what: "Web Server", value: `"${WEB_SERVER}"` })],
};
