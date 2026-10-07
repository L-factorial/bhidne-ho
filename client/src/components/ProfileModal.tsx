import { createContext, useContext, type ReactNode } from 'react';
import { GameModal as Modal } from './GameModal';
import { DeletionNavigation } from '../auth/deletion';
import { PolicyNavigation } from './moderation/PublicPolicies';
import { useDismissalAction } from './useDismissalAction';

export const ProfileDismissal = createContext<(action: () => void) => void>(action => action());

/** Keep the native Modal mounted while it dismisses. Root navigation and
 * sign-out may replace the profile's owner only after that dismissal. */
export function ProfileModal({ visible, onClose, children }: {
  visible: boolean; onClose: () => void; children: ReactNode;
}) {
  const openDeletion = useContext(DeletionNavigation);
  const openPolicy = useContext(PolicyNavigation);
  const { afterDismiss, onDismiss } = useDismissalAction(visible, onClose);
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose} onDismiss={onDismiss}>
    <ProfileDismissal.Provider value={afterDismiss}>
      <DeletionNavigation.Provider value={() => afterDismiss(openDeletion)}>
        <PolicyNavigation.Provider value={page => afterDismiss(() => openPolicy(page))}>
          {children}
        </PolicyNavigation.Provider>
      </DeletionNavigation.Provider>
    </ProfileDismissal.Provider>
  </Modal>;
}
