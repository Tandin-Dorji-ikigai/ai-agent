import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Allow opening the app via the LAN IP (e.g. http://172.28.32.1:3000) in dev.
  allowedDevOrigins: ["172.28.32.1"],
  turbopack: {
    // Pin the project root. Without this, a stray package-lock.json in a
    // parent folder (e.g. the home directory) makes Next.js warn on startup.
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
