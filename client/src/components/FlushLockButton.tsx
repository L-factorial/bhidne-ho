import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { FloatingTableAction } from './FloatingTableAction';

export function FlushLockButton({ disabled, onPress, loading = false }: { loading?: boolean; disabled: boolean; onPress: () => void }) {
  useUiLanguage();
  return <FloatingTableAction label={ui(loading ? "rooms.starting_game" : "rooms.play_again")} loading={loading} disabled={disabled} onPress={onPress} />;
}
