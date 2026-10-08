import { normalizeArabicIndicDigits, stripArabicIndicDigitsFromInput, westernizeInputDigits } from "../src/shared/arabic-text.ts";
import { mirasPhoneticSkeleton, mirasPhoneticWordMatch } from "../src/shared/phonetic-search.ts";
import { createReporter } from "./lib.mjs";

const { check, done } = createReporter("FLOWS / ARABIC TEXT");

check("normalizeArabicIndicDigits - handles eastern arabic numerals", normalizeArabicIndicDigits("١٢٣٤٥٦٧٨٩٠") === "1234567890", normalizeArabicIndicDigits("١٢٣٤٥٦٧٨٩٠"));
check("normalizeArabicIndicDigits - handles persian numerals", normalizeArabicIndicDigits("۱۲۳۴۵۶۷۸۹۰") === "1234567890", normalizeArabicIndicDigits("۱۲۳۴۵۶۷۸۹۰"));
check("normalizeArabicIndicDigits - leaves standard alone", normalizeArabicIndicDigits("123") === "123", normalizeArabicIndicDigits("123"));

check("stripArabicIndicDigitsFromInput - removes them completely", stripArabicIndicDigitsFromInput("abc١٢٣def") === "abcdef", stripArabicIndicDigitsFromInput("abc١٢٣def"));

check("westernizeInputDigits - keeps typed numbering as western digits", westernizeInputDigits("١. اذكر ٢٠ مثالاً") === "1. اذكر 20 مثالاً", westernizeInputDigits("١. اذكر ٢٠ مثالاً"));
check("westernizeInputDigits - persian and full-width digits, same length", westernizeInputDigits("۳٤５") === "345" && westernizeInputDigits("أ١ب").length === 3, westernizeInputDigits("۳٤５"));

check("mirasPhoneticSkeleton - handles english text", mirasPhoneticSkeleton("hello") === "hl", mirasPhoneticSkeleton("hello"));
check("mirasPhoneticSkeleton - handles arabic text", mirasPhoneticSkeleton("مرحبا") === "mrhb", mirasPhoneticSkeleton("مرحبا"));

check("mirasPhoneticWordMatch - exact match returns 24", mirasPhoneticWordMatch("مرحبا", "مرحبا") === 24, mirasPhoneticWordMatch("مرحبا", "مرحبا"));
check("mirasPhoneticWordMatch - prefix match returns 18", mirasPhoneticWordMatch("مرح", "مرحبا") === 18, mirasPhoneticWordMatch("مرح", "مرحبا"));
check("mirasPhoneticWordMatch - substring match returns 12", mirasPhoneticWordMatch("رحب", "مرحبا") === 12, mirasPhoneticWordMatch("رحب", "مرحبا"));
check("mirasPhoneticWordMatch - no match returns 0", mirasPhoneticWordMatch("سلام", "مرحبا") === 0, mirasPhoneticWordMatch("سلام", "مرحبا"));
check("mirasPhoneticWordMatch - short query returns 0", mirasPhoneticWordMatch("م", "مرحبا") === 0, mirasPhoneticWordMatch("م", "مرحبا"));

done();
