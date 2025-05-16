import { execSync, spawn } from "child_process";
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, cpSync } from 'fs';
import * as nodePath from 'path';

import { TResolvedFeature } from "../../lib/defs.js";
import { ILogger } from "../../lib/interfaces/logger.js";
import { SCENARIO_START } from '../../lib/defs.js';

export type TCachedAudio = { transcript: string, durationS: number, cachedPath: string };
export type TRenderedAudioMap = { [hash: string]: TCachedAudio };

const CACHE_DIR = 'capture/.said';

const SPOKEN_STEPS = ['prose', SCENARIO_START, 'feature'];

export async function preRenderFeatureProse(feature: TResolvedFeature, ttsCmd: string, logger: ILogger): Promise<TRenderedAudioMap> {
	const proseTexts = new Set<string>();
	for (const step of feature.featureSteps) {
		if (SPOKEN_STEPS.includes(step.action.actionName)) {
			const text = step.in;
			proseTexts.add(text);
		}
	}

	if (proseTexts.size === 0) {
		return {};
	}

	logger.debug(`${proseTexts.size} unique prose statements may need to be pre-rendered`);

	const renderedAudio: TRenderedAudioMap = {};
	mkdirSync(CACHE_DIR, { recursive: true });

	const existingAudioRenders = readdirSync(CACHE_DIR);
	for (const transcript of proseTexts) {
		const hash = createHash('sha1').update(transcript).digest('hex');
		const existing = existingAudioRenders.find((f) => f.startsWith(`${hash}-`));
		if (existing) {
			const parts = existing.replace('.wav', '').split('-');
			const durationS = parseFloat(parts[1]);
			const cachedPath = nodePath.join(CACHE_DIR, existing);
			renderedAudio[hash] = { transcript, durationS, cachedPath };
		} else {
			logger.info(`Rendering audio for transcript "${transcript}"`);
			const audioInfo = await renderAudio(hash, ttsCmd, transcript, CACHE_DIR);
			renderedAudio[hash] = audioInfo;
		}
	}
	return renderedAudio;
}

export async function getMediafileDuration(filePath: string): Promise<number> {
	try {
		const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
		const durationStr = await doExec(command);
		const duration = parseFloat(durationStr);

		if (isNaN(duration)) {
			throw new Error(`ffprobe returned non-numeric duration: "${durationStr}" for ${filePath}`);
		}
		return Promise.resolve(duration);
	} catch (error) {
		console.error(`Error getting duration for ${filePath}: ${error.message}`);
		throw error;
	}
}

export async function renderAudio(hash: string, ttsCmd: string, transcript: string, cacheDir: string): Promise<TCachedAudio> {
	const generatedWavPath = await renderSpeech(ttsCmd, transcript);
	if (!existsSync(generatedWavPath)) {
		throw new Error(`TTS command did not produce expected file: ${generatedWavPath}`);
	}

	const durationS = await getMediafileDuration(generatedWavPath);
	const targetFilename = `${hash}-${durationS.toFixed(3)}.wav`;
	const finalCachedPath = nodePath.join(cacheDir, targetFilename);

	cpSync(generatedWavPath, finalCachedPath, { force: true });

	return { transcript, durationS, cachedPath: finalCachedPath };
}

export async function copyPreRenderedAudio(dir: string, renderedAudio: TRenderedAudioMap, transcript: string) {
	const hash = createHash('sha1').update(transcript).digest('hex');
	const { cachedPath, durationS } = renderedAudio[hash];
	const cacheFilename = nodePath.parse(cachedPath).base;

	const path = nodePath.resolve(nodePath.join(dir, cacheFilename));
	cpSync(cachedPath, path, { force: true });
	return Promise.resolve({ path: cacheFilename, durationS });
}

export async function playAudioFile(playCmd: string) {
	await doExec(playCmd);
}

export async function doExec(command: string, throwOnError = true): Promise<string> {
	try {
		const stdout = execSync(command, { encoding: 'utf8', stdio: 'pipe' }).toString();
		return Promise.resolve(stdout.trim());
	} catch (error) {
		const stderr = error.stderr ? error.stderr.toString() : '';
		console.error(stderr);
		if (throwOnError) throw (error);
	}
}

export function doSpawn(command: string) {
	const captureProc = spawn(command, { shell: true, detached: true, stdio: 'ignore' });
	captureProc.unref();
}

async function renderSpeech(cmd: string, what: string): Promise<string> {
	what = what.replace(/"/g, '\\"');
	const command = cmd.replace('@WHAT@', `"${what}"`);
	return await doExec(command)
}
