# Unity WebGL build — drop zone

The Gameplay page loads a build from this folder. Nothing here yet, so the page shows a
"no build installed" panel instead of failing.

## Expected layout

```
public/unity/
  Build/
    WebGL.loader.js
    WebGL.data
    WebGL.framework.js
    WebGL.wasm
  StreamingAssets/        (only if your build uses it)
```

The file prefix must match `BUILD_NAME` in `src/components/UnityPlayer.tsx` (default: `WebGL`).
Unity names these after the build folder you choose, so either name the build output folder
`WebGL` or change that one constant.

## Unity build settings that matter here

- **Platform:** WebGL
- **Compression Format:** Brotli. The Vite dev/preview middleware and the Apache configuration in
  `public/.htaccess` serve `.unityweb` files with `Content-Encoding: br` and the correct MIME type.
- **Decompression Fallback:** on, if you want compressed builds to work on static hosts that do
  not set encoding headers (slower startup, larger loader).
- **Player Settings → Publishing Settings → Data Caching:** on, so returning visitors skip the
  download.
- **Strip Engine Code:** on. WebGL payload size is the whole battle.
- **Exceptions:** "None" or "Explicitly Thrown" for a smaller, faster build.

## Notes

- `WebGL.data.unityweb` is 244 MiB, so it cannot be stored as a regular Git object. Git LFS is not
  supported by GitHub Pages. Production keeps that one payload in the `unity-webgl-v1` GitHub
  Release; `.github/workflows/deploy-pages.yml` downloads it before building the Pages artifact.
  The loader, framework, and WebAssembly files remain in normal Git.
- The large payload starts preloading once a journal is opened. Visitors who only explore the
  campsite do not pay for it, while readers approaching a playable page overlap the download with
  their page turns.
- Threads/SharedArrayBuffer builds need cross-origin isolation headers. The dev server already
  sends them (`vite.config.ts`); replicate them on the production host if you go that route.
