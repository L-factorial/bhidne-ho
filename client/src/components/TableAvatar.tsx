import {createContext, useContext, useState, type ReactNode} from 'react';
import {AvatarPicker} from './AvatarPicker';
import type {Session} from '../multiplayer/session';

type TableAvatarContext = {open: () => void; uri: string | null | undefined};
const Context = createContext<TableAvatarContext | null>(null);
export const useTableAvatar = () => useContext(Context);

/** Keep the table mounted while editing the authenticated player's profile. */
export function TableAvatarProvider({session, children}: {session: Session; children: ReactNode}) {
  const [visible, setVisible] = useState(false);
  const [uri, setUri] = useState<string | null | undefined>(undefined);
  return <Context.Provider value={{open: () => setVisible(true), uri}}>
    {children}
    {visible && <AvatarPicker session={session} overlayOnly onSaved={setUri} onDone={() => setVisible(false)} />}
  </Context.Provider>;
}
