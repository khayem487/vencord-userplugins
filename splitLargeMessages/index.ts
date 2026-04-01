/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { MessageActions, showToast, Toasts } from "@webpack/common";

const settings = definePluginSettings({
    maxMessageLength: {
        type: OptionType.SLIDER,
        description: "Maximum size per split chunk",
        markers: [500, 1000, 1500, 1800, 2000, 3000, 4000],
        default: 1800,
        minValue: 200,
        maxValue: 4000,
        stickToMarkers: false
    },
    pasteKeepWholeMessage: {
        type: OptionType.BOOLEAN,
        description: "On paste > limit, keep full text in input for editing. Split only when sending.",
        default: true
    },
    enableCustomSplitCommand: {
        type: OptionType.BOOLEAN,
        description: "Enable /split command to define your own delimiter",
        default: true
    },
    emptyLinePriorityOnly: {
        type: OptionType.BOOLEAN,
        description: "Default splitting prioritizes empty lines only (\n\n). If none found, fallback to hard cut.",
        default: true
    },
    delayMs: {
        type: OptionType.SLIDER,
        description: "Delay between chunks (ms)",
        markers: [0, 120, 200, 300, 500, 800],
        default: 120,
        minValue: 0,
        maxValue: 1000,
        stickToMarkers: false
    },
    showSplitToast: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when a message is split",
        default: true
    }
});

type SendMessage = typeof MessageActions.sendMessage;

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function normalizeNewlines(text: string) {
    return text.replace(/\r\n/g, "\n");
}

function splitByEmptyLineOrHardCut(content: string, maxLen: number) {
    const parts: string[] = [];
    let remaining = content;

    while (remaining.length > maxLen) {
        const slice = remaining.slice(0, maxLen);
        const idx = slice.lastIndexOf("\n\n");

        let cut = maxLen;
        if (idx > Math.floor(maxLen * 0.35)) {
            cut = idx + 2;
        }

        let part = remaining.slice(0, cut).trimEnd();
        if (!part.length) {
            part = remaining.slice(0, maxLen);
            cut = maxLen;
        }

        parts.push(part);
        remaining = remaining.slice(cut).trimStart();
    }

    if (remaining.length) parts.push(remaining);
    return parts;
}

function splitByDelimiter(body: string, delimiter: string, maxLen: number) {
    const groups = body.split(delimiter).map(s => s.trim()).filter(Boolean);
    const out: string[] = [];

    for (const group of groups) {
        if (group.length <= maxLen) {
            out.push(group);
        } else {
            out.push(...splitByEmptyLineOrHardCut(group, maxLen));
        }
    }

    return out.length ? out : [body];
}

function parseCustomSplit(content: string) {
    const normalized = normalizeNewlines(content);
    if (!normalized.startsWith("/split")) return null;

    const firstNl = normalized.indexOf("\n");
    if (firstNl < 0) return null;

    const header = normalized.slice(0, firstNl).trim();
    const body = normalized.slice(firstNl + 1);

    const delimiter = header === "/split"
        ? "\n\n"
        : header.replace(/^\/split\s+/, "");

    return {
        body,
        delimiter: delimiter.length ? delimiter : "\n\n"
    };
}

function looksLikeChatInput(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    if (!el) return false;

    return Boolean(
        el.closest("[role='textbox']") ||
        el.closest("[data-slate-editor='true']") ||
        el.closest("[class*='slateTextArea']")
    );
}

export default definePlugin({
    name: "SplitLargeMessages",
    description: "Automatically split oversized messages into multiple smaller messages",
    authors: [Devs.mwittrien],
    settings,

    _originalSend: null as SendMessage | null,
    _onPaste: null as ((e: ClipboardEvent) => void) | null,

    async _sendChunks(channelId: string, chunks: string[], data: any, waitForChannelReady?: boolean, options?: any) {
        const original = this._originalSend;
        if (!original) return;

        let lastResult: any;
        for (let i = 0; i < chunks.length; i++) {
            const msgData = {
                ...data,
                content: chunks[i]
            };

            const msgOptions = i === 0
                ? options
                : {
                    ...options,
                    messageReference: null,
                    allowedMentions: {
                        ...(options?.allowedMentions ?? {}),
                        replied_user: false
                    }
                };

            lastResult = await original(channelId, msgData, waitForChannelReady, msgOptions);

            if (i < chunks.length - 1 && this.settings.store.delayMs > 0) {
                await sleep(this.settings.store.delayMs);
            }
        }

        return lastResult;
    },

    start() {
        if (this._originalSend) return;

        const original = MessageActions.sendMessage.bind(MessageActions) as SendMessage;
        this._originalSend = original;

        this._onPaste = (e: ClipboardEvent) => {
            if (e.defaultPrevented) return;
            if (!this.settings.store.pasteKeepWholeMessage) return;
            if (!looksLikeChatInput(e.target)) return;

            const text = e.clipboardData?.getData("text/plain") ?? "";
            const maxLen = this.settings.store.maxMessageLength;
            if (!text || text.length <= maxLen) return;

            // Prevent Discord converting to message.txt while still keeping full editable text in input.
            e.preventDefault();
            insertTextIntoChatInputBox(text);

            if (this.settings.store.showSplitToast) {
                showToast("Large paste kept in input. It will split when you send.", Toasts.Type.MESSAGE);
            }
        };

        document.addEventListener("paste", this._onPaste, true);

        MessageActions.sendMessage = (async (channelId: string, data: any, waitForChannelReady?: boolean, options?: any) => {
            const content = typeof data?.content === "string" ? data.content : "";
            const maxLen = this.settings.store.maxMessageLength;
            const hasAttachments = Boolean(options?.attachmentsToUpload?.length || options?.stickerIds?.length || options?.poll);

            if (!content || hasAttachments) {
                return original(channelId, data, waitForChannelReady, options);
            }

            let chunks: string[] | null = null;

            if (this.settings.store.enableCustomSplitCommand) {
                const parsed = parseCustomSplit(content);
                if (parsed) {
                    chunks = splitByDelimiter(parsed.body, parsed.delimiter, maxLen);
                }
            }

            if (!chunks && content.length > maxLen) {
                if (this.settings.store.emptyLinePriorityOnly) {
                    chunks = splitByEmptyLineOrHardCut(content, maxLen);
                } else {
                    chunks = splitByEmptyLineOrHardCut(content, maxLen);
                }
            }

            if (!chunks || chunks.length <= 1) {
                return original(channelId, data, waitForChannelReady, options);
            }

            if (this.settings.store.showSplitToast) {
                showToast(`Splitting message into ${chunks.length} parts`, Toasts.Type.MESSAGE);
            }

            return this._sendChunks(channelId, chunks, data, waitForChannelReady, options);
        }) as SendMessage;
    },

    stop() {
        if (this._onPaste) {
            document.removeEventListener("paste", this._onPaste, true);
            this._onPaste = null;
        }

        if (!this._originalSend) return;
        MessageActions.sendMessage = this._originalSend;
        this._originalSend = null;
    }
});
