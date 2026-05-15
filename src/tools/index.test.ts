import { describe, it, expect } from "vitest";
import { composeBody, escapeHtml, buildStyleAttr } from "./index.js";

describe("escapeHtml", () => {
  it("escapes HTML special chars", () => {
    expect(escapeHtml('<script>alert("hi")</script>')).toBe(
      "&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt;",
    );
  });

  it("replaces newlines with <br>", () => {
    expect(escapeHtml("line 1\nline 2\n\nline 3")).toBe(
      "line 1<br>line 2<br><br>line 3",
    );
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("A & B")).toBe("A &amp; B");
  });

  it("returns empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("buildStyleAttr", () => {
  it("builds single property", () => {
    expect(buildStyleAttr({ fontFamily: "Arial" })).toBe("font-family: Arial");
  });

  it("builds multiple properties", () => {
    expect(
      buildStyleAttr({
        fontFamily: "Arial",
        fontSize: "12pt",
        fontColor: "#333333",
      }),
    ).toBe("font-family: Arial; font-size: 12pt; color: #333333");
  });

  it("returns empty string for empty style", () => {
    expect(buildStyleAttr({})).toBe("");
  });

  it("skips falsy values", () => {
    expect(buildStyleAttr({ fontFamily: "", fontSize: "12pt" })).toBe(
      "font-size: 12pt",
    );
  });
});

describe("composeBody", () => {
  describe("no signature, no style → pass through", () => {
    it("returns plain text unchanged", () => {
      const result = composeBody({
        body: "Hello world",
        isHtml: false,
      });
      expect(result).toEqual({ body: "Hello world", isHtml: false });
    });

    it("returns HTML unchanged", () => {
      const result = composeBody({
        body: "<p>Hello world</p>",
        isHtml: true,
      });
      expect(result).toEqual({ body: "<p>Hello world</p>", isHtml: true });
    });
  });

  describe("signature injection", () => {
    it("appends HTML signature to HTML body", () => {
      const result = composeBody({
        body: "<p>Hello</p>",
        isHtml: true,
        signature: "<b>John Doe</b><br>CEO",
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain("<p>Hello</p>");
      expect(result.body).toContain(
        '<div class="signature"><b>John Doe</b><br>CEO</div>',
      );
    });

    it("auto-upgrades text body to HTML when signature exists", () => {
      const result = composeBody({
        body: "Hello world",
        isHtml: false,
        signature: "<b>John</b>",
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain("Hello world"); // escaped
      expect(result.body).toContain('<div class="signature"><b>John</b></div>');
    });

    it("respects remove_signature", () => {
      const result = composeBody({
        body: "<p>Hello</p>",
        isHtml: true,
        signature: "<b>John</b>",
        removeSignature: true,
      });
      expect(result).toEqual({ body: "<p>Hello</p>", isHtml: true });
    });

    it("stays text when remove_signature and no style", () => {
      const result = composeBody({
        body: "Hello",
        isHtml: false,
        signature: "<b>John</b>",
        removeSignature: true,
      });
      expect(result).toEqual({ body: "Hello", isHtml: false });
    });
  });

  describe("style injection", () => {
    it("wraps HTML body with style div", () => {
      const result = composeBody({
        body: "<p>Hello</p>",
        isHtml: true,
        style: { fontFamily: "Arial", fontSize: "12pt" },
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toBe(
        '<div style="font-family: Arial; font-size: 12pt"><p>Hello</p></div>',
      );
    });

    it("auto-upgrades text body to HTML with style", () => {
      const result = composeBody({
        body: "Hello world",
        isHtml: false,
        style: { fontFamily: "Arial", fontSize: "12pt" },
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain("Hello world");
      expect(result.body).toContain("font-family: Arial");
    });

    it("does nothing for empty style", () => {
      const result = composeBody({
        body: "<p>Hello</p>",
        isHtml: true,
        style: {},
      });
      expect(result).toEqual({ body: "<p>Hello</p>", isHtml: true });
    });
  });

  describe("combined signature + style", () => {
    it("applies style and appends signature to HTML body", () => {
      const result = composeBody({
        body: "<p>Hello</p>",
        isHtml: true,
        signature: "<b>John</b>",
        style: { fontFamily: "Arial" },
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain('style="font-family: Arial"');
      expect(result.body).toContain('<div class="signature"><b>John</b></div>');
    });

    it("applies style and appends signature to text body (auto-upgrade)", () => {
      const result = composeBody({
        body: "Hello world",
        isHtml: false,
        signature: "<b>John</b>",
        style: { fontFamily: "Arial" },
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain("Hello world");
      expect(result.body).toContain('style="font-family: Arial"');
      expect(result.body).toContain('<div class="signature"><b>John</b></div>');
    });

    it("applies style only when remove_signature is true", () => {
      const result = composeBody({
        body: "<p>Hello</p>",
        isHtml: true,
        signature: "<b>John</b>",
        style: { fontFamily: "Arial" },
        removeSignature: true,
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain("font-family: Arial");
      expect(result.body).not.toContain("signature");
    });
  });

  describe("edge cases", () => {
    it("handles empty body with signature", () => {
      const result = composeBody({
        body: "",
        isHtml: false,
        signature: "<b>John</b>",
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain('<div class="signature"><b>John</b></div>');
    });

    it("handles empty signature (treated as no signature)", () => {
      const result = composeBody({
        body: "<p>Hello</p>",
        isHtml: true,
        signature: "",
      });
      expect(result).toEqual({ body: "<p>Hello</p>", isHtml: true });
    });

    it("handles text body with newlines auto-upgraded", () => {
      const result = composeBody({
        body: "Line 1\nLine 2",
        isHtml: false,
        signature: "<b>Sig</b>",
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain("Line 1<br>Line 2");
      expect(result.body).toContain('<div class="signature"><b>Sig</b></div>');
    });
  });
});
