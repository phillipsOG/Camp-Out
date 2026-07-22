/**
 * The camp action registry.
 *
 * Mechanics follow Kibbles' Camp Actions. A long rest is eight hours split into
 * four two-hour watches. A character needs six hours of sleep, which leaves them
 * one free watch to spend on a single camp action — unless they take Slumber,
 * which consumes the whole night.
 */

import { MODULE_ID, WATCH_COUNT, loc } from "./constants.js";

/**
 * How alert a character is while performing an action.
 * - `normal`: rolls and passive Perception are unaffected.
 * - `distracted`: disadvantage on Perception checks and -5 passive Perception.
 * - `asleep`: automatically fails Perception checks.
 */
export const ALERTNESS = {
  normal: "normal",
  distracted: "distracted",
  asleep: "asleep"
};

/**
 * @typedef {object} CampAction
 * @property {string}  id             Stable key used in stored camp state.
 * @property {string}  icon           Font Awesome class.
 * @property {number}  watches        Watches consumed (Slumber takes the night).
 * @property {string}  alertness      One of {@link ALERTNESS}.
 * @property {boolean} repeatable     May be assigned to more than one watch.
 * @property {boolean} requiresTools  Prompts the GM about tool proficiency.
 * @property {boolean} requiresHeat   Needs a campfire or similar heat source.
 * @property {boolean} needsChoice    Asks the player for extra input (e.g. an ability).
 * @property {string}  color          Accent colour for the UI card.
 */

/** @type {Record<string, CampAction>} */
export const CAMP_ACTIONS = {
  watch: {
    id: "watch",
    icon: "fa-solid fa-eye",
    watches: 1,
    alertness: ALERTNESS.normal,
    repeatable: true,
    requiresTools: false,
    requiresHeat: false,
    needsChoice: false,
    color: "#c9a227"
  },
  cook: {
    id: "cook",
    icon: "fa-solid fa-drumstick-bite",
    watches: 1,
    alertness: ALERTNESS.distracted,
    repeatable: false,
    requiresTools: true,
    requiresHeat: true,
    needsChoice: false,
    color: "#b8562f"
  },
  craft: {
    id: "craft",
    icon: "fa-solid fa-hammer",
    watches: 1,
    alertness: ALERTNESS.distracted,
    repeatable: false,
    requiresTools: true,
    requiresHeat: false,
    needsChoice: false,
    color: "#7a6a58"
  },
  repair: {
    id: "repair",
    icon: "fa-solid fa-screwdriver-wrench",
    watches: 1,
    alertness: ALERTNESS.distracted,
    repeatable: false,
    requiresTools: true,
    requiresHeat: false,
    needsChoice: false,
    color: "#5f7d8c"
  },
  prepare: {
    id: "prepare",
    icon: "fa-solid fa-book-open-reader",
    watches: 1,
    alertness: ALERTNESS.distracted,
    repeatable: false,
    requiresTools: false,
    requiresHeat: false,
    needsChoice: true,
    color: "#4f6d9e"
  },
  task: {
    id: "task",
    icon: "fa-solid fa-scroll",
    watches: 1,
    alertness: ALERTNESS.distracted,
    repeatable: false,
    requiresTools: false,
    requiresHeat: false,
    needsChoice: false,
    color: "#6b5b8e"
  },
  slumber: {
    id: "slumber",
    icon: "fa-solid fa-moon",
    watches: WATCH_COUNT,
    alertness: ALERTNESS.asleep,
    repeatable: false,
    requiresTools: false,
    requiresHeat: false,
    needsChoice: false,
    color: "#3d4a6b"
  }
};

/** Display order in the action picker. */
export const ACTION_ORDER = ["watch", "cook", "craft", "repair", "prepare", "task", "slumber"];

/** The die chain a Preparation die steps down through as it is spent. */
export const PREPARATION_DIE_CHAIN = ["d6", "d4", "d2", null];

/**
 * @param {string} id
 * @returns {CampAction|null}
 */
export function getAction(id) {
  return CAMP_ACTIONS[id] ?? null;
}

/**
 * Actions decorated with localised strings, ready for a template.
 * @returns {Array<CampAction & {label: string, summary: string, details: string}>}
 */
export function localizedActions() {
  return ACTION_ORDER.map((id) => {
    const action = CAMP_ACTIONS[id];
    return {
      ...action,
      label: loc(`actions.${id}.label`),
      summary: loc(`actions.${id}.summary`),
      details: loc(`actions.${id}.details`)
    };
  });
}

/**
 * Localised label for an action id, falling back to the raw id for camp state
 * written by an older version of the module.
 * @param {string} id
 * @returns {string}
 */
export function actionLabel(id) {
  if (!id) return loc("common.unassigned");
  return CAMP_ACTIONS[id] ? loc(`actions.${id}.label`) : id;
}

/**
 * Races and traits that replace sleep with a shorter trance or inactive period,
 * and therefore earn a short rest partway through the night.
 *
 * Matching is a case-insensitive substring test against the actor's race name
 * and its trait/feature names, so homebrew lineages like "High Elf (Variant)"
 * or "Warforged Envoy" are picked up without extra configuration.
 */
export const TRANCE_KEYWORDS = ["elf", "elves", "eladrin", "trance", "warforged", "sentry's rest", "sentrys rest"];

/**
 * Keywords that should *not* count as trance despite containing a match above.
 * Half-elves sleep normally, as do most elf-adjacent constructs.
 */
export const TRANCE_EXCLUSIONS = ["half-elf", "half elf", "halfelf"];

/**
 * Does this actor trance or rest inactively rather than sleeping?
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasTrance(actor) {
  if (!actor) return false;

  // An explicit flag always wins, so a GM can force the answer either way.
  const override = actor.getFlag(MODULE_ID, "trance");
  if (typeof override === "boolean") return override;

  const haystack = [];
  const race = actor.system?.details?.race;
  haystack.push(typeof race === "string" ? race : race?.name ?? "");
  for (const item of actor.items ?? []) {
    if (["race", "feat", "trait", "background"].includes(item.type)) haystack.push(item.name);
  }

  const text = haystack.filter(Boolean).join(" ").toLowerCase();
  if (!text) return false;
  if (TRANCE_EXCLUSIONS.some((word) => text.includes(word))) return false;
  return TRANCE_KEYWORDS.some((word) => text.includes(word));
}
