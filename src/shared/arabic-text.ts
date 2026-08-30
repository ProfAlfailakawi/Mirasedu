export const normalizeArabicIndicDigits = (value: any) =>
  String(value ?? "").replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return ch;
  });

export const stripArabicIndicDigitsFromInput = (value: any) =>
  String(value ?? "").replace(/[\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]/g, "");
