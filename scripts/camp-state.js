/**
 * Camp state: the shared record of who is doing what, on which watch.
 *
 * The whole object lives in one world setting. Only a GM ever writes to it —
 * player edits arrive over the socket and are applied by the GM client (see
 * socket.js). Every client reacts to the resulting `updateSetting` hook, so
 * reads are always local and cheap.
 */

import { MODULE_ID, SETTINGS, WATCH_COUNT, REQUIRED_SLEEP_WATCHES } from "./constants.js";
import { CAMP_ACTIONS, getAction, hasTrance } from "./actions.js";

export const PHASES = {
  idle: "idle",
  planning: "planning",
  resolving: "resolving",
  complete: "complete"
};

/** @returns {object} A pristine, inactive camp. */
export function blankState() {
  return {
    active: false,
    id: null,
    phase: PHASES.idle,
    startedAt: null,
    sceneId: null,
    currentWatch: 0,
    participants: {},
    encounters: {},
    resolved: {},
    shortRested: []
  };
}

/** Build the participant record for an actor joining a camp. */
export function blankParticipant(actor) {
  const assignments = {};
  for (let w = 1; w <= WATCH_COUNT; w++) assignments[w] = null;
  return {
    actorId: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    trance: hasTrance(actor),
    assignments,
    choices: {},
    note: "",
    ready: false
  };
}

/** Build the encounter record for a watch. */
export function blankEncounter() {
  return { title: "", text: "", links: [], revealed: false, fired: false };
}

export class CampState {
  /** @returns {object} The current camp state. Never null. */
  static get data() {
    const raw = game.settings.get(MODULE_ID, SETTINGS.campState);
    return foundry.utils.mergeObject(blankState(), raw ?? {}, { inplace: false });
  }

  /** @returns {boolean} */
  static get active() {
    return this.data.active === true;
  }

  /**
   * Persist a whole state object. GM only — callers on a player client must go
   * through the socket instead.
   * @param {object} data
   */
  static async replace(data) {
    if (!game.user.isGM) throw new Error(`${MODULE_ID} | Only a GM may write camp state.`);
    return game.settings.set(MODULE_ID, SETTINGS.campState, data);
  }

  /**
   * Read-modify-write helper. The mutator receives a deep clone and may either
   * mutate it in place or return a replacement.
   * @param {(state: object) => (object|void)} mutator
   */
  static async mutate(mutator) {
    const draft = foundry.utils.deepClone(this.data);
    const result = mutator(draft) ?? draft;
    return this.replace(result);
  }

  /** @param {string} actorId */
  static participant(actorId) {
    return this.data.participants[actorId] ?? null;
  }

  /** @returns {object[]} Participants in a stable, name-sorted order. */
  static participants() {
    return Object.values(this.data.participants).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Participants whose actor the given user owns. */
  static participantsFor(user = game.user) {
    return this.participants().filter((p) => {
      const actor = game.actors.get(p.actorId);
      return actor?.testUserPermission(user, "OWNER") ?? false;
    });
  }

  /**
   * Every participant awake during a watch, with the action they are performing.
   * @param {number} watch
   * @returns {Array<{participant: object, action: object}>}
   */
  static awakeDuring(watch) {
    const out = [];
    for (const p of this.participants()) {
      const id = p.assignments?.[watch];
      const action = getAction(id);
      if (action && action.id !== "slumber") out.push({ participant: p, action });
    }
    return out;
  }

  /** Watches this participant has left unassigned, i.e. spends asleep. */
  static sleepWatches(participant) {
    if (!participant) return 0;
    if (this.isSlumbering(participant)) return WATCH_COUNT;
    let count = 0;
    for (let w = 1; w <= WATCH_COUNT; w++) {
      if (!participant.assignments?.[w]) count++;
    }
    return count;
  }

  /** Has this participant committed the whole night to Slumber? */
  static isSlumbering(participant) {
    if (!participant) return false;
    return Object.values(participant.assignments ?? {}).some((id) => id === "slumber");
  }

  /**
   * Whether a participant's plan satisfies the six-hours-of-sleep requirement.
   * Trance characters need less rest, so they are always considered rested.
   * @param {object} participant
   * @returns {boolean}
   */
  static isRested(participant) {
    if (!participant) return false;
    if (participant.trance) return true;
    return this.sleepWatches(participant) >= REQUIRED_SLEEP_WATCHES;
  }

  /**
   * Validate a proposed assignment against the camp action rules.
   * Returns null when the assignment is legal, otherwise an i18n key explaining
   * why it is not.
   *
   * @param {object} participant  The participant as they currently stand.
   * @param {number} watch        Watch being assigned.
   * @param {string|null} actionId Action to place there, or null to clear it.
   * @returns {string|null} An i18n key under `CAMPOUT.errors`, or null.
   */
  static validateAssignment(participant, watch, actionId) {
    if (!actionId) return null;
    const action = getAction(actionId);
    if (!action) return "unknownAction";

    // Slumber owns the entire night; picking it always replaces whatever was
    // planned, and picking anything else wakes the character back up.
    if (actionId === "slumber") return null;
    const base = this.isSlumbering(participant)
      ? Object.fromEntries(Object.keys(participant.assignments ?? {}).map((w) => [w, null]))
      : { ...participant.assignments };

    const assignments = { ...base, [watch]: actionId };
    const taken = Object.entries(assignments).filter(([, id]) => id);

    // Non-repeatable actions may appear only once across the night.
    if (!action.repeatable) {
      const uses = taken.filter(([, id]) => id === actionId).length;
      if (uses > 1) return "actionOnce";
    }

    // Kibbles allows one camp action per night. Trance characters may stack
    // watches on top of it, but still only one *other* action.
    const nonWatch = taken.filter(([, id]) => id !== "watch").length;
    const limit = 1;
    if (nonWatch > limit) return participant.trance ? "tranceOneAction" : "oneActionPerNight";

    if (!participant.trance && taken.length > WATCH_COUNT - REQUIRED_SLEEP_WATCHES) {
      return "notEnoughSleep";
    }

    return null;
  }

  /** Participants who have flagged themselves ready. */
  static readyCount() {
    const all = this.participants();
    return { ready: all.filter((p) => p.ready).length, total: all.length };
  }

  /** @returns {object} The encounter planned for a watch, always an object. */
  static encounter(watch) {
    return foundry.utils.mergeObject(blankEncounter(), this.data.encounters?.[watch] ?? {}, {
      inplace: false
    });
  }

  /** Has every watch been resolved? */
  static get allWatchesResolved() {
    const resolved = this.data.resolved ?? {};
    for (let w = 1; w <= WATCH_COUNT; w++) {
      if (!resolved[w]) return false;
    }
    return true;
  }
}

/** Convenience re-export so callers need not import both modules. */
export { CAMP_ACTIONS };
