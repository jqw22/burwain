import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Email images are resized in the browser before upload, but allow some room.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
