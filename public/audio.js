import { AUTO_STOP_MS, MIN_WAV_BYTES } from '/shared/constants.js';

export { MIN_WAV_BYTES };

export async function toWav(blob) {
  const ctx = new AudioContext();
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration < 0.1) {
      const err = new Error('short');
      err.code = 'TOO_SHORT';
      throw err;
    }
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const node = offline.createBufferSource();
    node.buffer = decoded;
    node.connect(offline.destination);
    node.start();
    const mono = (await offline.startRendering()).getChannelData(0);

    const bytes = new ArrayBuffer(44 + mono.length * 2);
    const view = new DataView(bytes);
    const ascii = (off, s) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + mono.length * 2, true);
    ascii(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 16000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, mono.length * 2, true);
    for (let i = 0; i < mono.length; i++) {
      const s = Math.max(-1, Math.min(1, mono[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([bytes], { type: 'audio/wav' });
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function record({ onStop, onLevel, onElapsed, signal, maxMs = AUTO_STOP_MS }) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, signal });
  let audioCtx;
  let raf;
  if (onLevel) {
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const x = (value - 128) / 128;
        sum += x * x;
      }
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const started = performance.now();
  const interval = setInterval(() => onElapsed?.(performance.now() - started), 200);
  rec.onstop = async () => {
    clearTimeout(timer);
    clearInterval(interval);
    if (raf) cancelAnimationFrame(raf);
    stream.getTracks().forEach((track) => track.stop());
    if (audioCtx) await audioCtx.close().catch(() => {});
    try {
      onStop(await toWav(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })));
    } catch (err) {
      onStop(null, err);
    }
  };
  rec.start();
  const timer = setTimeout(() => {
    if (rec.state === 'recording') rec.stop();
  }, maxMs);
  return {
    stop() {
      clearTimeout(timer);
      if (rec.state === 'recording') rec.stop();
    },
  };
}
