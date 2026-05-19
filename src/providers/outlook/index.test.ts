import { describe, it, expect } from "vitest";
import { convertInlineImages } from "./index.js";

describe("convertInlineImages", () => {
  it("transforms a single png data URI into cid: reference + attachment", () => {
    const body =
      '<div><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA"></div>';
    const result = convertInlineImages(body);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].name).toBe("signature-image.png");
    expect(result.attachments[0].contentType).toBe("image/png");
    expect(result.attachments[0].contentId).toMatch(/^sig-img-/);
    expect(result.attachments[0].contentBytes).toBe(
      "iVBORw0KGgoAAAANSUhEUgAAAAUA",
    );
    expect(result.attachments[0].isInline).toBe(true);
    expect(result.attachments[0]["@odata.type"]).toBe(
      "#microsoft.graph.fileAttachment",
    );

    expect(result.body).toBe(
      `<div><img src="cid:${result.attachments[0].contentId}"></div>`,
    );
    expect(result.body).not.toContain("base64");
    expect(result.body).not.toContain("data:image");
  });

  it("handles JPEG data URI", () => {
    const body =
      '<img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA">';
    const result = convertInlineImages(body);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].name).toBe("signature-image.jpeg");
    expect(result.attachments[0].contentType).toBe("image/jpeg");
    expect(result.attachments[0].contentBytes).toBe("/9j/4AAQSkZJRgABAQEA");
  });

  it("returns body unchanged with empty attachments array when no data URIs", () => {
    const body = "<p>Plain HTML, no images</p>";
    const result = convertInlineImages(body);

    expect(result.body).toBe(body);
    expect(result.attachments).toHaveLength(0);
  });

  it("transforms multiple data URIs with unique contentIds", () => {
    const body =
      '<img src="data:image/png;base64,AAA"><img src="data:image/jpeg;base64,BBB">';
    const result = convertInlineImages(body);

    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0].contentId).not.toBe(
      result.attachments[1].contentId,
    );
    expect(result.attachments[0].contentBytes).toBe("AAA");
    expect(result.attachments[1].contentBytes).toBe("BBB");
    expect(result.attachments[0].name).toBe("signature-image.png");
    expect(result.attachments[1].name).toBe("signature-image.jpeg");
  });

  it("skips non-base64 data URIs gracefully (e.g. raw svg)", () => {
    const body =
      '<img src="data:image/svg+xml,<svg></svg>"><img src="data:image/png;base64,CCC">';
    const result = convertInlineImages(body);

    // Only the base64 one should be captured
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].contentBytes).toBe("CCC");
  });

  it("handles SVG+XML base64 correctly", () => {
    const body =
      '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">';
    const result = convertInlineImages(body);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].name).toBe("signature-image.svg");
    expect(result.attachments[0].contentType).toBe("image/svg+xml");
    expect(result.attachments[0].contentBytes).toBe("PHN2Zz48L3N2Zz4=");
  });

  it("handles empty body", () => {
    const result = convertInlineImages("");

    expect(result.body).toBe("");
    expect(result.attachments).toHaveLength(0);
  });

  it("is case-insensitive for both tag attribute and MIME type", () => {
    const body =
      '<IMG SRC="data:image/PNG;base64,DDD">';
    const result = convertInlineImages(body);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].contentBytes).toBe("DDD");
    expect(result.attachments[0].name).toBe("signature-image.png");
  });

  it("preserves surrounding HTML structure", () => {
    const body = [
      '<html><body>',
      '<p>Hello</p>',
      '<div class="signature"><img src="data:image/png;base64,EEE"></div>',
      '<div>Footer</div>',
      '</body></html>',
    ].join("\n");
    const result = convertInlineImages(body);

    expect(result.body).toContain("<p>Hello</p>");
    expect(result.body).toContain('<div class="signature">');
    expect(result.body).toContain("<div>Footer</div>");
    expect(result.attachments).toHaveLength(1);
  });
});
