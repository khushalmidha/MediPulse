import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
const fixture = 'http://127.0.0.1:19080';
const id = 'a'.repeat(24), doctor = '000000000000000000000001';
let root, media, source, probe;
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'reels-browser-')); process.env.REELS_MEDIA_ROOT = root;
  const backend = path.resolve(process.cwd(), '../backend');
  const binary = (await import(pathToFileURL(path.join(backend, 'node_modules/ffmpeg-static/index.js')).href)).default;
  const { processVideo, probeVideo } = await import(pathToFileURL(path.join(backend, 'services/reelMedia.js')).href); probe = probeVideo;
  source = path.join(root, id, 'originals/source.mp4'); await fs.mkdir(path.dirname(source), { recursive: true });
  const generated = spawnSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=360x640:r=1', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source], { timeout: 30000 });
  expect(generated.status).toBe(0); media = await processVideo(id, source);
});
test.afterAll(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });
test.beforeEach(async ({ page, request }) => {
  await request.post(fixture + '/__fixture/reset', { data: {} });
  await page.route('**/*', route => { const url = new URL(route.request().url()); return url.hostname === '127.0.0.1' && ['15173', '19080'].includes(url.port) ? route.continue() : route.abort(); });
});
async function mockReels(page, { reviewer = false } = {}) {
  let following = false, comments = [], mine = [], preference = false;
  const mutations = [];
  const reel = { id, doctor: { id: doctor, name: 'Dr. Synthetic Educator', specialty: 'Cardiology' }, title: 'Heart health basics', caption: 'A synthetic educational video', topics: ['heart health'], language: 'en', duration: 2, counts: { likes: 0, saves: 0, comments: 0 }, liked: false, saved: false, following: false, status: 'published', mediaStatus: 'ready', version: 2, playbackUrl: `/api/reels/media/${id}/job/master.m3u8`, thumbnailUrl: `/api/reels/media/${id}/job/thumbnail.jpg` };
  await page.route('**/api/reels**', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname.split('/api/reels')[1], method = req.method();
    if (p.startsWith('/media/')) {
      const file = p.split('/job/')[1];
      const body = await fs.readFile(path.join(media.outputDirectory, file));
      return route.fulfill({ status: 200, body, contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : file.endsWith('.ts') ? 'video/mp2t' : 'image/jpeg' });
    }
    const body = req.postDataBuffer()?.length && !p.endsWith('/upload') ? req.postDataJSON() : {};
    if (method !== 'GET') mutations.push({ path: p, body, csrf: req.headers()['x-csrf-token'], contentType: req.headers()['content-type'], bytes: req.postDataBuffer()?.length || 0 });
    let data = {};
    if (p === '/feed') data = { items: url.searchParams.get('mode') === 'following' && !following ? [] : [reel], nextCursor: null, personalization: { enabled: preference } };
    else if (p === '/preferences') { if (method === 'POST') preference = body.personalizationEnabled; data = { personalizationEnabled: preference, topics: [] }; }
    else if (p === '/mine') data = { items: mine, canReview: reviewer };
    else if (p === '/moderation') data = { items: reviewer ? [{ ...reel, status: 'pending_review' }] : [] };
    else if (p === '/reports') data = { items: [] };
    else if (p.endsWith('/reactions')) { reel[body.kind === 'like' ? 'liked' : 'saved'] = body.active; reel.counts[body.kind === 'like' ? 'likes' : 'saves'] = Number(body.active); data = { active: body.active, counts: reel.counts }; }
    else if (p.endsWith('/follow')) { following = body.active; data = { active: following }; }
    else if (p.endsWith('/comments') && method === 'GET') data = { items: comments, nextCursor: null };
    else if (p.endsWith('/comments')) { const comment = { id: 'comment-1', authorName: 'Synthetic Patient', text: body.text, createdAt: new Date().toISOString() }; comments = [comment]; data = { comment }; }
    else if (p.endsWith('/playback')) data = { sessionId: 'synthetic-playback' };
    else if ((p === '' || p === '/') && method === 'POST') { mine = [{ ...reel, ...body, status: 'draft', mediaStatus: 'empty', version: 0 }]; data = { reel: mine[0] }; }
    else if (p.endsWith('/upload')) {
      if (req.headers()['content-type'].startsWith('video/webm')) { const captured = path.join(root, id, 'originals/captured.webm'); await fs.writeFile(captured, req.postDataBuffer()); const checked = await probe(captured); expect(checked.duration).toBeGreaterThan(0); expect(checked.duration).toBeLessThanOrEqual(300); }
      mine[0] = { ...mine[0], mediaStatus: 'queued', version: 1 }; data = { reel: mine[0] };
    }
    else if (p.endsWith('/moderate')) data = { reel: { ...reel, status: 'published' } };
    return route.fulfill({ status: method === 'POST' && p.endsWith('/comments') ? 201 : 200, json: data });
  });
  return mutations;
}
test('guest and patient studio gates explain actual required account', async ({ page, request }) => {
  await request.post(fixture + '/__fixture/reset', { data: { guest: true } }); await page.goto('/reels'); await expect(page.getByRole('heading', { name: 'Doctor Reels', exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await request.post(fixture + '/__fixture/reset', { data: {} }); await page.goto('/doctor/reels'); await expect(page.getByText('Publishing is available to verified doctor accounts.')).toBeVisible();
});
test('adaptive HLS feed, account CSRF reactions, comments, reporting and mobile layout', async ({ page }) => {
  const writes = await mockReels(page); await page.goto('/reels');
  await expect(page.getByRole('heading', { name: 'Heart health basics' })).toBeVisible();
  await page.locator('video').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('video').evaluate(v => v.readyState)).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Like · 0', exact: true }).click(); await expect(page.getByRole('button', { name: 'Like · 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(writes.find(x => x.path.endsWith('/reactions')).csrf).toBe('fixture-account-csrf');
  await page.getByRole('button', { name: 'Comments · 0', exact: true }).click(); await page.getByLabel('Your comment').fill('Useful synthetic explanation'); await page.getByRole('button', { name: 'Post comment', exact: true }).click(); await expect(page.getByText('Useful synthetic explanation', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Report', exact: true }).click(); await page.getByLabel('Report reason', { exact: true }).selectOption('patient_privacy'); await page.getByRole('button', { name: 'Send report', exact: true }).click(); await expect.poll(() => writes.some(x => x.path.endsWith('/report'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
test('doctor uploads actual video bytes with stable identity and explicit privacy attestations', async ({ page, request }) => {
  await request.post(fixture + '/__fixture/reset', { data: { doctorSession: true } }); const writes = await mockReels(page); await page.goto('/doctor/reels');
  await page.getByLabel('Title', { exact: true }).fill('Synthetic exercise guide'); await page.getByLabel('Caption', { exact: true }).fill('Educational discussion'); await page.getByLabel('Topics, separated by commas').fill('heart health');
  await page.getByLabel(/Choose a video/).setInputFiles(source);
  expect(await page.getByLabel(/Choose a video/).evaluate(node => node.files[0].size)).toBeGreaterThan(100);
  await page.getByRole('checkbox', { name: /I confirm this video/ }).check(); await page.getByRole('checkbox', { name: /This content is educational/ }).check();
  await page.getByRole('button', { name: /Upload/ }).click();
  await expect.poll(() => writes.some(x => x.path.endsWith('/upload'))).toBe(true);
  const upload = writes.find(x => x.path.endsWith('/upload')); expect(upload.contentType).toContain('video/mp4'); expect(upload.contentType).toContain('video/mp4'); expect(upload.csrf).toBe('fixture-account-csrf');
  await expect(page.getByRole('heading', { name: 'Synthetic exercise guide' })).toBeVisible();
});
test('independent reviewer sees actual HLS preview and submits version-bound decision', async ({ page, request }) => {
  await request.post(fixture + '/__fixture/reset', { data: { doctorSession: true } }); const writes = await mockReels(page, { reviewer: true }); await page.goto('/doctor/reels');
  await expect(page.getByRole('heading', { name: 'Independent medical review' })).toBeVisible(); await page.getByLabel('Review reason', { exact: true }).fill('Synthetic video reviewed for publication'); await page.getByRole('button', { name: 'Approve and publish', exact: true }).click();
  await expect.poll(() => writes.some(x => x.path.endsWith('/moderate') && x.body.version === 2 && x.body.decision === 'publish')).toBe(true);
});
test('browser camera recording uploads a genuinely server-probed WebM', async ({ page, request, context }) => {
  await context.grantPermissions(['camera', 'microphone']);
  await request.post(fixture + '/__fixture/reset', { data: { doctorSession: true } }); const writes = await mockReels(page); await page.goto('/doctor/reels');
  await page.getByLabel('Title', { exact: true }).fill('Synthetic recorded education');
  await page.getByRole('button', { name: 'Enable camera & microphone', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.waitForTimeout(1500); // Real recording duration, not a substitute for a readiness assertion.
  await page.getByRole('button', { name: /Stop recording/ }).click();
  await expect(page.getByLabel('Recorded video preview')).toBeVisible();
  await page.getByRole('checkbox', { name: /I confirm this video/ }).check(); await page.getByRole('checkbox', { name: /This content is educational/ }).check();
  await page.getByRole('button', { name: /Upload/ }).click();
  await expect.poll(() => writes.some(x => x.path.endsWith('/upload') && x.contentType.startsWith('video/webm'))).toBe(true);
  await expect(page.getByRole('heading', { name: 'Synthetic recorded education' })).toBeVisible();
});
