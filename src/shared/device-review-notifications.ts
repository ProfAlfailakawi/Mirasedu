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
export function deviceReviewNotifications<T extends Record<string, any>>(logs: T[]): (T & {deviceReviewGroupKey?:string;deviceReviewCount?:number;deviceReviewReadKeys?:string[]})[] {
 const groups: {key:string;first:number;latest:T;id:string;count:number;readKeys:string[]}[]=[];
 const other:T[]=[];
 for(const log of [...logs].sort((a,b)=>time(a)-time(b))) {
  const normalized=normalizeDeviceReviewReason(log.details);
  const code=cleanCode(log.code || normalized.match(/الرمز:\s*(LAB-[A-Z0-9-]+)/i)?.[1]);
  const course=String(log.sectionCode || log.courseCode || '').toLowerCase();
  if(log.action!=='محاولة كود مرفوضة' || !normalized.includes(BINDING_REASON) || !log.studentId || !code || !course || !Number.isFinite(time(log))) {other.push(log);continue;}
  const key=JSON.stringify([String(log.studentId),course,code,BINDING_REASON]);
  let group=groups.find(g=>g.key===key && time(log)-g.first<WINDOW_MS);
  if(!group){group={key,first:time(log),latest:log,id:String(log.id || log.timestamp),count:0,readKeys:[]};groups.push(group);}
  group.latest=log;group.count++;
  group.readKeys.push(`admin-log-${log.id || log.timestamp || log.createdAt}`,`teacher-log-${log.id || log.timestamp || log.createdAt}`);
 }
 return [...other,...groups.map(g=>({...g.latest,deviceReviewGroupKey:`device-review-${g.id}`,deviceReviewCount:g.count,deviceReviewReadKeys:g.readKeys}))]
  .sort((a,b)=>time(b)-time(a));
}

/** Older push copies can outlive the shorter audit page; group those too. */
export function deviceReviewPushNotifications<T extends Record<string, any>>(notes: T[]): (T & {deviceReviewGroupKey?:string;deviceReviewReadKeys?:string[]})[] {
 const groups:{key:string;first:number;latest:T;id:string;readKeys:string[]}[]=[];
 const other:T[]=[];
 for(const note of [...notes].sort((a,b)=>time(a)-time(b))) {
  const data=note.data || {};
  const reason=normalizeDeviceReviewReason(`${note.body || ''} ${data.reason || ''}`);
  const code=cleanCode(note.code || data.code);
  const student=String(note.studentId || data.studentId || '');
  const scope=String(note.courseCode || note.sectionCode || data.courseCode || data.sectionCode || note.teacherEmail || data.teacherEmail || note.userId || data.userId || '').toLowerCase();
  if(String(note.type || data.type || '')!=='code_integrity' || !reason.includes(BINDING_REASON) || !student || !code || !scope || !Number.isFinite(time(note))) {other.push(note);continue;}
  const key=JSON.stringify([scope,student,code,BINDING_REASON]);
  let group=groups.find(g=>g.key===key && time(note)-g.first<WINDOW_MS);
  if(!group){group={key,first:time(note),latest:note,id:String(note.id || note.timestamp),readKeys:[]};groups.push(group);}
  group.latest=note;
  for(const id of [note.id,note.legacyNotificationId].filter(Boolean))group.readKeys.push(`admin-inapp-${id}`,`teacher-inapp-${id}`);
 }
 return [...other,...groups.map(g=>({...g.latest,title:'محاولة دخول من متصفح غير معتمد',body:`${g.latest.studentName || g.latest.data?.studentName || String(g.latest.body || '').match(/^محاولة مرفوضة للطالب (.+?):/)?.[1] || 'طالب'}: بيانات المتصفح في محاولة الدخول لم تطابق الربط المعتمد.`,deviceReviewGroupKey:`device-review-note-${g.id}`,deviceReviewReadKeys:g.readKeys}))]
  .sort((a,b)=>time(b)-time(a));
}
