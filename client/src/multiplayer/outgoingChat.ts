import {newCommandId} from './DurableCommandClient.ts';
export type ChatRecord={id:string;sender_id:string;text:string;sent_at:number;command_id?:string|null};
export type Delivery='sending'|'confirming'|'failed';
export type OutgoingRow<T> = T & {delivery?:Delivery;retry_id?:string;send_error?:string;can_retry?:boolean};
type Entry<T>={scope:string;message:T;delivery:Delivery;confirmed?:T;observed?:boolean;error?:string;safeRetry:boolean;active:boolean;transmit:(id:string,text:string)=>Promise<T>};
/** Local bubbles and retries retain their original identity, recipient and text. */
export class OutgoingChat<T extends ChatRecord>{
  entries:Entry<T>[]=[];
  private changed:()=>void;
  constructor(changed:()=>void){this.changed=changed;}
  get blocked(){return this.entries.some(e=>e.active||!e.confirmed);}
  rows(scope:string,history:T[]):OutgoingRow<T>[] {
    const rows:OutgoingRow<T>[]=[...history];
    for(const entry of this.entries.filter(e=>e.scope===scope)){
      const found=history.find(row=>row.id===entry.confirmed?.id||row.command_id===entry.message.command_id);
      if(found){
        entry.observed=true;
        if(!entry.confirmed){const index=rows.indexOf(found);rows[index]={...found,delivery:entry.delivery,retry_id:entry.message.id,send_error:entry.error,can_retry:!entry.active&&(entry.safeRetry||entry.delivery==='failed')};}
        continue;
      }
      if(entry.confirmed&&!entry.observed)rows.push(entry.confirmed);
      else if(!entry.confirmed)rows.push({...entry.message,delivery:entry.delivery,retry_id:entry.message.id,send_error:entry.error,can_retry:!entry.active&&(entry.safeRetry||entry.delivery==='failed')});
    }
    return rows.sort((a,b)=>a.sent_at-b.sent_at);
  }
  send(scope:string,message:Omit<T,'id'|'command_id'|'sent_at'>,transmit:Entry<T>['transmit'],safeRetry:boolean){
    if(this.blocked)return false;
    this.entries=this.entries.filter(entry=>!entry.observed||entry.active);
    const id=newCommandId();
    const entry:Entry<T>={scope,message:{...message,id:`outgoing:${id}`,command_id:id,sent_at:Date.now()} as T,delivery:'sending',active:false,transmit,safeRetry};
    this.entries.push(entry);this.changed();void this.attempt(entry);return true;
  }
  retry(id:string){const entry=this.entries.find(e=>e.message.id===id);if(entry&&!entry.active&&!entry.confirmed&&(entry.safeRetry||entry.delivery==='failed')){
      // A definitive rejection committed no message. Its rejected command receipt
      // cannot turn into success, so start a new attempt on the same local bubble.
      if(entry.delivery==='failed')entry.message.command_id=newCommandId();
      void this.attempt(entry);
    }}
  private async attempt(entry:Entry<T>){
    if(entry.active)return;
    entry.active=true;entry.delivery='sending';entry.error=undefined;this.changed();
    const timer=setTimeout(()=>{if(entry.active){entry.delivery='confirming';this.changed();}},5000);
    try{
      const confirmed=await entry.transmit(entry.message.command_id!,entry.message.text);
      if(!confirmed||typeof confirmed.id!=='string'||!confirmed.id)throw Error('Waiting for message confirmation.');
      entry.confirmed=confirmed;
    }
    catch(error){
      // A network error is ambiguous. Retry uses the durable command ID; legacy
      // non-idempotent sends remain confirming instead of blindly resending.
      const status=(error as {status?:number})?.status;
      const rejected=(error as {preserveChatId?:boolean})?.preserveChatId!==true&&typeof status==='number'&&status>=400&&status<500&&status!==408;
      entry.delivery=rejected?'failed':'confirming';
      entry.error=error instanceof Error?error.message:'Could not send message.';
    }finally{clearTimeout(timer);entry.active=false;this.changed();}
  }
}
