import type {CommandEnvelope,DurableReceipt} from './DurableCommandClient.ts';
export type CreationProgress={id:string;kind:'room'|'table';roomId?:string;name:string;gameType?:string;matchId?:string;stage?:'room'|'table'};
export type CreationFeedback={id:string;kind:'room'|'table';roomId?:string;error?:string;skipped?:string[]};
export function creationProgress(request:CommandEnvelope|null,receipt:DurableReceipt|null):CreationProgress|null {
  if(!request || !['create-room','create-table'].includes(request.body.command) || receipt?.status==='rejected')return null;
  const payload=request.body.payload;
  return {id:request.body.command_id,kind:request.body.command==='create-room'?'room':'table',roomId:request.target.room_id,
    name:typeof payload.name==='string'?payload.name:'Table',gameType:typeof payload.game_type==='string'?payload.game_type:undefined,
    matchId:receipt&&'outcome' in receipt?receipt.outcome?.match_id??undefined:undefined};
}
