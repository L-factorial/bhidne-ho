/** Preserve a known removal when an older in-flight history response arrives.
 * Only retain rows still present in the new authorized history (block-safe).
 */
export function preserveRemovals<T extends {id:string;removed?:boolean}>(current:T[],incoming:T[]):T[]{
 const removed=new Map(current.filter(m=>m.removed).map(m=>[m.id,m]));
 return incoming.map(m=>removed.get(m.id)??m);
}
