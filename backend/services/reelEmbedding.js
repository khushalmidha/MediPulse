import path from 'node:path';
import { access } from 'node:fs/promises';

export const REEL_EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
// Immutable upstream model revision, verified against the Hugging Face model API.
export const REEL_EMBEDDING_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900';
export const REEL_EMBEDDING_DIMENSION = 384;
let extractorPromise;

export function reelEmbeddingText({ title = '', caption = '', topics = [], language = '' } = {}) {
  if (typeof title !== 'string' || typeof caption !== 'string' || typeof language !== 'string' || !Array.isArray(topics) || topics.some(topic => typeof topic !== 'string')) throw new Error('Invalid public reel metadata');
  if (title.length > 200 || caption.length > 4000 || language.length > 40 || topics.length > 20 || topics.some(topic => topic.length > 80)) throw new Error('Reel embedding metadata exceeds limits');
  const text = [title, caption, topics.join(', '), language].map(value => value.trim()).filter(Boolean).join('\n');
  if (!text) throw new Error('Public reel metadata is empty');
  return text;
}

async function extractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { AutoModel, AutoTokenizer, FeatureExtractionPipeline, env } = await import('@huggingface/transformers');
      const allowDownload = process.env.REELS_EMBEDDING_ALLOW_DOWNLOAD === 'true';
      env.allowRemoteModels = allowDownload;
      env.allowLocalModels = true;
      if (process.env.REELS_EMBEDDING_CACHE_DIR) env.cacheDir = path.resolve(process.env.REELS_EMBEDDING_CACHE_DIR);
      let source = REEL_EMBEDDING_MODEL;
      const local = process.env.REELS_EMBEDDING_LOCAL_MODEL_PATH
        ? path.resolve(process.env.REELS_EMBEDDING_LOCAL_MODEL_PATH)
        : path.join(env.cacheDir, REEL_EMBEDDING_MODEL, REEL_EMBEDDING_REVISION);
      try {
        await Promise.all(['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'].map(file => access(path.join(local, file))));
        source = local;
      } catch { if (!allowDownload) throw new Error('Pinned local model files are missing'); }
      const options = {
        revision: REEL_EMBEDDING_REVISION,
        dtype: 'q8', device: 'cpu', local_files_only: !allowDownload,
      };
      // Load both known text components explicitly. Automatic remote file discovery
      // can omit the tokenizer in offline mode even when all pinned files are cached.
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(source, options),
        AutoModel.from_pretrained(source, options),
      ]);
      return new FeatureExtractionPipeline({ task: 'feature-extraction', model, tokenizer });
    })().catch(error => {
      extractorPromise = undefined;
      throw new Error('Reel embedding model unavailable. Install the pinned local multilingual model or explicitly enable REELS_EMBEDDING_ALLOW_DOWNLOAD=true to populate the model cache.', { cause: error });
    });
  }
  return extractorPromise;
}

// Accept only already-public reel metadata; callers must never supply patient records.
export async function embedReelText(metadata) {
  const text = reelEmbeddingText(metadata);
  const pipeline = await extractor();
  const output = await pipeline(text, { pooling: 'mean', normalize: true, truncation: true });
  const vector = Array.from(output.data, Number);
  if (vector.length !== REEL_EMBEDDING_DIMENSION || vector.some(value => !Number.isFinite(value)) || Math.abs(Math.hypot(...vector) - 1) > 0.01) throw new Error('Embedding model returned an invalid normalized vector');
  return { vector, model: REEL_EMBEDDING_MODEL, revision: REEL_EMBEDDING_REVISION, dimension: vector.length };
}
