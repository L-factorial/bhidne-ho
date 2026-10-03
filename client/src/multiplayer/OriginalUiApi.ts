import { ApiError } from './apiResponse.ts';
import { DistributedRequestError } from './DistributedHttpTransport.ts';
import type { TableSocialChannel, TableMessage, SocialAck } from './TableSocialChannel';
import type { Session } from './session';
import type { UiRequest } from './RuntimeRequests.ts';
import { sharedPlatformPath } from './RuntimeRequests.ts';
import type { DistributedRootRuntime } from './DistributedRoot.ts';
import { DistributedUiIntent } from './DistributedUiIntent.ts';
import type { CommandTarget, Json } from './DurableCommandClient.ts';
import { gameTarget, tableTarget } from './DistributedControls.ts';
import type { LeaveView } from './DistributedScreenController.ts';
import { GameRequestError } from './PendingGameAction.ts';

type Payload = {[key:string]:Json};
export class OriginalUiApi {
  readonly request:UiRequest;
  private root:DistributedRootRuntime;
  private account:Session;
  private shared:UiRequest;
  private intents:DistributedUiIntent;
  private restored=new Map<string,string>();
  private recoveryTimer?:ReturnType<typeof setTimeout>;
  private closed=new AbortController();
  private channel:TableSocialChannel|null=null;
  private chatTail:Promise<void>=Promise.resolve();
  private profiles=new Map<string,{value:{user_id:string;display_name:string;username?:string|null};until:number}>();
  private chatScopes=new Map<string,{room:string;match:string;seen:Set<string>;ready:boolean}>();
  constructor(root:DistributedRootRuntime,account:Session,shared:UiRequest) {
    this.root=root;this.account={...account};this.shared=shared;this.intents=new DistributedUiIntent(root.session);
    for(const slot of ['ui-table-control','ui-room-settings','ui-ledger','ui-invitations','ui-friendship','ui-notifications','ui-direct-chat','ui-room-chat','ui-table-chat']) {
      const saved=root.session.command(slot).request;
      if(saved)this.restored.set(slot,saved.body.command_id);
    }
    this.request=async<T>(path:string,session:Session|null,body?:object,signal?:AbortSignal,method?:'DELETE'|'PATCH'):Promise<T>=>{
      if(this.closed.signal.aborted||!session||session.token!==this.account.token||session.user_id!==this.account.user_id)throw Error('API session has changed.');
      const abort=new AbortController(),cancel=()=>abort.abort();
      this.closed.signal.addEventListener('abort',cancel,{once:true});signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted)cancel();
      try {return await this.route(path,body,abort.signal,method) as T;}
      catch(error){if(error instanceof DistributedRequestError)throw new ApiError(error.status,error.message);throw error;}
      finally {this.closed.signal.removeEventListener('abort',cancel);signal?.removeEventListener('abort',cancel);}
    };
  }
  recover(notify:(message:string)=>void) {
    const tick=async()=>{
      for(const [slot,id] of this.restored) {
        if(this.closed.signal.aborted)return;
        const saved=this.root.session.command(slot).request;
        if(!saved||saved.body.command_id!==id){this.restored.delete(slot);continue;}
        const {command_id,...body}=saved.body;
        try {
          await this.intents.run(slot,saved.target,body,this.closed.signal,async()=>{
            // Present a committed projection before retiring an offscreen intent.
            if(['conversation','room_chat','table_chat'].includes(saved.target.kind)&&['send-message','send-chat'].includes(body.command))
              await this.messages(saved.target,this.closed.signal);
            else if(saved.target.room_id) {
              try {await this.game(saved.target.room_id,null,this.closed.signal);}
              catch(error){if(!(error instanceof DistributedRequestError)||![403,404].includes(error.status))throw error;}
            }
            notify(`Previous ${body.command} action confirmed.`);
          });
          this.restored.delete(slot);
        } catch(error) {
          if(this.closed.signal.aborted)return;
          if(error instanceof GameRequestError) {
            notify(error.message);this.restored.delete(slot);
          }
          // Transport uncertainty keeps the original journal and is retried.
        }
      }
      if(this.restored.size&&!this.closed.signal.aborted)this.recoveryTimer=setTimeout(()=>void tick(),1500);
    };
    void tick();
  }
  attachSocial(channel:TableSocialChannel) {
    this.channel=channel;
    channel.transport=async(type,match,payload,signal)=>{
      const room=this.selectedRoom;
      if(!room)throw Error('Open a table before using its chat.');
      const view=await this.game(room,match,signal);
      const target={kind:'table_chat',room_id:room,table_id:view.table_id};
      const stream=await this.root.reads.open(target,signal);
      if(!this.chatScopes.has(stream.lane_id))this.chatScopes.set(stream.lane_id,{room,match,seen:new Set(),ready:false});
      const result:SocialAck={type:'TABLE_SOCIAL_ACK',room_id:room,match_id:match,command_id:'distributed',status:'accepted'};
      if(type==='TABLE_POKE_SEND')await this.tableRequest(room,'send-reaction',{match_id:match,...payload} as Payload,signal);
      else if(type==='TABLE_CHAT_SEND')result.message=await this.sendMessage(target,(payload as Payload).text,signal) as unknown as TableMessage;
      else result.messages=(await this.messages(target,signal)).map(r=>({...r,type:'TABLE_CHAT_MESSAGE',room_id:room,match_id:match}) as unknown as TableMessage);
      if(result.message)result.message={...result.message,type:'TABLE_CHAT_MESSAGE',room_id:room,match_id:match};
      for(const r of result.messages??(result.message?[result.message]:[]))this.chatScopes.get(stream.lane_id)!.seen.add(r.id);
      this.chatScopes.get(stream.lane_id)!.ready=true;
      return result;
    };
  }
  selectedRoom:string|null=null;
  deliverChat(lane:string,value:unknown) {
    const work=this.chatTail.catch(()=>{}).then(()=>this.deliverChatRows(lane,value));
    this.chatTail=work;return work;
  }
  private async deliverChatRows(lane:string,value:unknown) {
    const scope=this.chatScopes.get(lane);
    if(!scope||!scope.ready||!Array.isArray(value)||this.closed.signal.aborted)return;
    for(const row of value) {
      if(scope.seen.has(row.id))continue;
      const player=await this.player(String(row.sender_id),this.closed.signal);
      if(this.closed.signal.aborted)return;
      scope.seen.add(row.id);
      if(scope.seen.size>10000)scope.seen.delete(scope.seen.values().next().value!);
      this.channel?.receive({...row,type:'TABLE_CHAT_MESSAGE',room_id:scope.room,match_id:scope.match,
        sender_name:player.display_name,sent_at:Date.parse(String(row.sent_at))});
    }
  }
  close(){clearTimeout(this.recoveryTimer);this.closed.abort();if(this.channel)this.channel.transport=undefined;this.channel=null;this.chatScopes.clear();}
  private async command(slot:string,target:CommandTarget,command:string,payload:Payload,signal:AbortSignal) {
    return this.intents.run(slot,target,{command,payload},signal,async()=>undefined);
  }
  async game(room:string,match:string|null,signal:AbortSignal,invalidate=true) {
    return this.root.readGameView<LeaveView & {status:string}>(room,match,signal,invalidate);
  }
  private pair(other:string):CommandTarget {
    const users=[this.account.user_id.replace(/^user-/,''),other.replace(/^user-/,'')].sort();
    return {kind:'conversation',user_low:users[0],user_high:users[1]};
  }
  private async player(user:string,signal:AbortSignal) {
    const cached=this.profiles.get(user);
    if(cached&&cached.until>Date.now())return cached.value;
    const value=await this.shared<{user_id:string;display_name:string;username?:string|null}> (user===this.account.user_id?'/auth/me':`/players/${encodeURIComponent(user)}`,this.account,undefined,signal);
    if(signal.aborted)throw Error('Profile load cancelled.');
    if(this.profiles.size>=512)this.profiles.delete(this.profiles.keys().next().value!);
    this.profiles.set(user,{value,until:Date.now()+30000});return value;
  }
  private async invitations(table:boolean,signal:AbortSignal) {
    const items:any[]=[];let after:string|null=null;
    const seen=new Set<string>();
    for(let page=0;page<100;page++) {
      const result: {items:any[];next_table_id?:string|null;next_id?:string|null}=table?await this.root.reads.tableInvitations(after,signal):await this.root.reads.roomInvitations(after,signal);
      items.push(...result.items);
      const next:string|null=(table?result.next_table_id:result.next_id)??null;
      if(next===null)return Promise.all(items.map(async item=>({...item,inviter:await this.player(String(item.inviter_id),signal)})));
      if(!next||seen.has(next))throw Error('Invalid invitation cursor.');
      seen.add(next);after=next;
    }
    throw Error('Invitation list exceeds the supported limit.');
  }
  private async notificationRows(signal:AbortSignal) {
    const recipient=await this.root.reads.recipient(signal);
    const [native,legacy]=await Promise.all([this.root.reads.history('social',recipient.lane_id,signal),this.root.reads.legacy('notifications',null,null,signal)]);
    return [...legacy.items,...native].filter(row=>['friend_accepted','friend_rejected'].includes(String(row.kind)));
  }
  async messages(target:CommandTarget,signal:AbortSignal) {
    const lane=await this.root.reads.open(target,signal);
    const rows=await this.root.reads.history(target.kind==='conversation'?'social':'chat',lane.lane_id,signal);
    if(target.kind==='conversation') {
      const other='user-'+(target.user_low===this.account.user_id.replace(/^user-/,'')?target.user_high:target.user_low);
      const legacy=await this.root.reads.legacy('direct',other,null,signal);
      return [...legacy.items,...rows].map(r=>({...r,sent_at:Date.parse(String(r.sent_at))}));
    }
    const profiles=new Map<string,string>();
    for(const sender of new Set(rows.map(r=>String(r.sender_id))))profiles.set(sender,(await this.player(sender,signal)).display_name);
    return rows.map(r=>({...r,sender_name:profiles.get(String(r.sender_id)),sent_at:Date.parse(String(r.sent_at))}));
  }
  async sendMessage(target:CommandTarget,text:Json,signal:AbortSignal) {
    return this.intents.run(target.kind==='conversation'?'ui-direct-chat':target.kind==='table_chat'?'ui-table-chat':'ui-room-chat',target,
      {command:target.kind==='conversation'?'send-message':'send-chat',payload:{text}},signal,async(_receipt,request)=>{
        const rows=await this.messages(target,signal);
        const message=rows.find(r=>(r as any).command_id===request.body.command_id);
        if(!message)throw Error('Message accepted; waiting for its committed history.');
        return message;
      });
  }
  private async route(path:string,body:object|undefined,signal:AbortSignal,method?:string):Promise<unknown> {
    if(sharedPlatformPath(path,body,method))return this.shared(path,this.account,body,signal,method as 'DELETE'|'PATCH'|undefined);
    const url=new URL(path,'https://ui.invalid'), parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const data=JSON.parse(JSON.stringify(body??{})) as Payload, reads=this.root.reads;
    if(!body&&!method) {
      if(path==='/room-invitations')return this.invitations(false,signal);
      if(path==='/test-games/invitations')return this.invitations(true,signal);
      if(path==='/notifications')return Promise.all((await this.notificationRows(signal)).map(async row=>({...row,
        actor:await this.player(String(row.actor_id),signal),created_at:Date.parse(String(row.created_at))})));
      if(parts[0]==='friends'&&parts[2]==='messages')return this.messages(this.pair(parts[1]),signal);
      if(parts[0]==='rooms'&&parts[2]==='chat')return this.messages({kind:'room_chat',room_id:parts[1]},signal);
      if(path==='/rooms')return reads.lobby(signal);
      if(path==='/memberships')return reads.activity('memberships',signal);
      if(path==='/active-tables')return reads.activity('active-tables',signal);
      if(parts[0]==='rooms'&&parts.length===2)return reads.preview(parts[1],signal);
      if(parts[0]==='rooms'&&parts[2]==='members')return reads.memberProfiles(parts[1],signal);
      if(parts[0]==='rooms'&&parts[2]==='ledger')return reads.ledger(parts[1],signal);
      if(parts[0]==='test-games'&&parts.length===2&&parts[1]!=='invitations')return this.game(parts[1],url.searchParams.get('match_id'),signal,false);
    }
    if(path==='/notifications/read'&&body) {
      const ids=(await this.notificationRows(signal)).filter(r=>r.read!==true).map(r=>String(r.id));
      for(let offset=0;offset<ids.length;offset+=100)await this.command('ui-notifications',
        {kind:'recipient',recipient_id:this.account.user_id.replace(/^user-/,'')},'read-notifications',{ids:ids.slice(offset,offset+100)},signal);
      return;
    }
    if((parts[0]==='room-invitations'||parts[0]==='test-games'&&parts[1]==='invitations')&&body) {
      const table=parts[0]==='test-games',id=parts[table?2:1],accept=parts.at(-1)==='accept';
      const saved=this.root.session.command('ui-invitations').request;
      if(saved&&saved.body.payload.invitation_id===id&&saved.body.payload.accept===accept) {
        const {command_id,...body}=saved.body;
        return this.intents.run('ui-invitations',saved.target,body,signal,async()=>undefined);
      }
      const invitation=(await this.invitations(table,signal)).find(row=>row.id===id);
      if(!invitation)throw Error('Invitation is no longer available.');
      if(!table)return this.command('ui-invitations',{kind:'room',room_id:invitation.room_id},'answer-room-invitation',{invitation_id:id,accept},signal);
      return this.intents.run('ui-invitations',{kind:'table',room_id:invitation.room_id,table_id:invitation.table_id},
        {command:'answer-table-invitation',match_id:invitation.match_id,expected_revision:invitation.table_revision,payload:{invitation_id:id,accept}},signal,async()=>undefined);
    }
    if(parts[0]==='rooms') {
      const room=parts[1],target={kind:'room',room_id:room};
      if(parts[2]==='chat'&&body)return this.sendMessage({kind:'room_chat',room_id:room},data.text,signal);
      if(parts.length===2&&method==='PATCH')return this.command('ui-room-settings',target,'room-visibility',{visibility:data.visibility},signal);
      if(parts[2]==='invitations'&&body)return this.command('ui-room-settings',target,'invite-room',{recipients:data.invitees},signal);
      if(parts[2]==='ledger'&&parts[3]==='settlements'&&body) {
        const {idempotency_key,...payload}=data;
        return this.command('ui-ledger',target,parts.length===4?'create-settlement':'settlement-action',
          parts.length===4?payload:{batch_id:parts[4],transfer_id:parts[6],action:parts[7]},signal);
      }
    }
    if(parts[0]==='test-games'&&parts[2]==='invitations'&&parts[3]==='eligibility')return reads.eligibility(parts[1],data.player_ids as string[],signal);
    if(parts[0]==='test-games'&&parts[1]!=='invitations') {
      return this.tableRequest(parts[1],parts.slice(2).join('/'),data,signal);
    }
    if(parts[0]==='friends'&&body||parts[0]==='friends'&&method==='DELETE') {
      const other=parts[1]==='requests'?parts[2]:parts[1];
      if(parts.at(-1)==='messages')return this.sendMessage(this.pair(other),data.text,signal);
      const pair=[this.account.user_id.replace(/^user-/,''),other.replace(/^user-/,'')].sort();
      return this.command('ui-friendship',{kind:'conversation',user_low:pair[0],user_high:pair[1]},
        method==='DELETE'?'remove-friend':parts.at(-1)==='accept'?'accept-friend':'request-friend',{},signal);
    }
    throw Error(`Distributed UI route is not connected: ${url.pathname}`);
  }
  private async afterTable(room:string,match:string|null|undefined,command:string,signal:AbortSignal) {
    if(!match||command==='next-match')return this.game(room,null,signal);
    try {return await this.game(room,match,signal);}
    catch(error) {
      // The accepted intention can outlive its match; a missing projection does
      // not authorize submitting that intention a second time.
      if(error instanceof DistributedRequestError&&error.status===404)return this.game(room,null,signal);
      throw error;
    }
  }
  async tableRequest(room:string,action:string,data:Payload,signal:AbortSignal):Promise<unknown> {
    if(!action) {
      const payload:Payload={game_type:data.game_type,capacity:data.player_count,name:data.name,invitees:data.invitees??[]};
      const saved=this.root.session.command('ui-table-control').request;
      if(saved?.body.command==='create-table'&&saved.target.room_id===room) {
        if(saved.body.payload.replace_table_id) {
          payload.replace_table_id=saved.body.payload.replace_table_id;
          payload.replace_revision=saved.body.payload.replace_revision;
        }
      } else if(!saved) {
        const current=await this.game(room,null,signal) as LeaveView & {can_create_new_game?:boolean};
        if(current.can_create_new_game&&current.table?.current_user?.can_leave_seat) {
          payload.replace_table_id=current.table_id;payload.replace_revision=current.table_revision;
        }
      }
      return this.intents.run('ui-table-control',{kind:'room',room_id:room},{command:'create-table',payload},signal,async(receipt)=>{
        if(!('outcome' in receipt)||!receipt.outcome?.match_id)throw Error('Missing created match identity.');
        return this.game(room,receipt.outcome.match_id,signal);
      });
    }
    const saved=this.root.session.command('ui-table-control').request;
    const alias:Record<string,string>={join:'join-seat',poke:'send-poke','next-deal':'NEXT_DEAL'};
    let intended=alias[action]??action.replace(/^table\//,'');
    if(action==='leave'&&saved&&['leave-seat','abandon','FOLD_AND_LEAVE'].includes(saved.body.command))intended=saved.body.command;
    if(saved&&saved.target.room_id===room&&saved.body.match_id===data.match_id&&saved.body.command===intended) {
      const {match_id,...payload}=data;
      const {command_id,...body}=saved.body;
      return this.intents.run('ui-table-control',saved.target,{...body,payload},signal,async()=>this.afterTable(room,saved.body.match_id,saved.body.command,signal));
    }
    const view=await this.game(room,typeof data.match_id==='string'?data.match_id:null,signal);
    const {match_id,...payload}=data;
    let command=action.replace(/^table\//,''), game=false;
    const aliases:Record<string,string>={join:'join-seat',poke:'send-poke'};
    command=aliases[command]??command;
    if(action==='leave') {
      const user=view.table.current_user;
      if(['OPEN','COMPLETED','ENDED'].includes(view.table.phase)&&user.can_leave_seat)command='leave-seat';
      else if(view.table.phase==='STARTED'&&view.game_type==='callbreak'&&user.can_abandon_match)command='abandon';
      else if(view.table.phase==='STARTED'&&['marriage','flush'].includes(view.game_type)&&user.is_in_active_match){command='FOLD_AND_LEAVE';game=true;}
      else throw new GameRequestError(409,'Leaving is unavailable in the current table state.');
    }
    if(action==='next-deal'){command='NEXT_DEAL';game=true;}
    return this.intents.run('ui-table-control',game?gameTarget(view):tableTarget(view),
      {command,payload,match_id:view.match_id,expected_revision:game?view.game?.revision:view.table_revision},signal,
      async()=>this.afterTable(room,view.match_id,command,signal));
  }
}
