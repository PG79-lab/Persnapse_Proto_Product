export interface PrototypeRuntimeEnvironment {
  APP_REMOTE_PROTOTYPE_ACCESS?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
}

function hostName(value: string): string {
  const first = value.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("[")) {
    return first.split("]")[0] + "]";
  }
  return first.split(":")[0] ?? "";
}

export function isPrototypeRequestAllowed(
  request: Request,
  runtime: PrototypeRuntimeEnvironment = {
    APP_REMOTE_PROTOTYPE_ACCESS: process.env.APP_REMOTE_PROTOTYPE_ACCESS,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  },
): boolean {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host =
    forwardedHost ?? request.headers.get("host") ?? new URL(request.url).host;
  const name = hostName(host);

  if (["localhost", "127.0.0.1", "[::1]"].includes(name)) {
    return true;
  }

  return (
    runtime.APP_REMOTE_PROTOTYPE_ACCESS === "vercel_preview" &&
    runtime.VERCEL === "1" &&
    runtime.VERCEL_ENV === "preview" &&
    name.endsWith(".vercel.app")
  );
}
