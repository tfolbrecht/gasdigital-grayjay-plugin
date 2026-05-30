// Stubs for the Grayjay runtime globals our plugin script consumes.
//
// The bundle is loaded against an ambient API declared in
// src/types/grayjay.d.ts. In production these classes/globals come from
// grayjay/app/src/main/assets/scripts/source.js. Here we mirror just enough
// surface to drive the plugin: value classes that record their constructor
// args (so tests can assert what the plugin built), a tiny pluggable http
// client, and a stub `source` object the plugin populates via `source.* =`.

import { beforeEach, vi } from 'vitest';

// ---------- Exceptions ----------

class ScriptException extends Error {
  plugin_type: string;
  msg: string;
  constructor(...args: string[]) {
    super(args[args.length - 1] ?? 'ScriptException');
    this.plugin_type = args.length > 1 ? args[0]! : 'ScriptException';
    this.msg = args[args.length - 1] ?? '';
  }
}
class LoginRequiredException extends ScriptException {
  constructor(msg: string) {
    super('ScriptLoginRequiredException', msg);
  }
}
class TimeoutException extends ScriptException {
  constructor(msg: string) {
    super('TimeoutException', msg);
  }
}

// ---------- Type enum ----------

const Type = {
  Source: { Dash: 'DASH', HLS: 'HLS', STATIC: 'Static' },
  Feed: {
    Videos: 'VIDEOS',
    Streams: 'STREAMS',
    Mixed: 'MIXED',
    Live: 'LIVE',
    Subscriptions: 'SUBSCRIPTIONS',
    Shorts: 'SHORTS',
  },
  Order: { Chronological: 'CHRONOLOGICAL' },
  Date: {
    LastHour: 'LAST_HOUR',
    Today: 'TODAY',
    LastWeek: 'LAST_WEEK',
    LastMonth: 'LAST_MONTH',
    LastYear: 'LAST_YEAR',
  },
  Duration: { Short: 'SHORT', Medium: 'MEDIUM', Long: 'LONG' },
  Text: { RAW: 0, HTML: 1, MARKUP: 2, CODE: 3 },
  Chapter: { NORMAL: 0, SKIPPABLE: 5, SKIP: 6, SKIPONCE: 7 },
};

// ---------- Value classes (capture-everything stubs) ----------

class PlatformID {
  constructor(
    public platform: string,
    public value: string | null,
    public pluginId?: string,
    public claimType: number = 0,
    public claimFieldType: number = -1,
  ) {}
}

class Thumbnail {
  constructor(public url: string, public quality: number) {}
}
class Thumbnails {
  sources: Thumbnail[];
  constructor(thumbnails: Thumbnail[]) {
    this.sources = thumbnails;
  }
}

class PlatformAuthorLink {
  constructor(
    public id: PlatformID,
    public name: string,
    public url: string,
    public thumbnail?: string,
    public subscribers?: number,
    public membershipUrl?: string,
  ) {}
}

class PlatformChannel {
  plugin_type = 'PlatformChannel';
  id!: PlatformID;
  name!: string;
  thumbnail?: string;
  banner?: string;
  subscribers: number = 0;
  description?: string;
  url!: string;
  urlAlternatives: string[] = [];
  links: Record<string, string> = {};
  constructor(obj: Record<string, unknown>) {
    Object.assign(this, obj);
  }
}

class PlatformVideo {
  plugin_type = 'PlatformVideo';
  constructor(public obj: Record<string, unknown>) {
    Object.assign(this, obj);
  }
}
class PlatformVideoDetails extends PlatformVideo {
  override plugin_type = 'PlatformVideoDetails';
}

class VideoSourceDescriptor {
  plugin_type = 'MuxVideoSourceDescriptor';
  isUnMuxed = false;
  videoSources: unknown[];
  constructor(obj: unknown[] | { videoSources: unknown[] }) {
    this.videoSources = Array.isArray(obj) ? obj : obj.videoSources;
  }
}
class UnMuxVideoSourceDescriptor {
  plugin_type = 'UnMuxVideoSourceDescriptor';
  isUnMuxed = true;
  videoSources: unknown[];
  audioSources: unknown[];
  constructor(videoSources: unknown[], audioSources: unknown[] = []) {
    this.videoSources = videoSources;
    this.audioSources = audioSources;
  }
}
class HLSSource {
  plugin_type = 'HLSSource';
  constructor(public obj: Record<string, unknown>) {
    Object.assign(this, obj);
  }
}
class DashSource {
  plugin_type = 'DashSource';
  constructor(public obj: Record<string, unknown>) {
    Object.assign(this, obj);
  }
}

