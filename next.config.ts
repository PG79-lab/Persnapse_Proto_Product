import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  ...(process.env.PERSNAPSE_GRAPH_PREVIEW === "1"
    ? { devIndicators: false as const }
    : {}),
  async redirects() {
    return [
      { source: "/capture", destination: "/#cards", permanent: false },
      {
        source: "/recall",
        destination: "/?assistant=1#todos",
        permanent: false,
      },
      { source: "/people", destination: "/#people", permanent: false },
      {
        source: "/people/:personId",
        destination: "/?person=:personId#people",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
