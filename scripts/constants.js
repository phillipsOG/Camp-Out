/**
 * Shared identifiers and small cross-version compatibility shims.
 *
 * Camp Out supports Foundry v12 and v13. Several core helpers moved into the
 * `foundry.applications.*` namespaces in v13 while remaining as (deprecated)
 * globals, so every call site goes through the shims at the bottom of this file
 * rather than touching either form directly.
 */

export const MODULE_ID = "camp-out";
export const SOCKET_NAME = `module.${MODULE_ID}`;

/** Number of watches in a long rest. Kibbles' camp actions assume four. */
export const WATCH_COUNT = 4;

/**
 * Watches a character must spend asleep to earn a long rest.
 *
 * Most characters need six hours (three watches). Elves and their kin trance for
 * four hours instead, which buys them a second free watch rather than exempting
 * them from resting.
 */
export const SLEEP_WATCHES = {
  normal: 3,
  trance: 2
};

/** World/client setting keys. */
export const SETTINGS = {
  campState: "campState",
  revealActions: "revealActions",
  autoInspiration: "autoInspiration",
  autoTranceRest: "autoTranceRest",
  advanceWorldTime: "advanceWorldTime",
  requireSleep: "requireSleep",
  requireRations: "requireRations",
  theme: "theme"
};

/** Module flag keys written onto actors and effects. */
export const FLAGS = {
  wellFed: "wellFed",
  preparation: "preparation",
  campId: "campId",
  saturation: "saturation"
};

/**
 * Saturation (food value) needed to feed one creature for the night, keyed by
 * dnd5e's own size codes so `actor.system.traits.size` can index it directly.
 * Doubles per size step above medium, the same curve dnd5e uses for carrying
 * capacity, so bigger mouths eat proportionally more.
 */
export const SIZE_SATURATION = {
  tiny: 3,
  sm: 5,
  med: 10,
  lg: 20,
  huge: 40,
  grg: 80
};

/** Socket message types. Everything a player wants to persist is relayed here. */
export const SOCKET_TYPES = {
  setAssignment: "setAssignment",
  clearAssignments: "clearAssignments",
  setReady: "setReady",
  setNote: "setNote",
  openSheet: "openSheet",
  refresh: "refresh"
};

export const TEMPLATES = {
  planner: `modules/${MODULE_ID}/templates/camp-planner.hbs`,
  sheet: `modules/${MODULE_ID}/templates/camp-sheet.hbs`,
  rosterTab: `modules/${MODULE_ID}/templates/parts/tab-roster.hbs`,
  watchesTab: `modules/${MODULE_ID}/templates/parts/tab-watches.hbs`,
  resolveTab: `modules/${MODULE_ID}/templates/parts/tab-resolve.hbs`,
  provisionsTab: `modules/${MODULE_ID}/templates/parts/tab-provisions.hbs`,
  actionCard: `modules/${MODULE_ID}/templates/parts/action-card.hbs`,
  chatWatch: `modules/${MODULE_ID}/templates/chat/watch-summary.hbs`,
  chatSummary: `modules/${MODULE_ID}/templates/chat/camp-summary.hbs`,
  chatInvite: `modules/${MODULE_ID}/templates/chat/camp-invite.hbs`
};

/* -------------------------------------------- */
/*  Version shims                               */
/* -------------------------------------------- */

/** @returns {number} The running Foundry generation, e.g. 12 or 13. */
export function generation() {
  return Number(game.version?.split(".")[0] ?? 12);
}

/** The TextEditor implementation, which moved namespaces in v13. */
export function textEditor() {
  return foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
}

/** Handlebars template rendering, which moved namespaces in v13. */
export function renderTpl(path, data) {
  const fn = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;
  return fn(path, data);
}

/** Template preloading, which moved namespaces in v13. */
export function loadTpls(paths) {
  const fn = foundry.applications?.handlebars?.loadTemplates ?? loadTemplates;
  return fn(paths);
}

/** Parse drag data off a drop event across both generations. */
export function getDragData(event) {
  try {
    return textEditor().getDragEventData(event);
  } catch (err) {
    console.warn(`${MODULE_ID} | Unreadable drag payload`, err);
    return null;
  }
}

/** Localisation helper scoped to this module's namespace. */
export function loc(key, data) {
  const full = `CAMPOUT.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}
