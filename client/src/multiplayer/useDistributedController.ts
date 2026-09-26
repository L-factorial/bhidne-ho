import {useEffect,useState} from 'react';
import type {DistributedRootRuntime} from './DistributedRoot';
import type {DistributedScreenController,ScreenActionState} from './DistributedScreenController';
export function useDistributedController(root:DistributedRootRuntime,slot:string) {
  const [controller,setController]=useState<DistributedScreenController|null>(null);
  const [state,setState]=useState<ScreenActionState>({status:'idle',busy:false,error:'',commandId:null,receipt:null});
  const [version,setVersion]=useState(0);
  useEffect(()=>{
    const control=root.screen(slot,{changed:setState,accepted:()=>setVersion(n=>n+1)});
    setController(control);void control.recover();
    return ()=>{control.dispose();setController(null);};
  },[root,slot]);
  return {controller,state,version};
}
export async function requireAccepted(control:DistributedScreenController|null,operation:()=>Promise<boolean>|undefined) {
  if(!control)throw Error('Wait for the command session.');
  const submitted=await operation();
  if(!submitted||control.state.status!=='accepted')throw Error(control.state.error||'Waiting for the original action to finish.');
}
