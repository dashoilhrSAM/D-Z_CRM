// The exported file is a contract with whoever receives it, so its shape is pinned here.
import { describe, expect, it } from "vitest";
import { buildExportMarkdown, exportFilename, type ExportInput } from "@/modules/marketing/content-export";

const full: ExportInput = {
  title: "Elak clutch slip",
  platform: "TIKTOK",
  language: "ms",
  hook: "Clutch basah selamat?",
  body: "Guna minyak JASO MA2.",
  cta: "WhatsApp kami",
  occasionKey: "HARI_MALAYSIA",
  generatedAt: "2026-09-11T03:00:00.000Z",
  usedAt: null,
  posterUrl: "/api/storage/x.png",
  expanded: {
    versions: [
      { platform: "TIKTOK", caption: "Caption tiktok", note: "15s" },
      { platform: "INSTAGRAM", caption: "Caption ig" },
    ],
    hashtags: ["#dashoil", "#servis"],
    posterScene: "workshop bench",
    posterText: { headline: "Elak Clutch Slip", sub: "JASO MA2", productLine: "E1300+", specsLine: "10W40", cta: "D&Z" },
    publishNote: "Post before the long weekend",
  },
};

describe("buildExportMarkdown", () => {
  it("puts every caption in its own labelled section", () => {
    const md = buildExportMarkdown(full);
    expect(md).toContain("## Captions by platform");
    expect(md).toContain("### TIKTOK");
    expect(md).toContain("### INSTAGRAM");
    expect(md).toContain("Caption tiktok");
    expect(md).toContain("Caption ig");
  });

  /**
   * The receiver has to be able to tell which caption belongs to which platform without
   * guessing — pasting the wrong caption under the wrong platform is the mistake this file
   * exists to prevent.
   */
  it("keeps a caption under its own platform heading", () => {
    const md = buildExportMarkdown(full);
    const ig = md.indexOf("### INSTAGRAM");
    expect(md.indexOf("Caption ig")).toBeGreaterThan(ig);
    expect(md.indexOf("Caption tiktok")).toBeLessThan(ig);
  });

  it("includes the hashtags, poster text and publishing note", () => {
    const md = buildExportMarkdown(full);
    expect(md).toContain("#dashoil #servis");
    expect(md).toContain("- Headline: Elak Clutch Slip");
    expect(md).toContain("- Specs: 10W40");
    expect(md).toContain("Post before the long weekend");
  });

  it("links the poster and gives the download path", () => {
    const md = buildExportMarkdown(full);
    expect(md).toContain("![poster](/api/storage/x.png)");
    expect(md).toContain("Download: /api/storage/x.png");
  });

  it("says whether it has been posted, so a file in a folder is not ambiguous", () => {
    expect(buildExportMarkdown(full)).toContain("- Status: not posted yet");
    expect(buildExportMarkdown({ ...full, usedAt: "2026-09-12T00:00:00.000Z" })).toContain("- Status: posted 2026-09-12");
  });

  it("omits sections it has nothing to say about rather than leaving empty headings", () => {
    const md = buildExportMarkdown({ title: "Bare", expanded: null });
    expect(md).toContain("# Bare");
    expect(md).not.toContain("## Captions by platform");
    expect(md).not.toContain("## Hashtags");
    expect(md).not.toContain("## Poster");
    expect(md).not.toContain("## Poster text");
  });

  it("does not open with a run of blank lines when fields are missing", () => {
    const md = buildExportMarkdown({ title: "Bare", expanded: null });
    expect(md.startsWith("# Bare\n")).toBe(true);
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("ends with exactly one newline, so the file does not look truncated", () => {
    const md = buildExportMarkdown(full);
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });

  it("survives an unparseable date instead of printing Invalid Date", () => {
    const md = buildExportMarkdown({ ...full, generatedAt: "not a date" });
    expect(md).not.toContain("Invalid Date");
  });
});

describe("exportFilename", () => {
  it("is a slug plus the date, so a folder of them sorts sensibly", () => {
    expect(exportFilename("Elak Clutch Slip!", "2026-09-11T00:00:00.000Z")).toBe("dz-content-elak-clutch-slip-2026-09-11.md");
  });

  it("never produces a name that a filesystem would object to", () => {
    const name = exportFilename("///???", null);
    expect(name).toMatch(/^[a-z0-9.-]+$/);
    expect(name.endsWith(".md")).toBe(true);
  });

  it("falls back to a usable name when the title is only punctuation", () => {
    expect(exportFilename("!!!", null)).toBe("dz-content-content.md");
  });
});
