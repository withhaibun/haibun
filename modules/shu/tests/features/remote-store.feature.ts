import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import Haibun from "@haibun/core/steps/haibun.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import MonitorStepper from "../../build/monitor-stepper.js";

const { feature, useStoreAt } = withAction(new Haibun());
const { issueSessionGrant } = withAction(new AuthorityStepper());
const { clusteredGraphHoldsFromSite } = withAction(new MonitorStepper());

const LAUNCHER = '"launcher-token"';
const PEER_PORT = process.env.HAIBUN_REMOTE_STORE_PEER_PORT ?? "8252";
const PEER_URL = `"http://localhost:${PEER_PORT}"`;

export const features: TKirejiExport = {
	"A satellite instance keeps its records in the main instance's store": [
		feature({ feature: "Keep records in another instance's store" }),
		"A main instance starts and grants a delegated store capability. This satellite mounts the main's store for its principal records, so anything it persists lands in the main's store — one store, one custodian — under the capability the main granted.",
		issueSessionGrant({ token: LAUNCHER, action: '"Instance:launch"' }),
		`with token ${LAUNCHER}, start a haibun instance from "tests/federate-peer" on port ${PEER_PORT} as host 7`,
		useStoreAt({ where: PEER_URL, types: '"Principal"', token: '"satellite-store"' }),
		"The naming of a connecting site persists principal records; with the store mounted, they travel through to the main instance.",
		"name a connecting site",
		"The proof reads back through the mounted store itself: this instance's own view now shows the record it wrote under the main's site, because that is where it is held — its location is a store fact.",
		clusteredGraphHoldsFromSite({ type: '"Principal"', subject: '"did:site:0.1"', site: '"did:site:7"' }),
	],
};
