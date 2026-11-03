import type { NextConfig } from "next";

// Never inside another site's frame (clickjacking): every page and route.
const NO_FRAMING = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  /* config options here */
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
      // The consent page's URL carries the agent's request: never passed on in a Referer.
      { source: "/oauth/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
