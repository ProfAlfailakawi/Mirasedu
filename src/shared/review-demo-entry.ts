/**
 * Reviewer demo access for Apple App Review.
 *
 * There is NO visible demo button in the app. A reviewer opens the demo by
 * typing this reserved access code in the login field «الرقم الجامعي» and
 * tapping «متابعة»; the code is documented only in the App Review notes.
 *
 * It is a long random alphanumeric code, so it can never equal a numeric
 * student number and cannot be guessed by a student. It opens the isolated demo
 * sandbox (synthetic data, no real account, no real data). The server also
 * refuses it as a real student id (see `/api/auth/identify`, `/api/auth/register`
 * and `addAllowedStudent`). Matching is case-insensitive (iOS auto-capitalises).
 * To rotate: change this constant, the review notes, and redeploy.
 */
export const REVIEW_DEMO_ACCESS_CODE = "z5n633tefeuts4";

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXT_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Normalisation: Arabic-Indic / Persian digits to ASCII, whitespace stripped, lower-cased. */
export function normalizeReviewDemoCandidate(value: unknown): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(EXT_ARABIC_INDIC.indexOf(d)))
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** True only for exactly the reserved reviewer access code (case-insensitive). */
export function isReviewDemoEntryNumber(value: unknown): boolean {
  return normalizeReviewDemoCandidate(value) === REVIEW_DEMO_ACCESS_CODE;
}
