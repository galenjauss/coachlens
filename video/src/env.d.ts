/** app/src/config.ts reads Vite's `import.meta.env`; remotion.config.ts defines these at bundle time. */
interface ImportMetaEnv { readonly DEV: boolean; readonly VITE_API_URL?: string; readonly VITE_IMU_LOG?: string }
interface ImportMeta { readonly env: ImportMetaEnv }
