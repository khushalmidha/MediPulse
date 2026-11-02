// Explicit public-model preparation; never run automatically during API startup.
if (!process.argv.includes('--download')) {
  console.error('Pass --download to explicitly populate the pinned public model cache'); process.exitCode = 1;
} else {
  process.env.REELS_EMBEDDING_ALLOW_DOWNLOAD = 'true';
  const { embedReelText } = await import('../services/reelEmbedding.js');
  const result = await embedReelText({ title: 'Synthetic educational model preparation', topics: ['education'], language: 'en' });
  console.log(JSON.stringify({ model: result.model, revision: result.revision, dimension: result.dimension, ready: true }));
}
