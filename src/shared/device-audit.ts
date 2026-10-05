/** Preserve the audit trail while removing its former generic duplicate in display. */
export const LEGACY_THIRD_DEVICE_DETAILS = "محاولة تسجيل دخول فاشلة بسبب تجاوز الحد الأقصى للأجهزة (جهاز ثالث)";
export const LEGACY_DEVICE_REJECTION_DESCRIPTION = "رفض دخول بسبب قفل الجهاز؛ السبب التفصيلي غير محفوظ في هذا السجل القديم.";

export function deviceAuditForDisplay<T extends Record<string, any>>(logs: T[]): T[] {
  return logs.flatMap(log => {
    if (log.action !== "انتهاك الأجهزة" || log.details !== LEGACY_THIRD_DEVICE_DETAILS) return [log];
    const at = new Date(log.timestamp || log.createdAt || 0).getTime();
    const detailed = logs.some(other => {
      if (other === log || !log.studentId || String(other.studentId) !== String(log.studentId)) return false;
      if (!other.ip || !log.ip || other.ip !== log.ip || !other.userAgent || other.userAgent !== log.userAgent) return false;
      if (!["محاولة كود مرفوضة", "رفض متصفح/وضع عرض آخر على نفس الجهاز", "رفض دخول من جهاز غير معتمد"].includes(other.action)) return false;
      const distance = Math.abs(new Date(other.timestamp || other.createdAt || 0).getTime() - at);
      return Number.isFinite(at) && Number.isFinite(distance) && distance <= 5000;
    });
    return detailed ? [] : [{ ...log, details: LEGACY_DEVICE_REJECTION_DESCRIPTION }];
  });
}
