/**
 * SKYLOG — browser notifications.
 *
 * Opt-in nudges for the two most consumer-useful events:
 *   1. A tracked flight is about to land / approach home.
 *   2. A special-interest aircraft is near (emergency squawk, heavy jet
 *      inside radius).
 *
 * Permission is asked exactly once, on first use of a feature that
 * wants to notify. We never poll the user for permission.
 *
 * Rate-limited to at-most-once per key per 5 minutes so a low-speed
 * aircraft near home doesn't blast a notification every poll.
 */

const RATE_LIMIT_MS = 5 * 60_000;
const lastFired = new Map<string, number>();

export async function ensureNotificationPermission(): Promise<
  "granted" | "denied" | "default" | "unsupported"
> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    const r = await Notification.requestPermission();
    return r;
  } catch {
    return "denied";
  }
}

export function notificationState(): "granted" | "denied" | "default" | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

interface FireOpts {
  key: string;
  title: string;
  body: string;
  tag?: string;
  silent?: boolean;
}

export function fireNotification({ key, title, body, tag, silent }: FireOpts): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  const now = Date.now();
  const last = lastFired.get(key) ?? 0;
  if (now - last < RATE_LIMIT_MS) return;
  lastFired.set(key, now);
  try {
    // eslint-disable-next-line no-new
    new Notification(title, {
      body,
      tag: tag ?? key,
      silent: silent ?? false,
      icon: "/favicon.svg",
    });
  } catch {
    /* user might have revoked; ignore */
  }
}
