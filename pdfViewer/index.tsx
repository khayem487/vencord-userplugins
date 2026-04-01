/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./pdfViewer.css";

import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Tooltip, useEffect, useRef, useState } from "@webpack/common";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs";

(globalThis as any).pdfjsWorker = pdfjsWorker;

const Native = VencordNative.pluginHelpers.PdfViewer as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    autoEmptyCache: {
        type: OptionType.BOOLEAN,
        description: "Unused with the current renderer path; kept for compatibility.",
        default: false
    },
});

interface Attachment {
    id: string;
    filename: string;
    url: string;
    proxy_url: string;
    content_type: string;
}

function errText(err: unknown) {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (typeof err === "object" && "message" in err) return String((err as any).message);
    return String(err);
}

function PdfAttachmentPreview({ attachment }: { attachment: Attachment; }) {
    const [visible, setVisible] = useState(false);
    const [error, setError] = useState<string>();
    const [pages, setPages] = useState(0);
    const [pdfData, setPdfData] = useState<Uint8Array>();
    const [zoom, setZoom] = useState(100);
    const [fitWidth, setFitWidth] = useState(true);
    const [rerenderToken, setRerenderToken] = useState(0);

    const pagesWrapRef = useRef<HTMLDivElement>(null);
    const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
    const docRef = useRef<any>(null);
    const sourceUrl = attachment.url || attachment.proxy_url;

    const initPdfData = async () => {
        try {
            setError(undefined);

            const res = await fetch(sourceUrl, { credentials: "include" }).catch(() => null);
            if (res?.ok) {
                const ab = await res.arrayBuffer();
                setPdfData(new Uint8Array(ab));
                return;
            }

            const nativeBytes = await Native.getBufferResponse(sourceUrl);
            setPdfData(nativeBytes as unknown as Uint8Array);
        } catch (err) {
            console.error("[PdfViewer] Failed to load PDF bytes", err);
            setError(`Failed to load PDF: ${errText(err)}`);
        }
    };

    useEffect(() => {
        if (visible && !pdfData && !error) initPdfData();
    }, [visible]);

    useEffect(() => {
        if (!visible || !fitWidth || !pagesWrapRef.current) return;

        const observer = new ResizeObserver(() => {
            setRerenderToken(t => t + 1);
        });

        observer.observe(pagesWrapRef.current);
        return () => observer.disconnect();
    }, [visible, fitWidth]);

    useEffect(() => {
        if (!visible || !pagesWrapRef.current) return;

        const el = pagesWrapRef.current;
        const onWheel = (ev: WheelEvent) => {
            // Chromium touchpad pinch emits ctrlKey + wheel
            if (!ev.ctrlKey) return;
            ev.preventDefault();
            setFitWidth(false);
            setZoom(z => Math.max(30, Math.min(400, z + (ev.deltaY < 0 ? 10 : -10))));
        };

        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel as EventListener);
    }, [visible]);

    useEffect(() => {
        if (!visible || !pdfData) return;

        let cancelled = false;

        (async () => {
            try {
                if (!docRef.current) {
                    const task = (pdfjsLib as any).getDocument({
                        data: pdfData,
                        disableWorker: true,
                        isEvalSupported: false,
                        disableFontFace: false,
                        useSystemFonts: true
                    });

                    docRef.current = await task.promise;
                    if (cancelled) return;
                    setPages(docRef.current.numPages || 1);
                }

                const pdfDoc = docRef.current;
                const total = pdfDoc.numPages || 1;
                if (pages !== total) {
                    setPages(total);
                    return;
                }

                const wrapWidth = pagesWrapRef.current?.clientWidth || 900;
                const dpr = window.devicePixelRatio || 1;

                for (let pageNum = 1; pageNum <= total; pageNum++) {
                    const pdfPage = await pdfDoc.getPage(pageNum);
                    if (cancelled) return;

                    const baseViewport = pdfPage.getViewport({ scale: 1 });
                    const desiredScale = fitWidth
                        ? Math.max(0.3, (wrapWidth - 24) / baseViewport.width)
                        : Math.max(0.3, zoom / 100);

                    const cssViewport = pdfPage.getViewport({ scale: desiredScale });
                    const renderViewport = pdfPage.getViewport({ scale: desiredScale * dpr });

                    const canvas = canvasRefs.current[pageNum - 1];
                    if (!canvas) continue;

                    const ctx = canvas.getContext("2d");
                    if (!ctx) continue;

                    canvas.width = Math.floor(renderViewport.width);
                    canvas.height = Math.floor(renderViewport.height);
                    canvas.style.width = `${Math.floor(cssViewport.width)}px`;
                    canvas.style.height = "auto";

                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    await pdfPage.render({ canvasContext: ctx, viewport: renderViewport }).promise;
                    if (cancelled) return;
                }

                setError(undefined);
            } catch (err) {
                console.error("[PdfViewer] Failed to render PDF", err);
                setError(`PDF render failed: ${errText(err)}`);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [visible, pdfData, pages, zoom, fitWidth, rerenderToken]);

    useEffect(() => {
        if (!visible) {
            docRef.current = null;
            setPdfData(undefined);
            setPages(0);
            canvasRefs.current = [];
            setError(undefined);
        }
    }, [visible]);

    return (
        <div>
            <Tooltip text={visible ? "Hide File Preview" : "Preview File"}>
                {tooltipProps => (
                    <div
                        {...tooltipProps}
                        className="vc-pdf-viewer-toggle"
                        role="button"
                        onClick={() => setVisible(v => !v)}
                    >
                        {visible ? "Hide" : "Preview"}
                    </div>
                )}
            </Tooltip>

            {visible && (
                <div className="vc-pdf-viewer-container">
                    <div className="vc-pdf-viewer-toolbar">
                        <span>{pages || 1} page(s)</span>
                        <div className="vc-pdf-viewer-controls">
                            <button className="vc-pdf-viewer-btn" onClick={() => { setFitWidth(false); setZoom(z => Math.max(30, z - 10)); }}>-</button>
                            <span className="vc-pdf-viewer-zoom-label">{zoom}%</span>
                            <button className="vc-pdf-viewer-btn" onClick={() => { setFitWidth(false); setZoom(z => Math.min(400, z + 10)); }}>+</button>
                        </div>
                        <button className="vc-pdf-viewer-fit-btn" onClick={() => setFitWidth(v => !v)}>{fitWidth ? "Fit width ✓" : "Fit width"}</button>
                        <a className="vc-pdf-viewer-link" href={sourceUrl} target="_blank" rel="noreferrer">Open PDF</a>
                    </div>

                    <div ref={pagesWrapRef} className="vc-pdf-viewer-pages">
                        {Array.from({ length: pages || 1 }, (_, idx) => (
                            <div key={idx} className="vc-pdf-viewer-page">
                                <canvas
                                    ref={el => {
                                        canvasRefs.current[idx] = el;
                                    }}
                                    className="vc-pdf-viewer-preview"
                                />
                            </div>
                        ))}
                    </div>

                    {error ? <div style={{ marginTop: 8, opacity: 0.8, fontSize: 12 }}>{error}</div> : null}
                </div>
            )}
        </div>
    );
}

export default definePlugin({
    name: "PdfViewer",
    description: "Preview PDF Files without having to download them",
    authors: [Devs.AGreenPig],
    dependencies: ["MessageAccessoriesAPI"],
    settings,

    start() {
        addMessageAccessory("pdfViewer", props => {
            const pdfAttachments = props.message.attachments.filter((a: Attachment) => a.content_type === "application/pdf");
            if (!pdfAttachments.length) return null;

            return (
                <ErrorBoundary>
                    {pdfAttachments.map((attachment, index) => (
                        <PdfAttachmentPreview key={index} attachment={attachment} />
                    ))}
                </ErrorBoundary>
            );
        }, -1);
    },

    stop() {
        removeMessageAccessory("pdfViewer");
    },
});
