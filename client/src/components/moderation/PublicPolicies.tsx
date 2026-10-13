import {AppText as Text} from '../AppText';
import { createContext, useContext, useEffect, useState } from 'react';
import {Linking, Pressable, View} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ui } from '../../i18n/copy.ts';
import { useUiLanguage } from '../../i18n/useUiLanguage';
import { sharedRequest } from '../../multiplayer/api';
import { AccountPage } from '../AccountPage';
import { Button, Copy } from './Controls';
import { fonts, useTheme } from '../../theme';
import { CommunityRulesContent, rulesText } from './CommunityRules';
export type PolicyPage='privacy'|'support'|'community-rules'|'terms';
export const PolicyNavigation=createContext<(page:PolicyPage)=>void>(()=>{});
export const labels={en:{privacy:'Privacy',support:'Support', 'community-rules':'Community rules',terms:'Terms'},ne:{privacy:'गोपनीयता',support:'सहयोग','community-rules':'समुदाय नियम',terms:'सर्तहरू'}};
export function PolicyLinks({includeCommunityRules = true, exclude}:{includeCommunityRules?:boolean;exclude?:PolicyPage} = {}){
 const ne=useUiLanguage()==='ne',open=useContext(PolicyNavigation),{colors:c}=useTheme();
 const pages:PolicyPage[]=includeCommunityRules?['privacy','terms','community-rules','support']:['privacy','terms','support'];
 return <View style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'center',columnGap:8,marginTop:20}}>{pages.filter(p=>p!==exclude).map((p,i)=><View key={p} style={{flexDirection:'row',alignItems:'center',gap:8}}>
  {i>0&&<Text accessibilityElementsHidden style={{color:c.textMuted}}>·</Text>}
  <Pressable accessibilityRole="link" onPress={()=>open(p)} style={{minHeight:44,justifyContent:'center'}}><Text style={{fontFamily:fonts.body,fontSize:12,color:c.textMuted}}>{labels[ne?'ne':'en'][p]}</Text></Pressable>
 </View>)}</View>;
}
type Metadata={ready:boolean;operator:string;contact:string;minimum_age:number|null;backups:string};
export function PublicPolicyPage({page,onBack}:{page:PolicyPage;onBack:()=>void}){
 const {colors:c}=useTheme();
 const ne=useUiLanguage()==='ne';const [meta,setMeta]=useState<Metadata|null>(null);
 useEffect(()=>{const a=new AbortController();void sharedRequest<Metadata>('/public/policy',null,undefined,a.signal).then(v=>{if(!a.signal.aborted)setMeta(v);}).catch(()=>{});return()=>a.abort();},[]);
 const privacyHeadings=ne?['हामीले सङ्कलन गर्ने जानकारी','दृश्यता र सुरक्षा','डेटा भण्डारण र सेवाहरू','डेटा राख्ने अवधि','खाता मेटाउने प्रक्रिया','सुरक्षा र उपकरणको डेटा']:['Information We Collect','Visibility and Safety','Data Storage and Services','Data Retention','Account Deletion','Security and Device Data'];
 const termsHeadings=ne?['सेवाको प्रयोग','खाताको जिम्मेवारी','समुदाय दिशानिर्देश','मोडरेशन र कारबाही','सेवाको उपलब्धता','खाता मेटाउने प्रक्रिया']:['Use of Service','Account Responsibility','Community Guidelines','Moderation and Enforcement','Service Availability','Account Deletion'];
 const structuredPolicy=page==='privacy'||page==='terms'||page==='community-rules'||page==='support';
 const paragraphs=page==='community-rules'?rulesText[ne?'ne':'en']:page==='privacy'?(ne?[
 'खाता चलाउन प्रयोगकर्ता नाम, प्रोफाइल नाम, इमेल, सुरक्षित पासवर्ड ह्यास, सत्र र रिकभरी विवरण राखिन्छ। मित्रता, ब्लक, निमन्त्रणा, च्याट, खेल अङ्क र साझा खेल इतिहास पनि राखिन्छ।',
 'प्रोफाइल अन्य खेलाडीले देख्छन्। च्याट सम्बन्धित कोठा/टेबल वा प्रत्यक्ष कुराकानीका सहभागीले देख्छन्। मोडरेटरले रिपोर्ट गरिएको सामग्री हेर्न सक्छन्, तर रिपोर्ट गरिएका खेलाडीलाई तपाईंको पहिचान खुलाइँदैन।',
 'पूर्वाधारमा PostgreSQL र Redis प्रयोग हुन्छन्। इमेल प्रमाणिकरण र रिकभरी Resend मार्फत पठाइन्छ। सामाजिक लगइनका विकल्प अहिले बन्द छन्।',
 'खाता र खेल रेकर्ड खाता प्रयोग हुँदा राखिन्छन्। उजुरी र कारबाही इतिहास ९० दिनपछि नियमित सफाइमा हट्छन्। हटाइएको सन्देश च्याट र पुनःजडानमा लुकाइन्छ; मूल अभिलेख खाता मेटाउने प्रक्रियासम्म रहन सक्छ।',
 'Profile वा सार्वजनिक /delete-account बाट खाता मेटाउन सकिन्छ। व्यक्तिगत जानकारी हटाइन्छ र सत्र रद्द हुन्छन्; अरूको खेल निरन्तरताका लागि साझा खेल रेकर्ड पहिचानविहीन हुन सक्छन्।',
 'सुरक्षा र सेवा सञ्चालनका लागि अनुरोध तथा त्रुटि लगहरू र दर सीमा पहिचान प्रयोग हुन्छन्। वेब/मोबाइलमा लगइन सत्र र भाषा/थिम प्राथमिकता राखिन्छन्।'
 ]:[
 'We collect account information (username, profile name, email, password hash, sessions, and recovery records), friendships, invitations, blocked users, chat messages, game scores, and shared game history.',
 'Your profile is visible to other players. Messages are visible to their intended participants. Moderators may review reported content, but your identity is not disclosed to reported players.',
 'We use PostgreSQL and Redis to operate the service and Resend for account verification and recovery emails. Social sign-in is currently disabled.',
 'Account and game data are retained while your account is active. Reports and moderation records are deleted after 90 days. Removed messages are hidden from the app but may remain in storage until account deletion.',
 'You can request deletion through Profile or /delete-account. Personal information is erased and sessions revoked. Shared game history may be anonymized to preserve other players’ records.',
 'We maintain operational logs and rate-limit identifiers for reliability and abuse prevention. Your device stores login sessions and language/theme preferences.'
 ]):page==='terms'?(ne?["Bhidne Ho मनोरञ्जनका लागि बनाइएको बहुखेलाडी कार्ड खेल प्लेटफर्म हो। खेल अङ्क भर्चुअल हुन्, तिनको आर्थिक मूल्य छैन र नगद वा पुरस्कारसँग साट्न मिल्दैन।", "तपाईं आफ्नो खाताको सुरक्षा र त्यस खाताबाट गरिएका गतिविधिका लागि जिम्मेवार हुनुहुन्छ।", "अन्य खेलाडीलाई सम्मानपूर्वक व्यवहार गर्नुहोस्। उत्पीडन, अपमानजनक भाषा, छल, स्प्याम र अनुचित सामग्री निषेध छन्। च्याट प्रयोग गर्न वा निमन्त्रणा पठाउनुअघि समुदाय नियम स्वीकार गर्नुपर्छ।", "नियम उल्लङ्घनमा सामग्री हटाउन, च्याट सीमित गर्न, अस्थायी निलम्बन गर्न वा खाता बन्द गर्न सकिन्छ। सहयोगमार्फत मोडरेशन निर्णयविरुद्ध अपिल गर्न सकिन्छ।", "मर्मत, सुरक्षा वा सुधारका लागि सेवा अद्यावधिक, परिवर्तन वा अस्थायी रूपमा रोक्न सक्छौँ। निर्बाध उपलब्धताको ग्यारेन्टी छैन।", "हाम्रो गोपनीयता नीतिअनुसार Profile वा /delete-account बाट खाता मेटाउन अनुरोध गर्न सकिन्छ।"]:["Bhidne Ho is a recreational multiplayer card gaming platform. Game points are virtual, have no monetary value, and cannot be exchanged for cash or prizes.", "You are responsible for maintaining your account security and activities conducted through your account.", "Treat other players respectfully. Harassment, abusive language, cheating, spam, and inappropriate content are prohibited. You must accept the community rules before using chat or sending invitations.", "Violations may result in content removal, chat restrictions, temporary suspension, or account termination. You may appeal moderation decisions through support.", "We may update, modify, or temporarily interrupt the service for maintenance, security, or improvements. Uninterrupted availability is not guaranteed.", "You may request account deletion through Profile or /delete-account, subject to our Privacy Policy."]):[];
 return <AccountPage compact footer={null}>
  <Pressable accessibilityRole="button" accessibilityLabel={ui('common.back')} onPress={onBack}
    style={{alignSelf:'flex-start',minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}>
   <Ionicons name="arrow-back" size={22} color={c.textMuted} />
  </Pressable>
  {structuredPolicy?<Text accessibilityRole="header" style={{color:c.text,fontFamily:fonts.medium,fontSize:24}}>{page==='privacy'?(ne?'गोपनीयता नीति':'Privacy Policy'):page==='terms'?(ne?'सेवाका सर्तहरू':'Terms of Service'):page==='community-rules'?(ne?'समुदाय नियम':'Community Rules'):(ne?'सहयोग':'Support')}</Text>:<Copy>{labels[ne?'ne':'en'][page]}</Copy>}
  {!meta?.ready&&<Copy alert>{ne?'प्रकाशन विवरण अझै पुष्टि हुँदैछ।':'Publication details are awaiting operator confirmation.'}</Copy>}
  {structuredPolicy?<Text style={{color:c.text,fontFamily:fonts.medium,fontSize:14}}>Bhidne Ho</Text>:!!meta?.operator&&<Copy>{meta.operator}</Copy>}
  {(structuredPolicy||!!meta?.minimum_age)&&<Copy><Text style={{fontFamily:fonts.medium}}>{ne?'न्यूनतम उमेर: ':'Minimum age: '}</Text>{meta?.minimum_age??18}+</Copy>}
  {page==='support'?<SupportContent/>:page==='community-rules'?<CommunityRulesContent includeIdentity={false}/>:paragraphs.map((p,i)=>structuredPolicy?<View key={i} style={{gap:6,marginTop:8}}>
    <Text accessibilityRole="header" style={{color:c.text,fontFamily:fonts.medium,fontSize:17}}>{(page==='privacy'?privacyHeadings:termsHeadings)[i]}</Text>
    <Copy>{page==='privacy'&&i===4&&!ne?<>You can request deletion through <Text style={{fontFamily:fonts.medium}}>Profile</Text> or <Text style={{fontFamily:fonts.medium}}>/delete-account</Text>. Personal information is erased and sessions revoked. Shared game history may be anonymized to preserve other players' records.</>:page==='terms'&&i===5&&!ne?<>You may request account deletion through <Text style={{fontFamily:fonts.medium}}>Profile</Text> or <Text style={{fontFamily:fonts.medium}}>/delete-account</Text>, subject to our Privacy Policy.</>:p}</Copy>
  </View>:<Copy key={i}>{p}</Copy>)}
  {page==='privacy'&&<Copy>{meta?.backups || (ne?'डेटाबेस ब्याकअप हाल कन्फिगर गरिएको छैन।':'Database backups are currently not configured.')}</Copy>}
  {page==='terms'&&<View style={{gap:6,marginTop:8}}>
    <Text accessibilityRole="header" style={{color:c.text,fontFamily:fonts.medium,fontSize:17}}>{ne?'सम्पर्क':'Contact'}</Text>
    <Copy>{ne?'प्रश्न, उजुरी वा अपिलका लागि सम्पर्क गर्नुहोस्:':'For questions, reports, or appeals, contact'}</Copy>
    <Button label="support-bhidne-ho@lfactorial.com" onPress={()=>void Linking.openURL('mailto:support-bhidne-ho@lfactorial.com')} />
  </View>}
  {page==='privacy'&&!!meta?.contact&&<Button label={meta.contact} onPress={()=>void Linking.openURL(`mailto:${meta.contact}`)} />}
  {page==='support'&&<View style={{borderTopWidth:1,borderColor:c.borderSubtle,marginTop:12}}/>}
  <PolicyLinks exclude={page==='support'?'support':undefined} />
 </AccountPage>;
}

function SupportContent() {
 const ne=useUiLanguage()==='ne',{colors:c}=useTheme();
 const section=(title:string,children:React.ReactNode)=><View style={{gap:6,marginTop:8}}>
  <Text accessibilityRole="header" style={{color:c.text,fontFamily:fonts.medium,fontSize:17}}>{title}</Text>{children}
 </View>;
 const bold=(text:string)=><Text style={{fontFamily:fonts.medium}}>{text}</Text>;
 return <>
  {section(ne?'मद्दत र सहायता':'Help and Assistance',<>
   <Copy>{ne?'खाता, खेल वा प्राविधिक समस्यामा सहायता चाहिएको छ? आफ्नो प्रयोगकर्ता नाम, समस्या भएको अनुमानित समय र छोटो विवरणसहित सहयोग टोलीलाई सम्पर्क गर्नुहोस्।':'Need help with your account, gameplay, or technical issues? Contact our support team with your username, approximate time of the issue, and a brief description.'}</Copy>
   <Copy>{bold(ne?'आफ्नो पासवर्ड, प्रमाणिकरण कोड वा रिकभरी लिङ्क कहिल्यै नबाँड्नुहोस्।':'Never share your password, verification codes, or recovery links.')}</Copy>
  </>)}
  {section(ne?'दुर्व्यवहारको उजुरी':'Report Abuse',<Copy>{ne?<>{bold('Report')} प्रयोग गरेर अनुचित खेलाडी वा सन्देशबारे उजुरी गर्नुहोस्। अनिच्छित सम्पर्क रोक्न {bold('Block')} प्रयोग गर्नुहोस्।</>:<>Use {bold('Report')} on a player or message to flag inappropriate behavior. Use {bold('Block')} to prevent unwanted contact.</>}</Copy>)}
  {section(ne?'अपिल':'Appeals',<Copy>{ne?'तपाईंको खाता वा च्याट अधिकार सीमित गरिएको छ भने सान्दर्भिक विवरणसहित सहयोगमा सम्पर्क गरेर समीक्षा अनुरोध गर्न सक्नुहुन्छ।':'If your account or chat privileges have been restricted, you may request a review by contacting support with relevant details.'}</Copy>)}
  {section(ne?'खाता र गोपनीयतासम्बन्धी अनुरोध':'Account and Privacy Requests',<Copy>{ne?<>{bold('Profile')} वा {bold('/delete-account')} बाट खाता सेटिङ व्यवस्थापन वा खाता मेटाउने अनुरोध गर्नुहोस्।</>:<>Manage account settings or request deletion through {bold('Profile')} or {bold('/delete-account')}.</>}</Copy>)}
  {section(ne?'हामीलाई सम्पर्क गर्नुहोस्':'Contact Us',<>
   <Copy>{bold(ne?'इमेल:':'Email:')}</Copy>
   <Button label="support-bhidne-ho@lfactorial.com" onPress={()=>void Linking.openURL('mailto:support-bhidne-ho@lfactorial.com')} />
   <Copy>{ne?'सामान्य प्रश्न, प्राविधिक सहायता, मोडरेशन अपिल वा गोपनीयतासम्बन्धी चासोका लागि।':'For general inquiries, technical assistance, moderation appeals, or privacy concerns.'}</Copy>
  </>)}
 </>;
}
