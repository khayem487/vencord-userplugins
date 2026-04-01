# SplitLargeMessages

Splits oversized messages when sending.

## Features

- Keep full pasted text editable in input
- Split only on send
- Prefer empty-line splits (better structure)
- `/split` support for custom delimiter
- Safe handling while editing existing messages

## Demo

Add your GIF here:

```md
![SplitLargeMessages demo](./demo.gif)
```

## Install

Copy this folder to:
`src/userplugins/splitLargeMessages`

Then run:

```powershell
corepack pnpm build
corepack pnpm inject
```

## License

AGPL-3.0
