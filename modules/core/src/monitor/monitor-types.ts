/**
 * Browser-safe types and constants for Haibun monitor modules.
 * 
 * This file re-exports types from the core library that are safe for browser use.
 * It avoids importing from modules that have Node.js dependencies (defs.ts, prompter.ts, etc.)
 * 
 * Import from '@haibun/core/monitor' in browser code instead of '@haibun/core/lib/interfaces/logger.js'
 */

// ============================================================================
// Log Levels
// ============================================================================

export const LOG_LEVEL_NONE = 'none' as const;
export const LOG_LEVEL_DEBUG = 'debug' as const;
export const LOG_LEVEL_TRACE = 'trace' as const;
export const LOG_LEVEL_LOG = 'log' as const;
export const LOG_LEVEL_INFO = 'info' as const;
export const LOG_LEVEL_WARN = 'warn' as const;
export const LOG_LEVEL_ERROR = 'error' as const;

export const LOG_LEVELS = [LOG_LEVEL_DEBUG, LOG_LEVEL_TRACE, LOG_LEVEL_LOG, LOG_LEVEL_INFO, LOG_LEVEL_WARN, LOG_LEVEL_ERROR] as const;

export type TLogLevel = 'none' | typeof LOG_LEVELS[number];
export type TLogArgs = string;

// ============================================================================
// Execution Message Types
// ============================================================================

export enum EExecutionMessageType {
  INIT = 'INIT',
  EXECUTION_START = 'EXECUTION_START',
  FEATURE_START = 'FEATURE_START',
  SCENARIO_START = 'SCENARIO_START',
  STEP_START = 'STEP_START',
  STEP_NEXT = 'STEP_NEXT',
  ACTION = 'ACTION',
  TRACE = 'TRACE',
  STEP_END = 'STEP_END',
  ENSURE_START = 'ENSURE_START',
  ENSURE_END = 'ENSURE_END',
  SCENARIO_END = 'SCENARIO_END',
  FEATURE_END = 'FEATURE_END',
  EXECUTION_END = 'EXECUTION_END',
  ON_FAILURE = 'ON_FAILURE',
  DEBUG = "DEBUG",
  GRAPH_LINK = 'GRAPH_LINK',
}

// ============================================================================
// Message Context Types (without Node.js dependencies)
// ============================================================================

/**
 * Simplified TMessageContext for browser use.
 * Uses `unknown` instead of importing specific types that pull in Node.js deps.
 */
export type TMessageContext = {
  incident: EExecutionMessageType;
  artifacts?: TArtifact[];
  incidentDetails?: unknown;
  tag?: unknown;
};

// ============================================================================
// Artifact Types
// ============================================================================

export type TArtifact = (
  TArtifactSpeech |
  TArtifactVideo |
  TArtifactResolvedFeatures |
  TArtifactVideoStart |
  TArtifactImage |
  TArtifactHTML |
  TArtifactJSON |
  TArtifactHTTPTrace
);

export type TArtifactSpeech = {
  artifactType: 'speech';
  transcript: string;
  durationS: number;
  path: string;
};

export type RegisteredOutcomeEntry = {
  proofStatements?: string[];
  proofPath?: string;
  isBackground?: boolean;
  activityBlockSteps?: string[];
};

export type TArtifactResolvedFeatures = {
  artifactType: 'resolvedFeatures';
  resolvedFeatures: unknown[]; // TResolvedFeature[] - simplified for browser
  index?: number;
  registeredOutcomes?: Record<string, RegisteredOutcomeEntry>;
};

export type TArtifactVideo = {
  artifactType: 'video';
  path: string;
};

export type TArtifactVideoStart = {
  artifactType: 'video/start';
  start: number;
};

export type TArtifactImage = {
  artifactType: 'image';
  path: string;
};

export type TArtifactHTML = TArtifactHTMLWithHtml | TArtifactHTMLWithPath;

type TArtifactHTMLWithHtml = {
  artifactType: 'html';
  html: string;
}

type TArtifactHTMLWithPath = {
  artifactType: 'html';
  path: string;
}

export type TArtifactJSON = {
  artifactType: 'json';
  json: object;
};

export type TArtifactHTTPTrace = {
  artifactType: 'json/http/trace';
  httpEvent: 'response' | 'request' | 'route';
  trace: THTTPTraceContent;
};

export type TArtifactType = TArtifact['artifactType'];

export type THTTPTraceContent = {
  frameURL?: string;
  requestingPage?: string;
  requestingURL?: string;
  method?: string;
  headers?: Record<string, string>;
  postData?: unknown;
  status?: number;
  statusText?: string;
}

// ============================================================================
// Prompt Types (browser-safe subset)
// ============================================================================

/**
 * Browser-safe TPrompt type.
 * The full Prompter class has Node.js dependencies, but this type is safe.
 */
export type TPrompt = {
  id: string;
  message: string;
  context?: unknown;
  options?: string[];
};
