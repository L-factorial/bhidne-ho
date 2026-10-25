/** Bounded in-memory display data. Not used to authorize any action. */
const entries=new Map<string,{value:unknown;expires:number;revision:number}>();
let generation=0;
export function clearDisplaySnapshots(){generation++;entries.clear();}
export function displaySnapshot<T>(scope:string){
 const epoch=generation,slot=entries.get(scope)??{value:undefined,expires:0,revision:0};
 entries.delete(scope);entries.set(scope,slot);
 while(entries.size>32)entries.delete(entries.keys().next().value!);
 const current=()=>epoch===generation&&entries.get(scope)===slot;
 return {
  read():T|undefined {
   if(!current())return;
   if(slot.expires<=Date.now()){slot.value=undefined;return;}
   return slot.value as T;
  },
  beginRead(){
   const revision=++slot.revision;
   const latest=()=>current()&&slot.revision===revision;
   return {current:latest,write(value:T){if(latest()){slot.value=value;slot.expires=Date.now()+5*60_000;}}};
  },
  current,
 };
}
