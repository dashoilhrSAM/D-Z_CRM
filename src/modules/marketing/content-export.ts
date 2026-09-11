// Turning a finished script into one file the operator can hand to whoever posts it.
//
// WHY A FILE AT ALL
//
// The content already lives in the database, but using it meant copying four platform
// captions one at a time, copying the hashtags separately, and downloading the poster on its
// own. Handing that to a person is where mistakes happen — a caption pasted under the wrong
// platform, or a poster attached to the wrong script. One document with everything in it is
// the difference between "here are some files" and a usable handoff.
//
// Pure and separated from the component so the format is testable: the shape of this file is
// the contract with whoever receives it.

export interface ExportInput {
  title: string;
  platform?: string | null;
  language?: string | null;
  hook?: string | null;
  body?: string | null;
  cta?: string | null;
  occasionKey?: string | null;
  generatedAt?: Date | string | null;
  usedAt?: Date | string | null;
  posterUrl?: string | null;
  expanded: {
    versions?: { platform: string; caption: string; note?: string }[];
    hashtags?: string[];
    posterScene?: string;
    posterText?: { headline?: string; sub?: string; productLine?: string; specsLine?: string; cta?: string };
    publishNote?: string;
  } | null;
}

/** YYYY-MM-DD, or "" when there is no usable date. Stored dates are UTC (project convention). */
function day(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * The whole handoff as markdown.
 *
 * Markdown rather than plain text because the receiver is usually pasting into a caption box or
 * a chat: headings survive that, and nothing has to be reformatted by hand.
 */
export function buildExportMarkdown(input: ExportInput): string {
  const out: string[] = [];
  out.push("# " + input.title, "");

  const facts: string[] = [];
  if (input.platform) facts.push("- Platform: " + input.platform);
  if (input.language) facts.push("- Language: " + input.language);
  if (input.occasionKey) facts.push("- Occasion: " + input.occasionKey);
  const generated = day(input.generatedAt);
  if (generated) facts.push("- Generated: " + generated);
  facts.push("- Status: " + (input.usedAt ? "posted " + day(input.usedAt) : "not posted yet"));
  out.push(...facts, "");

  if (input.hook) out.push("**Hook**", "", input.hook, "");
  if (input.body) out.push("**Body**", "", input.body, "");
  if (input.cta) out.push("**Call to action**", "", input.cta, "");

  const versions = input.expanded?.versions ?? [];
  if (versions.length > 0) {
    out.push("## Captions by platform", "");
    for (const v of versions) {
      out.push("### " + v.platform, "", v.caption, "");
      if (v.note) out.push("_Note: " + v.note + "_", "");
    }
  }

  const tags = input.expanded?.hashtags ?? [];
  if (tags.length > 0) out.push("## Hashtags", "", tags.join(" "), "");

  const pt = input.expanded?.posterText;
  if (pt && (pt.headline || pt.sub || pt.productLine || pt.specsLine || pt.cta)) {
    out.push("## Poster text", "");
    if (pt.headline) out.push("- Headline: " + pt.headline);
    if (pt.sub) out.push("- Sub: " + pt.sub);
    if (pt.productLine) out.push("- Product line: " + pt.productLine);
    if (pt.specsLine) out.push("- Specs: " + pt.specsLine);
    if (pt.cta) out.push("- CTA: " + pt.cta);
    out.push("");
  }

  if (input.posterUrl) {
    out.push("## Poster", "", "![poster](" + input.posterUrl + ")", "", "Download: " + input.posterUrl, "");
  }

  if (input.expanded?.posterScene) out.push("## Poster scene", "", input.expanded.posterScene, "");
  if (input.expanded?.publishNote) out.push("## When and how to post", "", input.expanded.publishNote, "");

  // Collapse the blank lines left by the optional sections, so the file does not open with
  // three blank lines and every skipped field leave a gap.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** A filename a human will not have to rename: the title, made safe, plus the date. */
export function exportFilename(title: string, generatedAt?: Date | string | null): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "content";
  const d = day(generatedAt);
  return "dz-content-" + slug + (d ? "-" + d : "") + ".md";
}
