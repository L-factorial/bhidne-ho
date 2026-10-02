import { createContext, useContext, useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ui } from '../../i18n/copy.ts';
import { useUiLanguage } from '../../i18n/useUiLanguage';
import { sharedRequest } from '../../multiplayer/api';
import { AccountPage } from '../AccountPage';
import { Button, Copy } from './Controls';
import { fonts, useTheme } from '../../theme';
import { rulesText } from './CommunityRules';
export type PolicyPage='privacy'|'support'|'community-rules'|'terms';
export const PolicyNavigation=createContext<(page:PolicyPage)=>void>(()=>{});
export const labels={en:{privacy:'Privacy',support:'Support', 'community-rules':'Community rules',terms:'Terms'},ne:{privacy:'गोपनीयता',support:'सहयोग','community-rules':'समुदाय नियम',terms:'सर्तहरू'}};
export function PolicyLinks(){
 const ne=useUiLanguage()==='ne',open=useContext(PolicyNavigation),{colors:c}=useTheme();
 const pages:PolicyPage[]=['privacy','terms','community-rules','support'];
 return <View style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'center',columnGap:8,marginTop:20}}>{pages.map((p,i)=><View key={p} style={{flexDirection:'row',alignItems:'center',gap:8}}>
  {i>0&&<Text accessibilityElementsHidden style={{color:c.textMuted}}>·</Text>}
  <Pressable accessibilityRole="link" onPress={()=>open(p)} style={{minHeight:44,justifyContent:'center'}}><Text style={{fontFamily:fonts.body,fontSize:12,color:c.textMuted}}>{labels[ne?'ne':'en'][p]}</Text></Pressable>
 </View>)}</View>;
}
type Metadata={ready:boolean;operator:string;contact:string;minimum_age:number|null;backups:string};
export function PublicPolicyPage({page,onBack}:{page:PolicyPage;onBack:()=>void}){
 const {colors:c}=useTheme();
 const ne=useUiLanguage()==='ne';const [meta,setMeta]=useState<Metadata|null>(null);
 useEffect(()=>{const a=new AbortController();void sharedRequest<Metadata>('/public/policy',null,undefined,a.signal).then(v=>{if(!a.signal.aborted)setMeta(v);}).catch(()=>{});return()=>a.abort();},[]);
 const paragraphs=page==='community-rules'?rulesText[ne?'ne':'en']:page==='privacy'?(ne?[
 'खाता चलाउन प्रयोगकर्ता नाम, प्रोफाइल नाम, इमेल, सुरक्षित पासवर्ड ह्यास, सत्र र रिकभरी विवरण राखिन्छ। मित्रता, ब्लक, निमन्त्रणा, च्याट, खेल अङ्क र साझा खेल इतिहास पनि राखिन्छ।',
 'प्रोफाइल अन्य खेलाडीले देख्छन्। च्याट सम्बन्धित कोठा/टेबल वा प्रत्यक्ष कुराकानीका सहभागीले देख्छन्। उजुरीमा सम्बन्धित सन्देशको प्रतिलिपि र उजुरी विवरण मोडरेटरले हेर्न सक्छन्।',
 'पूर्वाधारमा PostgreSQL र Redis प्रयोग हुन्छन्। इमेल प्रमाणिकरण र रिकभरी Resend मार्फत पठाइन्छ। सामाजिक लगइनका विकल्प अहिले बन्द छन्।',
 'खाता र खेल रेकर्ड खाता प्रयोग हुँदा राखिन्छन्। उजुरी र कारबाही इतिहास ९० दिनपछि नियमित सफाइमा हट्छन्। हटाइएको सन्देश च्याट र पुनःजडानमा लुकाइन्छ; मूल अभिलेख खाता मेटाउने प्रक्रियासम्म रहन सक्छ।',
 'Profile वा सार्वजनिक /delete-account बाट खाता मेटाउन सकिन्छ। व्यक्तिगत जानकारी हटाइन्छ र सत्र रद्द हुन्छन्; अरूको खेल निरन्तरताका लागि साझा खेल रेकर्ड पहिचानविहीन हुन सक्छन्।',
 'सुरक्षा र सेवा सञ्चालनका लागि अनुरोध तथा त्रुटि लगहरू र दर सीमा पहिचान प्रयोग हुन्छन्। वेब/मोबाइलमा लगइन सत्र र भाषा/थिम प्राथमिकता राखिन्छन्।'
 ]:[
 'We store your username, profile name, email, password hash, sessions and recovery records to operate your account. We also store friendships, blocks, invitations, chat, game points and shared game history.',
 'Your profile is visible to other players. Messages are visible to the relevant room/table or direct conversation participants. Moderators can access reported message copies and report details; reporting does not reveal your identity to the reported player.',
 'The service uses PostgreSQL and Redis infrastructure. Resend delivers account verification and recovery emails. Social sign-in options are currently disabled.',
 'Account and game records remain while your account is in use. Reports and moderation action history expire after 90 days and are removed by periodic cleanup. Removed messages are hidden from chat/history/reconnect, but original stored records may remain until account erasure.',
 'Request deletion in Profile or at /delete-account. Personal data is erased and sessions revoked; shared game records may be anonymized to preserve other players’ games.',
 'Operational request/error logs and rate-limit identifiers support service reliability and abuse prevention. Your device stores sign-in sessions and language/theme preferences.'
 ]):page==='terms'?(ne?['यो खेल मनोरञ्जनका लागि हो। खेल अङ्कको नगद मूल्य छैन। समुदाय नियम स्वीकार गरेपछि मात्र च्याट र निमन्त्रणा पठाउन सकिन्छ।','तपाईं आफ्नो खाताको सुरक्षाका लागि जिम्मेवार हुनुहुन्छ। नियम उल्लङ्घनमा सामग्री हटाउन, च्याट रोक्न वा खाता निलम्बन गर्न सकिन्छ। सहयोगमार्फत अपिल गर्न सकिन्छ।']:['This is a recreational game. Game points have no cash value. Accept the community rules before sending chat or invitations.','Keep your account secure. Rule violations may result in content removal, chat restrictions or account suspension. You may appeal through support.']):(ne?['समस्या वा अपिलका लागि आफ्नो प्रयोगकर्ता नाम, समस्या भएको समय र सान्दर्भिक विवरण पठाउनुहोस्। पासवर्ड वा रिकभरी लिंक नपठाउनुहोस्।','दुर्व्यवहारको उजुरी खेलाडी वा सन्देशको Report बाट गर्नुहोस्। अनिच्छित सम्पर्क रोक्न Block प्रयोग गर्नुहोस्।']:['For help or an appeal, provide your username, the time of the issue and relevant details. Never send your password or recovery links.','Report abuse using Report on a player or message. Use Block to stop unwanted contact.']);
 return <AccountPage compact footer={null}>
  <Pressable accessibilityRole="button" accessibilityLabel={ui('common.back')} onPress={onBack}
    style={{alignSelf:'flex-start',minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}>
   <Ionicons name="arrow-back" size={22} color={c.textMuted} />
  </Pressable>
  <Copy>{labels[ne?'ne':'en'][page]}</Copy>
  {!meta?.ready&&<Copy alert>{ne?'प्रकाशन विवरण अझै पुष्टि हुँदैछ।':'Publication details are awaiting operator confirmation.'}</Copy>}
  {!!meta?.operator&&<Copy>{meta.operator}</Copy>}
  {!!meta?.minimum_age&&<Copy>{ne?'न्यूनतम उमेर: ':'Minimum age: '}{meta.minimum_age}+</Copy>}
  {paragraphs.map((p,i)=><Copy key={i}>{p}</Copy>)}
  {page==='privacy'&&!!meta?.backups&&<Copy>{meta.backups}</Copy>}
  {!!meta?.contact&&<Button label={meta.contact} onPress={()=>void Linking.openURL(`mailto:${meta.contact}`)} />}
  <PolicyLinks />
 </AccountPage>;
}
