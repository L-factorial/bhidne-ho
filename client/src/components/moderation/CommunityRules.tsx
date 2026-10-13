import {AppText as Text} from '../AppText';
import { GameModal as Modal } from '../GameModal';
import { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {Linking, Pressable, View} from 'react-native';
import type { Session } from '../../multiplayer/session';
import { sharedRequest } from '../../multiplayer/api';
import { useUiLanguage } from '../../i18n/useUiLanguage';
import { AppHeader } from '../AppHeader';
import { FormScrollView } from '../FormInput';
import { Button, Copy } from './Controls';
import { fonts, useTheme } from '../../theme';

export const rulesText={
  "en": [
    "Be respectful and play fairly. Harassment, threats, hate speech, bullying, sexual exploitation, and abusive or inappropriate content are prohibited.",
    "Do not share others' private information, impersonate users, scam, spam, advertise, or repeatedly send unwanted messages or invitations.",
    "Cheating, exploiting game mechanics, and intentionally disrupting games are prohibited.",
    "Game points and settlements have no monetary value and cannot be exchanged for cash or prizes. Real-money gambling or arranging wagers through the platform is strictly prohibited.",
    "Use Report to flag inappropriate players or messages and Block to prevent unwanted contact. Reports are confidential. False or malicious reporting is prohibited.",
    "Moderators may review reports, remove content, restrict chat or invitations, and suspend or terminate accounts. Moderation decisions are documented with reasons."
  ],
  "ne": [
    "सम्मानपूर्वक व्यवहार गर्नुहोस् र निष्पक्ष खेल्नुहोस्। उत्पीडन, धम्की, घृणायुक्त अभिव्यक्ति, हेपाइ, यौन शोषण र अपमानजनक वा अनुचित सामग्री निषेध छन्।",
    "अरूको निजी जानकारी नबाँड्नुहोस्। प्रयोगकर्ताको नक्कल, ठगी, स्प्याम, विज्ञापन वा बारम्बार अनिच्छित सन्देश वा निमन्त्रणा पठाउनु निषेध छ।",
    "छल, खेल प्रणालीको दुरुपयोग र जानाजानी खेलमा बाधा पुर्‍याउनु निषेध छ।",
    "खेल अङ्क र हिसाबको आर्थिक मूल्य छैन र नगद वा पुरस्कारसँग साट्न मिल्दैन। यस प्लेटफर्मबाट वास्तविक पैसाको जुवा खेल्नु वा बाजी मिलाउनु कडाइका साथ निषेध छ।",
    "अनुचित खेलाडी वा सन्देशबारे Report प्रयोग गर्नुहोस् र अनिच्छित सम्पर्क रोक्न Block प्रयोग गर्नुहोस्। उजुरी गोप्य हुन्छन्। झुटा वा दुर्भावनापूर्ण उजुरी निषेध छन्।",
    "मोडरेटरले उजुरी हेर्न, सामग्री हटाउन, च्याट वा निमन्त्रणा सीमित गर्न र खाता निलम्बन वा बन्द गर्न सक्छन्। मोडरेशन निर्णय कारणसहित अभिलेख गरिन्छन्।"
  ]
};
const rulesHeadings={
  "en": [
    "Respect Other Players",
    "Protect Privacy and Safety",
    "Fair Play",
    "Game Points Only",
    "Reporting and Blocking",
    "Moderation and Enforcement"
  ],
  "ne": [
    "अन्य खेलाडीलाई सम्मान गर्नुहोस्",
    "गोपनीयता र सुरक्षा जोगाउनुहोस्",
    "निष्पक्ष खेल",
    "खेल अङ्क मात्र",
    "उजुरी र ब्लक",
    "मोडरेशन र कारबाही"
  ]
};
export function CommunityRulesContent({includeIdentity=true}:{includeIdentity?:boolean}) {
 const ne=useUiLanguage()==='ne',{colors:c}=useTheme();
 const heading=(label:string)=><Text accessibilityRole="header" style={{color:c.text,fontFamily:fonts.medium,fontSize:17}}>{label}</Text>;
 return <View style={{gap:18}}>
  {includeIdentity&&<><Text style={{color:c.text,fontFamily:fonts.medium,fontSize:14}}>Bhidne Ho</Text><Copy><Text style={{fontFamily:fonts.medium}}>{ne?'न्यूनतम उमेर: ':'Minimum age: '}</Text>18+</Copy></>}
  {rulesText[ne?'ne':'en'].map((paragraph,index)=><View key={index} style={{gap:6}}>
   {heading(rulesHeadings[ne?'ne':'en'][index])}
   <Copy>{!ne&&index===4?<>Use <Text style={{fontFamily:fonts.medium}}>Report</Text> to flag inappropriate players or messages and <Text style={{fontFamily:fonts.medium}}>Block</Text> to prevent unwanted contact. Reports are confidential. False or malicious reporting is prohibited.</>:paragraph}</Copy>
  </View>)}
  <View style={{gap:6}}>{heading(ne?'अपिल र सहयोग':'Appeals and Support')}
   <Copy>{ne?'मोडरेशन कारबाहीविरुद्ध अपिल गर्न वा समस्या बताउन सम्पर्क गर्नुहोस्:':'You may appeal moderation actions or report concerns at'}</Copy>
   <Button label="support-bhidne-ho@lfactorial.com" onPress={()=>void Linking.openURL('mailto:support-bhidne-ho@lfactorial.com')} />
  </View>
 </View>;
}
export function CommunityRulesEntry({session,visible,onClose,onAccepted}:{session:Session;visible?:boolean;onClose?:()=>void;onAccepted?:()=>void}){
 const ne=useUiLanguage()==='ne',{colors:c}=useTheme();const [localOpen,setOpen]=useState(false),[accepted,setAccepted]=useState(false),[version,setVersion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[until,setUntil]=useState<string|null>(null);
 const open=visible??localOpen;const close=()=>{setOpen(false);onClose?.();};
 useEffect(()=>{if(!session.token || visible!==undefined&&!open)return;setError('');const abort=new AbortController();void sharedRequest<{accepted:boolean;version:string;muted_until:string|null}>('/me/community-rules',session,undefined,abort.signal).then(s=>{if(!abort.signal.aborted){setAccepted(s.accepted);setVersion(s.version);setUntil(s.muted_until);if(visible!==undefined&&open&&s.accepted)onAccepted?.();}}).catch(()=>{if(!abort.signal.aborted)setError(ne?'नियम लोड गर्न सकिएन। बन्द गरेर फेरि खोल्नुहोस्।':'Could not load Community Rules. Close and reopen to try again.');});return()=>abort.abort();},[session.token,open]);
 async function accept(){setBusy(true);setError('');try{await sharedRequest('/me/community-rules',session,{accepted:true,version});setAccepted(true);onAccepted?.();}catch{setError(ne?'स्वीकार गर्न सकिएन। फेरि प्रयास गर्नुहोस्।':'Could not save acceptance. Please try again.');}finally{setBusy(false);}}
 return <>{visible===undefined&&<Pressable accessibilityRole="button" onPress={()=>setOpen(true)} style={{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:6,minHeight:36}}><Ionicons name="shield-checkmark-outline" size={14} color={c.textMuted}/><Text style={{color:c.textMuted,fontSize:11}}>{ne?'समुदाय नियम':'Community rules'}</Text></Pressable>}
 {open&&<Modal visible animationType="slide" onRequestClose={close}><FormScrollView style={{flex:1,backgroundColor:c.background}} contentContainerStyle={{padding:20,paddingTop:48,alignItems:'center'}}><View style={{width:'100%',maxWidth:680,gap:18}}>
 <AppHeader title={ne?'समुदाय नियम':'Community Rules'} hideProfile onBack={close} />
 <CommunityRulesContent />
 {!!until&&Date.parse(until)>Date.now()&&<Copy>{ne?'च्याट रोकिएको समय: ':'Chat muted until: '}{new Date(until).toLocaleString()}</Copy>}
 {!!error&&<Copy alert>{error}</Copy>}
 <Button label={accepted?(ne?'नियम स्वीकार गरिसक्नुभयो':'Rules accepted'):(ne?'म नियम स्वीकार गर्छु':'I agree to these rules')} disabled={accepted||busy||!version} onPress={()=>void accept()} />
 </View></FormScrollView></Modal>}</>;
}


/** Preserve the intended chat while the current account reviews the rules. */
export function useCommunityRulesGate(session: Session) {
 const [open,setOpen]=useState(false),[error,setError]=useState('');
 const pending=useRef<(()=>void)|null>(null),request=useRef<AbortController|null>(null);
 const ne=useUiLanguage()==='ne';
 useEffect(()=>{setOpen(false);setError('');return()=>{request.current?.abort();pending.current=null;};},[session.token]);
 function close(){pending.current=null;setOpen(false);}
 async function run(action:()=>void){
  request.current?.abort();const abort=new AbortController();request.current=abort;pending.current=action;setError('');
  try{const status=await sharedRequest<{accepted:boolean}>('/me/community-rules',session,undefined,abort.signal);
   if(abort.signal.aborted)return;
   if(status.accepted){pending.current=null;action();}else setOpen(true);
  }catch{if(!abort.signal.aborted)setError(ne?'च्याट प्रयोग गर्न समुदाय नियम खोल्नुहोस् र स्वीकार गर्नुहोस्।':'Open Community Rules and accept them to use chat.');}
 }
 const view=<>{!!error&&<Pressable accessibilityRole="button" onPress={()=>setOpen(true)}><Copy alert>{error}</Copy></Pressable>}
  <CommunityRulesEntry session={session} visible={open} onClose={close} onAccepted={()=>{const action=pending.current;pending.current=null;setOpen(false);action?.();}} /></>;
 return {run,view};
}
