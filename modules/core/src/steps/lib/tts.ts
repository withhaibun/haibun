import { execSync, spawn } from "child_process";
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, cpSync, unlinkSync } from 'fs';
import * as nodePath from 'path';
import { createRequire } from 'module';

import { TResolvedFeature } from "../../lib/defs.js";
import { ILogger } from "../../lib/interfaces/logger.js";
import { SCENARIO_START } from '../../lib/defs.js';
import { TAnyFixme } from "../../lib/fixme.js";

export type TCachedAudio = { transcript: string, durationS: number, cachedPath: string };
export type TRenderedAudioMap = { [hash: string]: TCachedAudio };

const CACHE_DIR = nodePath.resolve('capture/.said');

const SPOKEN_STEPS = ['prose', SCENARIO_START, 'feature'];

export async function preRenderFeatureProse(feature: TResolvedFeature, logger: ILogger): Promise<TRenderedAudioMap> {
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
			const audioInfo = await renderAudio(hash, transcript, CACHE_DIR);
			renderedAudio[hash] = audioInfo;
		}
	}
	return renderedAudio;
}

export function getMediafileDuration(filePath: string): Promise<number> {
	try {
		const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
		const durationStr = doExec(command);
		const duration = parseFloat(durationStr);

		if (isNaN(duration)) {
			throw new Error(`ffprobe returned non-numeric duration: "${durationStr}" for ${filePath}`);
		}
		return Promise.resolve(duration);
	} catch (error) {
		console.error(`Error getting duration for ${filePath}: ${(error as Error).message}`);
		throw error;
	}
}

/**
 * Render speech to WAV using kokoro-js with late require.
 * Checks if kokoro-js is installed in the current working directory; if not, installs it locally.
 */
export async function renderSpeech(transcript: string): Promise<string> {
	// Ensure kokoro-js is available in the local node_modules
	const localKokoroPath = nodePath.join(process.cwd(), 'node_modules/kokoro-js');

	if (!existsSync(localKokoroPath)) {
		console.log('kokoro-js not found locally, installing in current directory...');
		try {
			doExec('npm install --no-save kokoro-js', true);
		} catch (e) {
			console.error(`Failed to install kokoro-js: ${(e as Error).message}`);
			throw e;
		}
	}

	// Use require to resolve from the local node_modules path
	let KokoroTTS: TAnyFixme;
	try {
		// biome-disable-next-line @typescript-eslint/no-explicit-any
		const require = createRequire(localKokoroPath + '/package.json');
		const kokoroModule = require('kokoro-js') as { KokoroTTS: TAnyFixme };
		KokoroTTS = kokoroModule.KokoroTTS;
	} catch (e) {
		throw new Error(`Failed to import kokoro-js: ${(e as Error).message}`);
	}

	try {
		const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
		const tts = await KokoroTTS.from_pretrained(model_id, {
			dtype: "q8", // Options: "fp32", "fp16", "q8", "q4", "q4f16"
			device: "cpu", // Options: "wasm", "webgpu" (web) or "cpu" (node)
		});

		const audio = await tts.generate(transcript, {
			// Use `tts.list_voices()` to list all available voices
			voice: "af_heart",
		});

		// Save to temporary file
		const tmpFile = nodePath.join(CACHE_DIR, `tmp-${Date.now()}.wav`);
		mkdirSync(CACHE_DIR, { recursive: true });
		await audio.save(tmpFile);

		return tmpFile;
	} catch (e) {
		console.error('Error in TTS generation:', (e as Error).message);
		throw e;
	}
}

export async function renderAudio(hash: string, transcript: string, cacheDir: string): Promise<TCachedAudio> {
	const generatedWavPath = await renderSpeech(transcript);
	if (!existsSync(generatedWavPath)) {
		throw new Error(`TTS command did not produce expected file: ${generatedWavPath}`);
	}

	const durationS = await getMediafileDuration(generatedWavPath);
	const targetFilename = `${hash}-${durationS.toFixed(3)}.wav`;
	const finalCachedPath = nodePath.join(cacheDir, targetFilename);

	cpSync(generatedWavPath, finalCachedPath, { force: true });

	// Clean up temporary file
	try {
		unlinkSync(generatedWavPath);
	} catch (e) {
		console.warn(`Failed to clean up temp file ${generatedWavPath}: ${(e as Error).message}`);
	}

	return { transcript, durationS, cachedPath: finalCachedPath };
}

export function copyPreRenderedAudio(dir: string, renderedAudio: TRenderedAudioMap, transcript: string) {
	const hash = createHash('sha1').update(transcript).digest('hex');
	const audioInfo = renderedAudio[hash];

	if (!audioInfo) {
		throw new Error(`No pre-rendered audio found for: "${transcript}" (hash: ${hash}). Available hashes: ${Object.keys(renderedAudio).join(', ')}`);
	}

	const { cachedPath, durationS } = audioInfo;
	const cacheFilename = nodePath.parse(cachedPath).base;

	const path = nodePath.resolve(nodePath.join(dir, cacheFilename));
	cpSync(cachedPath, path, { force: true });
	return { path: cacheFilename, durationS };
}

/**
 * Play audio file using ffmpeg.
 * This replaces the TTS_PLAY option entirely.
 */
export function playAudioFile(audioPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		try {
			// Use ffplay to play audio through system speakers
			const proc = spawn('ffplay', ['-nodisp', '-autoexit', audioPath], {
				stdio: ['ignore', 'pipe', 'pipe'],
				detached: false,
			});

			proc.on('close', (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`ffplay exited with code ${code}`));
				}
			});

			proc.on('error', (err) => {
				reject(new Error(`Error running ffplay: ${err.message}`));
			});
		} catch (error) {
			reject(new Error(`Failed to execute ffplay: ${(error as Error).message}`));
		}
	});
}

export function doExec(command: string, throwOnError = true): string {
	try {
		const stdout = execSync(command, { encoding: 'utf8', stdio: 'pipe' }).toString();
		return stdout.trim();
	} catch (error) {
		let stderr = '';
		if (error && typeof error === 'object' && 'stderr' in error && error.stderr) {
			stderr = String(error.stderr);
		}
		console.error(stderr);
		if (throwOnError) throw (error);
		return '';
	}
}

export function doSpawn(command: string) {
	const captureProc = spawn(command, { shell: true, detached: true, stdio: 'ignore' });
	captureProc.unref();
}
