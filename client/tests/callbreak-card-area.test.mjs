import test from 'node:test';
import assert from 'node:assert/strict';
import {isCallBreakThrow,callBreakCardArea} from '../src/multiplayer/callbreakCardArea.ts';
test('upward throw needs deliberate distance and direction, or a strong flick',()=>{
 for(const [dx,dy,vy] of [[0,-160,-.1],[15,-100,-.9],[-30,-190,-1]])assert.equal(isCallBreakThrow(dx,dy,vy),true);
 for(const [dx,dy,vy] of [[0,-45,-2],[0,-100,-.1],[130,-100,-2],[0,200,2],[100,0,0]])assert.equal(isCallBreakThrow(dx,dy,vy),false);
});
test('full hands fit arc and grid stages on small phones without scrolling',()=>{
 for(const [width,height] of [[280,568],[280,740],[350,844],[960,900]])for(const count of [1,10,13]){
  const l=callBreakCardArea(width,height,count),half=l.spread*Math.PI/360;
  const fanWidth=2*(l.cardHeight*Math.sin(half)+l.cardWidth/2+7);
  assert.ok(fanWidth<=width,`${width}/${count}: arc fits horizontally`);
  assert.ok(14+l.cardHeight+l.cardWidth/2*Math.sin(half)<=l.stageHeight,'arc fits vertically');
  const rows=Math.ceil(count/l.columns);
  assert.ok(rows*l.gridHeight+(rows-1)*5<=l.stageHeight,'grid fits vertically');
  assert.ok(l.columns*l.gridWidth+(l.columns-1)*5<=width,'grid fits horizontally');
 }
});
