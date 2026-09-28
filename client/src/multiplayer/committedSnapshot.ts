type Revisioned = {table_id?:string;table_revision?:number;durable_game_id?:string|null;game?:{revision:number}|null};
// An HTTP recovery read can finish after a newer WebSocket-driven read.
export function committedSnapshot<T extends Revisioned>(current:T|null,next:T):T {
  if(current && current.table_id===next.table_id &&
    ((current.table_revision??0)>(next.table_revision??0) ||
      (current.durable_game_id===next.durable_game_id &&
       (current.game?.revision??0)>(next.game?.revision??0))))return current;
  return next;
}
