import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  imageExtensionForContentType,
  isLocalPanelImageMissing,
  localPanelImageFilename,
  panelImageDisplayUrl,
  panelImageLocalPath,
  resolvePanelImageInput,
  sanitizeImageFilename,
} from "../src/lib/panelImage";

describe("resolvePanelImageInput", () => {
  it("returns null image when nothing is given", () => {
    assert.deepEqual(resolvePanelImageInput(null, undefined), { image: null });
    assert.deepEqual(resolvePanelImageInput(null, "   "), { image: null });
  });

  it("prefers the upload over the URL", () => {
    const res = resolvePanelImageInput(
      { url: "https://cdn.discordapp.com/attachments/a/banner.png", name: "banner.png", contentType: "image/png", size: 100 },
      "https://example.com/other.png",
    );
    assert.equal(res.image?.kind, "attachment");
    assert.match(res.note ?? "", /ignoring `image_url`/);
  });

  it("rejects non-image uploads and oversized files", () => {
    assert.match(
      resolvePanelImageInput({ url: "https://x/y.pdf", contentType: "application/pdf", size: 10 }, null).error ?? "",
      /must be an image/,
    );
    assert.match(
      resolvePanelImageInput({ url: "https://x/y.png", contentType: "image/png", size: 9_000_000 }, null).error ?? "",
      /too large/,
    );
  });

  it("accepts https URLs and rejects junk", () => {
    assert.deepEqual(resolvePanelImageInput(null, "https://example.com/b.png").image, {
      kind: "url",
      url: "https://example.com/b.png",
    });
    assert.match(resolvePanelImageInput(null, "not a url").error ?? "", /must be a direct https link/);
    assert.match(resolvePanelImageInput(null, "ftp://example.com/b.png").error ?? "", /must be a direct https link/);
  });
});

describe("panel image filename helpers", () => {
  it("maps content types to extensions", () => {
    assert.equal(imageExtensionForContentType("image/jpeg"), ".jpg");
    assert.equal(imageExtensionForContentType("IMAGE/WEBP"), ".webp");
    assert.equal(imageExtensionForContentType(null), ".png");
  });

  it("sanitizes names and keeps image extensions", () => {
    assert.equal(sanitizeImageFilename("../../evil.png", "image/png"), "evil.png");
    assert.equal(sanitizeImageFilename("my banner", "image/jpeg"), "my_banner.jpg");
  });

  it("renders local refs as attachment:// URLs", () => {
    assert.equal(panelImageDisplayUrl("local:123-protect-a.png"), "attachment://123-protect-a.png");
    assert.equal(panelImageDisplayUrl("https://example.com/b.png"), "https://example.com/b.png");
    assert.equal(panelImageDisplayUrl(null), null);
  });

  it("resolves local paths safely", () => {
    assert.ok(panelImageLocalPath("local:123-protect-a.png")?.endsWith("123-protect-a.png"));
    assert.equal(panelImageLocalPath("https://example.com/b.png"), null);
    assert.equal(panelImageLocalPath("local:../evil.png"), null);
    assert.equal(localPanelImageFilename("local:abc.png"), "abc.png");
  });

  it("reports missing local files", () => {
    assert.equal(isLocalPanelImageMissing(null), false);
    assert.equal(isLocalPanelImageMissing("https://example.com/b.png"), false);
    assert.equal(isLocalPanelImageMissing("local:does-not-exist-12345.png"), true);
    assert.equal(isLocalPanelImageMissing("local:../evil.png"), true);
  });
});
