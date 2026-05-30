// Runtime Polycentric helpers. Types live alongside in src/types/polycentric.d.ts.
//
// How Polycentric maps onto Grayjay content (per StatePolycentric.kt and
// VideoDetailView.kt:1649):
//
//   val ref = Models.referenceFromBuffer(video.url.toByteArray())
//   StatePolycentric.instance.getCommentPager(video.url, ref)
//
// In other words, **the Polycentric topic for a piece of content IS the bytes
// of the content's URL**. Grayjay auto-derives the protobuf Reference from
// `video.url` — the plugin does not declare topics explicitly. The contract
// is purely:
//
//   1. The URL on PlatformContent.url / PlatformVideo.url must be canonical
//      and stable. Using two URL forms for the same video splits its
//      Polycentric comment stream across two distinct topics.
//   2. Channel-level identity uses PlatformID.claimType (and optionally
//      claimFieldType) — a polycentric-core protobuf enum integer. Videos
//      typically leave claimType at NONE; only the channel's id needs to
//      claim cross-platform identity.

import type { PolycentricClaimTypeValue } from './types/polycentric';

/**
 * polycentric-core protobuf ClaimType integers verifiable from the Grayjay tree.
 * Other platform integers (YouTube, Twitter, Rumble, etc.) live in the
 * external polycentric-core protobuf and are not enumerated here.
 */
export const PolycentricClaimType = {
  /** Default — no Polycentric claim. Use for videos and unmapped channels. */
  NONE: 0,
  /** Polycentric-internal. Used by Grayjay's own profile plumbing — not for plugins. */
  POLYCENTRIC: 1,
  /** LBRY / Odysee. Verified usage in `odysee/OdyseeScript.js:38 PLATFORM_CLAIMTYPE = 3`. */
  LBRY: 3,
} as const satisfies Record<string, PolycentricClaimTypeValue>;

/**
 * The Polycentric reference for any Grayjay content is derived from the
 * content URL bytes. This helper exists so the plugin's URL-construction sites
 * make the topic-key contract obvious at the call site, and so URL
 * canonicalization changes can be made in one place.
 */
export function topicFor(canonicalContentUrl: string): string {
  return canonicalContentUrl;
}
