import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Workspace packages ship TypeScript source; Next compiles them with the app.
  transpilePackages: ["@btb/contracts", "@btb/core"],
  // The image build (apps/web/Dockerfile) ships the traced standalone server; tracing starts at the repo root.
  ...(process.env.NEXT_STANDALONE ? { output: "standalone" as const, outputFileTracingRoot: path.join(__dirname, "../..") } : {}),
  // `next dev` and `next build` write to different folders, so a build never corrupts a running dev server.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // Dev only: an unloaded route takes seconds to recompile, longer than a runner's 3 s callback timeout.
  onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 100 },
};

export default nextConfig;
