import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Resolves the `@/` alias from tsconfig so route modules can be imported in
// tests exactly as the app imports them.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: 'node' },
});
