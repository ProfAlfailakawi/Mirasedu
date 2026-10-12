import test from "node:test";
import assert from "node:assert/strict";
import { sortStudentsByName } from "../src/shared/student-name-order";

test("طالب جديد يدخل مكانه الأبجدي بدل أن يبقى في آخر القائمة", () => {
  const roster = [
    { id: "1", name: "أحمد علي" },
    { id: "2", name: "خالد سعد" },
    { id: "3", name: "يوسف محمد" },
  ];
  const withNew = [...roster, { id: "4", name: "بدر ناصر" }];
  assert.deepEqual(sortStudentsByName(withNew).map((r) => r.name), ["أحمد علي", "بدر ناصر", "خالد سعد", "يوسف محمد"]);
});

test("الأسماء المتساوية تُرتَّب بالرقم وتبقى القائمة الأصلية دون تعديل", () => {
  const rows = [{ id: "20", name: "سالم" }, { id: "10", name: "سالم" }];
  assert.deepEqual(sortStudentsByName(rows).map((r) => r.id), ["10", "20"]);
  assert.equal(rows[0].id, "20");
});
