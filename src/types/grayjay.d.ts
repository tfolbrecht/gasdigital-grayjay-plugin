// Ambient declarations for the Grayjay plugin runtime.
//
// Derived directly from the runtime bootstrap at:
//   grayjay/app/src/main/assets/scripts/source.js          (JS-side classes)
//   grayjay/app/src/main/java/.../api/media/platforms/js/  (Kotlin bridge)
//
// What the Kotlin client actually dispatches lives in JSClient.kt. The bridge
// detects which optional methods a plugin implements with `!!source.<name>`
// during initialize() and toggles capability flags accordingly — so omitted
// methods are *not* errors, they just disable the corresponding feature.

import type {
  ChannelTemplateByClaimMap,
  ChannelUrlByClaimFn,
  PolycentricClaimFieldType,
  PolycentricClaimTypeValue,
} from './polycentric';

export {};

declare global {
  // ============================================================
  // Enums (runtime objects)
  // ============================================================

  const Type: {
    Source: { Dash: 'DASH'; HLS: 'HLS'; STATIC: 'Static' };
    Feed: {
      Videos: 'VIDEOS';
      Streams: 'STREAMS';
      Mixed: 'MIXED';
      Live: 'LIVE';
      Subscriptions: 'SUBSCRIPTIONS';
      Shorts: 'SHORTS';
    };
    Order: { Chronological: 'CHRONOLOGICAL' };
    Date: { LastHour: 'LAST_HOUR'; Today: 'TODAY'; LastWeek: 'LAST_WEEK'; LastMonth: 'LAST_MONTH'; LastYear: 'LAST_YEAR' };
    Duration: { Short: 'SHORT'; Medium: 'MEDIUM'; Long: 'LONG' };
    Text: { RAW: 0; HTML: 1; MARKUP: 2; CODE: 3 };
    Chapter: { NORMAL: 0; SKIPPABLE: 5; SKIP: 6; SKIPONCE: 7 };
  };

  const Language: Record<string, string>;

  // ============================================================
  // Exceptions
  // ============================================================

  class ScriptException extends Error {
    plugin_type: string;
    msg: string;
    constructor(msg: string);
    constructor(type: string, msg: string);
  }
  class LoginRequiredException extends ScriptException {
    constructor(msg: string);
  }
  /** Alias kept around for backcompat with older plugins. Same shape as LoginRequiredException. */
  class ScriptLoginRequiredException extends ScriptException {
    constructor(msg: string);
  }
  class CaptchaRequiredException extends Error {
    plugin_type: 'CaptchaRequiredException';
    url: string;
    body: string;
    constructor(url: string, body: string);
  }
  class CriticalException extends ScriptException {
    constructor(msg: string);
  }
  class UnavailableException extends ScriptException {
    constructor(msg: string);
  }
  class ReloadRequiredException extends ScriptException {
    reloadData: unknown;
    constructor(msg: string, reloadData?: unknown);
  }
  class AgeException extends ScriptException {
    constructor(msg: string);
  }
  class TimeoutException extends ScriptException {
    constructor(msg: string);
  }
  class ScriptImplementationException extends ScriptException {
    constructor(msg: string);
  }

  // ============================================================
  // Value primitives
  // ============================================================

  class Thumbnail {
    url: string;
    quality: number;
    constructor(url: string, quality: number);
  }
  class Thumbnails {
    sources: Thumbnail[];
    constructor(thumbnails: Thumbnail[]);
  }

  /**
   * PlatformID identifies a piece of content/channel and, via `claimType` +
   * `claimFieldType`, carries optional **Polycentric** identity.
   *
   * - `claimType` is an integer enum from the polycentric-core protobuf (lives in
   *   the FUTO polycentric-core AAR, not in this repo). Examples seen in shipped
   *   plugins: Odysee/LBRY = 3. Use 0 for "no Polycentric claim".
   * - `claimFieldType` selects which field of the claim this id corresponds to
   *   (default -1 = none). Used together with `getChannelTemplateByClaimMap` /
   *   `getChannelUrlByClaim` if the plugin wants Grayjay to resolve a cross-
   *   platform channel by claim.
   *
   * Plugin-wide claim support is declared in Config.json, not in script:
   *   "supportedClaimTypes": number[]
   *   "primaryClaimFieldType": number
   */
  class PlatformID {
    platform: string;
    pluginId?: string;
    value: string | null;
    claimType: PolycentricClaimTypeValue;
    claimFieldType: PolycentricClaimFieldType;
    constructor(
      platform: string,
      id: string | null,
      pluginId?: string,
      claimType?: PolycentricClaimTypeValue,
      claimFieldType?: PolycentricClaimFieldType,
    );
  }

  // ============================================================
  // Authors / channels
  // ============================================================

  class PlatformAuthorLink {
    id: PlatformID;
    name: string;
    url: string;
    thumbnail?: string;
    subscribers?: number;
    membershipUrl?: string;
    constructor(
      id: PlatformID,
      name: string,
      url: string,
      thumbnail?: string,
      subscribers?: number,
      membershipUrl?: string,
    );
  }
  class PlatformAuthorMembershipLink extends PlatformAuthorLink {}

  interface PlatformChannelDef {
    id: PlatformID;
    name: string;
    thumbnail?: string;
    banner?: string;
    subscribers?: number;
    description?: string;
    url: string;
    /** Alternate URLs identifying the same channel — used by Grayjay for cross-platform identity. */
    urlAlternatives?: string[];
    /** Arbitrary social/external links surfaced in the channel header. */
    links?: Record<string, string>;
  }
  class PlatformChannel {
    plugin_type: 'PlatformChannel';
    id: PlatformID;
    name: string;
    thumbnail?: string;
    banner?: string;
    subscribers: number;
    description?: string;
    url: string;
    urlAlternatives: string[];
    links: Record<string, string>;
    constructor(obj: PlatformChannelDef);
  }

  // ============================================================
  // Content (base) + dispatched detail types
  // ============================================================

  interface PlatformContentDef {
    id: PlatformID;
    name: string;
    thumbnails?: Thumbnails;
    author?: PlatformAuthorLink;
    /** Epoch seconds. Either `datetime` or the legacy `uploadDate` is accepted. */
    datetime?: number;
    uploadDate?: number;
    url: string;
    shareUrl?: string;
  }
  class PlatformContent {
    contentType: number;
    id: PlatformID;
    name: string;
    thumbnails: Thumbnails;
    author?: PlatformAuthorLink;
    datetime: number;
    url: string;
    constructor(obj: PlatformContentDef, type: number);
  }
  class PlatformContentDetails {
    contentType: number;
    constructor(type: number);
  }

  interface PlatformVideoDef extends PlatformContentDef {
    duration: number;
    viewCount?: number;
    isLive?: boolean;
    isShort?: boolean;
    playbackTime?: number;
    playbackDate?: number;
  }
  class PlatformVideo extends PlatformContent {
    plugin_type: 'PlatformVideo';
    shareUrl?: string;
    duration: number;
    viewCount: number;
    playbackTime: number;
    playbackDate?: number;
    isLive: boolean;
    isShort: boolean;
    constructor(obj: PlatformVideoDef);
  }

  interface PlatformVideoDetailsDef extends PlatformVideoDef {
    description: string;
    video: VideoSourceDescriptor | UnMuxVideoSourceDescriptor;
    /** Deprecated alternatives — prefer including in `video.videoSources`. */
    dash?: DashSource | null;
    hls?: HLSSource | null;
    live?: HLSSource | DashSource | null;
    rating?: IRating;
    subtitles?: SubtitleSource[];
    /** Implementing this on the details object enables per-content recommendations. */
    getContentRecommendations?: () => VideoPager;
  }
  class PlatformVideoDetails extends PlatformVideo {
    plugin_type: 'PlatformVideoDetails';
    description: string;
    video: VideoSourceDescriptor | UnMuxVideoSourceDescriptor;
    dash: DashSource | null;
    hls: HLSSource | null;
    live: HLSSource | DashSource | null;
    rating: IRating | null;
    subtitles: SubtitleSource[];
    constructor(obj: PlatformVideoDetailsDef);
  }

  // Posts / web / articles / nested — included for completeness. Most plugins ignore.
  interface PlatformPostDef extends PlatformContentDef {
    thumbnails?: Thumbnails;
    images?: string[];
    description?: string;
  }
  class PlatformPost extends PlatformContent {
    plugin_type: 'PlatformPost';
    images: string[];
    description: string;
    constructor(obj: PlatformPostDef);
  }
  class PlatformPostDetails extends PlatformPost {
    plugin_type: 'PlatformPostDetails';
    rating: IRating;
    textType: number;
    content: string;
    constructor(obj: PlatformPostDef & { rating?: IRating; textType?: number; content?: string });
  }

  class PlatformWeb extends PlatformContent {
    plugin_type: 'PlatformWeb';
    constructor(obj: PlatformContentDef);
  }
  class PlatformWebDetails extends PlatformWeb {
    plugin_type: 'PlatformWebDetails';
    html: string;
    constructor(obj: PlatformContentDef & { html: string });
  }

  class PlatformArticle extends PlatformContent {
    plugin_type: 'PlatformArticle';
    rating: IRating;
    summary: string;
    constructor(obj: PlatformContentDef & { summary?: string; rating?: IRating });
  }
  class PlatformArticleDetails extends PlatformArticle {
    plugin_type: 'PlatformArticleDetails';
    segments: unknown[];
    constructor(obj: PlatformContentDef & { segments?: unknown[]; rating?: IRating });
  }

  class PlatformNestedMediaContent extends PlatformContent {
    contentUrl: string;
    contentName?: string;
    contentDescription?: string;
    contentProvider?: string;
    contentThumbnails: Thumbnails;
    constructor(obj: PlatformContentDef & {
      contentUrl: string;
      contentName?: string;
      contentDescription?: string;
      contentProvider?: string;
      contentThumbnails?: Thumbnails;
    });
  }
  class PlatformLockedContent extends PlatformContent {
    contentName?: string;
    contentThumbnails: Thumbnails;
    unlockUrl: string;
    lockDescription?: string;
    constructor(obj: PlatformContentDef & {
      contentName?: string;
      contentThumbnails?: Thumbnails;
      unlockUrl: string;
      lockDescription?: string;
    });
  }

  // Playlists
  interface PlatformPlaylistDef extends PlatformContentDef {
    videoCount?: number;
    thumbnail?: string;
  }
  class PlatformPlaylist extends PlatformContent {
    plugin_type: 'PlatformPlaylist';
    videoCount: number;
    thumbnail?: string;
    constructor(obj: PlatformPlaylistDef);
  }
  class PlatformPlaylistDetails extends PlatformPlaylist {
    plugin_type: 'PlatformPlaylistDetails';
    contents: PlatformVideo[];
    constructor(obj: PlatformPlaylistDef & { contents: PlatformVideo[] });
  }

  // ============================================================
  // Video/audio sources
  // ============================================================

  interface VideoUrlSourceDef {
    width?: number;
    height?: number;
    container?: string;
    codec?: string;
    name?: string;
    bitrate?: number;
    duration?: number;
    url: string;
    language?: string;
    original?: boolean;
    requestModifier?: unknown;
  }
  class VideoUrlSource {
    plugin_type: 'VideoUrlSource';
    constructor(obj: VideoUrlSourceDef);
  }
  class VideoUrlWidevineSource extends VideoUrlSource {
    constructor(obj: VideoUrlSourceDef & { licenseUri: string; getLicenseRequestExecutor?: () => unknown });
  }
  class VideoUrlRangeSource extends VideoUrlSource {
    constructor(obj: VideoUrlSourceDef & {
      itagId?: number; initStart?: number; initEnd?: number; indexStart?: number; indexEnd?: number;
    });
  }

  interface AudioUrlSourceDef {
    name?: string;
    bitrate?: number;
    container?: string;
    codec?: string;
    duration?: number;
    url: string;
    language?: string;
    requestModifier?: unknown;
  }
  class AudioUrlSource {
    plugin_type: 'AudioUrlSource';
    constructor(obj: AudioUrlSourceDef);
  }
  class AudioUrlWidevineSource extends AudioUrlSource {
    constructor(obj: AudioUrlSourceDef & { licenseUri: string; getLicenseRequestExecutor?: () => unknown; bearerToken?: string });
  }
  class AudioUrlRangeSource extends AudioUrlSource {
    constructor(obj: AudioUrlSourceDef & {
      itagId?: number; initStart?: number; initEnd?: number; indexStart?: number; indexEnd?: number; audioChannels?: number;
    });
  }

  interface HLSSourceDef {
    name?: string;
    duration?: number;
    url: string;
    priority?: boolean;
    language?: string;
    original?: boolean;
    requestModifier?: unknown;
  }
  class HLSSource {
    plugin_type: 'HLSSource';
    constructor(obj: HLSSourceDef);
  }

  interface DashSourceDef {
    name?: string;
    duration?: number;
    url: string;
    language?: string;
    original?: boolean;
    requestModifier?: unknown;
  }
  class DashSource {
    plugin_type: 'DashSource';
    constructor(obj: DashSourceDef);
  }
  class DashWidevineSource extends DashSource {
    constructor(obj: DashSourceDef & { licenseUri: string; getLicenseRequestExecutor?: () => unknown });
  }

  class DashManifestRawSource {
    plugin_type: 'DashRawSource';
    constructor(obj: VideoUrlSourceDef & { manifest?: string });
  }
  class DashManifestRawAudioSource {
    plugin_type: 'DashRawAudioSource';
    constructor(obj: AudioUrlSourceDef & { manifest?: string });
  }

  class VideoSourceDescriptor {
    plugin_type: 'MuxVideoSourceDescriptor';
    isUnMuxed: false;
    videoSources: unknown[];
    constructor(obj: unknown[] | { videoSources: unknown[] });
  }
  class UnMuxVideoSourceDescriptor {
    plugin_type: 'UnMuxVideoSourceDescriptor';
    isUnMuxed: true;
    videoSources: unknown[];
    audioSources: unknown[];
    constructor(videoSources: unknown[], audioSources: unknown[]);
    constructor(obj: { videoSources: unknown[]; audioSources: unknown[] });
  }

  interface SubtitleSource {
    url: string;
    name: string;
    format: string;
    getSubtitles?: () => string;
  }

  // ============================================================
  // Ratings, comments, capabilities
  // ============================================================

  interface IRating {
    type: number;
  }
  class RatingLikes implements IRating {
    type: 1;
    likes: number;
    constructor(likes: number);
  }
  class RatingLikesDislikes implements IRating {
    type: 2;
    likes: number;
    dislikes: number;
    constructor(likes: number, dislikes: number);
  }
  class RatingScaler implements IRating {
    type: 3;
    value: number;
    constructor(value: number);
  }

  interface PlatformCommentDef {
    contextUrl: string;
    author: PlatformAuthorLink;
    message: string;
    rating?: IRating;
    date?: number;
    replyCount?: number;
    context?: unknown;
    getReplies?: () => CommentPager;
  }
  class PlatformComment {
    plugin_type: 'Comment';
    constructor(obj: PlatformCommentDef);
  }
  class Comment extends PlatformComment {
    constructor(obj: PlatformCommentDef);
  }

  class FilterCapability {
    name: string;
    value: string;
    id: string;
    constructor(name: string, value: string, id: string);
  }
  class FilterGroup {
    name: string;
    filters: FilterCapability[];
    isMultiSelect: boolean;
    id: string;
    constructor(name: string, filters: FilterCapability[], isMultiSelect: boolean, id: string);
  }
  class ResultCapabilities {
    types: string[];
    sorts: string[];
    filters: FilterGroup[];
    constructor(types: string[], sorts: string[], filters?: FilterGroup[]);
  }

  // ============================================================
  // Pagers — subclass to override nextPage/hasMorePagers
  // ============================================================

  class ContentPager {
    plugin_type: 'ContentPager';
    results: PlatformContent[];
    hasMore: boolean;
    context: unknown;
    constructor(results: PlatformContent[], hasMore: boolean, context?: unknown);
    hasMorePagers(): boolean;
    nextPage(): ContentPager;
  }
  class VideoPager {
    plugin_type: 'VideoPager';
    results: PlatformVideo[];
    hasMore: boolean;
    context: unknown;
    constructor(results: PlatformVideo[], hasMore: boolean, context?: unknown);
    hasMorePagers(): boolean;
    nextPage(): VideoPager;
  }
  class ChannelPager {
    plugin_type: 'ChannelPager';
    results: PlatformChannel[];
    hasMore: boolean;
    context: unknown;
    constructor(results: PlatformChannel[], hasMore: boolean, context?: unknown);
    hasMorePagers(): boolean;
    nextPage(): ChannelPager;
  }
  class PlaylistPager {
    plugin_type: 'PlaylistPager';
    results: PlatformPlaylist[];
    hasMore: boolean;
    context: unknown;
    constructor(results: PlatformPlaylist[], hasMore: boolean, context?: unknown);
    hasMorePagers(): boolean;
    nextPage(): PlaylistPager;
  }
  class CommentPager {
    plugin_type: 'CommentPager';
    results: Comment[];
    hasMore: boolean;
    context: unknown;
    constructor(results: Comment[], hasMore: boolean, context?: unknown);
    hasMorePagers(): boolean;
    nextPage(): CommentPager;
  }
  class LiveEventPager {
    plugin_type: 'LiveEventPager';
    nextRequest: number;
    constructor(results: unknown[], hasMore: boolean, context?: unknown);
    hasMorePagers(): boolean;
    nextPage(): LiveEventPager;
  }

  class LiveEvent {
    type: number;
    constructor(type: number);
  }
  class LiveEventComment extends LiveEvent {
    constructor(name: string, message: string, thumbnail?: string, colorName?: string, badges?: string[]);
  }
  class LiveEventEmojis extends LiveEvent {
    constructor(emojis: Record<string, string>);
  }
  class LiveEventDonation extends LiveEvent {
    constructor(amount: number, name: string, message?: string, thumbnail?: string, expire?: number, colorDonation?: string);
  }
  class LiveEventViewCount extends LiveEvent {
    constructor(viewCount: number);
  }
  class LiveEventRaid extends LiveEvent {
    constructor(targetUrl: string, targetName: string, targetThumbnail?: string, isOutgoing?: boolean);
  }

  class PlaybackTracker {
    nextRequest: number;
    constructor(interval?: number);
    setProgress(seconds: number): void;
  }

  // ============================================================
  // HTTP (config `"packages": ["Http"]`)
  // ============================================================

  interface BridgeHttpResponse {
    code: number;
    body: string;
    headers: Record<string, string[]>;
    url: string;
    readonly isOk: boolean;
  }
  interface BridgeHttpClient {
    GET(url: string, headers?: Record<string, string>, useAuth?: boolean): BridgeHttpResponse;
    POST(url: string, body: string, headers?: Record<string, string>, useAuth?: boolean): BridgeHttpResponse;
  }
  const http: BridgeHttpClient & {
    newClient(useAuth?: boolean): BridgeHttpClient;
  };

  // ============================================================
  // Plugin/runtime globals
  // ============================================================

  interface SourceConfig {
    name: string;
    description: string;
    id: string;
    version: number;
    /** Polycentric claim types declared in Config.json. Numbers come from polycentric-core protobuf. */
    supportedClaimTypes?: PolycentricClaimTypeValue[];
    primaryClaimFieldType?: PolycentricClaimFieldType;
    [key: string]: unknown;
  }
  interface SourceSettings {
    [key: string]: unknown;
  }

  /** Runtime-injected plugin handle. `plugin.config.id` is the canonical plugin id at runtime. */
  const plugin: {
    config: SourceConfig;
    settings: SourceSettings;
  };

  /** Low-level bridge surface — most plugins only touch `bridge.log`. */
  const bridge: {
    log(s: string): void;
    [key: string]: unknown;
  };

  function log(s: unknown): void;
  function throwException(type: string, message: string): never;
  const IS_TESTING: boolean;

  // ============================================================
  // The `source` surface a plugin overrides.
  //
  // Required (Grayjay calls validateFunction on these):
  //   enable, disable, getHome, search, searchSuggestions,
  //   isChannelUrl, getChannel, getChannelContents,
  //   isContentDetailsUrl, getContentDetails
  //
  // Optional (capability is detected via `!!source.<name>` during initialize):
  //   saveState, getShorts, getSearchCapabilities,
  //   getSearchChannelContentsCapabilities, searchChannelContents,
  //   searchChannels (capability flag: hasChannelSearch),
  //   getChannelCapabilities, getChannelPlaylists,
  //   getPeekChannelTypes, peekChannelContents,
  //   getChannelUrlByClaim, getChannelTemplateByClaimMap,
  //   getContentChapters, getPlaybackTracker, getContentRecommendations,
  //   getComments, getSubComments,
  //   getLiveChatWindow, getLiveEvents,
  //   searchPlaylists, isPlaylistUrl, getPlaylist,
  //   getUserPlaylists, getUserSubscriptions, getUserHistory,
  //   isLoggedIn   (non-bridge, but Grayjay UI checks via http.newClient(...))
  // ============================================================
  interface SourceLike {
    // ---- lifecycle ----
    enable?(config: SourceConfig, settings: SourceSettings, savedState: string | null): void;
    disable?(): void;
    saveState?(): string;

    // ---- home / shorts ----
    getHome?(): ContentPager | VideoPager;
    getShorts?(): VideoPager;

    // ---- search ----
    searchSuggestions?(query: string): string[];
    getSearchCapabilities?(): ResultCapabilities;
    search?(query: string, type?: string, order?: string, filters?: Record<string, string[]>): ContentPager | VideoPager;

    // ---- within-channel search ----
    getSearchChannelContentsCapabilities?(): ResultCapabilities;
    searchChannelContents?(channelUrl: string, query: string, type?: string, order?: string, filters?: Record<string, string[]>): ContentPager | VideoPager;

    // ---- channel search ----
    searchChannels?(query: string): ChannelPager;

    // ---- channel (single) ----
    isChannelUrl?(url: string): boolean;
    getChannel?(channelUrl: string): PlatformChannel;
    getChannelCapabilities?(): ResultCapabilities;
    getChannelContents?(channelUrl: string, type?: string, order?: string, filters?: Record<string, string[]>): ContentPager | VideoPager;
    getChannelPlaylists?(channelUrl: string): PlaylistPager;
    getPeekChannelTypes?(): string[];
    peekChannelContents?(channelUrl: string, type?: string): PlatformContent[];

    // ---- Polycentric / cross-platform claim resolution ----
    /** Given a Polycentric claim type + field-keyed values, return the URL of the equivalent channel on this platform (or null). */
    getChannelUrlByClaim?: ChannelUrlByClaimFn;
    /** Return URL templates keyed by claimType -> claimFieldType -> "https://.../{{CLAIMVALUE}}". */
    getChannelTemplateByClaimMap?(): ChannelTemplateByClaimMap;

    // ---- content ----
    isContentDetailsUrl?(url: string): boolean;
    getContentDetails?(url: string): PlatformVideoDetails | PlatformPostDetails | PlatformArticleDetails | PlatformWebDetails;
    getContentChapters?(url: string): unknown[];
    getPlaybackTracker?(url: string): PlaybackTracker | null;
    getContentRecommendations?(url: string): ContentPager | VideoPager;

    // ---- comments ----
    getComments?(url: string): CommentPager;
    getSubComments?(comment: Comment): CommentPager;

    // ---- live ----
    getLiveChatWindow?(url: string): { url: string; removeElements?: string[]; removeElementsInterval?: number };
    getLiveEvents?(url: string): LiveEventPager;

    // ---- playlists ----
    searchPlaylists?(query: string, type?: string, order?: string, filters?: Record<string, string[]>): ContentPager;
    isPlaylistUrl?(url: string): boolean;
    getPlaylist?(url: string): PlatformPlaylistDetails;

    // ---- user-bound (when authed) ----
    getUserPlaylists?(): string[];
    getUserSubscriptions?(): string[];
    getUserHistory?(): ContentPager | VideoPager;

    // ---- auth hint (queried by UI, not part of Kotlin bridge but conventional) ----
    isLoggedIn?(): boolean;
  }

  /**
   * Legacy method names from the FUTO Sample plugin.d.ts. The Android bridge
   * (JSClient.kt) does NOT dispatch these — it dispatches the canonical
   * `Content` / `ChannelContents` variants above. Listed here only so legacy
   * sample code typechecks without modification; binding to these methods
   * has no runtime effect.
   */
  interface LegacySourceLike {
    /** @deprecated Renamed to `isContentDetailsUrl`. */
    isVideoDetailsUrl?(url: string): boolean;
    /** @deprecated Renamed to `getContentDetails`. */
    getVideoDetails?(url: string): PlatformVideoDetails;
    /** @deprecated Renamed to `getChannelContents`. */
    getChannelVideos?(url: string, type?: string, order?: string, filters?: Record<string, string[]>): VideoPager;
    /** @deprecated Renamed to `searchChannelContents`. */
    searchChannelVideos?(channelUrl: string, query: string, type?: string, order?: string, filters?: Record<string, string[]>): VideoPager;
    /** @deprecated Renamed to `getSearchChannelContentsCapabilities`. */
    getSearchChannelVideoCapabilities?(): ResultCapabilities;
  }

  /**
   * Composite plugin surface — what a Grayjay JS plugin can populate on the
   * global `source`. Intersects the bridge-dispatched API (`SourceLike`) with
   * the deprecated FUTO-sample aliases (`LegacySourceLike`), so plugin
   * authors copying from either lineage typecheck cleanly.
   */
  type Plugin = SourceLike & LegacySourceLike;

  const source: Plugin;
}
