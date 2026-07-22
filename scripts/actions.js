/**
 * The camp action registry.
 *
 * Mechanics follow Kibbles' Camp Actions. A long rest is eight hours split into
 * four two-hour watches. Most characters need six hours of sleep, leaving one
 * free watch; elves and their kin trance for four, leaving two.
 *
 * A character may take one *primary* camp action per night. Watches and Tasks
 * are fillers: they can be repeated to soak up whatever free time is left over.
 */

import { MODULE_ID, loc } from "./constants.js";

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
 * Action categories.
 * - `primary`: the one real camp action a character gets each night.
 * - `filler`: repeatable, and free to fill any spare waking watch.
 * - `night`: consumes the entire rest.
 */
export const CATEGORY = {
  primary: "primary",
  filler: "filler",
  night: "night"
};

/**
 * @typedef {object} CampAction
 * @property {string}  id             Stable key used in stored camp state.
 * @property {string}  icon           Font Awesome class.
 * @property {string}  category       One of {@link CATEGORY}.
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
    category: CATEGORY.filler,
    alertness: ALERTNESS.normal,
    repeatable: true,
    requiresTools: false,
    requiresHeat: false,
    needsChoice: false,
    color: "#d8a83b"
  },
  cook: {
    id: "cook",
    icon: "fa-solid fa-drumstick-bite",
    category: CATEGORY.primary,
    alertness: ALERTNESS.distracted,
    repeatable: false,
    requiresTools: true,
    requiresHeat: true,
    needsChoice: false,
    color: "#e0703f"
  },
  craft: {
    id: "craft",
    icon: "fa-solid fa-hammer",
    category: CATEGORY.primary,
    alertness: ALERTNESS.distracted,
    repeatable: false,
    requiresTools: true,
    requiresHeat: false,
    needsChoice: false,
    color: "#a08a6f"
  },
  repair: {
    id: "repair",
    icon: "fa-solid fa-screwdriver-wrench",
    category: CATEGORY.primary,
    alertness: ALERTNESS.distracted,
    repeatable: false,
    requiresTools: true,
    requiresHeat: false,
    needsChoice: false,
    color: "#79a3b8"
  },
  prepare: {
    id: "prepare",
    icon: "fa-solid fa-book-open-reader",
    category: CATEGORY.primary,
    alertness: ALERTNESS.distracted,
    repeatable: false,
    requiresTools: false,
    requiresHeat: false,
    needsChoice: true,
    color: "#6b8fd4"
  },
  task: {
    id: "task",
    icon: "fa-solid fa-scroll",
    category: CATEGORY.filler,
    alertness: ALERTNESS.distracted,
    repeatable: true,
    requiresTools: false,
    requiresHeat: false,
    needsChoice: false,
    color: "#9b82c4"
  },
  slumber: {
    id: "slumber",
    icon: "fa-solid fa-moon",
    category: CATEGORY.night,
    alertness: ALERTNESS.asleep,
    repeatable: false,
    requiresTools: false,
    requiresHeat: false,
    needsChoice: false,
    color: "#5a6b96"
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

/* -------------------------------------------- */
/*  Trance detection                            */
/* -------------------------------------------- */

/**
 * Species that trance or rest inactively rather than sleeping.
 * Matched against the character's species only, never against their features.
 */
export const TRANCE_SPECIES = ["elf", "elves", "eladrin", "drow", "warforged"];

/**
 * Species that read as trancing but do not. Half-elves sleep normally.
 * Checked before {@link TRANCE_SPECIES}, so these always win.
 */
export const NON_TRANCE_SPECIES = ["half-elf", "half elf", "halfelf", "half-eladrin"];

/**
 * Traits that grant a trance regardless of species, for homebrew lineages.
 * Matched against feature names, and deliberately specific so that an unrelated
 * feat like "Elven Accuracy" on a human cannot trigger it.
 */
export const TRANCE_TRAITS = ["trance", "sentry's rest", "sentrys rest", "sentry’s rest"];

/**
 * The character's species, as a plain lowercase string.
 *
 * dnd5e has moved this around: 3.x stored a string on `system.details.race`,
 * 4.x stores a reference to an embedded Item of type `race`, and the 2024 rules
 * call the same thing a species. All three shapes are read here.
 *
 * @param {Actor} actor
 * @returns {string}
 */
export function speciesName(actor) {
  if (!actor) return "";

  // The embedded species/race Item is the most reliable source when present.
  const speciesItem = actor.items?.find?.((i) => i.type === "race");
  if (speciesItem?.name) return String(speciesItem.name).toLowerCase();

  const details = actor.system?.details ?? {};
  const raw = details.species ?? details.race;

  // 4.x: an Item document or a resolved reference carrying a name.
  if (raw && typeof raw === "object") {
    const name = raw.name ?? raw.value ?? "";
    if (name) return String(name).toLowerCase();
  }

  // 3.x: a plain string.
  if (typeof raw === "string") return raw.toLowerCase();

  return "";
}

/**
 * Does this actor trance or rest inactively rather than sleeping?
 *
 * Species drives the answer. Feature names are consulted only for the specific
 * traits that grant a trance, so unrelated elf-flavoured feats on a sleeping
 * species cannot trip the check.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasTrance(actor) {
  if (!actor) return false;

  // An explicit flag always wins, so a GM can force the answer either way.
  const override = actor.getFlag?.(MODULE_ID, "trance");
  if (typeof override === "boolean") return override;

  const species = speciesName(actor);
  if (species) {
    if (NON_TRANCE_SPECIES.some((word) => species.includes(word))) return false;
    if (TRANCE_SPECIES.some((word) => species.includes(word))) return true;
  }

  // Homebrew lineages that grant a trance through a named trait.
  for (const item of actor.items ?? []) {
    if (!["feat", "trait", "race", "background"].includes(item.type)) continue;
    const name = String(item.name ?? "").toLowerCase();
    if (TRANCE_TRAITS.some((word) => name.includes(word))) return true;
  }

  return false;
}
