/** Encode mono PCM as a 16-bit WAV Blob (browser-safe, no deps). */
export function encodeWavMono(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Decode a MediaRecorder blob and re-encode as 16 kHz mono WAV for Whisper. */
export async function blobToWav16k(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const targetRate = 16_000;
    const length = Math.max(1, Math.ceil(audio.duration * targetRate));
    const offline = new OfflineAudioContext(1, length, targetRate);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return encodeWavMono(rendered.getChannelData(0), targetRate);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
