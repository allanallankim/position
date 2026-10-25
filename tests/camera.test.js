import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openCamera,cameraError,withTimeout} from '../src/camera.js';
test('camera opens without requesting audio',async()=>{
  const stream={};
  assert.equal(await openCamera({getUserMedia:async options=>{assert.equal(options.audio,false);return stream;}}),stream);
});
test('unsupported constraints retry with simple video request',async()=>{
  let calls=0;const stream={};
  assert.equal(await openCamera({getUserMedia:async options=>{calls++;if(calls===1)throw {name:'OverconstrainedError'};assert.deepEqual(options,{video:true,audio:false});return stream;}}),stream);
  assert.equal(calls,2);
});
test('permission rejection is not retried',async()=>{
  let calls=0;await assert.rejects(openCamera({getUserMedia:async()=>{calls++;throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}}),{name:'NotAllowedError'});assert.equal(calls,1);
});
test('errors distinguish insecure origin and permission denial',()=>{
  assert.match(cameraError({name:'NotAllowedError'},false),/localhost/);
  assert.match(cameraError({name:'NotAllowedError'},true),/Windows/);
});
test('model timeout does not wait indefinitely',async()=>{
  await assert.rejects(withTimeout(new Promise(()=>{}),5,'model timeout'),/model timeout/);
  assert.equal(await withTimeout(Promise.resolve('ready'),100,'timeout'),'ready');
});
