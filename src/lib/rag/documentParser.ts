/**
 * Document parser supporting PDF, DOCX, plain text, and URL content.
 * Used by the Playbooks UI to extract text before chunking into the knowledge base.
 */

import { invoke } from '@tauri-apps/api/core';

// G14 (client mirror of Rust URL_ALLOWLIST in src-tauri/src/commands.rs).
// Used as a fallback when the `validate_remote_url` Tauri command is not registered
// (the Rust command is currently behind a TODO and not wired into the invoke_handler).
const CLIENT_URL_ALLOWLIST: readonly string[] = [
  'https://drive.google.com/',
  'https://docs.google.com/',
  'https://api.zoom.us/',
  'https://zoom.us/',
  'https://teams.microsoft.com/',
  'https://meet.google.com/',
  'https://api.atlassian.com/',
  'https://api.notion.com/',
  'https://api.linear.app/',
  'https://api.github.com/',
];

function clientValidate(url: string): boolean {
  return url.startsWith('https://') && CLIENT_URL_ALLOWLIST.some((p) => url.startsWith(p));
}

async function validateUrl(url: string): Promise<void> {
  // Prefer Rust validation (canonical source of truth); fall back to client list
  // if the command is unavailable (e.g. running outside Tauri or not yet registered).
  try {
    await invoke('validate_remote_url', { url });
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Heuristic: if the command isn't registered Tauri returns a "command not found"-style
    // error; in that case we fall back to client validation. Otherwise the Rust validator
    // rejected the URL and we must surface that.
    if (/not found|unknown command|command .* not/i.test(msg)) {
      if (!clientValidate(url)) {
        throw new Error(`URL host not in allowlist: ${url}`);
      }
      return;
    }
    throw new Error(msg);
  }
}

export async function parsePdf(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    // G15: pdfjs-dist v4+ runs document parsing inside a dedicated Web Worker
    // when GlobalWorkerOptions.workerSrc points at the bundled worker module.
    // Vite resolves the URL below at build time and serves the worker as a
    // separate chunk, so PDF parsing executes off the main thread.
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.mjs',
      import.meta.url,
    ).toString();

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const textParts: string[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      textParts.push(pageText);
    }

    return textParts.join('\n\n');
  } catch (e) {
    throw new Error(`PDF parsing failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function parseDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } catch (e) {
    throw new Error(`DOCX parsing failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function parseUrl(url: string): Promise<string> {
  // G14: validate URL against the allowlist (Rust canonical, client fallback)
  // BEFORE issuing any network request.
  await validateUrl(url);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    // Strip HTML tags and collapse whitespace
    const stripped = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped;
  } catch (e) {
    throw new Error(`URL parsing failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function parsePlainText(text: string): string {
  return text.trim();
}
