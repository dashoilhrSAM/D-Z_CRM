// Reading order for the lines on an invoice.
//
// InvoiceLine has no createdAt, so the database cannot order them for us. What a counter
// needs to read is what was DONE first and what was FITTED afterwards, so the ordering is
// by kind rather than by insertion, and stable inside each kind so the billed order is
// preserved.
//
// These are the invoice's own lines, not the job's. completion.ts copies the accepted job
// items and parts into InvoiceItem at completion time, which makes the invoice a snapshot:
// editing a job later cannot change what was billed, and the lines always add up to the
// total shown beside them.

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPriceSen: number;
  lineTotalSen: number;
  source: string;
}

/** What was done first, what was fitted last. Anything unknown sorts to the end. */
const SOURCE_ORDER: Record<string, number> = { SERVICE: 0, FEE: 1, APPROVAL: 2, PART: 3 };

export function orderInvoiceLines<T extends InvoiceLine>(lines: T[]): T[] {
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const ra = SOURCE_ORDER[a.line.source] ?? 99;
      const rb = SOURCE_ORDER[b.line.source] ?? 99;
      // The index tiebreak is what makes this stable, so same-kind lines keep their order.
      return ra !== rb ? ra - rb : a.index - b.index;
    })
    .map((entry) => entry.line);
}
