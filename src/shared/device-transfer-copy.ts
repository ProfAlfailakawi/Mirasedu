export const deviceTransferCopy = {
 title: 'تبديل جهاز الطالب',
 message: (name: string) => `السماح للطالب ${name} باستخدام جهاز جديد؟ ينتهي الدخول من الجهاز القديم، ويُعتمد الجديد عند أول دخول.`,
 confirmLabel: 'تبديل الجهاز',
 success: 'تم السماح بتبديل الجهاز.',
 batchTitle: 'تبديل أجهزة الطلبة المحددين',
 batchMessage: (names: string[]) => {
  const shown = names.slice(0, 8).join('، ');
  const rest = names.length > 8 ? ` و${names.length - 8} آخرين` : '';
  return `السماح للطلبة المحددين (${names.length}) باستخدام أجهزة جديدة؟ ${shown}${rest}. ينتهي الدخول من الأجهزة القديمة، ويُعتمد الجديد عند أول دخول لكل طالب.`;
 },
 batchConfirmLabel: (count: number) => `تبديل الكل (${count})`,
 batchSuccess: (count: number) => `تم تبديل الأجهزة (${count}).`,
};
