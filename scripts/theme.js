/**
 * Appearance.
 *
 * The theme is a per-user client setting stamped onto the application root as
 * `data-theme`, which is the same element that carries the `.camp-out` class.
 * Every colour variable in the stylesheet resolves from there, so switching is
 * a single attribute change rather than a restyle.
 */

import { MODULE_ID, SETTINGS, loc } from "./constants.js";

export const THEMES = { dark: "dark", light: "light" };

/** @returns {"dark"|"light"} The current theme, defaulting to dark. */
export function currentTheme() {
  return game.settings.get(MODULE_ID, SETTINGS.theme) === THEMES.light ? THEMES.light : THEMES.dark;
}

/**
 * Stamp the active theme onto an application's root element.
 * @param {Application} app
 * @returns {string} The theme that was applied.
 */
export function applyTheme(app) {
  const theme = currentTheme();
  app.element?.setAttribute("data-theme", theme);
  return theme;
}

/** Flip the theme for this user. */
export async function toggleTheme() {
  const next = currentTheme() === THEMES.light ? THEMES.dark : THEMES.light;
  return game.settings.set(MODULE_ID, SETTINGS.theme, next);
}

/**
 * The header toggle's icon and label, which describe the theme being switched
 * *to* rather than the one in use.
 * @returns {{theme: string, icon: string, label: string}}
 */
export function themeContext() {
  const theme = currentTheme();
  return {
    theme,
    icon: theme === THEMES.dark ? "fa-solid fa-sun" : "fa-solid fa-moon",
    label: loc(theme === THEMES.dark ? "common.lightMode" : "common.darkMode")
  };
}
