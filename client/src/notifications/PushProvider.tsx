import {createContext,useContext} from 'react';
import type {PushState,PushProviderProps} from './pushTypes';
import {defaultPushPreferences} from './pushTypes';
const Context=createContext<PushState>({available:false,enabled:false,busy:false,error:'',preferences:defaultPushPreferences,
  enable:async()=>{},disable:async()=>{},save:async()=>{}});
export function PushProvider({children}:PushProviderProps){return <>{children}</>;}
export function usePush(){return useContext(Context);}
