// The lines a counter reads on the invoice list come from the invoice, not the job.
//
// Two things are worth pinning here. The order, because InvoiceItem has no createdAt and
// the database cannot supply one — the reading order is decided in code. And the source,
// because showing the job's lines instead would drift from the invoice total the moment
// someone edited the job after it was billed.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { orderInvoiceLines, type InvoiceLine } from "@/lib/invoice-lines";

const line = (id: string, source: string): InvoiceLine => ({
  id, description: "line " + id, quantity: 1, unitPriceSen: 1000, lineTotalSen: 1000, source,
});

describe("orderInvoiceLines", () => {
  it("reads work done before parts fitted", () => {
    const out = orderInvoiceLines([line("p1", "PART"), line("s1", "SERVICE")]);
    expect(out.map((l) => l.id)).toEqual(["s1", "p1"]);
  });

  it("keeps the full reading order: service, fee, approval, part", () => {
    const out = orderInvoiceLines([line("d", "PART"), line("c", "APPROVAL"), line("b", "FEE"), line("a", "SERVICE")]);
    expect(out.map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
  });

  /**
   * No createdAt means no natural sort key, so same-kind lines have to keep the order they
   * were billed in. Sorting without the index tiebreak would be free to shuffle them.
   */
  it("keeps the billed order within a kind", () => {
    const out = orderInvoiceLines([line("s1", "SERVICE"), line("s2", "SERVICE"), line("s3", "SERVICE")]);
    expect(out.map((l) => l.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("does not mutate the input", () => {
    const input = [line("p1", "PART"), line("s1", "SERVICE")];
    orderInvoiceLines(input);
    expect(input.map((l) => l.id)).toEqual(["p1", "s1"]);
  });

  it("puts an unknown kind last rather than dropping it", () => {
    const out = orderInvoiceLines([line("x", "SOMETHING_NEW"), line("s1", "SERVICE")]);
    expect(out.map((l) => l.id)).toEqual(["s1", "x"]);
  });

  it("handles an invoice with no lines", () => {
    expect(orderInvoiceLines([])).toEqual([]);
  });
});

describe("the invoice list reads the invoice, not the job", () => {
  /**
   * completion.ts copies the accepted job items and parts into InvoiceItem at completion,
   * so the invoice is a snapshot. Reading the live job instead would show lines that no
   * longer add up to the total printed beside them.
   */
  it("completion.ts still snapshots the job lines onto the invoice", () => {
    const src = readFileSync(path.join(process.cwd(), "src/services/completion.ts"), "utf8");
    expect(src).toMatch(/invoiceItem\.create/);
  });

  it("the invoices page loads the invoice items for the disclosure", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/workshop/finance/invoices/page.tsx"), "utf8");
    expect(src).toContain("items: true");
    expect(src).toContain("orderInvoiceLines(inv.items)");
  });
});
