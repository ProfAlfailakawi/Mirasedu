import { useEffect, useState } from "react";

// قائمة طلبات حذف الحساب المعلّقة للسوبر أدمن (قراءة فقط). الطلب سجلٌ مضاف لا يمسّ
// أي سجل أكاديمي، ويعالجه المالك خلال ٣٠ يوماً (apple-release/review/account-deletion.md).
type DeletionRequest = {
  id: string;
  userId: string;
  role: string;
  requested_at: string;
  status: string;
};

const ROLE_LABEL: Record<string, string> = {
  student: "طالب",
  teacher: "أستاذ",
  admin: "سوبر أدمن",
};

export default function AccountDeletionRequestsAdmin({
  headers,
}: {
  headers: () => Record<string, string>;
}) {
  const [items, setItems] = useState<DeletionRequest[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/monitor/account-deletion-requests", {
          cache: "no-store",
          headers: headers(),
        });
        const data = await resp.json().catch(() => ({}));
        if (!cancelled) {
          setItems(resp.ok && Array.isArray(data?.items) ? data.items : []);
        }
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = (items || []).filter((item) => item.status === "pending");
  return (
    <div
      dir="rtl"
      className="rounded-[var(--miras-r-xl)] border border-rose-100 bg-white p-6 text-right shadow-sm space-y-3"
    >
      <h3 className="text-sm font-bold text-slate-900">
        طلبات حذف الحساب المعلّقة ({pending.length})
      </h3>
      <p className="text-[11px] font-bold leading-5 text-slate-500">
        تُعالَج خلال 30 يومًا من تاريخ الطلب.
      </p>
      {items === null ? null : pending.length === 0 ? (
        <p className="text-xs font-bold text-slate-400">لا توجد طلبات معلّقة.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {pending.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs font-bold text-slate-700"
            >
              <span dir="ltr" className="font-mono">
                {item.userId}
              </span>
              <span>{ROLE_LABEL[item.role] || item.role}</span>
              <span dir="ltr" className="font-mono text-slate-500">
                {String(item.requested_at || "").slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
