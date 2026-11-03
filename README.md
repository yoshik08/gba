# gba

GBA emulator page for [yoshik.xyz/gba](https://yoshik.xyz/gba): mGBA compiled to WebAssembly, running in the browser.

- Google login. ROMs are stored privately in Google Drive and streamed through the backend only (never public).
- In-game saves and save states live in MongoDB, keyed by the user's Google account `sub`.
- Installable (PWA). Games you've played, or downloaded from the details sheet, keep working offline. In-game saves made offline sync when you're back online.

## Local preview (no Google or Mongo needed)

```
npm install
npm run dev:local        # http://localhost:5173/gba  (Vite, hot reload)
npm run preview:local    # production build at http://localhost:5173/gba
```

`dev:local` runs Vite behind the same rewrites as `vercel.json`, with an in-process mock of `/gba/api/*`.
You're signed in as "Local Player". Data lives in `.local/` (gitignored).

- Put your own `.gba` files in `.local/roms/` to play them locally.
- `.local/roms/Input Test.gba` is generated (`npm run test:rom`): a tiny ROM where the D-pad moves a square, A/B/L recolour it, A plays a tone, Start writes SRAM, and the top row shows a frame counter.
- The mock lists a dozen well-known titles so the library looks real; they all load the test ROM.
- Visit `/gba/api/auth/logout` to see the signed-out page, `/gba/api/auth/callback/google` to sign back in.

## QA

With `npm run dev:local` (or `preview:local`) running:

```
npm run qa                     # gameplay + offline + performance
node tests/qa/play.mjs         # input, 2× fast-forward, tab switching, saves (46 checks)
MOBILE=1 W=390 H=844 node tests/qa/play.mjs   # same, phone portrait
node tests/qa/offline.mjs      # PWA + offline play
node tests/qa/perf.mjs         # 60 fps under CPU throttling, input latency, scroll
```

Set `BASE=http://localhost:4173` to point the suites at another port. Everything runs headless.
