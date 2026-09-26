import { Result, ImpactValue, RunOptions } from "axe-core";

export default interface Reporter {
	report(violations: Result[]): Promise<void>;
}

interface axeOptionsConfig {
	axeOptions?: RunOptions;
}

export type Options = {
	includedImpacts?: ImpactValue[];
	detailedReport?: boolean;
	detailedReportOptions?: { html?: boolean };
	verbose?: boolean;
} & axeOptionsConfig;
