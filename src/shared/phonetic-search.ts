// Extracted verbatim from the root App.tsx monolith as the seed of the
// feature-module structure (see JULES_TASK_refactor-app-monolith.md).
// Pure, side-effect-free Arabic/Latin phonetic-matching helpers used by the
// smart-search engine. Behavior is unchanged — this is a cut/paste + import.
//
// NOTE: root App.tsx is periodically re-uploaded from Google AI Studio, which
// owns that file. Keep these helpers importable and stable; a re-upload that
// reinlines them simply leaves this module unused, never broken.

export const MIRAS_AR2LAT: Record<string, string> = {
  "ا": "a", "أ": "a", "إ": "a", "آ": "a", "ى": "a", "ء": "", "ئ": "y", "ؤ": "w",
  "ب": "b", "ت": "t", "ث": "T", "ج": "j", "ح": "h", "خ": "K", "د": "d", "ذ": "T",
  "ر": "r", "ز": "z", "س": "s", "ش": "S", "ص": "s", "ض": "d", "ط": "t", "ظ": "z",
  "ع": "a", "غ": "G", "ف": "f", "ق": "g", "ك": "k", "ل": "l", "م": "m", "ن": "n",
  "ه": "h", "ة": "", "و": "w", "ي": "y",
};
export const mirasPhoneticSkeleton = (value: any): string => {
  let s = String(value || "")
    .toLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g, "");
  s = s
    .replace(/kh/g, "K")
    .replace(/gh/g, "G")
    .replace(/sh/g, "S")
    .replace(/th/g, "T")
    .replace(/ph/g, "f")
    .replace(/ou|oo/g, "u")
    .replace(/ee/g, "i")
    .replace(/q/g, "g")
    .replace(/c/g, "k")
    .replace(/p/g, "b")
    .replace(/v/g, "f")
    .replace(/e/g, "i")
    .replace(/o/g, "u");
  s = s
    .split("")
    .map((ch) => (MIRAS_AR2LAT[ch] !== undefined ? MIRAS_AR2LAT[ch] : ch))
    .join("");
  s = s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  s = s.replace(/[aiouwy]/g, "").replace(/(.)\1+/g, "$1");
  return s;
};
// مطابقة صوتية بين كلمتين: هيكلاهما يتضمّن أحدهما الآخر (بحد أدنى حرفين).
export const mirasPhoneticWordMatch = (queryWord: string, textWord: string): number => {
  const qs = mirasPhoneticSkeleton(queryWord);
  if (qs.length < 2) return 0;
  const ts = mirasPhoneticSkeleton(textWord);
  if (ts.length < 2) return 0;
  if (qs === ts) return 24;
  if (ts.startsWith(qs) || qs.startsWith(ts)) return 18;
  if (ts.includes(qs) || qs.includes(ts)) return 12;
  return 0;
};
