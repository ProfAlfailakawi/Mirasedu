import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deviceTransferCopy as copy} from '../src/shared/device-transfer-copy';
test('transfer confirmation describes the device action and first login concisely',()=>{
 const message=copy.message('طالب تجريبي');
 assert.equal(copy.title,'تبديل جهاز الطالب');
 assert.equal(copy.confirmLabel,'تبديل الجهاز');
 assert.ok(message.includes('طالب تجريبي'));
 assert.ok(message.includes('الجهاز القديم'));
 assert.ok(message.includes('أول دخول'));
 assert.ok(!message.includes('حذف'));
 assert.ok(copy.success.length<28);
});
test('device action preserves its explicit copy instead of passing through delete-message heuristics',()=>{
 const source=fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const start=source.indexOf('const resetOrHoldStudentAccount =');
 const action=source.slice(start,source.indexOf('const restoreStudentAccount =',start));
 assert.match(action,/deviceTransferCopy.message/);
 assert.match(action,/preserveMessage: true/);
 assert.match(source,/options.preserveMessage \? message : compactMirasDialogMessage/);
 assert.match(source,/dialogState.confirmLabel \|\| "تأكيد"/);
});
