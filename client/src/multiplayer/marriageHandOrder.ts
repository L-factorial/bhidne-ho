/** Local presentation order only; physical card IDs remain unchanged. */
export function reconcileHandOrder<T extends {card_id:string}>(cards:T[], order:readonly string[]):T[] {
  const remaining = new Map(cards.map(card => [card.card_id, card]));
  const ordered:T[] = [];
  for (const id of order) {
    const card = remaining.get(id);
    if (card) { ordered.push(card); remaining.delete(id); }
  }
  return [...ordered, ...remaining.values()];
}

export function insertHandCardBefore(order:readonly string[], source:string, target:string):string[] {
  const result = [...order], from = result.indexOf(source), to = result.indexOf(target);
  if (from >= 0 && to >= 0 && from !== to) {
    result.splice(from, 1);
    result.splice(result.indexOf(target), 0, source);
  }
  return result;
}

export type CardBounds = {id:string;x:number;y:number;width:number;height:number};
export function cardDropTarget(bounds:CardBounds[], source:string, x:number, y:number):string|null {
  return bounds.find(card => card.id !== source && card.width > 0 && card.height > 0 &&
    x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height)?.id ?? null;
}

export function marriageCardMarker(drawn:boolean, selected:boolean):'drawn'|'discard'|null {
  return selected ? 'discard' : drawn ? 'drawn' : null;
}

/** Only the empty tail of the final row is an append target. */
export function isHandEndDrop(last:CardBounds|undefined, area:CardBounds, controls:CardBounds, x:number,y:number):boolean {
  if(!last || area.width<=0)return false;
  const overControls=x>=controls.x&&x<=controls.x+controls.width&&y>=controls.y&&y<=controls.y+controls.height;
  return !overControls&&x>last.x+last.width&&x<=area.x+area.width&&y>=last.y&&y<=last.y+last.height;
}
export function appendHandCard(order:readonly string[],source:string):string[] {
  return order.includes(source)?[...order.filter(id=>id!==source),source]:[...order];
}
