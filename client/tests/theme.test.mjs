import test from 'node:test';
import assert from 'node:assert/strict';
import { colors, gameColors, primaryAction } from '../src/theme.ts';
import { tableThemes, isTableThemeId } from '../src/tableThemes.ts';
const luminance = hex => {
  const channels = hex.slice(1).match(/../g).map(c => parseInt(c,16)/255).map(c => c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4);
  return channels.reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
};
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
const c = colors;
test('all table choices retain readable text and recognizable cards', () => {
  for (const theme of Object.values(tableThemes)) {
    const c = theme.colors;
    for (const bg of [c.background, c.surface, c.surfaceRaised, c.surfaceSelected, c.table, c.resultOwnSurface, c.ownMessage]) {
      for (const fg of [c.text, c.textMuted, c.accent]) assert.ok(contrast(fg, bg) >= 4.5, `${theme.name}: ${fg} on ${bg}`);
    }
    for (const key of ['cardFace', 'cardInk', 'cardRed', 'cardBack']) assert.equal(c[key], colors[key]);
  }
});
test('stored table choices reject unknown values and inherited object keys', () => {
  for (const id of Object.keys(tableThemes)) assert.equal(isTableThemeId(id), true);
  for (const id of [null, undefined, '', 'old-theme', 'toString', '__proto__']) assert.equal(isTableThemeId(id), false);
});
  test('fixed Nepali design retains readable contrast',()=>{
    for(const [fg,bg] of [[c.onTableHeader,c.tableHeader],[c.cardInnerBorder,c.tableHeader],[c.text,c.ownMessage],[c.textMuted,c.ownMessage],[c.accent,c.ownMessage],[c.text,c.background],[c.text,c.surface],[c.textMuted,c.surface],[c.textMuted,c.background],[c.text,c.surfaceRaised],[c.text,c.surfaceSelected],[c.textMuted,c.table],[c.accent,c.surface],[c.success,c.successSurface],[c.danger,c.dangerSurface],[c.onPrimary,c.primary],[c.onPrimary,c.primaryPressed],[c.turnText,c.turnSurface],[c.cardInk,c.cardFace],[c.cardRed,c.cardFace]]) assert.ok(contrast(fg,bg)>=4.5,`${fg} on ${bg}`);
    for (const surface of [c.background, c.surface]) assert.ok(contrast(c.border, surface) >= 3, `control border ${c.border} on ${surface}`);
    assert.ok(luminance(c.cardFace)>.85);
    assert.equal(c.cardSelected,c.cardFace);
    assert.equal(c.cardSelectedBorder,c.attention);
    assert.equal(primaryAction(c,true).backgroundColor,c.primaryPressed);
  });

test('game surfaces retain readable text and unchanged card faces', () => {
  const c = gameColors;
  for (const bg of [c.background, c.surface, c.surfaceRaised, c.table]) {
    for (const fg of [c.text, c.textMuted, c.accent]) assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}`);
  }
  assert.ok(contrast(c.onPrimary, c.primary) >= 4.5);
  assert.equal(c.cardFace, colors.cardFace);
  assert.equal(c.cardInk, colors.cardInk);
});

test('highlighted result names and scores remain readable in games and ledgers', () => {
  for (const c of [colors, gameColors]) {
    for (const fg of [c.text, c.success, c.danger]) {
      assert.ok(contrast(fg, c.resultOwnSurface) >= 4.5, `${fg} on highlighted result ${c.resultOwnSurface}`);
    }
  }
});
