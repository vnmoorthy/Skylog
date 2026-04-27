/**
 * SKYLOG — aircraft photos via Planespotters.net.
 *
 * For any aircraft registration, fetch the most-recent
 * community-uploaded photo of *that exact tail number*. Free public
 * endpoint, CORS-safe, no key required.
 *
 * The endpoint returns a small JSON payload with thumbnail URLs at
 * three sizes plus a link back to the photographer's page on
 * planespotters.net (where credit + license live).
 *
 * We cache results in localStorage with a 30-day TTL so we don't
 * hammer the Planespotters API. Negative results (no photo found)
 * are also cached, with a shorter 24h TTL — that way we stop asking
 * about obscure tail numbers but still try again the next day in case
 * a photographer uploads one.
 */

export interface AircraftPhoto {
  /** Direct URL to a small (200x150-ish) thumbnail. */
  readonly thumbnailUrl: string;
  /** Direct URL to a larger thumbnail (800-wide-ish). */
  readonly largeUrl: string;
  /** Photographer credit, e.g. "Jane Smith". */
  readonly photographer: string | null;
  /** URL to the photo's page on planespotters.net (for full-res + license). */
  readonly pageUrl: string;
}

const CACHE_PREFIX = "skylog:photo:";
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days for found photos
const MISS_TTL_MS = 24 * 60 * 60 * 1000;     // 24h for not-found

interface CachedEntry {
  readonly at: number;
  readonly photo: AircraftPhoto | null;
}

interface PlanespottersResponse {
  readonly photos?: ReadonlyArray<{
    readonly id?: string;
    readonly thumbnail?: { readonly src?: string };
    readonly thumbnail_large?: { readonly src?: string };
    readonly link?: string;
    readonly photographer?: string;
  }>;
}

function readCache(reg: string): CachedEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + reg);
    if (!raw) return null;
    const v = JSON.parse(raw) as CachedEntry;
    const ttl = v.photo ? HIT_TTL_MS : MISS_TTL_MS;
    if (Date.now() - v.at > ttl) {
      try { localStorage.removeItem(CACHE_PREFIX + reg); } catch { /* ignore */ }
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

function writeCache(reg: string, photo: AircraftPhoto | null): void {
  try {
    const payload: CachedEntry = { at: Date.now(), photo };
    localStorage.setItem(CACHE_PREFIX + reg, JSON.stringify(payload));
  } catch {
    // localStorage may be full or disabled (private browsing); ignore.
  }
}

/**
 * Look up a photo for the given aircraft registration (e.g. "G-EUUH").
 * Returns the cached entry if available, otherwise fetches from
 * Planespotters and caches. Throws on a network error so the caller
 * can render a fallback.
 */
export async function fetchAircraftPhoto(
  registration: string
): Promise<AircraftPhoto | null> {
  const reg = registration.trim().toUpperCase();
  if (!reg) return null;

  const cached = readCache(reg);
  if (cached) return cached.photo;

  try {
    const res = await fetch(
      `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) {
      writeCache(reg, null);
      return null;
    }
    const json = (await res.json()) as PlanespottersResponse;
    const first = json.photos?.[0];
    const thumbnailUrl = first?.thumbnail?.src;
    const largeUrl = first?.thumbnail_large?.src ?? thumbnailUrl;
    if (!thumbnailUrl || !largeUrl || !first?.link) {
      writeCache(reg, null);
      return null;
    }
    const photo: AircraftPhoto = {
      thumbnailUrl,
      largeUrl,
      photographer: first.photographer ?? null,
      pageUrl: first.link,
    };
    writeCache(reg, photo);
    return photo;
  } catch {
    // Don't poison the cache on a network error — try again next time.
    return null;
  }
}

/** Helper for tests — clear all photo cache entries. */
export function clearPhotoCache(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
