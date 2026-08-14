import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import Haibun from "@haibun/core/steps/haibun.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import MonitorStepper from "../../build/monitor-stepper.js";

const { feature } = withAction(new Haibun());
const { issueSessionGrant } = withAction(new AuthorityStepper());
const { federateGraphReads, clusteredGraphHoldsFromSite } = withAction(new MonitorStepper());

const LAUNCHER = '"launcher-token"';
const PEER_PORT = process.env.HAIBUN_FEDERATE_PEER_PORT ?? "8250";

export const features: TKirejiExport = {
	"Federated graph reads from a sibling instance": [
		feature({ feature: "Federate graph reads across haibun instances" }),
		"A second haibun instance starts the same way an operator would run one — its own configuration, port, and host number — and this instance merges the peer's graph reads into its own view. Each record the peer serves arrives stamped with the site that holds it, so a view can group what it shows by site. The peer keeps its own records: it named a connecting site once, so it holds two principals of its own.",
		issueSessionGrant({ token: LAUNCHER, action: '"Instance:launch"' }),
		`with token ${LAUNCHER}, start a haibun instance from "tests/federate-peer" on port ${PEER_PORT} as host 7`,
		federateGraphReads({ where: `"http://localhost:${PEER_PORT}"` }),
		clusteredGraphHoldsFromSite({ type: '"Principal"', subject: '"did:site:7"', site: '"did:site:7"' }),
	],
};