class ContentPager {
  plugin_type = 'ContentPager';
  constructor(public results: unknown[], public hasMore: boolean) {}
  nextPage(): ContentPager {
    return this;
  }
  hasMorePagers(): boolean {
    return this.hasMore;
  }
}
class VideoPager {
  plugin_type = 'VideoPager';
  constructor(public results: unknown[], public hasMore: boolean) {}
  nextPage(): VideoPager {
    return this;
  }
  hasMorePagers(): boolean {
    return this.hasMore;
  }
}
class ChannelPager {
  plugin_type = 'ChannelPager';
  constructor(public results: unknown[], public hasMore: boolean) {}
  nextPage(): ChannelPager {
    return this;
  }
  hasMorePagers(): boolean {
    return this.hasMore;
  }
}
class CommentPager {
  plugin_type = 'CommentPager';
  constructor(public results: unknown[], public hasMore: boolean) {}
  nextPage(): CommentPager {
    return this;
  }
  hasMorePagers(): boolean {
    return this.hasMore;
  }
}

class FilterCapability {
  constructor(public name: string, public value: string, public id: string) {}
}
class FilterGroup {
  constructor(
    public name: string,
    public filters: FilterCapability[],
    public isMultiSelect: boolean,
    public id: string,
  ) {}
}
class ResultCapabilities {
  constructor(public types: string[], public sorts: string[], public filters: unknown[] = []) {}
}

class RatingLikes {
  type = 1;
  constructor(public likes: number) {}
}
class RatingLikesDislikes {
  type = 2;
  constructor(public likes: number, public dislikes: number) {}
}
class RatingScaler {
  type = 3;
  constructor(public value: number) {}
}

class Comment {
  constructor(public obj: Record<string, unknown>) {
    Object.assign(this, obj);
  }
}

// ---------- Mocked http client ----------
//
// Tests configure responses via mockHttp({ "GET https://...": { code, body } }).
// http.GET / http.POST look up the exact "METHOD URL" key; unconfigured calls
// return 404 with an empty body so missing mocks fail loudly with our error
// surface rather than silently returning empty data.

export interface MockedResponse {
  code: number;
  body: string;
  headers?: Record<string, string[]>;
}

const responses = new Map<string, MockedResponse | MockedResponse[]>();

/** Configure responses keyed by `"METHOD URL"`. Pass an array to script a sequence (one response per call). */
export function mockHttp(map: Record<string, MockedResponse | MockedResponse[]>): void {
  for (const [k, v] of Object.entries(map)) responses.set(k, v);
}

function nextResponse(method: string, url: string): MockedResponse {
  const key = `${method} ${url}`;
  const entry = responses.get(key);
  if (entry == null) {
    return { code: 404, body: JSON.stringify({ error: 'not mocked', method, url }) };
  }
  if (Array.isArray(entry)) {
    const next = entry.shift();
    if (entry.length === 0) responses.delete(key);
    return next ?? { code: 410, body: 'sequence exhausted' };
  }
  return entry;
}

function makeHttpResponse(method: string, url: string) {
  const r = nextResponse(method, url);
  return {
    code: r.code,
    body: r.body,
    headers: r.headers ?? {},
    url,
    get isOk() {
      return this.code >= 200 && this.code < 300;
    },
  };
}

const http = {
  GET: vi.fn((url: string, _headers?: Record<string, string>, _useAuth?: boolean) =>
    makeHttpResponse('GET', url),
  ),
  POST: vi.fn(
    (url: string, _body: string, _headers?: Record<string, string>, _useAuth?: boolean) =>
      makeHttpResponse('POST', url),
  ),
  newClient: vi.fn(() => http),
};

// ---------- Install on globalThis ----------

const globals = {
  ScriptException,
  LoginRequiredException,
  TimeoutException,
  Type,
  PlatformID,
  Thumbnail,
  Thumbnails,
  PlatformAuthorLink,
  PlatformChannel,
  PlatformVideo,
  PlatformVideoDetails,
  VideoSourceDescriptor,
  UnMuxVideoSourceDescriptor,
  HLSSource,
  DashSource,
  ContentPager,
  VideoPager,
  ChannelPager,
  CommentPager,
  FilterCapability,
  FilterGroup,
  ResultCapabilities,
  RatingLikes,
  RatingLikesDislikes,
  RatingScaler,
  Comment,
  http,
  log: vi.fn(),
  bridge: { log: vi.fn() },
  plugin: { config: { id: 'test-plugin', name: 'Test' }, settings: {} },
  source: {} as Record<string, unknown>,
  IS_TESTING: true,
};

for (const [k, v] of Object.entries(globals)) {
  (globalThis as Record<string, unknown>)[k] = v;
}

// ---------- Per-test reset ----------

beforeEach(() => {
  responses.clear();
  http.GET.mockClear();
  http.POST.mockClear();
  (globalThis as Record<string, unknown>).source = {};
  ((globalThis as Record<string, unknown>).log as ReturnType<typeof vi.fn>).mockClear();
});
