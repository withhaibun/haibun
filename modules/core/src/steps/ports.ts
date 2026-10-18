/** The ports of core's steppers: the host's speech and screen capture, which the narrator reads. */

/** A transcript's rendered audio, by the hash of the transcript: its length and the file that keeps the render. */
export type TRenderedAudioMap = { [hash: string]: { transcript: string; durationS: number; cachedPath: string } };

/** The host's speech and screen capture. */
export type TSpeech = {
	/** The audio of each transcript, rendered where a render isn't kept. */
	rendered(transcripts: ReadonlySet<string>): Promise<TRenderedAudioMap>;
	/** Copies a transcript's rendered audio into `dir`, and returns its file's name and its length in seconds. */
	copy(dir: string, rendered: TRenderedAudioMap, transcript: string): { path: string; durationS: number };
	play(audioPath: string): Promise<void>;
	/** Runs a shell command and returns what it writes, or an empty text where it fails and `throwOnError` is false. */
	exec(command: string, throwOnError: boolean): string;
	/** Starts a shell command apart from this process. */
	spawn(command: string): void;
	pause(ms: number): Promise<void>;
};
