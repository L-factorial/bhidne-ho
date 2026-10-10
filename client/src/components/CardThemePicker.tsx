import { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText as Text } from './AppText';
import { cardThemeCatalog, type CardThemeId } from '../cardThemeCatalog';
import { cardThemeImages } from '../cardThemeImages';
import { useCardTheme, useDeviceCardTheme } from '../CardThemeProvider';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { ui } from '../i18n/copy';
import { fonts, radii, useTheme } from '../theme';

export function CardThemePicker({ disabled = false, compact = false, device = false, onSelected }: { disabled?: boolean; compact?: boolean; device?: boolean; onSelected?: () => void }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const tableChoice = useCardTheme(), deviceChoice = useDeviceCardTheme();
  const { id, select, canSelect, shared, pending } = device ? deviceChoice : tableChoice;
  const unavailable = disabled || !canSelect || pending;
  if (compact) return <ScrollView testID="card-theme-dropdown" nestedScrollEnabled keyboardShouldPersistTaps="handled"
    style={{ height: 234, flexGrow: 0 }} contentContainerStyle={{ gap: 0 }}>
    <View testID="card-theme-picker" accessibilityRole="radiogroup" accessibilityLabel={ui('common.card_theme')}>
      {(Object.keys(cardThemeCatalog) as CardThemeId[]).map(key => <Pressable key={key} testID={`card-theme-${key}`}
        accessibilityRole="radio" accessibilityLabel={ui(cardThemeCatalog[key].nameKey)}
        accessibilityState={{ checked: id === key, disabled: unavailable }} aria-checked={id === key} disabled={unavailable}
        onPress={() => { select(key); onSelected?.(); }} style={({ pressed }) => ({ minHeight: 78, flexDirection: 'row',
          alignItems: 'center', gap: 12, padding: 12, borderBottomWidth: 1, borderColor: c.borderSubtle,
          backgroundColor: pressed || id === key ? c.surfaceRaised : c.surface, opacity: unavailable ? 0.55 : 1 })}>
        <Image source={cardThemeImages[key]} accessible={false} resizeMode="cover" style={{ width: 36, height: 54, flexShrink: 0, borderRadius: 4 }} />
        <Text style={{ flex: 1, color: c.text, fontFamily: fonts.medium }}>{ui(cardThemeCatalog[key].nameKey)}</Text>
        {id === key && <Ionicons name="checkmark-circle" size={20} color={c.accent} />}
      </Pressable>)}
    </View>
  </ScrollView>;
  return <View testID="card-theme-picker" style={{ gap: 12 }}>
    <Text style={{ color: c.textMuted }}>{ui(shared ? 'common.card_theme_shared_help' : 'common.card_theme_help')}</Text>
    {shared && !canSelect && <Text style={{ color: c.textMuted }}>{ui('common.card_theme_controller_help')}</Text>}
    {pending && <Text accessibilityLiveRegion="polite">{ui('common.card_theme_saving')}</Text>}
    <View accessibilityRole="radiogroup" accessibilityLabel={ui('common.card_theme')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {(Object.keys(cardThemeCatalog) as CardThemeId[]).map(key => <Pressable key={key} testID={`card-theme-${key}`}
        accessibilityRole="radio" accessibilityLabel={ui(cardThemeCatalog[key].nameKey)}
        accessibilityState={{ checked: id === key, disabled: unavailable }} aria-checked={id === key} disabled={unavailable}
        onPress={() => select(key)} style={({ pressed }) => ({ flexBasis: '45%', flexGrow: 1, minWidth: 100,
          alignItems: 'center', gap: 8, padding: 12, borderRadius: radii.medium, borderWidth: 2,
          borderColor: id === key ? c.accent : c.borderSubtle, backgroundColor: pressed ? c.surfaceRaised : c.surface,
          opacity: unavailable ? 0.55 : 1 })}>
        <Image source={cardThemeImages[key]} accessible={false} resizeMode="stretch" style={{ width: 76, height: 114, borderRadius: 6 }} />
        <Text style={{ color: c.text, fontFamily: fonts.medium, fontSize: 14, textAlign: 'center' }}>{ui(cardThemeCatalog[key].nameKey)}</Text>
        {id === key && <Ionicons name="checkmark-circle" size={20} color={c.accent} />}
      </Pressable>)}
    </View>
  </View>;
}

/** Float over the form without changing its measured height. */
export function CreateCardThemeSelector({ disabled = false, device = false, overlay = false, onExpandedChange }: { disabled?: boolean; device?: boolean; overlay?: boolean; onExpandedChange?: (expanded: boolean) => void }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const tableChoice = useCardTheme(), deviceChoice = useDeviceCardTheme();
  const { id } = device ? deviceChoice : tableChoice;
  const [expanded, setExpanded] = useState(false);
  const expand = (next: boolean) => { setExpanded(next); onExpandedChange?.(next); };
  return <View testID={device ? 'profile-card-theme' : undefined} style={{ gap: 12, zIndex: expanded ? 100 : 0 }}>
    <Text style={{ fontFamily: fonts.medium }}>{ui('common.card_theme')}</Text>
    <Pressable testID="create-card-theme-selector" accessibilityRole="button" accessibilityLabel={ui('common.choose_card_theme')}
      accessibilityState={{ expanded, disabled }} disabled={disabled} onPress={() => expand(!expanded)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radii.medium,
        borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, minHeight: 64 }}>
      <Image source={cardThemeImages[id]} accessible={false} resizeMode="cover" style={{ width: 36, height: 54, flexShrink: 0, borderRadius: 4 }} />
      <Text style={{ flex: 1, fontFamily: fonts.medium }}>{ui(cardThemeCatalog[id].nameKey)}</Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={c.text} />
    </Pressable>
    {expanded && <View style={[{ borderWidth: 1, borderColor: c.border, borderRadius: radii.medium, overflow: 'hidden', backgroundColor: c.surface },
      overlay && { position: 'absolute', top: '100%', marginTop: 4, left: 0, right: 0, zIndex: 100, elevation: 24 }]}>
      <CardThemePicker disabled={disabled} compact device={device} onSelected={() => expand(false)} />
    </View>}
  </View>;
}
