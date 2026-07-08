import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import Haibun from "@haibun/core/steps/haibun.js";
import InstanceStepper from "@haibun/cli/instance-stepper.js";
import MonitorStepper from "../../build/monitor-stepper.js";

const { feature } = withAction(new Haibun());
const { startInstance } = withAction(new InstanceStepper());
const { federateGraphReads, clusteredGraphHoldsFromSite } = withAction(new MonitorStepper());

const PEER_PORT = process.env.HAIBUN_FEDERATE_PEER_PORT ?? "8250";

export const features: TKirejiExport = {
	"Federated graph reads from a sibling instance": [
		feature({ feature: "Federate graph reads across haibun instances" }),
		"A second haibun instance starts the same way an operator would run one — its own configuration, port, and host number — and this instance merges the peer's graph reads into its own view. Each record the peer serves arrives stamped with the site that holds it, so a view can group what it shows by site. The peer keeps its own records: it named a connecting site once, so it holds two principals of its own.",
		startInstance({ where: '"tests/federate-peer"', port: PEER_PORT, hostId: "7" }),
		federateGraphReads({ where: `"http://localhost:${PEER_PORT}"` }),
		clusteredGraphHoldsFromSite({ type: '"Principal"', site: '"did:site:7"' }),
	],
};
