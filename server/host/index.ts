import createLmEvalAdapter from './adapter';

/**
 * Compiled entry point HomeBase actually loads (dist/host/index.js, built by
 * `npm run build:host` — see package.json and the esbuild invocation it
 * drives). The real implementation lives in `./adapter.ts`.
 *
 * LMEval is native ESM ("type": "module"), unlike LMApi/DevPlanner which
 * compile to CommonJS. A plain `export default` here compiles to a genuine
 * ESM default export, and Node's dynamic `import()` of an ESM module sets
 * the resulting namespace's `.default` directly to the exported value — no
 * interop wrapper involved. Do NOT port LMApi's `export =` trick to this
 * file: that construct only exists to work around CommonJS's `export
 * default` → `{ default: fn, __esModule: true }` wrapping, which does not
 * apply here.
 */
export default createLmEvalAdapter;
