import {AppText as Text} from './AppText';
import { GameModal as Modal } from './GameModal';
import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { Ionicons } from '@expo/vector-icons';
import { BrandIcon } from './BrandArt';
import { KeyboardFrame } from './KeyboardFrame';
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import {Platform, Pressable, ScrollView, View, useWindowDimensions} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TableShareSheet } from './ShareLink';
import { fonts, radii, typography, useTheme } from '../theme';
import { HeaderProfileContext } from './AppHeader';
import { CardThemePicker } from './CardThemePicker';
import { RoomSheet } from './RoomSheet';
import { ThemeAction } from './ThemeAction';
import { LanguageToggle } from './LanguageToggle';
import { HeaderAction } from './HeaderAction';
import { ProfileModal } from './ProfileModal';
import { useTranslation } from 'react-i18next';

export const GameRoomNameContext = createContext('');

export function GameTableHeader({ title, tableName, path, game, roomId, matchId, onBack, endControl, children, mobileTestIds = false, compact = false, drawerMetadata, showShare = false }: {
  tableName?: string; title: string; path?: string; game: string; roomId?: string; matchId?: string; onBack: () => void; endControl?: ReactNode;
  children?: ReactNode | ((closeMenu: () => void) => ReactNode);
  mobileTestIds?: boolean; compact?: boolean; drawerMetadata?: ReactNode; showShare?: boolean;
}) {
  useUiLanguage();
  const { colors } = useTheme();
  const roomName=useContext(GameRoomNameContext);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const mobile = useWindowDimensions().width < 900;
  const small = mobile || compact;
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const renderProfile = useContext(HeaderProfileContext);
  const [cardThemesOpen, setCardThemesOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  useEffect(() => { if (!showShare) setSharing(false); }, [showShare]);
  useEffect(() => {
    if (!open || !drawerMetadata || Platform.OS !== 'web') return;
    // A child sheet captures at window first; otherwise consume Escape before the game modal.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    };
    document.addEventListener('keyup', escape, true);
    return () => document.removeEventListener('keyup', escape, true);
  }, [open, !!drawerMetadata]);
  const menuControls=<View testID={`${game}-menu-settings`} style={{gap:10,paddingVertical:8}}>
    {!!roomId && !!matchId && <Pressable accessibilityRole="button" accessibilityLabel={ui('rooms.share_table_link_or_code')} onPress={()=>{setOpen(false);setSharing(true);}} style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:8}}><Ionicons name="share-outline" size={22} color={colors.accent}/><Text style={{color:colors.text,fontFamily:fonts.medium}}>{ui('rooms.share_table')}</Text></Pressable>}
    {renderProfile && <HeaderAction icon="profile" label={t('common.profile')} compact={false} onPress={()=>{setOpen(false);setProfileOpen(true);}} />}
    <View style={{flexDirection:'row',alignItems:'center',gap:8}}><Text style={{color:colors.text}}>{ui('common.theme')}</Text><ThemeAction /></View>
    <Pressable accessibilityRole="button" accessibilityLabel={ui('common.choose_card_theme')} onPress={()=>{setOpen(false);setCardThemesOpen(true);}} style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:8}}><Ionicons name="albums-outline" size={22} color={colors.accent}/><Text style={{color:colors.text,fontFamily:fonts.medium}}>{ui('common.card_theme')}</Text></Pressable>
    <View style={{flexDirection:'row',alignItems:'center',gap:8}}><Text style={{color:colors.text}}>{ui('common.language_label')}</Text><LanguageToggle /></View>
  </View>;
  return <>
    <RoomSheet visible={cardThemesOpen} title={ui('common.card_theme')} closeLabel={ui('common.close_card_themes')} testID="game-card-theme-sheet" presentation="dialog" onClose={()=>setCardThemesOpen(false)}>
      <CardThemePicker />
    </RoomSheet>
    <View testID={`${game}-${mobile && mobileTestIds ? 'mobile-' : ''}header`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.borderSubtle }}>
      <View style={{flexDirection:'row',alignItems:'center',flexShrink:0}}>
        <BrandIcon />
      </View>
      <View testID={`${game}-header-location`} style={{flex:1,minWidth:0,alignItems:'center'}}>
        <Text numberOfLines={1} accessibilityRole="header" style={{fontFamily:fonts.medium,fontSize:small?16:20,color:colors.text}}>{title}</Text>
        <Text numberOfLines={1} style={{fontFamily:fonts.body,fontSize:11,color:colors.textMuted}}>{roomName ? `${roomName} → ${tableName || title}` : path || tableName || ''}</Text>
      </View>
      <View style={{flexShrink:0,flexDirection:'row',alignItems:'center',justifyContent:'flex-end',gap:4,minWidth:88}}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.backToLobby')} onPress={onBack}
        style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.medium, backgroundColor: pressed ? colors.surfaceRaised : 'transparent' })}>
        <Ionicons name="arrow-back" size={22} color={colors.text} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.tableMenu')} accessibilityState={{ expanded: open }} onPress={() => setOpen(v => !v)}
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, borderRadius: radii.medium }}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: 5 }}>
          {[0, 1, 2].map(line => <View key={line} style={{ width: 22, height: 2, borderRadius: 1, backgroundColor: colors.text }} />)}
        </View>
      </Pressable>
      </View>
    </View>
    {/* Web menu dismissal must finish before a newly opened chat takes focus. */}
    {!!drawerMetadata && <Modal transparent visible={open} animationType={Platform.OS === 'web' ? 'none' : 'fade'} onRequestClose={() => setOpen(false)}>
      <KeyboardFrame style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', paddingTop: Math.max(12, insets.top), paddingBottom: Math.max(12, insets.bottom), paddingRight: Math.max(8, insets.right) }}>
        <Pressable testID={`${game}-menu-backdrop`} accessibilityRole="button" accessibilityLabel={ui("common.close_table_menu_backdrop")}
          onPress={() => setOpen(false)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.overlay, opacity: 0.6 }} />
        <View testID={`${game}-menu-drawer`} accessibilityViewIsModal style={{ width: '86%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: radii.large, padding: 20, borderWidth: 1, borderColor: colors.borderSubtle, boxShadow: `0px 4px 12px ${colors.shadow}` }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primarySoft, borderRadius: radii.medium }}>
            <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: fonts.medium, fontSize: typography.sectionTitle, paddingLeft: 10, flexShrink: 1 }}>{tableName || title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={ui("common.close_table_menu")} onPress={() => setOpen(false)}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.textMuted, fontSize: 24 }}>×</Text></Pressable>
          </View>
          {drawerMetadata}
          <ScrollView keyboardShouldPersistTaps="handled" horizontal={false} showsVerticalScrollIndicator={false} style={{ flex: 1, minWidth: 0, width: '100%' }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 8, paddingBottom: 8 }}>
            {menuControls}
            {typeof children === 'function' ? children(() => setOpen(false)) : children}
          </ScrollView>
        </View>
      </KeyboardFrame>
    </Modal>}
    {open && !drawerMetadata && <ScrollView keyboardShouldPersistTaps="handled" testID={`${game}-${mobile && mobileTestIds ? 'mobile-' : ''}menu`} style={{ maxHeight: '40%', flexGrow: 0 }} contentContainerStyle={{ padding: 8, gap: 8 }} nestedScrollEnabled>
      {compact && !!path && <Text style={{ color: colors.textMuted }}>{path}</Text>}
      {menuControls}
      {typeof children === 'function' ? children(() => setOpen(false)) : children}
      <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 4 }}>{endControl}</View>
    </ScrollView>}
    {!!roomId && !!matchId && <TableShareSheet roomId={roomId} matchId={matchId} visible={sharing} onClose={() => setSharing(false)} />}
    {renderProfile && <ProfileModal visible={profileOpen} onClose={() => setProfileOpen(false)}>
      {renderProfile(() => setProfileOpen(false))}
    </ProfileModal>}
  </>;
}
