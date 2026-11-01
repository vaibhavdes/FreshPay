import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Photos ship already sized, so the optimizer endpoint stays off rather than left exposed.
  images: { unoptimized: true },
  async redirects() {
    return [{ source: '/plots/:id', destination: '/farms/:id', permanent: false }];
  },
};

export default nextConfig;
