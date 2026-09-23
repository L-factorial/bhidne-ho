const assert = require('node:assert/strict');
// Device color settings must not change the selected game theme or remount a game.
exports.checkThemes = async (page, name) => {
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.getByRole('button', { name: 'Table menu', exact: true }).click();
    const menu = page.getByTestId(/-menu-drawer$/);
    assert.equal(await menu.getByRole('button', { name: /^Appearance,/ }).count(), 0);
    await page.getByRole('button', { name: 'Close table menu', exact: true }).click();
    await menu.waitFor({ state: 'hidden' });
    const backs = page.getByTestId('card-back');
    if (await backs.count()) assert.equal(await backs.first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(116, 27, 37)');
  }
};
