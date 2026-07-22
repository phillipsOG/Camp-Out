/**
 * Camp Out — entry point.
 *
 * Wires up settings, the socket relay, scene controls, chat interactivity and
 * the public API. Kibbles' Camp Actions rules are implemented in actions.js,
 * effects.js and rest.js.
 */

import { MODULE_ID, SETTINGS, TEMPLATES, WATCH_COUNT, loadTpls } from "./constants.js";
import { registerSettings } from "./settings.js";
import { registerSocket, broadcastOpenSheet, refreshApps } from "./socket.js";
import { CampState } from "./camp-state.js";
import { CAMP_ACTIONS, hasTrance } from "./actions.js";
import { spendPreparationDie } from "./effects.js";
import {
  beginCamp,
  cancelCamp,
  completeCamp,
  resolveWatch,
  startResolving,
  grantTranceShortRests,
  triggerEncounterLink,
  defaultParticipants
} from "./rest.js";
import { CampPlanner } from "./apps/camp-planner.js";
import { CampSheet } from "./apps/camp-sheet.js";

/* -------------------------------------------- */
/*  Initialisation                              */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();
  loadTpls(Object.values(TEMPLATES));

  if (game.system.id !== "dnd5e") {
    console.warn(
      `${MODULE_ID} | Camp Out automates dnd5e mechanics. Scheduling still works on ${game.system.id}, but rests and buffs will not be applied.`
    );
  }
});

Hooks.once("ready", () => {
  registerSocket();

  /** Public API, also mounted on the module entry for `game.modules.get(...).api`. */
  const api = {
    open: () => (game.user.isGM ? CampPlanner.show() : CampSheet.show()),
    openPlanner: () => CampPlanner.show(),
    openSheet: () => CampSheet.show(),
    beginCamp,
    cancelCamp,
    completeCamp,
    resolveWatch,
    startResolving,
    grantTranceShortRests,
    spendPreparationDie,
    defaultParticipants,
    hasTrance,
    notifyPlayers: broadcastOpenSheet,
    get state() {
      return CampState.data;
    },
    CampState,
    CAMP_ACTIONS,
    WATCH_COUNT
  };

  game.campOut = api;
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = api;

  Hooks.callAll(`${MODULE_ID}.ready`, api);
});

/* -------------------------------------------- */
/*  Live refresh                                */
/* -------------------------------------------- */

/** Camp state lives in a world setting, so replication doubles as the sync bus. */
Hooks.on("updateSetting", (settingDoc) => {
  if (settingDoc.key !== `${MODULE_ID}.${SETTINGS.campState}`) return;
  refreshApps();
  if (ui.controls?.rendered) ui.controls.render();
});

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", (controls) => {
  const visible = game.user.isGM || CampState.active;
  if (!visible) return;

  const onClick = () => (game.user.isGM ? CampPlanner.show() : CampSheet.show());
  const title = game.user.isGM ? "CAMPOUT.controls.planner" : "CAMPOUT.controls.sheet";
  const icon = "fa-solid fa-campground";

  // v13 hands over a record keyed by control name; v12 hands over an array.
  if (Array.isArray(controls)) {
    const tokens = controls.find((c) => c.name === "token");
    if (!tokens) return;
    tokens.tools.push({
      name: MODULE_ID,
      title,
      icon,
      button: true,
      visible: true,
      onClick
    });
    return;
  }

  const tokens = controls.tokens ?? controls.token;
  if (!tokens?.tools) return;
  tokens.tools[MODULE_ID] = {
    name: MODULE_ID,
    title,
    icon,
    button: true,
    visible: true,
    order: Object.keys(tokens.tools).length + 1,
    onChange: onClick
  };
});

/* -------------------------------------------- */
/*  Chat card interactivity                     */
/* -------------------------------------------- */

/**
 * Bind the buttons Camp Out puts in chat. Registered against both the v12 and
 * v13 hooks; the dataset marker keeps a double registration harmless.
 * @param {HTMLElement} html
 */
function bindChatButtons(html) {
  if (!html || html.dataset?.campOutBound) return;
  if (html.dataset) html.dataset.campOutBound = "1";

  for (const button of html.querySelectorAll?.(".camp-out-link") ?? []) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      triggerEncounterLink(event.currentTarget.dataset.uuid);
    });
  }

  for (const button of html.querySelectorAll?.(".camp-out-open") ?? []) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (game.user.isGM) CampPlanner.show();
      else CampSheet.show();
    });
  }
}

Hooks.on("renderChatMessageHTML", (message, html) => bindChatButtons(html));
Hooks.on("renderChatMessage", (message, html) => bindChatButtons(html?.[0] ?? html));

/**
 * Expose a chat command as a low-friction alternative to the scene control.
 * `/camp` opens the planner for a GM and the camp sheet for a player.
 */
Hooks.on("chatMessage", (chatLog, message) => {
  if (!/^\/camp\b/i.test(message.trim())) return true;
  if (game.user.isGM) CampPlanner.show();
  else CampSheet.show();
  return false;
});

export { CampPlanner, CampSheet };
