import React from 'react';
import { TSpeechArtifact } from '@haibun/core/schema/protocol.js';

interface SpeechArtifactProps {
  artifact: TSpeechArtifact;
}

/**
 * Speech/audio artifact with audio controls and optional transcript.
 */
export function SpeechArtifact({ artifact }: SpeechArtifactProps) {
  return (
    <div className="haibun-artifact-speech flex flex-col gap-2">
      <audio
        src={artifact.path}
        controls
        className="w-80"
      />
      {artifact.transcript && (
        <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded italic">
          "{artifact.transcript}"
        </div>
      )}
      {artifact.durationS && (
        <div className="text-xs text-gray-400">
          Duration: {artifact.durationS.toFixed(1)}s
        </div>
      )}
    </div>
  );
}
