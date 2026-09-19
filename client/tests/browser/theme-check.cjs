const assert = require('node:assert/strict');
// Reused during real-game flows: theme changes must not submit game actions or remount the table.
exports.checkThemes = async (page, name) => {
  for (const mode of ['dark','light']) {
    await page.getByRole('button',{name:'Table menu',exact:true}).click();
    const menu=page.getByTestId(/-menu-drawer$/);
    const toggle=menu.getByRole('button',{name:`Switch to ${mode} mode`,exact:true});
    if(await toggle.count()) await toggle.click();
    await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode);
    assert.equal(await page.evaluate(()=>localStorage.getItem('bhidne.appearance')),mode);
    await page.screenshot({path:`/tmp/theme-${name}-${mode}-menu.png`});
    if(mode==='light') {
      await menu.getByRole('button',{name:'Use system theme',exact:true}).click();
      await page.emulateMedia({colorScheme:'dark'});
      await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
      await menu.getByRole('button',{name:'Switch to light mode',exact:true}).click();
    }
    await page.getByRole('button',{name:'Close table menu',exact:true}).click();
    await menu.waitFor({state:'hidden'});
    await page.waitForTimeout(200);
    await page.screenshot({path:`/tmp/theme-${name}-${mode}.png`});
    const backs=page.getByTestId('card-back');
    if(await backs.count()) assert.equal(await backs.first().evaluate(el=>getComputedStyle(el).backgroundColor),mode==='dark'?'rgb(104, 25, 35)':'rgb(116, 27, 37)');
  }
};
