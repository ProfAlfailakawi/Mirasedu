/**
 * Reviewer demo access for Apple App Review.
 *
 * There is NO visible demo button in the app. A reviewer opens the demo by
 * typing this reserved university number in the login field and tapping
 * «متابعة»; the number is documented in the App Review notes of every release.
 *
 * The number is not a secret: it opens the isolated demo sandbox (synthetic
 * data, no real account, no real data). The server refuses to ever register it
 * as a real student (see `src/server/db.ts` `addAllowedStudent`, `/api/auth/register`
 * and `/api/auth/identify`), so it can never collide with a real student.
 */
export const REVIEW_DEMO_STUDENT_ID = "9999999999";

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXT_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Digits-only normalisation (Arabic-Indic / Persian digits, whitespace stripped). */
export function normalizeReviewDemoCandidate(value: unknown): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(EXT_ARABIC_INDIC.indexOf(d)))
    .replace(/\s+/g, "");
}

/** True only for exactly the reserved reviewer number. */
export function isReviewDemoEntryNumber(value: unknown): boolean {
  return normalizeReviewDemoCandidate(value) === REVIEW_DEMO_STUDENT_ID;
}
