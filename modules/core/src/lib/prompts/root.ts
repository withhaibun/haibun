/**
 * The composition root of prompts. It builds the prompter that reads a person's answers from the console.
 */
import type { IPrompter } from "./ports.js";
import { ReadlinePrompter } from "./adapters/readline-prompter.js";

/** The prompter that reads a person's answer from the console. */
export const consolePrompter = (): IPrompter => new ReadlinePrompter();
