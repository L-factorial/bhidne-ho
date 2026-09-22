import test from 'node:test';
import assert from 'node:assert/strict';
import { lightColors, darkColors, palettes, validAppearance, primaryAction } from '../src/theme.ts';
const luminance = hex => {
  const channels = hex.slice(1).match(/../g).map(c => parseInt(c,16)/255).map(c => c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4);
  return channels.reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
};
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
for (const [mode,c] of Object.entries(Object.fromEntries(Object.entries(palettes).flatMap(([family, modes]) => Object.entries(modes).map(([mode, colors]) => [`${family}/${mode}`, colors]))))) {
  test(`${mode}: semantic text, buttons and faces retain readable contrast`,()=>{
    for(const [fg,bg] of [[c.text,c.background],[c.text,c.surface],[c.textMuted,c.surface],[c.textMuted,c.background],[c.text,c.surfaceRaised],[c.text,c.surfaceSelected],[c.textMuted,c.table],[c.accent,c.surface],[c.success,c.successSurface],[c.danger,c.dangerSurface],[c.onPrimary,c.primary],[c.onPrimary,c.primaryPressed],[c.turnText,c.turnSurface],[c.cardInk,c.cardFace],[c.cardRed,c.cardFace]]) assert.ok(contrast(fg,bg)>=4.5,`${fg} on ${bg}`);
    for (const surface of [c.background, c.surface]) assert.ok(contrast(c.border, surface) >= 3, `control border ${c.border} on ${surface}`);
    assert.ok(luminance(c.cardFace)>.85);
    assert.equal(c.cardSelected,c.cardFace);
    assert.equal(c.cardSelectedBorder,c.attention);
    assert.equal(primaryAction(c,true).backgroundColor,c.primaryPressed);
  });
}
test('both themes expose the same semantic tokens',()=>assert.deepEqual(Object.keys(lightColors),Object.keys(darkColors)));

test('appearance accepts only supported presets', () => {
  for (const theme of Object.keys(palettes)) for (const mode of ['system', 'light', 'dark']) assert.ok(validAppearance({ theme, mode }));
  for (const value of [null, {}, { theme: 'unknown', mode: 'dark' }, { theme: 'heritage', mode: 'unknown' }]) assert.equal(validAppearance(value), false);
});
