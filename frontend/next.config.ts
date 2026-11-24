import path from "node:path";
import type { NextConfig } from "next";

// Never inside another site's frame (clickjacking): every page and route.
const NO_FRAMING = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  /* config options here */
  // The desktop app runs `.next/standalone/server.js` in its own process.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      // Everything but the files route, whose PDFs the assignment pop-up's own viewer frames.
      { source: "/((?!api/files/).*)", headers: NO_FRAMING },
      {
        source: "/api/files/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
