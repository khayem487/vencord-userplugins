# Vencord Userplugins by Khayem

Small collection of unofficial Vencord userplugins.

## Plugins

- **PdfViewer** → inline PDF preview in Discord (scroll + zoom)
- **SplitLargeMessages** → keep long text editable, split on send

## Quick install

1. Copy a plugin folder into your Vencord source at `src/userplugins/<pluginName>`
2. Build + inject:

```powershell
corepack pnpm build
corepack pnpm inject
```

## License

AGPL-3.0 (see `LICENSE`).
