import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";

/**
 * Shared helpers for optional banner images on Components v2 panels
 * (/verify setup, /protectroom setup/edit).
 *
 * Two input styles (upload wins when both are given):
 *   - `image`: file uploaded with the slash command (Discord Attachment)
 *   - `image_url`: direct https link to an image
 *
 * Pure module — no DB / discord.js imports so it stays unit-testable.
 */

export const PANEL_IMAGE_MAX_BYTES = 8_000_000; // 8MB — safe ceiling for bot uploads
export const PANEL_IMAGE_URL_MAX_LENGTH = 512;
export const PANEL_IMAGE_DIR = path.join(__dirname, "..", "..", "data", "panel-images");

export type PanelImageAttachmentInput = {
  url: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
} | null | undefined;

export type ResolvedPanelImage =
  | { kind: "attachment"; url: string; filename: string }
  | { kind: "url"; url: string };

export type ResolvePanelImageResult = {
  image: ResolvedPanelImage | null;
  error?: string;
  note?: string;
};

const IMAGE_EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/** Map a MIME type to a file extension (defaults to .png). */
export function imageExtensionForContentType(contentType: string | null | undefined): string {
  if (!contentType) return ".png";
  return IMAGE_EXT_BY_CONTENT_TYPE[contentType.toLowerCase()] ?? ".png";
}

/** Strip path/unsafe chars so the name is safe for attachment:// + disk. */
export function sanitizeImageFilename(
  rawName: string | null | undefined,
  contentType?: string | null,
): string {
  const fallbackExt = imageExtensionForContentType(contentType);
  const base = (rawName ?? "").split(/[\\/]/).pop()?.trim() ?? "";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || `banner${fallbackExt}`;
  if (/\.(png|jpe?g|gif|webp)$/i.test(cleaned)) return cleaned;
  return `${cleaned}${fallbackExt}`;
}

// ─── Persistent storage for long-lived notices ────────────────────────────
// The protect-room notice is edited on every punishment (counter refresh) and
// re-posted if an admin deletes it. A plain Discord CDN `attachment.url` from
// the slash-command upload is a signed URL that can expire, and re-attaching
// the same file on every counter edit would pile duplicate attachments onto
// the message. So uploaded files are downloaded once to PANEL_IMAGE_DIR and
// re-attached from disk only when (re-)posting — counter edits reference the
// already-attached file via `attachment://` without re-uploading.
//
// Stored `imageUrl` formats (single TEXT column, nullable):
//   - null/""            → no banner
//   - "https://..."      → external URL, rendered directly, never needs files
//   - "local:<filename>" → file in PANEL_IMAGE_DIR, rendered as
//                          `attachment://<filename>` + `files` on (re-)post

export const PANEL_IMAGE_LOCAL_PREFIX = "local:";

export function isLocalPanelImageRef(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PANEL_IMAGE_LOCAL_PREFIX);
}

export function localPanelImageFilename(stored: string): string {
  return stored.slice(PANEL_IMAGE_LOCAL_PREFIX.length);
}

/** Display URL for a stored image ref (attachment:// for local files). */
export function panelImageDisplayUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (isLocalPanelImageRef(stored)) {
    const filename = localPanelImageFilename(stored);
    return filename ? `attachment://${filename}` : null;
  }
  return stored;
}

/** Absolute disk path of a local stored ref, or null for URLs / empty. */
export function panelImageLocalPath(stored: string | null | undefined): string | null {
  if (!isLocalPanelImageRef(stored ?? "")) return null;
  const filename = localPanelImageFilename(stored as string);
  // Defense-in-depth: the column should only ever hold sanitized names, but
  // refuse traversal outright so a hand-edited DB can never escape the dir.
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return null;
  }
  return path.join(PANEL_IMAGE_DIR, filename);
}

/**
 * Download an image URL to the local panel-image store and return the stored
 * ref (`local:<filename>`). Throws with a user-friendly message on failure.
 */
