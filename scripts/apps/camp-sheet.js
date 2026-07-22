/**
 * The player's camp sheet: claim a watch, pick a camp action, and see how the
 * night is shaping up without seeing what everyone else chose.
 *
 * The night is shown as a single horizontal timeline, one segment per watch.
 * Clicking a segment selects it; the action-card grid below always reflects
 * whichever segment is selected, rather than repeating a full grid per watch.
 * Selection defaults to the watch the GM is currently playing out once the
 * night starts, but a deliberate click pins it until clicked elsewhere - see
 * `#resolveSelectedWatch`.
 *
 * Concealment is deliberate but not secret-keeping: other players' picks are
 * withheld from the interface until the watch is played out (or the GM flips the
 * reveal setting), which is what lets the GM narrate each shift as it happens.
 */

import { WATCH_COUNT, TEMPLATES, SETTINGS, loc } from "../constants.js";
import { CampState, PHASES, MODES } from "../camp-state.js";
import { localizedActions, actionLabel, getAction } from "../actions.js";
import { setting } from "../settings.js";
import { setAssignment, clearAssignments, setReady, setNote } from "../socket.js";
import { promptForChoice } from "../dialogs.js";
import { applyTheme, toggleTheme, themeContext } from "../theme.js";

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
    position: { width: 620, height: 680 },
    actions: {
      assign: CampSheet.#onAssign,
      clear: CampSheet.#onClear,
      ready: CampSheet.#onReady,
      theme: CampSheet.#onTheme,
      selectActor: CampSheet.#onSelectActor,
      selectWatch: CampSheet.#onSelectWatch
    }
  };

  static PARTS = {
    body: { template: TEMPLATES.sheet, scrollable: [".camp-out-scroll"] }
  };

  /** Actor whose night is currently being edited. */
  #actorId = null;

  /** Watch the timeline panel is showing, or null to auto-follow the current watch. */
  #selectedWatch = null;

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
    const theme = themeContext();

    if (participant) this.#actorId = participant.actorId;

    const sleep = participant ? CampState.sleepWatches(participant) : WATCH_COUNT;
    const required = participant ? CampState.requiredSleep(participant) : 3;
    const assists = participant ? CampState.assistWatches(participant) : 0;

    const rows = this.#rowContext(state, participant);
    const selectedWatch = this.#resolveSelectedWatch(state, rows);
    const selectedRow = rows.find((r) => r.watch === selectedWatch) ?? null;
    const resolvedCount = rows.filter((r) => r.resolved).length;
    const locked = state.phase !== PHASES.planning;

    return {
      active: state.active,
      phase: state.phase,
      resolving: state.phase === PHASES.resolving,
      locked,
      watchCount: WATCH_COUNT,
      theme: theme.theme,
      themeIcon: theme.icon,
      themeLabel: theme.label,
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
      sleepHours: sleep * 2,
      requiredHours: required * 2,
      assistWatches: assists,
      freeWatches: participant ? CampState.freeWatches(participant) : 1,
      slumbering: participant ? CampState.isSlumbering(participant) : false,
      rows: rows.map((row) => ({ ...row, selected: row.watch === selectedWatch })),
      progressPercent: Math.round((resolvedCount / WATCH_COUNT) * 100),
      progressLabel: this.#progressLabel(state),
      selectedRow,
      choices: selectedRow
        ? actions.map((a) => ({ ...a, watch: selectedWatch, selected: a.id === selectedRow.assigned, disabled: locked }))
        : [],
      roster: this.#rosterContext(state, participant),
      note: participant?.note ?? ""
    };
  }

  /**
   * Which watch the timeline panel should show. A deliberate click on a
   * segment (`#selectedWatch`) always wins; short of that, the panel follows
   * the GM's pace once the night starts, or lands on the first unplanned
   * watch while the party is still deciding.
   */
  #resolveSelectedWatch(state, rows) {
    if (this.#selectedWatch && rows.some((r) => r.watch === this.#selectedWatch)) {
      return this.#selectedWatch;
    }
    if (state.phase === PHASES.resolving) {
      return Math.min(Math.max(state.currentWatch, 1), WATCH_COUNT);
    }
    return rows.find((r) => !r.assigned)?.watch ?? rows[0]?.watch ?? 1;
  }

  #progressLabel(state) {
    if (state.phase === PHASES.resolving) {
      const current = Math.min(Math.max(state.currentWatch, 1), WATCH_COUNT);
      return loc("sheet.progressResolving", { current, total: WATCH_COUNT });
    }
    return loc("sheet.progressPlanning");
  }

  /** One timeline segment per watch. The action-card grid is built separately, for whichever segment is selected. */
  #rowContext(state, participant) {
    const schedule = participant ? CampState.scheduleFor(participant) : [];

    return schedule.map((slot) => {
      const action = getAction(slot.actionId);
      const assisting = slot.mode === MODES.assist;
      return {
        watch: slot.watch,
        label: loc("common.watchN", { n: slot.watch }),
        hours: loc("common.hoursRange", { from: slot.watch * 2 - 1, to: slot.watch * 2 }),
        resolved: !!state.resolved?.[slot.watch],
        current: state.currentWatch === slot.watch,
        assigned: slot.actionId,
        mode: slot.mode,
        assisting,
        asleep: slot.mode === MODES.sleep,
        color: action?.color ?? "transparent",
        assignedLabel: action
          ? actionLabel(action.id)
          : loc(assisting ? "common.assisting" : "common.asleep"),
        assignedIcon: action?.icon ?? (assisting ? "fa-solid fa-hands-holding-circle" : "fa-solid fa-bed")
      };
    });
  }

  /**
   * The rest of the party, each as their own mini timeline. An entry's action
   * is only included once that watch has been played out, or when the GM has
   * turned reveal on - see the module README's note on concealment.
   */
  #rosterContext(state, participant) {
    const reveal = setting(SETTINGS.revealActions);

    return CampState.participants()
      .filter((p) => p.actorId !== participant?.actorId)
      .map((p) => {
        const schedule = CampState.scheduleFor(p);
        const watches = schedule.map((slot) => {
          const visible = reveal || !!state.resolved?.[slot.watch];
          const resolved = !!state.resolved?.[slot.watch];
          const current = state.currentWatch === slot.watch;
          if (!visible) {
            return { watch: slot.watch, visible, resolved, current, label: "?", icon: "fa-solid fa-question", color: "transparent" };
          }
          const action = getAction(slot.actionId);
          const assisting = slot.mode === MODES.assist;
          return {
            watch: slot.watch,
            visible,
            resolved,
            current,
            label: action
              ? actionLabel(action.id)
              : loc(assisting ? "common.assisting" : "common.asleep"),
            icon: action?.icon ?? (assisting ? "fa-solid fa-hands-holding-circle" : "fa-solid fa-bed"),
            color: action?.color ?? "transparent"
          };
        });
        return { name: p.name, img: p.img, ready: p.ready, trance: p.trance, watches };
      });
  }

  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);
    applyTheme(this);

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

  static async #onTheme() {
    await toggleTheme();
    this.render(false);
  }

  static async #onSelectActor(event, target) {
    this.#actorId = target.dataset.actorId;
    this.#selectedWatch = null;
    this.render(false);
  }

  static async #onSelectWatch(event, target) {
    this.#selectedWatch = Number(target.dataset.watch);
    this.render(false);
  }
}
