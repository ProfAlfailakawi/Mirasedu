const WINDOW_MS = 6 * 60 * 60 * 1000;
const cleanCode = (value: any) => String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const time = (item: any) => Date.parse(String(item.timestamp || item.createdAt || ''));
const BINDING_REASON = 'عدم تطابق بيانات ربط المتصفح المعتمد';
export function normalizeDeviceReviewReason(value: any) {
 return String(value || '').replace('محاولة دخول بتوكن منسوخ دون سر المتصفح الأصلي', BINDING_REASON)
  .replace('رفض دخول لعدم تطابق بيانات ربط المتصفح المعتمد؛ يحتاج مراجعة', BINDING_REASON);
}
/** Alert grouping does not grant access or remove the underlying security audit. */
export function sameDeviceReviewIncident(attempt: any, incident: any, now: number) {
 const student = String(incident.studentId || '');
 const code = cleanCode(incident.normalizedCode || incident.code);
 const course = String(incident.sectionCode || incident.courseCode || '').toLowerCase();
 const at = time(attempt), age = now-at;
 return !!student && !!code && !!course &&
  String(attempt.studentId || '') === student &&
  cleanCode(attempt.normalizedCode || attempt.code) === code &&
  String(attempt.sectionCode || attempt.courseCode || '').toLowerCase() === course &&
  normalizeDeviceReviewReason(attempt.reason) === normalizeDeviceReviewReason(incident.reason) &&
  Number.isFinite(age) && age >= 0 && age < WINDOW_MS;
}
export function deviceReviewNotifications<T extends Record<string, any>>(logs: T[]): (T & {deviceReviewGroupKey?:string;deviceReviewCount?:number})[] {
 const groups: {key:string;first:number;latest:T;id:string;count:number}[]=[];
 const other:T[]=[];
 for(const log of [...logs].sort((a,b)=>time(a)-time(b))) {
  const normalized=normalizeDeviceReviewReason(log.details);
  const code=cleanCode(log.code || normalized.match(/الرمز:\s*(LAB-[A-Z0-9-]+)/i)?.[1]);
  const course=String(log.sectionCode || log.courseCode || '').toLowerCase();
  if(log.action!=='محاولة كود مرفوضة' || !normalized.includes(BINDING_REASON) || !log.studentId || !code || !course || !Number.isFinite(time(log))) {other.push(log);continue;}
  const key=JSON.stringify([String(log.studentId),course,code,BINDING_REASON]);
  let group=groups.find(g=>g.key===key && time(log)-g.first<WINDOW_MS);
  if(!group){group={key,first:time(log),latest:log,id:String(log.id || log.timestamp),count:0};groups.push(group);}
  group.latest=log;group.count++;
 }
 return [...other,...groups.map(g=>({...g.latest,deviceReviewGroupKey:`device-review-${g.id}`,deviceReviewCount:g.count}))]
  .sort((a,b)=>time(b)-time(a));
}
