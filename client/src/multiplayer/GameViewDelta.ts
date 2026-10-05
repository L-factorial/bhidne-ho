// Version 1 authorized-view patches. Callers install only the verified result
// and must recheck selection/generation after the asynchronous checksum work.
export type ViewDelta = {
  version: 1; game_id: string; base_revision: number; revision: number;
  base_checksum: string; checksum: string;
  operations: ({op: 'set'; path: string[]; value: unknown} | {op: 'remove'; path: string[]})[];
};
const forbidden = new Set(['__proto__','prototype','constructor']);
const maximumBytes = 262144;
function fail(): never { throw Error('Invalid game delta; reconcile the snapshot.'); }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
  && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));
const text = (v: string) => Array.from({length:v.length},(_,i)=>v.charCodeAt(i).toString(16).padStart(4,'0')).join('');
function normalized(v: unknown, depth = 0): unknown {
  if(depth>64)fail();
  if(v===null)return ['null'];
  if(typeof v==='boolean')return ['bool',v];
  if(typeof v==='string')return ['string',text(v)];
  if(typeof v==='number'){
    if(!Number.isFinite(v) || Number.isInteger(v) && !Number.isSafeInteger(v))fail();
    const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,v===0?0:v,false);
    return ['number',Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')];
  }
  if(Array.isArray(v)){
    if(Object.keys(v).length!==v.length || Array.from({length:v.length},(_,i)=>i).some(i=>!Object.hasOwn(v,i)))fail();
    return ['array',v.map(item=>normalized(item,depth+1))];
  }
  if(object(v))return ['object',Object.keys(v).sort().map(k=>{
    if(forbidden.has(k))fail();return [text(k),normalized(v[k],depth+1)];
  })];
  return fail();
}
export function canonicalView(value: unknown): string {
  const result=JSON.stringify(normalized(value));
  if(result.length>maximumBytes*8)fail();return result;
}
const position = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number)>=0;
const exact = (v: Record<string,unknown>, keys: string[]) => Object.keys(v).length===keys.length
  && keys.every(key=>Object.hasOwn(v,key));
// ASCII canonical input permits a native-compatible SHA-256 implementation;
// this codec does not depend on browser WebCrypto or Node APIs.
export type ViewDigest = (canonicalAscii: string) => Promise<string>;
export async function applyViewDelta<T>(before: T, input: unknown, gameId: string,
  revision: number, digest: ViewDigest): Promise<{value: T; revision: number}> {
  if(!position(revision) || !object(input)
    || !exact(input,['version','game_id','base_revision','revision','base_checksum','checksum','operations'])
    || input.version!==1 || input.game_id!==gameId || !gameId
    || !position(input.base_revision) || input.base_revision!==revision
    || !position(input.revision) || input.revision<=revision
    || typeof input.base_checksum!=='string' || !/^[a-f0-9]{64}$/.test(input.base_checksum)
    || typeof input.checksum!=='string' || !/^[a-f0-9]{64}$/.test(input.checksum)
    || !Array.isArray(input.operations) || input.operations.length>4096)fail();
  // Measure the same ASCII-escaped wire representation as the Python codec.
  canonicalView(input);
  const wire=JSON.stringify(input).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  if(wire.length>maximumBytes)fail();
  const delta=JSON.parse(JSON.stringify(input)) as ViewDelta;
  const base=canonicalView(before);
  let value: unknown=JSON.parse(JSON.stringify(before));
  if(await digest(base)!==delta.base_checksum)fail();
  const paths: string[][]=[];
  for(const op of delta.operations){
    if(!object(op) || !['set','remove'].includes(op.op)
      || !exact(op,op.op==='set'?['op','path','value']:['op','path'])
      || !Array.isArray(op.path) || op.path.length>64
      || op.path.some(k=>typeof k!=='string' || forbidden.has(k)))fail();
    if(paths.some(p=>p.slice(0,op.path.length).every((k,i)=>k===op.path[i])
      || op.path.slice(0,p.length).every((k,i)=>k===p[i])))fail();
    paths.push(op.path);
    if(op.op==='set')canonicalView(op.value);
    if(!op.path.length){if(op.op!=='set')fail();value=op.value;continue;}
    let parent: unknown=value;
    for(const key of op.path.slice(0,-1)){
      if(!object(parent) || !Object.hasOwn(parent,key))fail();parent=parent[key];
    }
    if(!object(parent))fail();
    const key=op.path.at(-1)!;
    if(op.op==='remove'){if(!Object.hasOwn(parent,key))fail();delete parent[key];}
    else parent[key]=op.value;
  }
  if(await digest(canonicalView(value))!==delta.checksum)fail();
  return {value:value as T,revision:delta.revision};
}
