/**
 * Camp state: the shared record of who is doing what, on which watch.
 *
 * The whole object lives in one world setting. Only a GM ever writes to it -
 * player edits arrive over the socket and are applied by the GM client (see
 * socket.js). Every client reacts to the resulting `updateSetting` hook, so
 * reads are always local and cheap.
 */

import { MODULE_ID, SETTINGS, WATCH_COUNT, SLEEP_WATCHES } from "./constants.js";
import { CAMP_ACTIONS, CATEGORY, getAction, hasTrance } from "./actions.js";

export const PHASES = {
  idle: "idle",
  planning: "planning",
  resolving: "resolving",
  complete: "complete"
};

/**
 * What a character is doing during a given watch.
 * - `action`: performing an assigned camp action.
 * - `assist`: awake with nothing assigned, lending an extra pair of eyes.
 * - `sleep`: asleep.
 */
export const MODES = {
  action: "action",
  assist: "assist",
  sleep: "sleep"
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
   * Persist a whole state object. GM only - callers on a player client must go
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

  /* -------------------------------------------- */
  /*  Sleep and scheduling                        */
  /* -------------------------------------------- */

  /** Watches this participant must spend asleep. Trance characters need fewer. */
  static requiredSleep(participant) {
    return participant?.trance ? SLEEP_WATCHES.trance : SLEEP_WATCHES.normal;
  }

  /** Free watches this participant has to spend, after sleep is accounted for. */
  static freeWatches(participant) {
    return WATCH_COUNT - this.requiredSleep(participant);
  }

  /**
   * Work out what a participant is doing across the whole night.
   *
   * Watches with an explicit action are `action`. The rest are sleep, except
   * that any waking time left over once the sleep requirement is met becomes
   * `assist`: the character is up, unoccupied, and quietly helping whoever has
   * the watch. Surplus falls on the earliest free watches so the result is
   * stable and predictable rather than depending on iteration order.
   *
   * @param {object} participant
   * @returns {Array<{watch: number, actionId: string|null, mode: string}>}
   */
  static scheduleFor(participant) {
    const schedule = [];
    if (!participant) return schedule;

    if (this.isSlumbering(participant)) {
      for (let w = 1; w <= WATCH_COUNT; w++) {
        schedule.push({ watch: w, actionId: "slumber", mode: MODES.sleep });
      }
      return schedule;
    }

    const free = [];
    for (let w = 1; w <= WATCH_COUNT; w++) {
      const actionId = participant.assignments?.[w] ?? null;
      if (actionId) {
        schedule.push({ watch: w, actionId, mode: MODES.action });
      } else {
        schedule.push({ watch: w, actionId: null, mode: MODES.sleep });
        free.push(schedule.length - 1);
      }
    }

    const surplus = Math.max(0, free.length - this.requiredSleep(participant));
    for (let i = 0; i < surplus; i++) schedule[free[i]].mode = MODES.assist;

    return schedule;
  }

  /** Watches this participant actually spends asleep. */
  static sleepWatches(participant) {
    return this.scheduleFor(participant).filter((s) => s.mode === MODES.sleep).length;
  }

  /** Watches this participant spends awake but unoccupied, assisting the watch. */
  static assistWatches(participant) {
    return this.scheduleFor(participant).filter((s) => s.mode === MODES.assist).length;
  }

  /** Has this participant committed the whole night to Slumber? */
  static isSlumbering(participant) {
    if (!participant) return false;
    return Object.values(participant.assignments ?? {}).some((id) => id === "slumber");
  }

  /**
   * Whether a participant's plan leaves them enough sleep for a long rest.
   * @param {object} participant
   * @returns {boolean}
   */
  static isRested(participant) {
    if (!participant) return false;
    return this.sleepWatches(participant) >= this.requiredSleep(participant);
  }

  /**
   * Every participant awake during a watch, whether working or assisting.
   * @param {number} watch
   * @returns {Array<{participant: object, action: object|null, mode: string}>}
   */
  static awakeDuring(watch) {
    const out = [];
    for (const p of this.participants()) {
      const slot = this.scheduleFor(p).find((s) => s.watch === watch);
      if (!slot || slot.mode === MODES.sleep) continue;
      out.push({
        participant: p,
        action: getAction(slot.actionId),
        mode: slot.mode
      });
    }
    return out;
  }

  /* -------------------------------------------- */
  /*  Validation                                  */
  /* -------------------------------------------- */

  /**
   * Validate a proposed assignment against the camp action rules.
   *
   * @param {object} participant   The participant as they currently stand.
   * @param {number} watch         Watch being assigned.
   * @param {string|null} actionId Action to place there, or null to clear it.
   * @returns {{key: string, data: object}|null} An error under `CAMPOUT.errors`,
   *   or null when the assignment is legal.
   */
  static validateAssignment(participant, watch, actionId) {
    if (!actionId) return null;
    const action = getAction(actionId);
    if (!action) return { key: "unknownAction", data: {} };

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
      if (uses > 1) return { key: "actionOnce", data: { action: actionId } };
    }

    // One real camp action per night. Watches and Tasks are fillers.
    const primaries = taken.filter(([, id]) => CAMP_ACTIONS[id]?.category === CATEGORY.primary);
    if (primaries.length > 1) return { key: "oneActionPerNight", data: {} };

    const free = this.freeWatches(participant);
    if (taken.length > free) {
      return {
        key: "notEnoughSleep",
        data: { hours: this.requiredSleep(participant) * 2, free }
      };
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
