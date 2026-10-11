const hosts = new Set([
  "event-us.kr",
  "www.event-us.kr",
  "onoffmix.com",
  "www.onoffmix.com",
  "eventbrite.com",
  "www.eventbrite.com",
  "meetup.com",
  "www.meetup.com",
]);
const MAX_BYTES = 1024 * 1024;
export function validateEventUrl(value) {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("2,048자 이내의 공식 행사 URL을 입력해주세요.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("유효한 공식 행사 URL을 입력해주세요.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.has(url.hostname)
  )
    throw new Error(
      "이벤터스·온오프믹스·Eventbrite·Meetup의 HTTPS 공식 행사 URL만 지원합니다.",
    );
  url.hash = "";
  return url;
}
function decode(value) {
  return value.replace(
    /&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi,
    (entity) => {
      const named = {
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
        "&nbsp;": " ",
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const hex = /^&#x/i.test(entity);
      const n = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : "";
    },
  );
}
function attributes(tag) {
  const attrs = {};
  for (const match of tag.matchAll(
    /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  ))
    attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4]);
  return attrs;
}
function plain(value, max) {
  return decode(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
function imageUrl(value, sourceUrl) {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value, sourceUrl);
    // Images are returned as references, never fetched or proxied by the server.
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes(".") ||
      /^[\d.]+$/.test(url.hostname) ||
      url.hostname.startsWith("[") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(
        url.hostname,
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function parseEventMetadata(html, sourceUrl) {
  const metadata = {};
  // A small metadata reader, not a browser: no scripts, linked resources or page instructions execute.
  const document = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  for (const tag of document.matchAll(
    /<meta\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,
  )) {
    const attrs = attributes(tag[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (
      ["og:title", "og:description", "og:image", "description"].includes(key) &&
      attrs.content &&
      !metadata[key]
    )
      metadata[key] = attrs.content;
  }
  const title = plain(
    metadata["og:title"] ||
      document.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1],
    240,
  );
  const description = plain(
    metadata["og:description"] || metadata.description,
    2000,
  );
  if (!title && !description)
    throw new Error(
      "이 페이지에서 행사 정보를 확인하지 못했습니다. 직접 입력해주세요.",
    );
  return {
    title,
    description,
    imageUrl: imageUrl(metadata["og:image"], sourceUrl),
    sourceUrl,
  };
}
async function limitedHtml(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!/\btext\/html\b|\bapplication\/xhtml\+xml\b/i.test(contentType))
    throw new Error("행사 웹페이지에서만 정보를 가져올 수 있습니다.");
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_BYTES)
    throw new Error("행사 페이지가 너무 큽니다. 직접 입력해주세요.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("행사 페이지 응답을 읽지 못했습니다.");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES)
        throw new Error("행사 페이지가 너무 큽니다. 직접 입력해주세요.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}
/** @param {string} value @param {{ fetcher?: typeof fetch, signal?: AbortSignal }} options */
export async function fetchEventMetadata(
  value,
  { fetcher = fetch, signal } = {},
) {
  let url = validateEventUrl(value);
  const timeout = AbortSignal.timeout(8000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (let step = 0; step <= 3; step++) {
    const response = await fetcher(url.href, {
      method: "GET",
      redirect: "manual",
      signal: requestSignal,
      headers: {
        Accept: "text/html",
        "User-Agent": "Persnapse-EventPreview/1.0",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || step === 3)
        throw new Error("행사 페이지의 이동 경로를 확인하지 못했습니다.");
      // Validate every redirect before issuing another request, including relative locations.
      url = validateEventUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("행사 페이지에 접근하지 못했습니다. 직접 입력해주세요.");
    }
    return parseEventMetadata(await limitedHtml(response), url.href);
  }
  throw new Error("행사 정보를 가져오지 못했습니다.");
}
