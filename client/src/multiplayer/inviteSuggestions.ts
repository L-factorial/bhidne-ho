export type InvitePlayer={user_id:string;display_name:string;username?:string|null};

export function inviteSuggestions(players:Iterable<InvitePlayer>,query:string,self:string,selected:InvitePlayer[]=[]):InvitePlayer[]{
  const needle=query.trim().toLocaleLowerCase();
  if(needle.length<3)return [];
  const excluded=new Set([self,...selected.map(player=>player.user_id)]);
  const unique=new Map<string,InvitePlayer>();
  for(const player of players){
    if(excluded.has(player.user_id))continue;
    if([player.display_name,player.username,player.user_id].some(value=>value?.toLocaleLowerCase().includes(needle)))unique.set(player.user_id,player);
  }
  return [...unique.values()].sort((a,b)=>Number(b.username?.toLocaleLowerCase()===needle)-Number(a.username?.toLocaleLowerCase()===needle)
    ||a.display_name.localeCompare(b.display_name)||a.user_id.localeCompare(b.user_id)).slice(0,20);
}
