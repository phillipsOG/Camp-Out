/**
 * The player's camp sheet: claim a watch, pick a camp action, and see how the
 * night is shaping up without seeing what everyone else chose.
 *
 * Concealment is deliberate but not secret-keeping: other players' picks are
 * withheld from the interface until the watch is played out (or the GM flips the
 * reveal setting), which is what lets the GM narrate each shift as it happens.
 */

import { WATCH_COUNT, TEMPLATES, SETTINGS, loc } from "../constants.js";
import { CampState, PHASES } from "../camp-state.js";
import { localizedActions, actionLabel, getAction } from "../actions.js";
import { setting } from "../settings.js";
import { setAssignment, clearAssignments, setReady, setNote } from "../socket.js";
import { promptForChoice } from "../dialogs.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CampSheet extends HandlebarsApplicationMixin(ApplicationV2) {
  static CAMP_OUT_APP = true;

  static DEFAULT_OPTIONS = {
    id: "camp-out-sheet",
    classes: ["camp-out", "camp-out-sheet"],
    tag: "div",
    window: {
      title: "CAMPOUT.sheet.title",
      icon: "fa-solid fa-campground",
      resizable: true
    },
    position: { width: 640, height: 700 },
    actions: {
      assign: CampSheet.#onAssign,
      clear: CampSheet.#onClear,
      ready: CampSheet.#onReady,
      selectActor: CampSheet.#onSelectActor
    }
  };

  static PARTS = {
    body: { template: TEMPLATES.sheet, scrollable: [".camp-out-scroll"] }
  };

  /** Actor whose night is currently being edited. */
  #actorId = null;

  /** @type {CampSheet|null} */
  static #instance = null;

  /* -------------------------------------------- */

  static show() {
    if (!CampState.active) {
      ui.notifications.info(loc("errors.noCamp"));
      return null;
    }
    CampSheet.#instance ??= new CampSheet();
    return CampSheet.#instance.render(true);
  }

  /** The participant record this sheet is editing, or null. */
  get participant() {
    const mine = CampState.participantsFor(game.user);
    if (!mine.length) return null;
    return mine.find((p) => p.actorId === this.#actorId) ?? mine[0];
  }

  /* -------------------------------------------- */

  async _prepareContext() {
    const state = CampState.data;
    const participant = this.participant;
    const mine = CampState.participantsFor(game.user);
    const actions = localizedActions();

    if (participant) this.#actorId = participant.actorId;

    return {
      active: state.active,
      phase: state.phase,
      resolving: state.phase === PHASES.resolving,
      locked: state.phase !== PHASES.planning,
      watchCount: WATCH_COUNT,
      hasCharacter: !!participant,
      characters: mine.map((p) => ({
        actorId: p.actorId,
        name: p.name,
        img: p.img,
        active: p.actorId === participant?.actorId
      })),
      multipleCharacters: mine.length > 1,
      participant,
      trance: participant?.trance ?? false,
      rested: participant ? CampState.isRested(participant) : false,
      sleepWatches: participant ? CampState.sleepWatches(participant) : WATCH_COUNT,
      slumbering: participant ? CampState.isSlumbering(participant) : false,
      rows: this.#rowContext(state, participant, actions),
      actions,
      roster: this.#rosterContext(state, participant),
      note: participant?.note ?? ""
    };
  }

  /** One row per watch, each offering the full set of camp actions. */
  #rowContext(state, participant, actions) {
    const rows = [];
    for (let w = 1; w <= WATCH_COUNT; w++) {
      const assigned = participant?.assignments?.[w] ?? null;
      const resolved = !!state.resolved?.[w];
      rows.push({
        watch: w,
        label: loc("common.watchN", { n: w }),
        hours: loc("common.hoursRange", { from: w * 2 - 1, to: w * 2 }),
        resolved,
        current: state.currentWatch === w,
        assigned,
        assignedLabel: assigned ? actionLabel(assigned) : loc("common.asleep"),
        assignedIcon: getAction(assigned)?.icon ?? "fa-solid fa-bed",
        choices: actions.map((a) => ({
          ...a,
          watch: w,
          selected: a.id === assigned
        }))
      });
    }
    return rows;
  }

  /**
   * The rest of the party. An entry's action is only included once that watch
   * has been played out, or when the GM has turned reveal on.
   */
  #rosterContext(state, participant) {
    const reveal = setting(SETTINGS.revealActions);

    return CampState.participants()
      .filter((p) => p.actorId !== participant?.actorId)
      .map((p) => {
        const watches = [];
        for (let w = 1; w <= WATCH_COUNT; w++) {
          const visible = reveal || !!state.resolved?.[w];
          const assigned = p.assignments?.[w] ?? null;
          watches.push({
            watch: w,
            visible,
            label: visible ? (assigned ? actionLabel(assigned) : loc("common.asleep")) : "?",
            icon: visible ? getAction(assigned)?.icon ?? "fa-solid fa-bed" : "fa-solid fa-question"
          });
        }
        return { name: p.name, img: p.img, ready: p.ready, trance: p.trance, watches };
      });
  }

  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);
    const note = this.element?.querySelector("textarea[data-note]");
    if (!note) return;
    note.addEventListener("change", (event) => {
      const participant = this.participant;
      if (participant) setNote(participant.actorId, event.currentTarget.value);
    });
  }

  /* -------------------------------------------- */
  /*  Action handlers                             */
  /* -------------------------------------------- */

  static async #onAssign(event, target) {
    const participant = this.participant;
    if (!participant) return;

    const watch = Number(target.dataset.watch);
    const actionId = target.dataset.actionId;

    // Clicking the action already in place clears it back to sleep.
    const current = participant.assignments?.[watch] ?? null;
    if (current === actionId) {
      await setAssignment(participant.actorId, watch, null);
      this.render(false);
      return;
    }

    const choice = await promptForChoice(actionId);
    if (actionId === "prepare" && !choice) return;

    await setAssignment(participant.actorId, watch, actionId, choice);
    this.render(false);
  }

  static async #onClear() {
    const participant = this.participant;
    if (!participant) return;
    await clearAssignments(participant.actorId);
    this.render(false);
  }

  static async #onReady() {
    const participant = this.participant;
    if (!participant) return;
    await setReady(participant.actorId, !participant.ready);
    this.render(false);
  }

  static async #onSelectActor(event, target) {
    this.#actorId = target.dataset.actorId;
    this.render(false);
  }
}
