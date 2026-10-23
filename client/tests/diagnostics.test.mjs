import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnostic, recentDiagnostics, clearDiagnostics} from '../src/diagnostics/events.ts';
test('bounded diagnostics omit payloads and return independent copies', () => {
  clearDiagnostics();
  for(let i=0;i<350;i++) diagnostic('request.started', {requestId:i, body:'private', token:'secret', url:'/private'});
  const entries=recentDiagnostics();
  assert.equal(entries.length,300);
  assert.deepEqual(entries[0].details,{requestId:50});
  assert.equal(/private|secret/.test(JSON.stringify(entries)),false);
  entries[0].details.requestId=-1;
  assert.equal(recentDiagnostics()[0].details.requestId,50);
  clearDiagnostics();assert.deepEqual(recentDiagnostics(),[]);
});
test('console failure does not break app behavior', () => {
  const previous=console.warn;console.warn=()=>{throw Error('unavailable');};
  try{assert.doesNotThrow(()=>diagnostic('request.failed',{reason:'timeout'},'warn'));}
  finally{console.warn=previous;clearDiagnostics();}
});
