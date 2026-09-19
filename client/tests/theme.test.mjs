import test from 'node:test';
import assert from 'node:assert/strict';
import { lightColors, darkColors, primaryAction } from '../src/theme.ts';
const luminance = hex => {
  const channels = hex.slice(1).match(/../g).map(c => parseInt(c,16)/255).map(c => c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4);
  return channels.reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
};
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
for (const [mode,c] of Object.entries({light:lightColors,dark:darkColors})) {
  test(`${mode}: semantic text, buttons and faces retain readable contrast`,()=>{
    for(const [fg,bg] of [[c.text,c.background],[c.text,c.surface],[c.textMuted,c.surface],[c.onPrimary,c.primary],[c.onPrimary,c.primaryPressed],[c.turnText,c.turnSurface],[c.cardInk,c.cardFace],[c.cardRed,c.cardFace]]) assert.ok(contrast(fg,bg)>=4.5,`${fg} on ${bg}`);
    assert.ok(luminance(c.cardFace)>.85);
    assert.equal(c.cardSelected,c.cardFace);
    assert.equal(c.cardSelectedBorder,c.attention);
    assert.equal(primaryAction(c,true).backgroundColor,c.primaryPressed);
  });
}
test('both themes expose the same semantic tokens',()=>assert.deepEqual(Object.keys(lightColors),Object.keys(darkColors)));