export async function persistPanelImageFromUrl(
  sourceUrl: string,
  suggestedName: string | null | undefined,
  opts: { contentType?: string | null; scope: string } = { scope: "panel" },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(sourceUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") ?? opts.contentType ?? undefined;
    if (contentType && !contentType.toLowerCase().startsWith("image/")) {
      throw new Error("not an image");
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > PANEL_IMAGE_MAX_BYTES) {
      throw new Error(buf.length === 0 ? "empty file" : "too large (max 8MB)");
    }
    fs.mkdirSync(PANEL_IMAGE_DIR, { recursive: true });
    const filename = `${Date.now()}-${opts.scope}-${sanitizeImageFilename(
      suggestedName,
      contentType,
    )}`.slice(0, 80);
    fs.writeFileSync(path.join(PANEL_IMAGE_DIR, filename), buf);
    return `${PANEL_IMAGE_LOCAL_PREFIX}${filename}`;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("❌ Downloading the image timed out, please try again");
    if (e?.message === "not an image") throw new Error("❌ The uploaded file is not an image");
    if (e?.message === "too large (max 8MB)") throw new Error("❌ `image` is too large — max 8MB");
    throw new Error("❌ Could not download the uploaded image, please try again");
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort delete of a stored local image file (no-op for URLs / empty). */
export function deleteLocalPanelImage(stored: string | null | undefined): void {
  try {
    const filePath = panelImageLocalPath(stored);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // cleanup must never break the command flow
  }
}

/**
 * Files payload for (re-)posting a message that uses a local stored image.
 * Returns [] for external URLs (rendered directly) or when the file is gone.
 */
export function panelImageFilesForPost(stored: string | null | undefined): { attachment: string; name: string }[] {
  const filePath = panelImageLocalPath(stored);
  if (!filePath || !fs.existsSync(filePath)) return [];
  const filename = localPanelImageFilename(stored as string);
  return [{ attachment: filePath, name: filename }];
}

/** True when a stored local image is referenced but its file is missing. */
export function isLocalPanelImageMissing(stored: string | null | undefined): boolean {
  if (!isLocalPanelImageRef(stored ?? "")) return false;
  const filePath = panelImageLocalPath(stored);
  if (!filePath) return true;
  return !fs.existsSync(filePath);
}


/**
 * Resolve the `image` / `image_url` slash options into a single image source.
 * Returns `{ image: null }` when neither is given, or `{ error }` with a
 * user-facing message when the input is invalid.
 */
export function resolvePanelImageInput(
  attachment: PanelImageAttachmentInput,
  imageUrl: string | null | undefined,
): ResolvePanelImageResult {
  if (attachment) {
    if (!attachment.contentType?.toLowerCase().startsWith("image/")) {
      return { image: null, error: "❌ `image` must be an image file (PNG, JPG, GIF or WEBP)" };
    }
    if (typeof attachment.size === "number" && attachment.size > PANEL_IMAGE_MAX_BYTES) {
      return { image: null, error: "❌ `image` is too large — max 8MB" };
    }
    if (!attachment.url || !/^https?:\/\//i.test(attachment.url)) {
      return { image: null, error: "❌ Could not read the uploaded image, please try uploading again" };
    }
    return {
      image: {
        kind: "attachment",
        url: attachment.url,
        filename: sanitizeImageFilename(attachment.name, attachment.contentType),
      },
      note: imageUrl?.trim() ? "ℹ️ Using the uploaded `image` (ignoring `image_url`)" : undefined,
    };
  }

  const trimmed = imageUrl?.trim() ?? "";
  if (!trimmed) return { image: null };
  if (trimmed.length > PANEL_IMAGE_URL_MAX_LENGTH || !/^https?:\/\/\S+$/i.test(trimmed)) {
    return {
      image: null,
      error: "❌ `image_url` must be a direct https link to an image (e.g. https://example.com/banner.png)",
    };
  }
  return { image: { kind: "url", url: trimmed } };
}
