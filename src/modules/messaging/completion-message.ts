// The WhatsApp a rider gets when the bike is ready.
//
// WHY THIS IS ITS OWN MODULE: the amount in this message has to be the amount the invoice
// shows. It used to be built inline from the invoice *subtotal*, so a job with a promotional
// discount told the customer to pay RM165 while the invoice — and the rider app — said
// RM148.50. Keeping the copy in one pure function means the number, the wording and the
// formatter (the same formatRM the app uses) can be tested without a database.
import { formatRM } from "@/lib/money";

export interface CompletionMessageInput {
  /** Customer's full name — only the first word is used in the greeting. */
  customerName: string;
  /** What the customer owes: invoice.totalSen, after the promotional discount. */
  totalSen: number;
  /** The discount already taken off, quoted so a lower-than-expected number is explained. */
  discountSen?: number;
}

export function completionMessage(input: CompletionMessageInput): string {
  const firstName = input.customerName.split(" ")[0];
  const discountSen = input.discountSen ?? 0;
  const saved = discountSen > 0 ? " (diskaun " + formatRM(discountSen) + ")" : "";
  return (
    "Hi " + firstName + ", motosikal awak dah siap! Total " + formatRM(input.totalSen) + saved +
    ". Terima kasih — D&Z Smart Workshop."
  );
}
