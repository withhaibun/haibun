import { Result, Check, ImpactValue, Locale, Rule, RunOptions } from 'axe-core'

// adapted from https://github.com/abhinaba-ghosh/axe-playwright

export interface NodeViolation {
    target: string
    html: string
    violations: string
}

export interface Aggregate {
    [key: string]: {
        target: string
        html: string
        violations: number[]
    }
}

export default interface Reporter {
    report(violations: Result[]): Promise<void>
}

export interface axeOptionsConfig {
    axeOptions?: RunOptions
}

export interface ConfigOptions {
    branding?: {
        brand?: string
        application?: string
    }
    reporter?: 'v1' | 'v2' | 'no-passes'
    checks?: Check[]
    rules?: Rule[]
    locale?: Locale
    axeVersion?: string
}
export type Options = {
    includedImpacts?: ImpactValue[]
    detailedReport?: boolean
    detailedReportOptions?: { html?: boolean }
    verbose?: boolean
} & axeOptionsConfig