/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { MessageActions, showToast, Toasts } from "@webpack/common";

const settings = definePluginSettings({
    maxMessageLength: {
        type: OptionType.SLIDER,
        description: "Maximum size per split chunk",
        markers: [500, 1000, 1500, 2000, 3000, 4000],
        default: 2000,
        minValue: 200,
        maxValue: 4000,
        stickToMarkers: false
    },
    splitOnWordBoundary: {
        type: OptionType.BOOLEAN,
        description: "Prefer splitting on newlines/spaces when possible",
        default: true
    },
    delayMs: {
        type: OptionType.SLIDER,
        description: "Delay between chunks (ms)",
        markers: [0, 150, 300, 500, 800],
        default: 150,
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

function splitContent(content: string, maxLen: number, wordBoundary: boolean) {
    const parts: string[] = [];
    let remaining = content;

    while (remaining.length > maxLen) {
        let cut = maxLen;

        if (wordBoundary) {
            const slice = remaining.slice(0, maxLen);
            const newLineIdx = slice.lastIndexOf("\n");
            const spaceIdx = slice.lastIndexOf(" ");
            const candidate = Math.max(newLineIdx, spaceIdx);

            // Avoid tiny chunks when boundary is too early.
            if (candidate > Math.floor(maxLen * 0.4)) {
                cut = candidate + (slice[candidate] === "\n" ? 1 : 0);
            }
        }

        let part = remaining.slice(0, cut);
        if (wordBoundary) part = part.trimEnd();

        // Fallback safety guard
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

export default definePlugin({
    name: "SplitLargeMessages",
    description: "Automatically split oversized messages into multiple smaller messages",
    authors: [Devs.mwittrien],
    settings,

    _originalSend: null as SendMessage | null,

    start() {
        if (this._originalSend) return;

        const original = MessageActions.sendMessage.bind(MessageActions) as SendMessage;
        this._originalSend = original;

        MessageActions.sendMessage = (async (channelId: string, data: any, waitForChannelReady?: boolean, options?: any) => {
            const content = typeof data?.content === "string" ? data.content : "";
            const maxLen = this.settings.store.maxMessageLength;

            const hasAttachments = Boolean(options?.attachmentsToUpload?.length || options?.stickerIds?.length || options?.poll);
            if (!content || content.length <= maxLen || hasAttachments) {
                return original(channelId, data, waitForChannelReady, options);
            }

            const chunks = splitContent(content, maxLen, this.settings.store.splitOnWordBoundary);

            if (chunks.length <= 1) {
                return original(channelId, data, waitForChannelReady, options);
            }

            if (this.settings.store.showSplitToast) {
                showToast(`Splitting message into ${chunks.length} parts`, Toasts.Type.MESSAGE);
            }

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
        }) as SendMessage;
    },

    stop() {
        if (!this._originalSend) return;
        MessageActions.sendMessage = this._originalSend;
        this._originalSend = null;
    }
});
