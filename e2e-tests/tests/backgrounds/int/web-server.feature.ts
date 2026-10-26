import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import { configuredServiceHost } from "@haibun/shu/test/step-ui.js";

const { set } = withAction(new VariablesStepper());

/** The address a feature reaches its own web server at, on the port the group's config states. */
export const WEB_SERVER = configuredServiceHost();

export const backgrounds: TKirejiExport = {
	"Web server": [set({ what: "Web Server", value: `"${WEB_SERVER}"` })],
};
