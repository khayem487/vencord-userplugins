# PdfViewer (Vencord Userplugin)

Preview PDF attachments directly inside Discord messages.

## What it does

- Adds a **Preview / Hide** control on PDF attachments
- Renders PDF pages inline inside Discord
- Supports:
  - scrollable multipage view
  - fit-width mode
  - zoom in/out (`+` / `-`)
  - `Ctrl + mouse wheel` / touchpad pinch zoom
- Keeps controls visible in an overlay toolbar

## Why this plugin exists

Discord/Vencord native behavior for PDFs can be inconsistent depending on build/platform.
This plugin provides a stable inline PDF reading experience.

## Files

- `index.tsx` — main plugin logic + UI
- `native.ts` — helper bridge for PDF fetching
- `cache.ts` — lightweight cache helper
- `pdfViewer.css` — viewer styling

## Install (from this repo)

1. Copy `pdfViewer` folder into your Vencord source:
   - `src/userplugins/pdfViewer`
2. Build + inject Vencord:

```powershell
corepack pnpm build
corepack pnpm inject
```

3. Restart Discord and enable **PdfViewer** in Vencord plugins.

## Notes / limitations

- Viewer behavior still depends on Discord internals and Chromium rendering.
- If Discord changes message UI internals, button placement may need updates.
- Very large PDFs can be slower to render.

## Troubleshooting

- If preview doesn’t appear:
  - ensure plugin is enabled
  - restart Discord completely (tray included)
  - rebuild + inject again
- If controls overlap after Discord updates:
  - update plugin CSS/layout logic to match new DOM behavior
