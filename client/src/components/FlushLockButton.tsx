import { FloatingTableAction } from './FloatingTableAction';

export function FlushLockButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return <FloatingTableAction label="Lock table" disabled={disabled} onPress={onPress} />;
}
