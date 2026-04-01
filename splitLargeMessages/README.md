# SplitLargeMessages (Vencord Userplugin)

Automatically handles long Discord messages by splitting them into safe chunks when needed.

## What it does

- Keeps full pasted long text editable in input (no forced `message.txt` behavior)
- Splits oversized content on send
- Sends chunks sequentially in order
- Supports custom split command (`/split`)
- Avoids split behavior while editing existing messages

## Core behavior

- If content is under the configured limit: normal send
- If content exceeds limit: plugin splits and sends parts
- Default split strategy prefers section breaks (empty lines) before hard cuts

## Settings

- `maxMessageLength` — chunk max size (default: `1800`)
- `pasteKeepWholeMessage` — keep full paste editable, split only on send
- `enableCustomSplitCommand` — enable `/split` parsing
- `emptyLinePriorityOnly` — prioritize split on empty lines
- `delayMs` — delay between chunks
- `showSplitToast` — toasts for split actions

## `/split` usage

### 1) Default delimiter (empty line)

```text
/split
Section A

Section B

Section C
```

### 2) Custom delimiter

```text
/split ###
Part 1 ###
Part 2 ###
Part 3
```

## Install (from this repo)

1. Copy `splitLargeMessages` folder into your Vencord source:
   - `src/userplugins/splitLargeMessages`
2. Build + inject:

```powershell
corepack pnpm build
corepack pnpm inject
```

3. Restart Discord and enable **SplitLargeMessages** in Vencord plugins.

## Notes / limitations

- Discord UI/internals can change; input/send interception may require maintenance.
- Split quality depends on source text structure (empty lines improve results).
- Attachments/stickers/polls are not split like plain text.
