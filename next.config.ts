import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root. Without this, Turbopack walks up and finds a
    // stray package-lock.json in the home directory and warns on every build.
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
