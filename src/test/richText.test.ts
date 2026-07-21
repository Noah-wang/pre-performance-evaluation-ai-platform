import { describe, expect, it } from "vitest";
import { replacePlainTextInHtml, richTextToPlainText } from "@/lib/richText";

describe("replacePlainTextInHtml", () => {
  it("replaces a selected report paragraph inside rich text html", () => {
    const html = "<h1>一、评估对象</h1><p>原报告段落，需要进一步优化论证。</p><p>其他正文。</p>";

    const result = replacePlainTextInHtml(
      html,
      "原报告段落，需要进一步优化论证。",
      "重写后的报告段落，已经补充事实依据和逻辑说明。",
    );

    expect(result.replaced).toBe(true);
    expect(richTextToPlainText(result.html)).toContain("重写后的报告段落");
    expect(richTextToPlainText(result.html)).not.toContain("原报告段落");
  });

  it("returns unchanged html when the selected paragraph cannot be found", () => {
    const html = "<p>正文内容。</p>";

    const result = replacePlainTextInHtml(html, "不存在的段落", "新段落");

    expect(result.replaced).toBe(false);
    expect(result.html).toBe(html);
  });
});
