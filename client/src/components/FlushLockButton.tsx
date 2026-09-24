import { ui } from '../i18n/copy.ts';
import { useUiLanguage } from '../i18n/useUiLanguage';
import { FloatingTableAction } from './FloatingTableAction';

export function FlushLockButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  useUiLanguage();
  return <FloatingTableAction label={ui("rooms.lock_table")} disabled={disabled} onPress={onPress} />;
}
