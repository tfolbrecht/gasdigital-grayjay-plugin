// Polycentric type surface for Grayjay plugins.
// Runtime constants/helpers live in src/polycentric.ts.
//
// The Polycentric topic for content is `PlatformContent.url` bytes — this is
// derived by the client at runtime, not declared by the plugin. The only
// plugin-side knob is on PlatformID's `claimType` (and `claimFieldType`),
// plus optional `getChannelUrlByClaim` / `getChannelTemplateByClaimMap` source
// methods for cross-platform channel resolution.

/**
 * polycentric-core protobuf `ClaimType` enum value. The runtime is an integer;
 * this type carries documentation only. Plugins typically pick a single
 * constant for the whole platform (e.g. Odysee = 3).
 */
export type PolycentricClaimTypeValue = number;

/**
 * Optional second integer narrowing which field of a multi-field claim this id
 * corresponds to. -1 means unset. Used together with
 * `getChannelTemplateByClaimMap` if the plugin resolves channels by claim.
 */
export type PolycentricClaimFieldType = number;

/**
 * Shape of `source.getChannelTemplateByClaimMap()` — `claimType` ->
 * `claimFieldType` -> URL template string containing `{{CLAIMVALUE}}`.
 * Grayjay calls this once on initialize and uses it for the "show this
 * channel on platform X" cross-platform jump.
 */
export type ChannelTemplateByClaimMap = Record<
  PolycentricClaimTypeValue,
  Record<PolycentricClaimFieldType, string>
>;

/** Shape of `source.getChannelUrlByClaim(claimType, claimValues)`. */
export type ChannelUrlByClaimFn = (
  claimType: PolycentricClaimTypeValue,
  claimValues: Record<PolycentricClaimFieldType, string>,
) => string | null;

/**
 * Marker for the canonical content URL used as the Polycentric reference.
 * `PlatformContent.url` is treated as `PolycentricTopic` at runtime — the
 * client hashes its bytes into a Reference. Using this brand at construction
 * sites makes the contract grep-able even though it's a plain string at
 * runtime.
 */
export type PolycentricTopic = string & { readonly __polycentricTopic?: never };
