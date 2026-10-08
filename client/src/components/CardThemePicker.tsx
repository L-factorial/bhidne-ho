import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText as Text } from './AppText';
import { cardThemeCatalog, type CardThemeId } from '../cardThemeCatalog';
import { cardThemeImages } from '../cardThemeImages';
import { useCardTheme } from '../CardThemeProvider';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { ui } from '../i18n/copy';
import { fonts, radii, useTheme } from '../theme';

export function CardThemePicker({ disabled = false }: { disabled?: boolean }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const { id, select, canSelect, shared, pending } = useCardTheme();
  const unavailable = disabled || !canSelect || pending;
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

/** Expand in place inside the create form, so there is no nested native modal. */
export function CreateCardThemeSelector({ disabled = false }: { disabled?: boolean }) {
  useUiLanguage();
  const { colors: c } = useTheme();
  const { id } = useCardTheme();
  const [expanded, setExpanded] = useState(false);
  return <View style={{ gap: 12 }}>
    <Text style={{ fontFamily: fonts.medium }}>{ui('common.card_theme')}</Text>
    <Pressable testID="create-card-theme-selector" accessibilityRole="button" accessibilityLabel={ui('common.choose_card_theme')}
      accessibilityState={{ expanded, disabled }} disabled={disabled} onPress={() => setExpanded(value => !value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radii.medium,
        borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, minHeight: 64 }}>
      <Image source={cardThemeImages[id]} accessible={false} resizeMode="stretch" style={{ width: 36, height: 54, borderRadius: 4 }} />
      <Text style={{ flex: 1, fontFamily: fonts.medium }}>{ui(cardThemeCatalog[id].nameKey)}</Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={c.text} />
    </Pressable>
    {expanded && <CardThemePicker disabled={disabled} />}
  </View>;
}
