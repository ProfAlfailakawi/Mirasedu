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
test('batch transfer confirms once, names the students and caps a long list',()=>{
 const names=Array.from({length:11},(_,i)=>`طالب ${i+1}`);
 const message=copy.batchMessage(names);
 assert.ok(message.includes('(11)'));
 assert.ok(message.includes('طالب 8') && !message.includes('طالب 9،'));
 assert.ok(message.includes('و3 آخرين'));
 assert.ok(message.includes('أول دخول'));
 assert.equal(copy.batchConfirmLabel(2),'تبديل الكل (2)');
 assert.ok(copy.batchSuccess(2).length<28);
 const source=fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const start=source.indexOf('const transferSelectedStudentDevices =');
 const action=source.slice(start,source.indexOf('const resetOrHoldStudentAccount =',start));
 assert.match(action,/reset-access/);
 assert.match(action,/mode: "reset_device"/);
 assert.match(action,/preserveMessage: true/);
});
