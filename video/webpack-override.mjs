/**
 * Webpack override shared by remotion.config.ts (CLI/Studio) and scripts/*.mjs (programmatic renders).
 *
 * The video draws the REAL lens UI: it imports `../app/src/lens/*` and `../api/src/logic/cardLines.ts`
 * straight from the repo. Those files live outside this package, so:
 * - `@matside/shared` is aliased to the workspace source (`../shared/src/index.ts`);
 * - `@evenrealities/even_hub_sdk` (pulled in by app/src/config.ts for one enum) is stubbed;
 * - `import.meta.env.*` (Vite-only) is defined for app/src/config.ts.
 * Remotion's esbuild TS rule only excludes node_modules, so files outside the package compile as-is.
 */
import path from 'node:path'
import webpack from 'webpack'

/** Paths resolve from the working directory: the CLI and scripts/*.mjs always run from this package's root. */
const here = () => process.cwd()

/** @param {import('webpack').Configuration} current */
export const webpackOverride = current => ({
  ...current,
  resolve: {
    ...current.resolve,
    alias: {
      ...current.resolve?.alias,
      '@matside/shared': path.resolve(here(), '../shared/src/index.ts'),
      '@evenrealities/even_hub_sdk': path.resolve(here(), 'src/stubs/even_hub_sdk.ts'),
      // zod is imported by the shared contracts; resolve it from this package for files outside it.
      zod: path.resolve(here(), 'node_modules/zod'),
    },
  },
  plugins: [
    ...(current.plugins ?? []),
    new webpack.DefinePlugin({
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_API_URL': 'undefined',
      'import.meta.env.VITE_IMU_LOG': 'undefined',
    }),
  ],
})
