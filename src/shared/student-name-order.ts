// ترتيب الطلبة أبجدياً بالعربية؛ عند تساوي الاسم يُرتَّب بالرقم الجامعي ليبقى الترتيب ثابتاً.
const arabicNameOrder = new Intl.Collator("ar", { sensitivity: "base", numeric: true });

type NamedStudent = { name?: unknown; id?: unknown; idNumber?: unknown };

export function compareStudentNames(a: NamedStudent, b: NamedStudent): number {
  return (
    arabicNameOrder.compare(String(a.name || "").trim(), String(b.name || "").trim()) ||
    String(a.id || a.idNumber || "").localeCompare(String(b.id || b.idNumber || ""))
  );
}

export function sortStudentsByName<T extends NamedStudent>(rows: readonly T[]): T[] {
  return [...rows].sort(compareStudentNames);
}
