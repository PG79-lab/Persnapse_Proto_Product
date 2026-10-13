import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [{ source: "/capture", destination: "/#cards", permanent: false }];
  },
};

export default nextConfig;
