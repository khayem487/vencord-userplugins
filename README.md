# Vencord User Plugins (Khayem)

Private collection of custom Vencord plugins.

## Plugins

- `pdfViewer` — Restored and enhanced PDF preview plugin for Vencord.
- `splitLargeMessages` — Auto-splits oversized messages into sequential chunks before sending.

## Structure

```
vencord-userplugins/
  pdfViewer/
    index.tsx
    native.ts
    cache.ts
    pdfViewer.css
```

## Install (local)

1. Clone/copy this repo.
2. Copy plugin folder(s) into your Vencord source repo at:
   `src/userplugins/<pluginName>`
3. Build + inject from Vencord source:

```powershell
corepack pnpm build
corepack pnpm inject
```

## Notes

- This repo tracks only custom userplugins (not the full Vencord source).
- Keep plugin names stable if native helper names depend on them.
