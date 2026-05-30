import { fetchUrl, searchByShowName } from './api';
import { mapEpisodeSummary } from './mappers';
import type { EpisodeSummary, FeaturedItem, PaginatedResponse } from './types/gasdigital';

const showIdByName = new Map<string, string>();
export function rememberShow(name: string, id: string): void {
  showIdByName.set(name, id);
}
function resolveShowId(name: string): string | undefined {
  return showIdByName.get(name);
}

/**
 * Paginates one show's episodes by following the API's `next` URL (DRF style).
 * Used by getChannelContents — page() is keyed to the show name, nextPage follows
 * the server-provided cursor.
 */
export class GasDigitalShowEpisodePager extends VideoPager {
  private nextUrl: string | null;

  constructor(page: PaginatedResponse<EpisodeSummary>) {
    super(
      page.results.map((ep) => mapEpisodeSummary(ep, resolveShowId)),
      page.next != null,
    );
    this.nextUrl = page.next;
  }

  override nextPage(): VideoPager {
    if (!this.nextUrl) {
      this.results = [];
      this.hasMore = false;
      return this;
    }
    const page = fetchUrl<PaginatedResponse<EpisodeSummary>>(this.nextUrl, true);
    this.results = page.results.map((ep) => mapEpisodeSummary(ep, resolveShowId));
    this.hasMore = page.next != null;
    this.nextUrl = page.next;
    return this;
  }

  override hasMorePagers(): boolean {
    return this.hasMore;
  }
}

/**
 * Paginates "latest episode from each show" lazily across a list of shows.
 *
 * One `/api/search/?shows=<name>` call per show per page. SHOWS_PER_PAGE controls
 * the trade-off between initial latency and feed density — kept small to avoid
 * hammering the API on first load. Used by getHome and search.
 */
export class GasDigitalMultiShowPager extends VideoPager {
  private static readonly SHOWS_PER_PAGE = 4;
  private shows: FeaturedItem[];
  private cursor: number;

  constructor(shows: FeaturedItem[]) {
    const initial = GasDigitalMultiShowPager.batch(shows, 0);
    super(initial.videos, initial.cursor < shows.length);
    this.shows = shows;
    this.cursor = initial.cursor;
  }

  private static batch(shows: FeaturedItem[], start: number): { videos: PlatformVideo[]; cursor: number } {
    const end = Math.min(start + GasDigitalMultiShowPager.SHOWS_PER_PAGE, shows.length);
    const videos: PlatformVideo[] = [];
    for (let i = start; i < end; i++) {
      const show = shows[i]!;
      rememberShow(show.name, show.id);
      try {
        const page = searchByShowName(show.name, 1);
        const top = page.results[0];
        if (top) videos.push(mapEpisodeSummary(top, (n) => (n === show.name ? show.id : undefined)));
      } catch (e) {
        // Propagate auth failures so Grayjay can drive the login flow; only
        // swallow per-show errors that are recoverable (404, 5xx on one show).
        if (e instanceof LoginRequiredException) throw e;
        log(`multi-show pager: skipping ${show.name}: ${(e as Error).message}`);
      }
    }
    return { videos, cursor: end };
  }

  override nextPage(): VideoPager {
    const next = GasDigitalMultiShowPager.batch(this.shows, this.cursor);
    this.results = next.videos;
    this.cursor = next.cursor;
    this.hasMore = this.cursor < this.shows.length;
    return this;
  }

  override hasMorePagers(): boolean {
    return this.hasMore;
  }
}
