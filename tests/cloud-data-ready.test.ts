import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudDataReady } from '../src/shared/cloud-data-ready';
const success = {status:'fulfilled' as const,value:true};
test('all required successful reads open the gate, including valid empty datasets', () => {
  assert.equal(cloudDataReady([success,success],[0,1]),true);
});
test('sections alone do not open the teacher gate', () => {
  assert.equal(cloudDataReady([success,{status:'fulfilled',value:false}],[0,1]),false);
});
test('swallowed network errors and rejected cloud requests keep gate closed', () => {
  assert.equal(cloudDataReady([success,{status:'fulfilled',value:undefined}],[0,1]),false);
  assert.equal(cloudDataReady([success,{status:'rejected',reason:'offline'}],[0,1]),false);
});
test('incomplete datasets keep the gate closed', () => {
  assert.equal(cloudDataReady([success],[0,1]),false);
});
test('optional background reads cannot block complete required data', () => {
  assert.equal(cloudDataReady([success,{status:'rejected',reason:'optional'}],[0]),true);
});
test('successful retry opens gate after an offline failure', () => {
  assert.equal(cloudDataReady([{status:'fulfilled',value:false}],[0]),false);
  assert.equal(cloudDataReady([success],[0]),true);
});
