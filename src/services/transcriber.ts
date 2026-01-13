/**
 * Audio transcription service using Cloudflare Workers AI Whisper
 */

export interface TranscriptionResult {
  text: string;
  duration?: number;
}

/**
 * Transcribe audio/video content using Cloudflare Workers AI Whisper
 * Note: Whisper can handle video files directly - it extracts the audio automatically
 */
export async function transcribeAudio(
  ai: Ai,
  audioData: ArrayBuffer
): Promise<TranscriptionResult> {
  console.log(`Transcribing audio/video: ${audioData.byteLength} bytes`);

  // Convert ArrayBuffer to number array for Whisper
  const audioArray = Array.from(new Uint8Array(audioData));

  // Use Whisper model for transcription
  // Whisper can handle various audio/video formats
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (ai as any).run('@cf/openai/whisper', {
    audio: audioArray,
  }) as { text?: string; vtt?: string };

  if (!result.text) {
    throw new Error('No transcription text returned from Whisper');
  }

  console.log(`Transcription complete: ${result.text.length} characters`);

  return {
    text: result.text,
  };
}

/**
 * Transcribe with the larger, more accurate model for longer content
 */
export async function transcribeAudioLarge(
  ai: Ai,
  audioData: ArrayBuffer
): Promise<TranscriptionResult> {
  console.log(`Transcribing with large model: ${audioData.byteLength} bytes`);

  // Convert ArrayBuffer to number array for Whisper
  const audioArray = Array.from(new Uint8Array(audioData));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (ai as any).run('@cf/openai/whisper-large-v3-turbo', {
    audio: audioArray,
  }) as { text?: string };

  if (!result.text) {
    throw new Error('No transcription text returned from Whisper');
  }

  return {
    text: result.text,
  };
}
