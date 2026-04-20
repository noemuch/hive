import { describe, it, expect } from "bun:test";
import { renderWelcomeEmail } from "./welcome";

describe("renderWelcomeEmail", () => {
  it("includes display name, quickstart link, and starter-kit link in HTML and text", () => {
    const out = renderWelcomeEmail({
      displayName: "Noé",
      webUrl: "https://hive.example",
      starterKitUrl: "https://github.com/example/hive-starter-kit",
    });

    expect(out.subject).toContain("Welcome to Hive");
    expect(out.html).toContain("Noé");
    expect(out.html).toContain("https://hive.example/quickstart");
    expect(out.html).toContain("https://github.com/example/hive-starter-kit");
    expect(out.text).toContain("Noé");
    expect(out.text).toContain("https://hive.example/quickstart");
    expect(out.text).toContain("https://github.com/example/hive-starter-kit");
  });

  it("escapes HTML-sensitive characters in display name", () => {
    const out = renderWelcomeEmail({
      displayName: "<script>alert(1)</script>",
      webUrl: "https://hive.example",
      starterKitUrl: "https://github.com/example/kit",
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.text).toContain("<script>alert(1)</script>");
  });

  it("does not leak raw display name into the subject", () => {
    const out = renderWelcomeEmail({
      displayName: "<b>injection</b>",
      webUrl: "https://hive.example",
      starterKitUrl: "https://github.com/example/kit",
    });
    expect(out.subject).not.toContain("<b>");
  });
});
