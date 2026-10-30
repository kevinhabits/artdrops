import test from 'node:test';
import assert from 'node:assert/strict';
import { appHarness } from './helpers/app-harness.mjs';

const work = id => ({
  id, title: `Artwork ${id}`, artist: 'Example artist', kind: 'video',
  mediaUrl: `https://media.example/${id}.mp4`,
  alternateMediaUrl: `https://backup.example/${id}.mp4`,
  posterUrl: `https://media.example/${id}.jpg`, width: 1920, height: 1080,
});
const catalog = [work('first'), work('second')];
const boot = () => appHarness({
  inertMedia: true, catalog,
  stored: { format: 'artdrops-exhibition', version: 1, works: catalog, settings: {} },
});

test('starting a show releases every preview source and closing restores only visible previews using their working URLs', async () => {
  const app = await boot();
  const featured = app.node('featured').querySelector('video');
  const [fallback, offscreen] = app.node('art-grid').querySelectorAll('video');
  const videos = [featured, fallback, offscreen];
  assert.equal(videos.length, 3);
  for (const video of videos) {
    assert.equal(video.getAttribute('src'), null, 'preview downloads remain lazy');
    assert.equal(video.muted, true);
    assert.equal(video.defaultMuted, true);
    assert.equal(video.preload, 'none');
  }

  await app.setInView(videos);
  for (const video of videos) {
    assert.equal(video.src, video.dataset.src);
    assert.equal(video.paused, false);
  }
  await fallback.dispatch('error');
  assert.equal(fallback.src, catalog[0].alternateMediaUrl);
  assert.equal(fallback.dataset.src, catalog[0].alternateMediaUrl, 'the successful fallback must survive releasing the source');
  await app.setInView([offscreen], false);
  assert.equal(offscreen.paused, true);
  assert.equal(offscreen.src, catalog[1].mediaUrl, 'an offscreen preview may still hold its downloaded source');

  const beforeStart = app.mediaEvents.length;
  await app.click('start-show');
  assert.equal(app.player.opens.length, 1, 'only the inert player stub opens');
  assert.deepEqual(Array.from(app.player.opens[0].works, item => item.id), catalog.map(item => item.id));
  for (const video of videos) {
    assert.equal(video.getAttribute('src'), null, 'all competing preview downloads are released, including offscreen ones');
    assert.equal(video.paused, true);
    assert.ok(app.mediaEvents.slice(beforeStart).some(event => event.target === video && event.type === 'load' && event.src === ''), 'removing src must reset the media resource');
  }
  const duringShow = app.mediaEvents.length;
  for (const video of videos) await video.dispatch('error');
  await app.setInView([featured, fallback]);
  assert.equal(app.mediaEvents.length, duringShow, 'stale errors and observer callbacks cannot restart downloads during the show');
  assert.equal(app.node('featured').querySelector('.media-error'), null);
  assert.equal(app.node('art-grid').querySelector('.media-error'), null);

  app.player.close();
  await app.flush();
  assert.equal(featured.src, catalog[0].mediaUrl);
  assert.equal(fallback.src, catalog[0].alternateMediaUrl);
  assert.equal(featured.paused, false);
  assert.equal(fallback.paused, false);
  assert.equal(offscreen.getAttribute('src'), null, 'closing the show must not reload an offscreen preview');
  assert.equal(offscreen.paused, true);
  assert.ok(app.mediaEvents.filter(event => event.type === 'play').every(event => event.muted));
});

test('a stale error on an unloaded preview cannot consume its fallback or start a download', async () => {
  const app = await boot();
  const preview = app.node('art-grid').querySelector('video');
  const beforeError = app.mediaEvents.length;
  await preview.dispatch('error');
  assert.equal(preview.getAttribute('src'), null);
  assert.equal(preview.dataset.src, catalog[0].mediaUrl);
  assert.equal(app.mediaEvents.length, beforeError);
  assert.equal(app.node('art-grid').querySelector('.media-error'), null);
  await app.setInView([preview]);
  assert.equal(preview.src, catalog[0].mediaUrl);
  await preview.dispatch('error');
  assert.equal(preview.src, catalog[0].alternateMediaUrl, 'the first actual failure can still use the alternate');
});
