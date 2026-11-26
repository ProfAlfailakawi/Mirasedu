/*
 * توزيع درجات نشاط واحد إلى خمس فئات نسبية (عرض فقط، بلا حفظ).
 * يستخدمه «مكتب التصحيح» في لوحة الأستاذ.
 */
export interface DeskScore { id: string; value: number | null; max: number | null }

export const BANDS = [
  { from: 0, to: 0.5, label: 'أقل من ٥٠٪' },
  { from: 0.5, to: 0.65, label: '٥٠–٦٤٪' },
  { from: 0.65, to: 0.8, label: '٦٥–٧٩٪' },
  { from: 0.8, to: 0.9, label: '٨٠–٨٩٪' },
  { from: 0.9, to: 1.0001, label: '٩٠٪ فأكثر' },
];

export const toArabicDigits = (n: number | string) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

export function summarizeScores(scores: DeskScore[], currentId?: string) {
  const counts = BANDS.map(() => 0);
  let graded = 0;
  let sumRatio = 0;
  let currentBand = -1;
  for (const s of scores) {
    if (s.value === null || !Number.isFinite(s.value) || !s.max || !(s.max > 0)) continue;
    const ratio = Math.max(0, Math.min(1, s.value / s.max));
    const band = BANDS.findIndex((b) => ratio >= b.from && ratio < b.to);
    if (band < 0) continue;
    counts[band] += 1;
    graded += 1;
    sumRatio += ratio;
    if (currentId && s.id === currentId) currentBand = band;
  }
  return { counts, graded, total: scores.length, average: graded ? sumRatio / graded : null, currentBand };
}

