export const normalizeArabicIndicDigits = (value: any) =>
  String(value ?? "").replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return ch;
  });

export const stripArabicIndicDigitsFromInput = (value: any) =>
  String(value ?? "").replace(/[\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]/g, "");

// Typed Arabic-Indic, Persian and full-width digits become 0-9 in place, so a
// list like "١." in a question or project description is kept as "1.". The
// result has the same length, so the caret position does not move.
export const westernizeInputDigits = (value: any) =>
  String(value ?? "").replace(/[٠-٩۰-۹０-９]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code <= 0x0669) return String(code - 0x0660);
    if (code <= 0x06f9) return String(code - 0x06f0);
    return String(code - 0xff10);
  });
