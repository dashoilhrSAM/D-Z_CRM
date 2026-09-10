// Verify that a generated poster actually contains the words it was asked to render.
//
// Letting the image model set the typography was a large quality win, but it moved a risk
// that did not exist before: the model now writes the copy, and nothing in the pipeline
// could tell a correctly spelled poster from one with a subtly wrong word. A rendered
// "Cuti Lancer" instead of "Cuti Lancar" is invisible to code and obvious to a customer.
//
// So the poster is read back and compared against the text it was briefed with. A
// misspelling surfaces as a missing word, because the expected word is not there.
import { aiProvider } from "@/providers";
import { AiError } from "@/providers/types";

/** Lowercase and keep only letters and digits, so punctuation never causes a mismatch. */
export function normaliseWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Split into comparable words, dropping anything too short to be meaningful. */
export function words(text: string): string[] {
  return text.split(/\s+/).map(normaliseWord).filter((w) => w.length >= 3);
}

export interface TextComparison {
  /** Expected words that are absent from the transcription. */
  missing: string[];
  /** Words present in the transcription that were not expected (may legitimately be
   *  product-label text, so this is advisory only). */
  unexpected: string[];
  /** True when every expected word was found. */
  ok: boolean;
}

/**
 * Compare transcribed poster text against what was briefed.
 *
 * Pure, so the matching rules are testable without generating an image.
 */
export function comparePosterText(transcribed: string, expectedLines: string[]): TextComparison {
  const found = new Set(words(transcribed));
  const expectedWords = [...new Set(expectedLines.flatMap(words))];
  const missing = expectedWords.filter((w) => !found.has(w));

  // Advisory: words the model added. Excluding the ones we asked for keeps this quiet for
  // legitimate extras such as the product label, which we deliberately did not brief.
  const expectedSet = new Set(expectedWords);
  const unexpected = [...found].filter((w) => !expectedSet.has(w)).slice(0, 40);

  return { missing, unexpected, ok: missing.length === 0 };
}

export interface VerificationResult extends TextComparison {
  /** The raw transcription, kept so a human can see what the poster actually says. */
  transcribed: string;
  /** Populated when the read itself failed, which is not the same as a bad poster. */
  readError?: string;
}

const TRANSCRIBE_PROMPT =
  "Transcribe every piece of text visible in this image, exactly as printed, including small text and text on any product packaging. " +
  "Output only the transcription, one line per piece of text. Do not describe the image, do not translate, do not correct spelling.";

/**
 * Read the poster back and check it. A failed read is reported as readError rather than
 * as a passing result — an unreadable poster must not look verified.
 */
export async function verifyPosterText(image: Buffer, expectedLines: string[]): Promise<VerificationResult> {
  let transcribed = "";
  try {
    transcribed = await aiProvider.chatVision(image, TRANSCRIBE_PROMPT, { maxTokens: 700 });
  } catch (e) {
    return {
      missing: [], unexpected: [], ok: false, transcribed: "",
      readError: e instanceof AiError ? e.message : String(e),
    };
  }
  return { ...comparePosterText(transcribed, expectedLines), transcribed };
}
