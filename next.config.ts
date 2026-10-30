import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // No page uses next/image, so the optimizer endpoint is switched off rather than left exposed.
  images: { unoptimized: true },
  // Earlier names for the tour and farm pages.
  async redirects() {
    return [
      { source: '/demo', destination: '/tour', permanent: false },
      { source: '/plots/:id', destination: '/farms/:id', permanent: false },
    ];
  },
};

export default nextConfig;
