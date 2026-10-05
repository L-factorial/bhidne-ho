export function parseQuietTime(value:string):number|null {
  if(!/^\d{2}:\d{2}$/.test(value))return null;
  const [hour,minute]=value.split(':').map(Number);
  return hour<24&&minute<60?hour*60+minute:null;
}
export function formatQuietTime(value:number):string {
  return `${Math.floor(value/60).toString().padStart(2,'0')}:${(value%60).toString().padStart(2,'0')}`;
}
