// A short, plain description of the device someone signed in on, such as "iPhone · Safari",
// worked out from the browser's user agent. We keep only this, not the full user agent or IP address.
export function describeDevice(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent;
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /OPR\//.test(ua)
          ? "Opera"
          : /Chrome|CriOS/.test(ua)
            ? "Chrome"
            : /Safari/.test(ua)
              ? "Safari"
              : null;
  const parts = [system, browser].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Other";
}
