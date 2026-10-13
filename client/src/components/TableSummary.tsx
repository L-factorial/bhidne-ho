import {useEffect,useState} from 'react';
import {Pressable,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {AppText as Text} from './AppText';
import {RoomSheet} from './RoomSheet';
import {RoundResultsTable} from './RoundResultsTable';
import {useTableSocial} from './TableSocial';
import type {Ledger} from './RoomLedger';
import type {RoomSnapshot} from '../screens/LiveGameTable';
import {request} from '../multiplayer/api';
import {playerError} from '../multiplayer/playerError';
import {ui} from '../i18n/copy';
import {fonts,radii,useTheme} from '../theme';

export function TableSummary({snapshot,onOpen}:{snapshot:RoomSnapshot;onOpen:()=>void}) {
  const social=useTableSocial(),session=social?.session;
  const {colors:c}=useTheme();
  const [open,setOpen]=useState(false),[data,setData]=useState<Ledger>(),[error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const tableId=snapshot.table_id || snapshot.table?.table_id;
  useEffect(()=>{setOpen(false);setData(undefined);setError('');},[snapshot.room_id,tableId,session?.token]);
  useEffect(()=>{
    if(!open||!session||!tableId)return;
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
    setLoading(true);
    async function load(){
      try {
        const value=await request<Ledger>(`/rooms/${encodeURIComponent(snapshot.room_id!)}/ledger`,session!,undefined,abort.signal);
        if(!abort.signal.aborted){setData(value);setError('');}
      }catch(failure){if(!abort.signal.aborted)setError(playerError(failure,ui('feedback.could_not_load_ledger')));}
      finally{if(!abort.signal.aborted){setLoading(false);timer=setTimeout(load,5000);}}
    }
    void load();return()=>{abort.abort();clearTimeout(timer);};
  },[open,snapshot.room_id,tableId,session?.token]);
  const table=(data?.record_tables||data?.tables)?.find(row=>row.table_id.replaceAll('-','')===tableId?.replaceAll('-',''));
  const balances=(rows:{player_id:string;amount:number}[],id:string)=><RoundResultsTable compact title="" numericAlign="right" columns={[ui('ledger.net')]} rows={rows.map(row=>({
    id:row.player_id,name:data?.player_profiles?.[row.player_id]?.display_name||data?.players[row.player_id]||ui('common.player'),
    avatarUrl:data?.player_profiles?.[row.player_id]?.avatar_url,own:row.player_id===session?.user_id,
    values:[{text:`${row.amount>0?'+':''}${row.amount}`,amount:row.amount}],
  }))} testID={id}/>;
  return <>
    <Pressable testID="table-summary-toggle" accessibilityRole="button" accessibilityLabel={ui('common.table_summary')} accessibilityState={{expanded:open,disabled:!session||!tableId}} disabled={!session||!tableId}
      onPress={()=>{onOpen();setOpen(true);}} style={{minHeight:44,maxWidth:'100%',paddingHorizontal:4,flexDirection:'row',alignItems:'center',gap:4,borderRadius:radii.medium,backgroundColor:c.surface}}>
      <Ionicons name="receipt-outline" size={18} color={c.accent}/><Text style={{color:c.text,fontFamily:fonts.medium,fontSize:14,flexShrink:1}}>{ui('common.table_summary')}</Text>
    </Pressable>
    <RoomSheet visible={open} title={ui('common.table_summary')} onClose={()=>setOpen(false)} closeLabel={ui('common.close')} testID="table-summary">
      <View style={{padding:12,gap:16}}>
        {!!error&&<Text accessibilityRole="alert" style={{color:c.danger,fontFamily:fonts.body}}>{error}</Text>}
        {loading&&!data&&<Text style={{color:c.textMuted}}>{ui('common.loading_bhidne_ho')}</Text>}
        {data&&<>
          <Text accessibilityRole="header" style={{color:c.text,fontFamily:fonts.medium}}>{ui('common.table_totals')}</Text>
          {table?balances(table.record_balances||table.balances,'table-summary-totals'):<Text style={{color:c.textMuted}}>{ui('common.table_no_results')}</Text>}
          <Text accessibilityRole="header" style={{color:c.text,fontFamily:fonts.medium}}>{ui('common.game_records')}</Text>
          {table?.games.map((game,index)=><View key={game.game_id} style={{gap:8}}>
            <Text accessibilityRole="header" style={{color:c.accent,fontFamily:fonts.medium}}>{ui('common.table_game_number',{number:index+1})}</Text>
            {balances(game.record_balances||game.balances||[],`table-summary-game-${index+1}`)}
          </View>)}
        </>}
      </View>
    </RoomSheet>
  </>;
}
