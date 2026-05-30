// Typed shapes of the gasdigital.com REST API responses we consume.
// Derived from the network capture at gasdigital.com.har.

export interface FeaturedItem {
  id: string;
  name: string;
  thumbnail: string;
  category: 'featured' | 'archived' | 'exclusives' | 'playlists' | string;
}

export interface Host {
  id: string;
  full_name: string;
  profile_image: string;
}

export interface ShowDetail {
  type: 'show';
  id: string;
  sqid: string;
  name: string;
  short_name?: string;
  description: string;
  episode_count: number;
  live_schedule?: string;
  category: string;
  tags: string[];
  thumbnail: string;
  poster: string;
  hosts: Host[];
  hosts_compact?: string;
  platform_links?: { name: string; code: string; url: string }[];
}

export interface EpisodeSummary {
  type: 'episode';
  id: string;
  name: string;
  thumbnail: string;
  description: string;
  show: string; // show name (in search results) — for detail it's a ShowDetail-like object
  duration: number; // seconds
  episode: number;
  date: number; // unix seconds
  thumbnail_remote?: {
    id: string;
    url: string;
    extension: string;
    width: number;
    height: number;
  };
}

export interface EpisodeDetail extends Omit<EpisodeSummary, 'show'> {
  sqid: string;
  show: {
    id: string;
    name: string;
    episode_count: number;
    thumbnail: string;
    hosts: Host[];
  };
  hosts_compact?: string;
  category: string;
  tags: string[];
  year: number;
  month: number;
  poster?: string;
  playback: string; // HLS master URL
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface UserSelf {
  id: string;
  email: string;
  display_name: string;
  avatar?: string;
  subscription_status?: string;
  subscription_renewal?: string;
  member_level?: number;
  user_level?: number;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: UserSelf;
  access_expiration: string;
  refresh_expiration: string;
}
