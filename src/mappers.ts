import { BASE } from './api';
import { PolycentricClaimType, topicFor } from './polycentric';
import type {
  EpisodeDetail,
  EpisodeSummary,
  FeaturedItem,
  ShowDetail,
} from './types/gasdigital';

export const PLATFORM = 'GasDigital';
export let PLUGIN_ID = '';

export function setPluginId(id: string): void {
  PLUGIN_ID = id;
}

// Canonical URL constructors. Stable across surfaces — the same string is
// returned everywhere a given show / episode is referenced, so all of Grayjay's
// downstream uses (sharing, history dedup, Polycentric reference derivation) key
// off a single topic per piece of content.
//
// Polycentric: the Reference for a video's comments is derived from the bytes
// of `PlatformContent.url` (Models.referenceFromBuffer in VideoDetailView.kt).
// Touch these only with care.

export function showUrl(showId: string): string {
  return `${BASE}/show/${showId}`;
}

export function episodeUrl(episodeId: string): string {
  return `${BASE}/view/video/${episodeId}`;
}

/**
 * Throw a descriptive ScriptException when a required field is missing from
 * an API response. The runtime would otherwise NPE deep in a constructor with
 * no hint about which episode/show was malformed.
 */
function requireField<T extends object, K extends keyof T>(
  obj: T | undefined | null,
  field: K,
  context: string,
): NonNullable<T[K]> {
  if (obj == null) {
    throw new ScriptException(`${context}: response missing object`);
  }
  const v = obj[field];
  if (v == null || v === '') {
    throw new ScriptException(`${context}: missing required field "${String(field)}"`);
  }
  return v as NonNullable<T[K]>;
}

/** Swap the size segment of a Kaltura thumbnail URL ("/width/400.jpg" -> "/width/N.jpg"). */
function resizeThumb(url: string, width: number): string {
  return url.replace(/\/width\/\d+(\.jpg)?/, `/width/${width}$1`);
}

export function thumbnailsFor(url: string | undefined): Thumbnails {
  if (!url) return new Thumbnails([]);
  // Kaltura thumbs are resizable; static gasdigital art is not.
  if (url.includes('/width/')) {
    return new Thumbnails([
      new Thumbnail(resizeThumb(url, 400), 400),
      new Thumbnail(resizeThumb(url, 800), 800),
      new Thumbnail(resizeThumb(url, 1280), 1280),
    ]);
  }
  return new Thumbnails([new Thumbnail(url, 0)]);
}

function authorFromShow(showName: string, showId?: string): PlatformAuthorLink {
  // PlatformID.claimType is left at NONE — Gas Digital isn't yet mapped to a
  // polycentric-core ClaimType. Channel-level Polycentric identity would go on
  // this PlatformID if/when we register one.
  const id = new PlatformID(
    PLATFORM,
    showId ?? showName,
    PLUGIN_ID,
    PolycentricClaimType.NONE,
  );
  return new PlatformAuthorLink(
    id,
    showName,
    showId ? showUrl(showId) : `${BASE}/`,
  );
}

export function mapFeaturedToChannel(item: FeaturedItem): PlatformChannel {
  return new PlatformChannel({
    id: new PlatformID(PLATFORM, item.id, PLUGIN_ID, PolycentricClaimType.NONE),
    name: item.name,
    thumbnail: item.thumbnail,
    url: showUrl(item.id),
    description: '',
  });
}

export function mapShowToChannel(show: ShowDetail): PlatformChannel {
  // Surface cross-platform podcast links (Spotify, Apple, etc. from
  // `/api/shows/{id}/.platform_links`) in the channel header `links` map.
  // These aren't `urlAlternatives` — those are reserved for URLs that resolve
  // back to a Gas Digital channel via isChannelUrl().
  const links: Record<string, string> = {};
  for (const l of show.platform_links ?? []) {
    if (l.url) links[l.name] = l.url;
  }
  return new PlatformChannel({
    id: new PlatformID(PLATFORM, show.id, PLUGIN_ID, PolycentricClaimType.NONE),
    name: show.name,
    thumbnail: show.thumbnail,
    banner: show.poster,
    subscribers: show.episode_count,
    description: show.description,
    url: showUrl(show.id),
    links,
  });
}

export function mapEpisodeSummary(
  ep: EpisodeSummary,
  resolveShowId?: (name: string) => string | undefined,
): PlatformVideo {
  const id = requireField(ep, 'id', 'episode summary');
  const showId = resolveShowId?.(ep.show);
  const url = episodeUrl(id);
  return new PlatformVideo({
    id: new PlatformID(PLATFORM, id, PLUGIN_ID),
    name: ep.name ?? '',
    thumbnails: thumbnailsFor(ep.thumbnail),
    author: authorFromShow(ep.show ?? 'Unknown', showId),
    uploadDate: ep.date ?? 0,
    url,
    shareUrl: topicFor(url),
    duration: ep.duration ?? 0,
    isLive: false,
  });
}

export function mapEpisodeDetail(ep: EpisodeDetail): PlatformVideoDetails {
  const id = requireField(ep, 'id', 'episode detail');
  const ctx = `episode ${id}`;
  const playback = requireField(ep, 'playback', ctx);
  const show = requireField(ep, 'show', ctx);
  const showName = requireField(show, 'name', `${ctx}.show`);
  const showId = requireField(show, 'id', `${ctx}.show`);
  const url = episodeUrl(id);
  const duration = ep.duration ?? 0;
  return new PlatformVideoDetails({
    id: new PlatformID(PLATFORM, id, PLUGIN_ID),
    name: ep.name ?? '',
    thumbnails: thumbnailsFor(ep.thumbnail || ep.poster),
    author: authorFromShow(showName, showId),
    uploadDate: ep.date ?? 0,
    url,
    shareUrl: topicFor(url),
    duration,
    isLive: false,
    description: ep.description ?? '',
    // HLS master playlist already mixes A+V — wrap as mux (VideoSourceDescriptor),
    // not UnMux. UnMux is for plugins that return separate video and audio sources.
    video: new VideoSourceDescriptor([
      new HLSSource({
        name: 'HLS',
        duration,
        url: playback,
        priority: true,
      }),
    ]),
  });
}
