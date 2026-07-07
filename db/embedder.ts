import { config } from 'dotenv';
config();

// Local model — Hugging Face nomic-embed-text, fully offline
const LOCAL_MODEL = process.env.EMBED_MODEL ?? 'Xenova/nomic-embed-text-v1';
let localPipeline: any = null;

async function getLocalPipeline() {
  if (localPipeline) return localPipeline;
  const { pipeline } = await import('@huggingface/transformers');
  localPipeline = await pipeline('feature-extraction', LOCAL_MODEL);
  return localPipeline;
}

async function embedLocal(text: string): Promise<Float32Array | null> {
  try {
    const pipe = await getLocalPipeline();
    const out = await pipe(text, { pooling: 'mean', normalize: true });
    return new Float32Array(out.data);
  } catch (e) { 
    console.error('Local embedding failed:', e);
    return null; 
  }
}

// ── Exports ────────────────────────────────────────────────────────────────
// Gemini logic removed to ensure cost-free local-only operation as requested.
export const embed      = (text: string) => embedLocal(text);
export const embedQuery = (text: string) => embedLocal(text);

export function toBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer);
}

export function fromBuffer(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
