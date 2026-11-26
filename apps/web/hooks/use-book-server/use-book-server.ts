"use client";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MAX_PAGE_BYTES, refused, type BookReply, type BookSource } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import type { RenderPage } from "@/hooks/use-table/use-table";
import { fitPage, pdfPage } from "@/lib/book-page/book-page";

import { JPEG_QUALITY, PAGE_WIDTH_PX } from "./constants";

type ServeBooks = (next: { sources: BookSource[]; render: RenderPage } | null) => void;
type UseBookServerArgs = { serveBooks: ServeBooks; sources: Ruleset["sources"] };

// The device's own PDFs of the room's sources, picked here and held in this tab's memory only: nothing is uploaded
// (docs/adr/0002-books-never-reach-the-server.md). While `serving`, a seat's tap on a cite reaches `render` through
// the api's relay and gets back a JPEG of that one page. After Auspex's use-book-server.
// ponytail: files are picked again after a reload, keep File handles in IndexedDB (or OPFS) if that gets tedious
export function useBookServer({ serveBooks, sources }: UseBookServerArgs) {
  const [files, setFiles] = useState<Partial<Record<BookSource, File>>>({});
  const [serving, setServing] = useState(false);
  const [served, setServed] = useState(0);
  // What `render` reads (a socket callback, outside render): each picked file, parsed once on its first request.
  const books = useRef(new Map<BookSource, { file: File; task?: Promise<PDFDocumentLoadingTask> }>());

  const render: RenderPage = useCallback(
    async (p) => {
      const book = books.current.get(p.source);
      if (!book) return refused("bookNotServed");
      book.task ??= openDoc(book.file);
      let doc: PDFDocumentProxy;
      try {
        doc = await (await book.task).promise;
      } catch {
        book.task = undefined; // not a PDF pdf.js reads; the GM can pick another file
        return refused("bookUnreadable");
      }
      const n = pdfPage({ page: p, sources });
      if (n < 1 || n > doc.numPages) return refused("bookNoPage", { page: p.page });
      const reply = await renderPage(doc, n);
      if (reply.ok) setServed((c) => c + 1);
      return reply;
    },
    [sources],
  );

  // External system: the table socket. Tells the api which of the room's sources this device serves, or none.
  useEffect(() => {
    const ids = sources.map((s) => s.id).filter((id) => files[id]);
    serveBooks(serving && ids.length ? { sources: ids, render } : null);
  }, [files, serving, render, serveBooks, sources]);
  // External system: the table socket and pdf.js's worker. Leaving the app stops serving and lets the parsed books go.
  // Apart from the effect above, so picking another book never tells the table "none" first.
  useEffect(() => {
    const open = books.current;
    return () => {
      serveBooks(null);
      for (const book of open.values()) {
        void closeDoc(book.task);
        book.task = undefined;
      }
    };
  }, [serveBooks]);

  // Picks a source's file, or removes it (null); a replaced book's parsed document is freed.
  const pick = useCallback((source: BookSource, file: File | null) => {
    void closeDoc(books.current.get(source)?.task);
    if (file) books.current.set(source, { file });
    else books.current.delete(source);
    setFiles((f) => ({ ...f, [source]: file ?? undefined }));
  }, []);

  return useMemo(() => ({ files, pick, serving, setServing, served }), [files, pick, serving, served]);
}
export type BookServer = ReturnType<typeof useBookServer>;

// Frees a parsed PDF. One that never opened has nothing to free.
async function closeDoc(task: Promise<PDFDocumentLoadingTask> | undefined) {
  try {
    await (await task)?.destroy();
  } catch {
    // It failed to load, so there is nothing to destroy.
  }
}

async function openDoc(file: File) {
  const pdfjs = await pdfjsLib();
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
}

// Draws page `n` at PAGE_WIDTH_PX and sends the best JPEG that fits the relay's limit.
async function renderPage(doc: PDFDocumentProxy, n: number): Promise<BookReply> {
  const page = await doc.getPage(n);
  try {
    const viewport = page.getViewport({ scale: PAGE_WIDTH_PX / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await fitPage({
      encode: (q) => new Promise((done) => canvas.toBlob(done, "image/jpeg", q)),
      qualities: JPEG_QUALITY,
      max: MAX_PAGE_BYTES,
    });
    return blob ? { ok: true, image: await blob.arrayBuffer() } : refused("bookPageTooLarge");
  } finally {
    page.cleanup();
  }
}

// pdf.js loads only on a serving device, and only once a page is asked for, so no phone's bundle carries it. Only a
// loaded module is kept: a failed chunk load (a signal blip) is tried again on the next request.
let lib: typeof import("pdfjs-dist") | null = null;
async function pdfjsLib() {
  if (lib) return lib;
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerPort ??= new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), {
    type: "module",
  });
  lib = pdfjs;
  return pdfjs;
}
