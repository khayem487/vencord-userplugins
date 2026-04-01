/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { MessageActions, SelectedChannelStore, showToast, Toasts } from "@webpack/common";

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
    splitOnWordBoundary: {
        type: OptionType.BOOLEAN,
        description: "Prefer splitting on delimiters when possible",
        default: true
    },
    preferEmptyLineSplit: {
        type: OptionType.BOOLEAN,
        description: "Prefer splitting on empty lines first, then newline, then space",
        default: true
    },
    queueRemainingOnPaste: {
        type: OptionType.BOOLEAN,
        description: "When oversized text is pasted, insert first chunk and queue remaining chunks",
        default: true
    },
    autoSendQueuedChunks: {
        type: OptionType.BOOLEAN,
        description: "When queued chunks exist, auto-send all after first Enter (disable to review/edit each next chunk manually)",
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

type QueuedPaste = {
    firstChunk: string;
    remaining: string[];
};

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function splitContent(content: string, maxLen: number, wordBoundary: boolean, preferEmptyLineSplit: boolean) {
    const parts: string[] = [];
    let remaining = content;

    while (remaining.length > maxLen) {
        let cut = maxLen;

        if (wordBoundary) {
            const slice = remaining.slice(0, maxLen);
            const doubleNewLineIdx = preferEmptyLineSplit
                ? Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\r\n\r\n"))
                : -1;
            const newLineIdx = slice.lastIndexOf("\n");
            const spaceIdx = slice.lastIndexOf(" ");

            const candidate = Math.max(doubleNewLineIdx, newLineIdx, spaceIdx);

            if (candidate > Math.floor(maxLen * 0.4)) {
                if (candidate === doubleNewLineIdx) {
                    cut = candidate + (slice.startsWith("\r\n\r\n", candidate) ? 4 : 2);
                } else {
                    cut = candidate + (slice[candidate] === "\n" ? 1 : 0);
                }
            }
        }

        let part = remaining.slice(0, cut);
        if (wordBoundary) part = part.trimEnd();

        if (!part.length) {
            part = remaining.slice(0, maxLen);
            cut = maxLen;
        }

        parts.push(part);
        remaining = remaining.slice(cut);
        if (wordBoundary) remaining = remaining.trimStart();
    }

    if (remaining.length) parts.push(remaining);
    return parts;
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
    _queuedByChannel: new Map<string, QueuedPaste>(),

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
            if (!looksLikeChatInput(e.target)) return;

            const text = e.clipboardData?.getData("text/plain") ?? "";
            const maxLen = this.settings.store.maxMessageLength;
            if (!text || text.length <= maxLen) return;

            e.preventDefault();

            const chunks = splitContent(text, maxLen, this.settings.store.splitOnWordBoundary, this.settings.store.preferEmptyLineSplit);
            const [first, ...remaining] = chunks;

            insertTextIntoChatInputBox(first);

            if (this.settings.store.queueRemainingOnPaste && remaining.length) {
                const channelId = SelectedChannelStore.getChannelId();
                if (channelId) {
                    this._queuedByChannel.set(channelId, {
                        firstChunk: first,
                        remaining
                    });
                }
            }

            if (this.settings.store.showSplitToast) {
                const extra = remaining.length ? ` + ${remaining.length} queued` : "";
                showToast(`Pasted large text as chunks (${chunks.length} total${extra})`, Toasts.Type.MESSAGE);
            }
        };

        document.addEventListener("paste", this._onPaste, true);

        MessageActions.sendMessage = (async (channelId: string, data: any, waitForChannelReady?: boolean, options?: any) => {
            const content = typeof data?.content === "string" ? data.content : "";
            const maxLen = this.settings.store.maxMessageLength;

            const hasAttachments = Boolean(options?.attachmentsToUpload?.length || options?.stickerIds?.length || options?.poll);

            // First, handle queued chunks from a prior oversized paste.
            const queued = this._queuedByChannel.get(channelId);
            if (queued && content) {
                const sent = await original(channelId, data, waitForChannelReady, options);

                // If user changed content completely, drop queue to avoid wrong spam.
                const similarityHint = queued.firstChunk.slice(0, 24);
                if (!content.includes(similarityHint)) {
                    this._queuedByChannel.delete(channelId);
                    return sent;
                }

                if (this.settings.store.autoSendQueuedChunks) {
                    await this._sendChunks(channelId, queued.remaining, { ...data }, waitForChannelReady, {
                        ...options,
                        messageReference: null,
                        allowedMentions: {
                            ...(options?.allowedMentions ?? {}),
                            replied_user: false
                        }
                    });

                    this._queuedByChannel.delete(channelId);
                } else {
                    const [next, ...rest] = queued.remaining;
                    if (next) {
                        insertTextIntoChatInputBox(next);
                        this._queuedByChannel.set(channelId, {
                            firstChunk: next,
                            remaining: rest
                        });
                    } else {
                        this._queuedByChannel.delete(channelId);
                    }
                }

                return sent;
            }

            // Then, classic oversized content split when user typed/pasted normally.
            if (!content || content.length <= maxLen || hasAttachments) {
                return original(channelId, data, waitForChannelReady, options);
            }

            const chunks = splitContent(content, maxLen, this.settings.store.splitOnWordBoundary, this.settings.store.preferEmptyLineSplit);

            if (chunks.length <= 1) {
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

        this._queuedByChannel.clear();

        if (!this._originalSend) return;
        MessageActions.sendMessage = this._originalSend;
        this._originalSend = null;
    }
});
