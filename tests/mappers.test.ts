import { beforeEach, describe, expect, it } from 'vitest';

// Re-import the source modules in each test so module-level state
// (PLUGIN_ID in mappers.ts) starts fresh.
let mappers: typeof import('../src/mappers');
let polycentric: typeof import('../src/polycentric');

beforeEach(async () => {
  const v = await import('vitest');
  v.vi.resetModules();
  mappers = await import('../src/mappers');
  polycentric = await import('../src/polycentric');
  mappers.setPluginId('test-plugin');
});

describe('URL canonicalization (Polycentric topic invariant)', () => {
  it('episodeUrl is /view/video/<id>', () => {
    expect(mappers.episodeUrl('an9QSdzrHE1a')).toBe('https://gasdigital.com/view/video/an9QSdzrHE1a');
  });

  it('showUrl is /show/<id>', () => {
    expect(mappers.showUrl('m1CLX6BWfntK')).toBe('https://gasdigital.com/show/m1CLX6BWfntK');
  });

  it('topicFor returns the canonical URL verbatim (URL = Polycentric topic)', () => {
    const url = mappers.episodeUrl('an9QSdzrHE1a');
    expect(polycentric.topicFor(url)).toBe(url);
  });
});

describe('thumbnailsFor', () => {
  it('returns three Kaltura sizes when the URL is resizable', () => {
    const tn = mappers.thumbnailsFor(
      'https://mediaplatform.streamingmediahosting.com/p/11853/sp/1185300/thumbnail/entry_id/0_x/version/100/acv/180/quality/100/type/1/width/400.jpg',
    );
    expect(tn.sources.map((s) => s.quality)).toEqual([400, 800, 1280]);
    expect(tn.sources[0]!.url).toMatch(/\/width\/400\.jpg$/);
    expect(tn.sources[2]!.url).toMatch(/\/width\/1280\.jpg$/);
  });

  it('returns a single entry for static (non-Kaltura) art', () => {
    const tn = mappers.thumbnailsFor('https://gasdigital.com/static/images/foo.png');
    expect(tn.sources).toHaveLength(1);
    expect(tn.sources[0]!.url).toBe('https://gasdigital.com/static/images/foo.png');
  });

  it('handles undefined gracefully (empty Thumbnails, no throw)', () => {
    const tn = mappers.thumbnailsFor(undefined);
    expect(tn.sources).toHaveLength(0);
  });
});

describe('mapFeaturedToChannel', () => {
  it('builds a PlatformChannel with claimType NONE and canonical URL', () => {
    const ch = mappers.mapFeaturedToChannel({
      id: 'm1CLX6BWfntK',
      name: 'The SDR Show',
      thumbnail: 'https://gasdigital.com/static/images/x.png',
      category: 'featured',
    });
    expect((ch as unknown as { url: string }).url).toBe('https://gasdigital.com/show/m1CLX6BWfntK');
    const id = (ch as unknown as { id: { claimType: number; value: string } }).id;
    expect(id.value).toBe('m1CLX6BWfntK');
    expect(id.claimType).toBe(polycentric.PolycentricClaimType.NONE);
  });
});

describe('mapShowToChannel', () => {
  it('lifts platform_links into the channel links map', () => {
    const ch = mappers.mapShowToChannel({
      type: 'show',
      id: 'm1CLX6BWfntK',
      sqid: 'm1CLX6BWfntK',
      name: 'The SDR Show',
      description: 'desc',
      episode_count: 963,
      category: 'featured',
      tags: [],
      thumbnail: 'thumb.png',
      poster: 'poster.png',
      hosts: [],
      platform_links: [
        { name: 'Spotify', code: 'SP', url: 'https://open.spotify.com/show/x' },
        { name: 'Apple', code: 'AP', url: 'https://podcasts.apple.com/x' },
      ],
    });
    const links = (ch as unknown as { links: Record<string, string> }).links;
    expect(links.Spotify).toBe('https://open.spotify.com/show/x');
    expect(links.Apple).toBe('https://podcasts.apple.com/x');
  });

  it('leaves urlAlternatives empty (Spotify etc. are not GD channel URLs)', () => {
    const ch = mappers.mapShowToChannel({
      type: 'show', id: 'a', sqid: 'a', name: 'A', description: '',
      episode_count: 0, category: 'featured', tags: [], thumbnail: '', poster: '', hosts: [],
      platform_links: [{ name: 'Spotify', code: 'SP', url: 'https://spotify.com/x' }],
    });
    const ua = (ch as unknown as { urlAlternatives: string[] }).urlAlternatives;
    expect(ua).toEqual([]);
  });
});

describe('mapEpisodeDetail', () => {
  it('wraps the HLS master in a Mux VideoSourceDescriptor (not UnMux)', () => {
    const details = mappers.mapEpisodeDetail({
      type: 'episode',
      id: 'an9QSdzrHE1a',
      sqid: 'an9QSdzrHE1a',
      name: 'EP',
      thumbnail: 'thumb.jpg',
      description: 'desc',
      show: { id: 's1', name: 'Show', episode_count: 1, thumbnail: '', hosts: [] },
      duration: 120,
      episode: 1,
      date: 0,
      year: 2026,
      month: 1,
      category: 'regular',
      tags: [],
      playback: 'https://stream.example/master.m3u8',
    });
    const video = (details as unknown as { video: { plugin_type: string; videoSources: unknown[] } })
      .video;
    expect(video.plugin_type).toBe('MuxVideoSourceDescriptor');
    expect(video.videoSources).toHaveLength(1);
    expect((video.videoSources[0] as { url?: string }).url).toBe('https://stream.example/master.m3u8');
  });

  it('uses shareUrl == url (canonical) so the Polycentric topic is stable', () => {
    const details = mappers.mapEpisodeDetail({
      type: 'episode', id: 'an9QSdzrHE1a', sqid: 'an9QSdzrHE1a', name: 'EP',
      thumbnail: '', description: '',
      show: { id: 's1', name: 'Show', episode_count: 1, thumbnail: '', hosts: [] },
      duration: 0, episode: 1, date: 0, year: 2026, month: 1, category: 'regular', tags: [],
      playback: 'https://x',
    });
    const d = details as unknown as { url: string; shareUrl?: string };
    expect(d.url).toBe('https://gasdigital.com/view/video/an9QSdzrHE1a');
    expect(d.shareUrl).toBe(d.url);
  });
});
