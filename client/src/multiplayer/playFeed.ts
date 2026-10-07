import type { TableSummary, TableEntry } from './tableNavigation';
export type PlayTable = TableSummary & {table_id?:string;room_id:string;room_name:string;created_at?:number;invitation_id?:string};
export type PlayInvitation = {id:string;room_id:string;room_name:string;match_id:string;table_name:string;game_type:PlayTable['game_type'];created_at:number;seated:number;capacity:number;seat_available:boolean};

export function playEntry(table:PlayTable):TableEntry {
  if(table.current_user?.is_seated)return 'watch';
  return table.players<table.capacity && table.current_user?.can_join ? 'seat' : 'watch';
}
export function playFeed(tables:PlayTable[], invitations:PlayInvitation[]):PlayTable[] {
  const key=(table:{room_id:string;match_id:string})=>`${table.room_id}:${table.match_id}`;
  const result=new Map(tables.map(table=>[key(table),{...table}]));
  for(const invitation of invitations){
    const previous=result.get(key(invitation));
    result.set(key(invitation),{...(previous??{
      room_id:invitation.room_id,room_name:invitation.room_name,match_id:invitation.match_id,
      name:invitation.table_name,game_type:invitation.game_type,status:'waiting',
      players:invitation.seated,capacity:invitation.capacity,
      current_user:{can_join:invitation.seat_available} as PlayTable['current_user'],
    }),created_at:Math.max(previous?.created_at??0,invitation.created_at),invitation_id:invitation.id});
  }
  return [...result.values()].sort((a,b)=>(b.created_at??0)-(a.created_at??0)||key(a).localeCompare(key(b)));
}
