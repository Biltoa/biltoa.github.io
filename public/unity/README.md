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
- **Compression Format:** Brotli for production, **Disabled** while testing locally. Vite's dev
  server does not add the `Content-Encoding` header Unity's Brotli files need, so a Brotli build
  fails to load under `npm run dev` unless you configure the header yourself.
- **Decompression Fallback:** on, if you want compressed builds to work on static hosts that do
  not set encoding headers (slower startup, larger loader).
- **Player Settings → Publishing Settings → Data Caching:** on, so returning visitors skip the
  download.
- **Strip Engine Code:** on. WebGL payload size is the whole battle.
- **Exceptions:** "None" or "Explicitly Thrown" for a smaller, faster build.

## Notes

- `Build/` is gitignored — WebGL builds are large. Use Git LFS or upload it with the deploy if you
  want it in version control.
- The player only starts loading after the visitor clicks **Launch build**, so the page stays light
  for people who just came to read.
- Threads/SharedArrayBuffer builds need cross-origin isolation headers. The dev server already
  sends them (`vite.config.ts`); replicate them on the production host if you go that route.
