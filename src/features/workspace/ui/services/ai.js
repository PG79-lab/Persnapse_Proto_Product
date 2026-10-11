async function request(path, body, signal, timeout = 70000) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "요청을 완료하지 못했습니다.");
  return data;
}
export async function requestAI(input, { signal } = {}) {
  if (input.task !== "briefing") throw new Error("지원하지 않는 요청입니다.");
  return request("/api/briefing", { note: input.text || "" }, signal);
}
export async function requestEventMetadata(url, { signal } = {}) {
  return (await request("/api/event-metadata", { url }, signal, 18000))
    .metadata;
}
