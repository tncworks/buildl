import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (main: src/index.ts); Next must compile them.
  transpilePackages: ["@calibrate/shared", "@calibrate/data", "@calibrate/backtest"],
  // Keep the SDK and its ws client out of the server bundle; they run as plain node modules.
  serverExternalPackages: ["@somnia-chain/markets-sdk", "viem"],
};

export default nextConfig;
