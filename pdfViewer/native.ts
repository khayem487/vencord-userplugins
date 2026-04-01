/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

const allowedHosts = new Set([
    "cdn.discordapp.com",
    "media.discordapp.net",
    "cdn.discordapp.net"
]);

const urlChecks = [
    (url: URL) => allowedHosts.has(url.host),
    (url: URL) => url.pathname.includes("/attachments/") || url.pathname.includes("/ephemeral-attachments/"),
    (url: URL) => url.pathname.toLowerCase().endsWith(".pdf") || (url.searchParams.get("filename")?.toLowerCase().endsWith(".pdf") ?? false)
];

export async function getBufferResponse(_: IpcMainInvokeEvent, url: string) {
    const urlObj = new URL(url);
    if (!urlChecks.every(check => check(urlObj))) {
        throw new Error("Invalid URL");
    }

    const response = await fetch(url).catch(() => null);
    if (!response?.ok) {
        throw new Error(`Failed to fetch: ${response?.statusText ?? "Failed to connect"}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
}
