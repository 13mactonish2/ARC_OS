import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // camera / mic / display-capture only from the app itself — no third-party embedding of media devices
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  /* confine trace collection to THIS project — without it Next walks up the
     directory tree hunting for a workspace root and trace collection
     ("Collecting build traces") balloons past the Node heap cap on 4GB boxes */
  outputFileTracingRoot: process.cwd(),
  /* keep bulky data dirs out of the trace walk — nft's file graph was
     OOM-ing the build heap on the 4GB sandbox box (Task: deploy-fix) */
  outputFileTracingExcludes: {
    "*": [
      "./gitdata/**",
      "./qa/**",
      "./upload/**",
      "./download/**",
      "./node_modules/typescript/**",
      "./node_modules/@types/**",
    ],
  },
  /* lower webpack peak memory during compile (Next 15+/16 experimental flag) */
  experimental: {
    webpackMemoryOptimizations: true,
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /* webpack dev fallback — office libs (pptxgenjs) reference node: builtins */
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
        resource.request = resource.request.replace(/^node:/, "");
      })
    );
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      stream: false,
      zlib: false,
      https: false,
      http: false,
    };
    return config;
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      /* HTML documents must never be pinned by shared caches — every build
         ships a new page-chunk hash, so a stale shell = "nothing changed".
         Chunks under /_next/static keep their own immutable caching. */
      { source: "/", headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }] },
      { source: "/website", headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }] },
      { source: "/unlock", headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }] },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        /* pretty URL for the showcase site (public/website/index.html) —
           standalone mode serves exact file paths only, so map /website → the file */
        { source: "/website", destination: "/website/index.html" },
        /* Task 22 — remote-unlock page for the phone (public/unlock/index.html);
           same standalone exact-path trap, so map /unlock → the file */
        { source: "/unlock", destination: "/unlock/index.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
