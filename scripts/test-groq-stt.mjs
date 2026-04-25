// Diagnostic: synthesize a 16kHz mono WAV containing a swept tone and call
// Groq Whisper to verify the API path works end-to-end. If Groq returns 400
// on this file, the bug is upstream (key/model/format). If 200, our app's
// pipeline is the only suspect.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.error('Set GROQ_API_KEY env var first.');
  process.exit(1);
}

// Build a 3-second WAV: 16kHz mono 16-bit PCM, simple tone.
const SR = 16000;
const SECS = 3;
const N = SR * SECS;
const data = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const s = Math.sin(2 * Math.PI * 440 * t) * 0.3;
  data.writeInt16LE(Math.round(s * 32767), i * 2);
}
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0);
hdr.writeUInt32LE(36 + data.length, 4);
hdr.write('WAVE', 8);
hdr.write('fmt ', 12);
hdr.writeUInt32LE(16, 16);
hdr.writeUInt16LE(1, 20);
hdr.writeUInt16LE(1, 22);
hdr.writeUInt32LE(SR, 24);
hdr.writeUInt32LE(SR * 2, 28);
hdr.writeUInt16LE(2, 32);
hdr.writeUInt16LE(16, 34);
hdr.write('data', 36);
hdr.writeUInt32LE(data.length, 40);
const wav = Buffer.concat([hdr, data]);

const out = path.join(os.tmpdir(), 'mm-test.wav');
fs.writeFileSync(out, wav);
console.log('Wrote', wav.length, 'bytes →', out);

const fd = new FormData();
fd.set('model', 'whisper-large-v3-turbo');
fd.set('file', new Blob([wav], { type: 'audio/wav' }), 'test.wav');

console.log('POST https://api.groq.com/openai/v1/audio/transcriptions');
const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}` },
  body: fd,
});
const text = await res.text();
console.log('Status:', res.status);
console.log('Body:', text.slice(0, 400));
