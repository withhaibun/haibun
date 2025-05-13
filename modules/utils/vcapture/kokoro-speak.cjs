const { KokoroTTS } = require("kokoro-js");

async function writeTextToWav(fn, tospeak) {
	const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
	const tts = await KokoroTTS.from_pretrained(model_id, {
		dtype: "q8", // Options: "fp32", "fp16", "q8", "q4", "q4f16"
		device: "cpu", // Options: "wasm", "webgpu" (web) or "cpu" (node). If using "webgpu", we recommend using dtype="fp32".
	});

	const audio = await tts.generate(tospeak, {
		// Use `tts.list_voices()` to list all available voices
		voice: "af_heart",
	});
	audio.save(fn);
}
const [fn, tospeak] = process.argv.slice(2);
writeTextToWav(fn, tospeak);
