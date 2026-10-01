import { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import type { Session } from '../../multiplayer/session';
import { sharedRequest } from '../../multiplayer/api';
import { useUiLanguage } from '../../i18n/useUiLanguage';
import { AppHeader } from '../AppHeader';
import { FormScrollView } from '../FormInput';
import { Button, Copy } from './Controls';
import { useTheme } from '../../theme';

export const rulesText={
 en:['Be respectful. No harassment, threats, hate speech, sexual exploitation, or abusive content.',
 'Do not share private information, impersonate others, scam, advertise, spam, or repeatedly send unwanted invitations.',
 'Use Report on a player or message and Block to stop unwanted contact. Moderators can review reported content, remove messages, mute chat/invitations, or suspend accounts. Report decisions and actions require reasons.',
 'Game balances and settlements are game points only. They have no cash value. Do not arrange real-money gambling through this app.',
 'Reports are private. Do not submit false reports or misuse moderation. Contact support to appeal an action.'],
 ne:['सम्मानपूर्वक व्यवहार गर्नुहोस्। उत्पीडन, धम्की, घृणा, यौन शोषण वा अपमानजनक सामग्री निषेध छ।',
 'निजी जानकारी नबाँड्नुहोस्। अरूको नक्कल, ठगी, विज्ञापन, स्प्याम वा बारम्बार अनिच्छित निमन्त्रणा नपठाउनुहोस्।',
 'खेलाडी वा सन्देशमा उजुरी गर्नुहोस् र अनिच्छित सम्पर्क रोक्न ब्लक गर्नुहोस्। मोडरेटरले उजुरी हेर्न, सन्देश हटाउन, च्याट/निमन्त्रणा रोक्न वा खाता निलम्बन गर्न सक्छन्। निर्णय र कारबाहीमा कारण आवश्यक छ।',
 'खेलको ब्यालेन्स र हिसाब खेल अङ्क मात्र हुन्। तिनको नगद मूल्य हुँदैन। यस एपबाट वास्तविक पैसाको जुवा नमिलाउनुहोस्।',
 'उजुरी गोप्य हुन्छ। झुटा उजुरी वा मोडरेसनको दुरुपयोग नगर्नुहोस्। कारबाहीविरुद्ध अपिल गर्न सहयोगमा सम्पर्क गर्नुहोस्।']
};
export function CommunityRulesEntry({session}:{session:Session}){
 const ne=useUiLanguage()==='ne',{colors:c}=useTheme();const [open,setOpen]=useState(false),[accepted,setAccepted]=useState(false),[version,setVersion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[until,setUntil]=useState<string|null>(null);
 useEffect(()=>{const abort=new AbortController();void sharedRequest<{accepted:boolean;version:string;muted_until:string|null}>('/me/community-rules',session,undefined,abort.signal).then(s=>{if(!abort.signal.aborted){setAccepted(s.accepted);setVersion(s.version);setUntil(s.muted_until);}}).catch(()=>{});return()=>abort.abort();},[session.token,open]);
 async function accept(){setBusy(true);setError('');try{await sharedRequest('/me/community-rules',session,{accepted:true,version});setAccepted(true);}catch{setError(ne?'स्वीकार गर्न सकिएन। फेरि प्रयास गर्नुहोस्।':'Could not save acceptance. Please try again.');}finally{setBusy(false);}}
 return <><Button label={ne?'समुदाय नियम':'Community rules'} onPress={()=>setOpen(true)} />
 {open&&<Modal visible animationType="slide" onRequestClose={()=>setOpen(false)}><FormScrollView style={{flex:1,backgroundColor:c.background}} contentContainerStyle={{padding:20,paddingTop:48,alignItems:'center'}}><View style={{width:'100%',maxWidth:680,gap:18}}>
 <AppHeader title={ne?'समुदाय नियम':'Community rules'} hideProfile inlineActions={<Button label={ne?'पछाडि':'Back'} onPress={()=>setOpen(false)} />} />
 {rulesText[ne?'ne':'en'].map((p,i)=><Copy key={i}>{p}</Copy>)}
 {!!until&&Date.parse(until)>Date.now()&&<Copy>{ne?'च्याट रोकिएको समय: ':'Chat muted until: '}{new Date(until).toLocaleString()}</Copy>}
 {!!error&&<Copy alert>{error}</Copy>}
 <Button label={accepted?(ne?'नियम स्वीकार गरिसक्नुभयो':'Rules accepted'):(ne?'म नियम स्वीकार गर्छु':'I agree to these rules')} disabled={accepted||busy||!version} onPress={()=>void accept()} />
 </View></FormScrollView></Modal>}</>;
}
