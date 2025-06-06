import { TArtifactSpeech } from '@haibun/core/build/lib/interfaces/logger.js';
import { ArtifactDisplay } from './artifactDisplayBase.js';

export class SpeechArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget = 'details';

	constructor(protected artifact: TArtifactSpeech) {
		super(artifact);
	}

	public render(container: HTMLElement): void {
		const typedArtifact = this.artifact as TArtifactSpeech;
		container.innerHTML = '';

		const audioElement = document.createElement('audio');
		audioElement.src = typedArtifact.path;
		audioElement.controls = true;
		audioElement.style.width = '320px';

		container.appendChild(audioElement);
	}
}
