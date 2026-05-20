"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const menu_title_guard_1 = require("../lib/menu-title-guard");
describe('preserveLeadingMenuTitle', () => {
    it('restores a leading Menu title when the model deletes it', () => {
        const originalMenu = ['Menu', 'Toro Toro Guacamole, lime, cilantro, chips VG 18'].join('\n');
        const correctedMenu = 'Toro Toro Guacamole, lime, cilantro, chips VG 18';
        const result = (0, menu_title_guard_1.preserveLeadingMenuTitle)(originalMenu, correctedMenu);
        expect(result.restored).toBe(true);
        expect(result.correctedMenu).toBe(originalMenu);
    });
    it('restores a leading Menu title when the model pluralizes it', () => {
        const originalMenu = ['Menu', 'Toro Toro Guacamole, lime, cilantro, chips VG 18'].join('\n');
        const correctedMenu = ['Menus', 'Toro Toro Guacamole, lime, cilantro, chips VG 18'].join('\n');
        const result = (0, menu_title_guard_1.preserveLeadingMenuTitle)(originalMenu, correctedMenu);
        expect(result.restored).toBe(true);
        expect(result.correctedMenu).toBe(originalMenu);
    });
    it('does not change menus without a leading standalone Menu title', () => {
        const originalMenu = ['Starters', 'Toro Toro Guacamole, lime, cilantro, chips VG 18'].join('\n');
        const correctedMenu = ['Starters', 'Toro Toro Guacamole, lime, cilantro, chips VG 18'].join('\n');
        const result = (0, menu_title_guard_1.preserveLeadingMenuTitle)(originalMenu, correctedMenu);
        expect(result.restored).toBe(false);
        expect(result.correctedMenu).toBe(correctedMenu);
    });
});
