import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceReviewNotifications as group,sameDeviceReviewIncident as same} from '../src/shared/device-review-notifications';
const base={id:'first',studentId:'s1',sectionCode:'c-teacher@test',action:'محاولة كود مرفوضة',details:'رفض دخول لعدم تطابق بيانات ربط المتصفح المعتمد؛ يحتاج مراجعة — الرمز: LAB-ABCD-EFGH-JKLM',timestamp:'2026-10-06T00:21:00Z'};
test('four changing browser tokens produce one alert with a stable read key and latest time',()=>{
 const rows=[base,...[22,27,28].map(minute=>({...base,id:`m${minute}`,timestamp:`2026-10-06T00:${minute}:00Z`,deviceToken:`different-${minute}`}))];
 const result=group(rows);
 assert.equal(result.length,1);assert.equal(result[0].deviceReviewGroupKey,'device-review-first');assert.equal(result[0].deviceReviewCount,4);assert.equal(result[0].id,'m28');assert.equal(rows.length,4);
 assert.equal(group([...rows].reverse())[0].deviceReviewGroupKey,result[0].deviceReviewGroupKey);
 assert.ok(result[0].deviceReviewReadKeys?.includes('admin-log-m27'));
 assert.ok(result[0].deviceReviewReadKeys?.includes('teacher-log-first'));
});
test('different students, courses, codes, reasons and later incidents stay visible',()=>{
 for(const patch of [{studentId:'s2'},{sectionCode:'other-teacher@test'},{details:base.details.replace('ABCD','ZZZZ')},{details:'مصيدة كود غير مُصدر — الرمز: LAB-ABCD-EFGH-JKLM'},{timestamp:'2026-10-06T06:21:00Z'}])assert.equal(group([base,{...base,id:'second',...patch}]).length,2);
});
test('legacy copied-token wording and corrected reason identify the same incident',()=>{
 const legacy={...base,details:base.details.replace('رفض دخول لعدم تطابق بيانات ربط المتصفح المعتمد؛ يحتاج مراجعة','محاولة دخول بتوكن منسوخ دون سر المتصفح الأصلي')};
 assert.equal(group([legacy,{...base,id:'new'}]).length,1);
});
test('missing scope and audit evidence do not hide events',()=>{
 for(const patch of [{studentId:''},{sectionCode:''},{timestamp:'invalid'},{action:'مصيدة كود'}])assert.equal(group([{...base,...patch},{...base,id:'second',...patch}]).length,2);
});
test('push suppression tolerates changing tokens but does not authorize them',()=>{
 const incident={studentId:'s1',sectionCode:base.sectionCode,code:'LAB-ABCD-EFGH-JKLM',reason:'عدم تطابق بيانات ربط المتصفح المعتمد'};
 const attempt={...incident,deviceToken:'old',reason:'محاولة دخول بتوكن منسوخ دون سر المتصفح الأصلي',timestamp:base.timestamp};
 const now=Date.parse(base.timestamp)+60000;
 assert.equal(same(attempt,{...incident,deviceToken:'new'},now),true);
 for(const patch of [{studentId:'s2'},{sectionCode:'different'},{code:'LAB-OTHER'},{reason:'جهاز مختلف'},{studentId:''}])assert.equal(same(attempt,{...incident,...patch},now),false);
 assert.equal(same(attempt,incident,now+6*60*60*1000),false);
 assert.equal(same(attempt,incident,Date.parse(base.timestamp)-1),false);
});
