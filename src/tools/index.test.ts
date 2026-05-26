import { describe, it, expect } from "vitest";
import {
  composeBody,
  escapeHtml,
  buildStyleAttr,
  markdownToHtml,
} from "./index.js";

describe("markdownToHtml", () => {
  it("converts bold text", () => {
    const result = markdownToHtml("Hello **world**");
    expect(result).toContain("<strong>world</strong>");
  });

  it("converts italic text", () => {
    const result = markdownToHtml("Hello *world*");
    expect(result).toContain("<em>world</em>");
  });

  it("converts unordered lists", () => {
    const result = markdownToHtml("- item 1\n- item 2");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>item 1</li>");
    expect(result).toContain("<li>item 2</li>");
  });

  it("converts headings", () => {
    const result = markdownToHtml("### Title");
    expect(result).toContain("<h3>Title</h3>");
  });

  it("converts links", () => {
    const result = markdownToHtml("[example](https://example.com)");
    expect(result).toContain(
      '<a href="https://example.com">example</a>',
    );
  });

  it("converts inline code", () => {
    const result = markdownToHtml("use `code` here");
    expect(result).toContain("<code>code</code>");
  });

  it("converts blockquotes", () => {
    const result = markdownToHtml("> quoted text");
    expect(result).toContain("<blockquote>");
    expect(result).toContain("<p>quoted text</p>");
  });

  it("returns empty string for empty input", () => {
    const result = markdownToHtml("");
    expect(result).toBe("");
  });

  it("preserves paragraphs", () => {
    const result = markdownToHtml("Line 1\n\nLine 2");
    expect(result).toContain("<p>Line 1</p>");
    expect(result).toContain("<p>Line 2</p>");
  });
});

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
  describe("html format", () => {
    describe("no signature, no style → pass through", () => {
      it("returns HTML unchanged", () => {
        const result = composeBody({
          body: "<p>Hello world</p>",
          format: "html",
          includeSignature: false,
        });
        expect(result).toEqual({ body: "<p>Hello world</p>", isHtml: true });
      });
    });

    describe("signature injection", () => {
      it("appends HTML signature to HTML body", () => {
        const result = composeBody({
          body: "<p>Hello</p>",
          format: "html",
          signature: "<b>John Doe</b><br>CEO",
          includeSignature: true,
        });
        expect(result.isHtml).toBe(true);
        expect(result.body).toContain("<p>Hello</p>");
        expect(result.body).toContain(
          '<div class="signature"><b>John Doe</b><br>CEO</div>',
        );
      });

      it("skips signature when include_signature is false", () => {
        const result = composeBody({
          body: "<p>Hello</p>",
          format: "html",
          signature: "<b>John</b>",
          includeSignature: false,
        });
        expect(result).toEqual({ body: "<p>Hello</p>", isHtml: true });
      });
    });

    describe("style injection", () => {
      it("wraps HTML body with style div", () => {
        const result = composeBody({
          body: "<p>Hello</p>",
          format: "html",
          style: { fontFamily: "Arial", fontSize: "12pt" },
          includeSignature: false,
        });
        expect(result.isHtml).toBe(true);
        expect(result.body).toBe(
          '<div style="font-family: Arial; font-size: 12pt"><p>Hello</p></div>',
        );
      });

      it("does nothing for empty style", () => {
        const result = composeBody({
          body: "<p>Hello</p>",
          format: "html",
          style: {},
          includeSignature: false,
        });
        expect(result).toEqual({ body: "<p>Hello</p>", isHtml: true });
      });
    });

    describe("combined signature + style", () => {
      it("applies style and appends signature to HTML body", () => {
        const result = composeBody({
          body: "<p>Hello</p>",
          format: "html",
          signature: "<b>John</b>",
          style: { fontFamily: "Arial" },
          includeSignature: true,
        });
        expect(result.isHtml).toBe(true);
        expect(result.body).toContain('style="font-family: Arial"');
        expect(result.body).toContain(
          '<div class="signature"><b>John</b></div>',
        );
      });

      it("applies style only when include_signature is false", () => {
        const result = composeBody({
          body: "<p>Hello</p>",
          format: "html",
          signature: "<b>John</b>",
          style: { fontFamily: "Arial" },
          includeSignature: false,
        });
        expect(result.isHtml).toBe(true);
        expect(result.body).toContain("font-family: Arial");
        expect(result.body).not.toContain("signature");
      });
    });
  });

  describe("markdown format", () => {
    it("converts markdown to HTML when no signature/style", () => {
      const result = composeBody({
        body: "Hello **world**",
        format: "markdown",
        includeSignature: false,
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain("<strong>world</strong>");
    });

    it("converts markdown and appends signature", () => {
      const result = composeBody({
        body: "Hello **world**",
        format: "markdown",
        signature: "<b>John</b>",
        includeSignature: true,
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain("<strong>world</strong>");
      expect(result.body).toContain(
        '<div class="signature"><b>John</b></div>',
      );
    });

    it("converts markdown and wraps with style", () => {
      const result = composeBody({
        body: "Hello *world*",
        format: "markdown",
        style: { fontFamily: "Arial", fontSize: "12pt" },
        includeSignature: false,
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain("font-family: Arial; font-size: 12pt");
      expect(result.body).toContain("<em>world</em>");
    });

    it("converts markdown with style + signature", () => {
      const result = composeBody({
        body: "Hello **world**",
        format: "markdown",
        signature: "<b>John</b>",
        style: { fontFamily: "Arial" },
        includeSignature: true,
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain("<strong>world</strong>");
      expect(result.body).toContain('style="font-family: Arial"');
      expect(result.body).toContain(
        '<div class="signature"><b>John</b></div>',
      );
    });
  });

  describe("edge cases", () => {
    it("handles empty body with signature", () => {
      const result = composeBody({
        body: "",
        format: "html",
        signature: "<b>John</b>",
        includeSignature: true,
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain(
        '<div class="signature"><b>John</b></div>',
      );
    });

    it("handles empty body with markdown format and signature", () => {
      const result = composeBody({
        body: "",
        format: "markdown",
        signature: "<b>John</b>",
        includeSignature: true,
      });
      expect(result.isHtml).toBe(true);
      expect(result.body).toContain(
        '<div class="signature"><b>John</b></div>',
      );
    });

    it("handles empty signature (treated as no signature)", () => {
      const result = composeBody({
        body: "<p>Hello</p>",
        format: "html",
        signature: "",
        includeSignature: true,
      });
      expect(result).toEqual({ body: "<p>Hello</p>", isHtml: true });
    });

    it("passes through unchanged when includeSignature true but signature is undefined", () => {
      const result = composeBody({
        body: "<p>Hello</p>",
        format: "html",
        includeSignature: true,
        // no signature key at all
      });
      expect(result).toEqual({ body: "<p>Hello</p>", isHtml: true });
    });

    it("always returns isHtml: true for html format", () => {
      const result = composeBody({
        body: "<p>Hello</p>",
        format: "html",
        includeSignature: false,
      });
      expect(result.isHtml).toBe(true);
    });

    it("always returns isHtml: true for markdown format", () => {
      const result = composeBody({
        body: "Hello **world**",
        format: "markdown",
        includeSignature: false,
      });
      expect(result.isHtml).toBe(true);
    });
  });
});
