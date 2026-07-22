import { MODULE_ID, SETTINGS, loc } from "./constants.js";
import { blankState } from "./camp-state.js";

/**
 * Register every world setting. `campState` is the single source of truth for an
 * in-progress camp: Foundry replicates world settings to all clients and fires
 * `updateSetting`, which is what keeps the GM planner and the player sheets in
 * step without any bespoke broadcast plumbing.
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.campState, {
    scope: "world",
    config: false,
    type: Object,
    default: blankState()
  });

  game.settings.register(MODULE_ID, SETTINGS.revealActions, {
    name: loc("settings.revealActions.name"),
    hint: loc("settings.revealActions.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.requireSleep, {
    name: loc("settings.requireSleep.name"),
    hint: loc("settings.requireSleep.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.autoInspiration, {
    name: loc("settings.autoInspiration.name"),
    hint: loc("settings.autoInspiration.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.autoTranceRest, {
    name: loc("settings.autoTranceRest.name"),
    hint: loc("settings.autoTranceRest.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // Client-scoped: each user picks the look they want, dark out of the box.
  game.settings.register(MODULE_ID, SETTINGS.theme, {
    name: loc("settings.theme.name"),
    hint: loc("settings.theme.hint"),
    scope: "client",
    config: true,
    type: String,
    choices: {
      dark: loc("settings.theme.dark"),
      light: loc("settings.theme.light")
    },
    default: "dark",
    onChange: () => {
      for (const app of foundry.applications?.instances?.values?.() ?? []) {
        if (app?.constructor?.CAMP_OUT_APP) app.render(false);
      }
    }
  });

  game.settings.register(MODULE_ID, SETTINGS.advanceWorldTime, {
    name: loc("settings.advanceWorldTime.name"),
    hint: loc("settings.advanceWorldTime.hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
}

/** @returns {boolean} */
export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}
