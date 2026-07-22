/**
 * The GM's camp screen: roster and shift grid, per-watch encounter prep, and the
 * controls that play the night out.
 *
 * Every value a template needs is computed in `_prepareContext`, so the .hbs
 * files only ever use `{{#each}}` and `{{#if}}`. That keeps them working across
 * Foundry generations without depending on which Handlebars helpers core happens
 * to register.
 */

import { WATCH_COUNT, TEMPLATES, SETTINGS, getDragData, loc } from "../constants.js";
import { CampState, PHASES } from "../camp-state.js";
import { localizedActions, actionLabel, getAction } from "../actions.js";
import { setting } from "../settings.js";
import { confirmDialog, promptForChoice } from "../dialogs.js";
import { setAssignment, clearAssignments, broadcastOpenSheet } from "../socket.js";
import {
  beginCamp,
  cancelCamp,
  startResolving,
  resolveWatch,
  completeCamp,
  addParticipant,
  removeParticipant,
  setEncounter,
  addEncounterLink,
  removeEncounterLink,
  triggerEncounterLink,
  grantTranceShortRests,
  defaultParticipants
} from "../rest.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CampPlanner extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Marker used by socket.js to find our windows for a refresh. */
  static CAMP_OUT_APP = true;

  static DEFAULT_OPTIONS = {
    id: "camp-out-planner",
    classes: ["camp-out", "camp-out-planner"],
    tag: "div",
    window: {
      title: "CAMPOUT.planner.title",
      icon: "fa-solid fa-campground",
      resizable: true
    },
    position: { width: 860, height: 720 },
    actions: {
      begin: CampPlanner.#onBegin,
      cancel: CampPlanner.#onCancel,
      startWatches: CampPlanner.#onStartWatches,
      resolve: CampPlanner.#onResolve,
      complete: CampPlanner.#onComplete,
      notify: CampPlanner.#onNotify,
      tab: CampPlanner.#onTab,
      addActor: CampPlanner.#onAddActor,
      removeActor: CampPlanner.#onRemoveActor,
      clearActor: CampPlanner.#onClearActor,
      removeLink: CampPlanner.#onRemoveLink,
      triggerLink: CampPlanner.#onTriggerLink,
      tranceRest: CampPlanner.#onTranceRest
    }
  };

  static PARTS = {
    body: { template: TEMPLATES.planner, scrollable: [".camp-out-scroll"] }
  };

  /** @type {"roster"|"watches"|"resolve"} */
  #tab = "roster";

  /** @type {CampPlanner|null} */
  static #instance = null;

  /* -------------------------------------------- */

  /** Open the planner, reusing the existing window so its tab is preserved. */
  static show() {
    CampPlanner.#instance ??= new CampPlanner();
    return CampPlanner.#instance.render(true);
  }

  /* -------------------------------------------- */

  async _prepareContext() {
    const state = CampState.data;
    const actions = localizedActions();
    const resolvedWatches = state.resolved ?? {};

    return {
      active: state.active,
      phase: state.phase,
      planning: state.phase === PHASES.planning,
      resolving: state.phase === PHASES.resolving,
      currentWatch: state.currentWatch,
      watchCount: WATCH_COUNT,
      tab: this.#tab,
      tabs: this.#tabContext(),
      isRoster: this.#tab === "roster",
      isWatches: this.#tab === "watches",
      isResolve: this.#tab === "resolve",
      headers: Array.from({ length: WATCH_COUNT }, (_, i) => ({
        watch: i + 1,
        label: loc("common.watchN", { n: i + 1 }),
        hours: `${i * 2 + 1}–${i * 2 + 2}`,
        resolved: !!resolvedWatches[i + 1],
        current: state.currentWatch === i + 1
      })),
      participants: this.#participantContext(state, actions),
      actions,
      watches: this.#watchContext(state),
      ready: CampState.readyCount(),
      allResolved: CampState.allWatchesResolved,
      canStart: state.active && state.phase === PHASES.planning,
      canComplete: state.active && state.phase === PHASES.resolving,
      revealActions: setting(SETTINGS.revealActions),
      availableActors: this.#availableActors(state)
    };
  }

  #tabContext() {
    return [
      { id: "roster", label: loc("planner.tabs.roster"), icon: "fa-solid fa-users", active: this.#tab === "roster" },
      { id: "watches", label: loc("planner.tabs.watches"), icon: "fa-solid fa-triangle-exclamation", active: this.#tab === "watches" },
      { id: "resolve", label: loc("planner.tabs.resolve"), icon: "fa-solid fa-forward", active: this.#tab === "resolve" }
    ];
  }

  #participantContext(state, actions) {
    return CampState.participants().map((p) => {
      const sleep = CampState.sleepWatches(p);
      const rested = CampState.isRested(p);
      const cells = [];

      for (let w = 1; w <= WATCH_COUNT; w++) {
        const assigned = p.assignments?.[w] ?? null;
        const action = getAction(assigned);
        cells.push({
          watch: w,
          actorId: p.actorId,
          value: assigned ?? "",
          label: assigned ? actionLabel(assigned) : loc("common.asleep"),
          icon: action?.icon ?? "fa-solid fa-bed",
          color: action?.color ?? "transparent",
          resolved: !!state.resolved?.[w],
          options: actions.map((a) => ({
            id: a.id,
            label: a.label,
            selected: a.id === assigned
          }))
        });
      }

      return {
        ...p,
        cells,
        sleepWatches: sleep,
        rested,
        statusIcon: rested ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation",
        statusLabel: rested
          ? loc("planner.rested", { count: sleep })
          : loc("planner.underslept", { count: sleep }),
        readyLabel: p.ready ? loc("planner.ready") : loc("planner.notReady")
      };
    });
  }

  #watchContext(state) {
    const watches = [];
    for (let w = 1; w <= WATCH_COUNT; w++) {
      const encounter = CampState.encounter(w);
      const resolved = state.resolved?.[w] ?? null;
      watches.push({
        watch: w,
        label: loc("common.watchN", { n: w }),
        hours: loc("common.hoursRange", { from: w * 2 - 1, to: w * 2 }),
        encounter,
        hasPlan: !!(encounter.title || encounter.text || encounter.links.length),
        resolved: !!resolved,
        entries: resolved?.entries ?? CampState.awakeDuring(w).map(({ participant, action }) => ({
          actorId: participant.actorId,
          name: participant.name,
          img: participant.img,
          actionLabel: actionLabel(action.id),
          icon: action.icon
        })),
        isNext: state.currentWatch === w,
        canResolve: state.phase === PHASES.resolving && state.currentWatch === w
      });
    }
    return watches;
  }

  #availableActors(state) {
    return defaultParticipants()
      .filter((actor) => !state.participants[actor.id])
      .map((actor) => ({ id: actor.id, name: actor.name }));
  }

  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;

    // Shift grid: assigning an action for a participant on a watch.
    for (const select of root.querySelectorAll("select[data-assign]")) {
      select.addEventListener("change", async (event) => {
        const { actorId, watch } = event.currentTarget.dataset;
        const actionId = event.currentTarget.value || null;
        const choice = await promptForChoice(actionId);

        // A dismissed Prepare prompt means "never mind": put the select back.
        if (actionId === "prepare" && !choice) {
          this.render(false);
          return;
        }
        await setAssignment(actorId, Number(watch), actionId, choice);
      });
    }

    // Encounter fields save on blur so a stray re-render cannot eat typing.
    for (const field of root.querySelectorAll("[data-encounter-field]")) {
      field.addEventListener("change", (event) => {
        const el = event.currentTarget;
        setEncounter(Number(el.dataset.watch), { [el.dataset.encounterField]: el.value });
      });
    }

    // Drop zones for journals, tables, macros and actors.
    for (const zone of root.querySelectorAll(".camp-out-drop")) {
      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        zone.classList.add("is-over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
      zone.addEventListener("drop", async (event) => {
        event.preventDefault();
        zone.classList.remove("is-over");
        const data = getDragData(event);
        if (!data?.uuid) {
          ui.notifications.warn(loc("errors.badLink"));
          return;
        }
        await addEncounterLink(Number(zone.dataset.watch), data.uuid);
      });
    }
  }

  /* -------------------------------------------- */
  /*  Action handlers                             */
  /* -------------------------------------------- */

  static async #onTab(event, target) {
    this.#tab = target.dataset.tabId;
    this.render(false);
  }

  static async #onBegin() {
    await beginCamp();
    this.#tab = "roster";
    this.render(false);
  }

  static async #onCancel() {
    const ok = await confirmDialog(loc("dialogs.cancel.title"), loc("dialogs.cancel.content"));
    if (!ok) return;
    await cancelCamp();
    this.render(false);
  }

  static async #onStartWatches() {
    await startResolving();
    this.#tab = "resolve";
    this.render(false);
  }

  static async #onResolve(event, target) {
    await resolveWatch(Number(target.dataset.watch));
    this.render(false);
  }

  static async #onComplete() {
    const ok = await confirmDialog(loc("dialogs.complete.title"), loc("dialogs.complete.content"));
    if (!ok) return;
    await completeCamp();
    this.render(false);
  }

  static async #onNotify() {
    broadcastOpenSheet();
    ui.notifications.info(loc("notifications.playersNotified"));
  }

  static async #onAddActor() {
    const select = this.element.querySelector("select[data-add-actor]");
    const actor = game.actors.get(select?.value);
    if (!actor) return;
    await addParticipant(actor);
    this.render(false);
  }

  static async #onRemoveActor(event, target) {
    await removeParticipant(target.dataset.actorId);
    this.render(false);
  }

  static async #onClearActor(event, target) {
    await clearAssignments(target.dataset.actorId);
    this.render(false);
  }

  static async #onRemoveLink(event, target) {
    await removeEncounterLink(Number(target.dataset.watch), target.dataset.uuid);
    this.render(false);
  }

  static async #onTriggerLink(event, target) {
    await triggerEncounterLink(target.dataset.uuid);
  }

  static async #onTranceRest() {
    const rested = await grantTranceShortRests();
    if (!rested.length) ui.notifications.info(loc("notifications.noTrance"));
    this.render(false);
  }
}
