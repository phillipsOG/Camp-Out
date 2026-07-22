/**
 * Camp lifecycle: begin the night, resolve it one watch at a time, then cash in
 * the long rest.
 *
 * Every function here is GM-only. Player interaction goes through socket.js.
 */

import { MODULE_ID, WATCH_COUNT, SETTINGS, TEMPLATES, renderTpl, loc } from "./constants.js";
import { CampState, PHASES, blankState, blankParticipant, blankEncounter } from "./camp-state.js";
import { actionLabel, hasTrance } from "./actions.js";
import { setting } from "./settings.js";
import { confirmDialog } from "./dialogs.js";
import {
  isDnd5e,
  applyCookBuff,
  applyPreparationDie,
  grantInspiration,
  reduceExhaustion,
  longRestActor,
  shortRestActor
} from "./effects.js";

/** Seconds in one two-hour watch. */
const WATCH_SECONDS = 2 * 60 * 60;

function assertGM() {
  if (!game.user.isGM) throw new Error(loc("errors.gmOnly"));
}

/* -------------------------------------------- */
/*  Starting a camp                             */
/* -------------------------------------------- */

/**
 * Actors that should be offered a place at the campfire: every player-owned
 * character with an active or assigned user.
 * @returns {Actor[]}
 */
export function defaultParticipants() {
  const actors = new Set();
  for (const user of game.users) {
    if (user.isGM) continue;
    if (user.character) actors.add(user.character);
  }
  for (const actor of game.actors) {
    if (actor.type !== "character") continue;
    if (actor.hasPlayerOwner) actors.add(actor);
  }
  return [...actors];
}

/**
 * Open a new camp.
 * @param {Actor[]} actors Participants. Defaults to every player character.
 */
export async function beginCamp(actors = defaultParticipants()) {
  assertGM();

  if (CampState.active) {
    ui.notifications.warn(loc("errors.campActive"));
    return CampState.data;
  }
  if (!actors.length) {
    ui.notifications.warn(loc("errors.noParticipants"));
    return null;
  }

  const participants = {};
  for (const actor of actors) participants[actor.id] = blankParticipant(actor);

  const encounters = {};
  for (let w = 1; w <= WATCH_COUNT; w++) encounters[w] = blankEncounter();

  const state = {
    active: true,
    id: foundry.utils.randomID(),
    phase: PHASES.planning,
    startedAt: Date.now(),
    sceneId: canvas.scene?.id ?? null,
    currentWatch: 0,
    participants,
    encounters,
    resolved: {},
    shortRested: []
  };

  await CampState.replace(state);
  await postInvite(state);
  return state;
}

/** Add a single actor to a camp that is already running. */
export async function addParticipant(actor) {
  assertGM();
  if (!CampState.active) return;
  return CampState.mutate((state) => {
    if (!state.participants[actor.id]) state.participants[actor.id] = blankParticipant(actor);
  });
}

/** Remove an actor from the camp. */
export async function removeParticipant(actorId) {
  assertGM();
  return CampState.mutate((state) => {
    delete state.participants[actorId];
  });
}

/** Abandon the camp without granting any rest. */
export async function cancelCamp() {
  assertGM();
  await CampState.replace(blankState());
  ui.notifications.info(loc("notifications.campCancelled"));
}

/* -------------------------------------------- */
/*  Resolving watches                           */
/* -------------------------------------------- */

/** Move from planning into the first watch. */
export async function startResolving() {
  assertGM();
  const state = CampState.data;
  if (!state.active) return;

  if (setting(SETTINGS.requireSleep)) {
    const short = CampState.participants().filter((p) => !CampState.isRested(p));
    if (short.length) {
      const names = short.map((p) => p.name).join(", ");
      const proceed = await confirmDialog(
        loc("dialogs.underslept.title"),
        loc("dialogs.underslept.content", { names })
      );
      if (!proceed) return;
    }
  }

  await CampState.mutate((s) => {
    s.phase = PHASES.resolving;
    s.currentWatch = 1;
  });
}

/**
 * Play out one watch: reveal who was awake, surface the planned encounter, and
 * hand trance characters their mid-night short rest.
 * @param {number} watch
 */
export async function resolveWatch(watch) {
  assertGM();
  const state = CampState.data;
  if (!state.active) return;
  if (state.resolved?.[watch]) {
    ui.notifications.warn(loc("errors.watchResolved", { watch }));
    return;
  }

  const awake = CampState.awakeDuring(watch);
  const entries = awake.map(({ participant, action }) => ({
    actorId: participant.actorId,
    name: participant.name,
    img: participant.img,
    action: action.id,
    actionLabel: actionLabel(action.id),
    icon: action.icon,
    alertness: action.alertness
  }));

  const sleepers = CampState.participants()
    .filter((p) => !awake.some((a) => a.participant.actorId === p.actorId))
    .map((p) => ({ actorId: p.actorId, name: p.name, img: p.img }));

  await CampState.mutate((s) => {
    s.resolved[watch] = { watch, at: Date.now(), entries };
    s.currentWatch = Math.min(watch + 1, WATCH_COUNT + 1);
    if (s.encounters[watch]) s.encounters[watch].revealed = true;
  });

  await postWatchSummary(watch, entries, sleepers);
  await postEncounterCard(watch);

  if (setting(SETTINGS.advanceWorldTime)) await game.time.advance(WATCH_SECONDS);

  // Trance and Sentry's Rest finish early, so their short rest lands mid-night.
  const midpoint = Math.ceil(WATCH_COUNT / 2);
  if (watch === midpoint && setting(SETTINGS.autoTranceRest)) await grantTranceShortRests();
}

/**
 * Give every trance/sentry participant a short rest partway through the night.
 * @returns {Promise<string[]>} Names of the actors that rested.
 */
export async function grantTranceShortRests() {
  assertGM();
  const rested = [];
  const already = new Set(CampState.data.shortRested ?? []);

  for (const participant of CampState.participants()) {
    const actor = game.actors.get(participant.actorId);
    if (!actor) continue;
    if (already.has(participant.actorId)) continue;
    if (!(participant.trance ?? hasTrance(actor))) continue;

    await shortRestActor(actor);
    rested.push(actor.name);
    already.add(participant.actorId);
  }

  if (!rested.length) return rested;

  await CampState.mutate((s) => {
    s.shortRested = [...already];
  });

  await ChatMessage.create({
    speaker: { alias: loc("title") },
    content: `<div class="camp-out-card camp-out-trance">
        <h3><i class="fa-solid fa-hourglass-half"></i> ${loc("chat.tranceTitle")}</h3>
        <p>${loc("chat.tranceBody", { names: rested.join(", ") })}</p>
      </div>`
  });

  return rested;
}

/* -------------------------------------------- */
/*  Finishing the camp                          */
/* -------------------------------------------- */

/**
 * Apply the long rest and every camp action benefit, then close the camp.
 *
 * Order matters: the system long rest runs first (it restores half the party's
 * hit dice), and Cook tops up from there so the extra dice are not swallowed by
 * the rest's own restoration.
 */
export async function completeCamp() {
  assertGM();
  const state = CampState.data;
  if (!state.active) {
    ui.notifications.warn(loc("errors.noCamp"));
    return;
  }

  const participants = CampState.participants();
  const actors = participants
    .map((p) => ({ participant: p, actor: game.actors.get(p.actorId) }))
    .filter((entry) => entry.actor);

  if (!actors.length) {
    ui.notifications.warn(loc("errors.noParticipants"));
    return;
  }

  const report = [];

  // 1. The long rest itself, tracking how much exhaustion it removed so Slumber
  //    can top the reduction up to two levels rather than double-dipping.
  for (const { participant, actor } of actors) {
    const before = Number(actor.system?.attributes?.exhaustion ?? 0);
    await longRestActor(actor);
    const after = Number(actor.system?.attributes?.exhaustion ?? 0);
    report.push({
      participant,
      actor,
      exhaustionRemoved: Math.max(0, before - after),
      lines: []
    });
  }

  // 2. Cook, once per cook, feeding everyone still in camp.
  for (const entry of report) {
    if (!usedAction(entry.participant, "cook")) continue;
    const diners = actors.map((a) => a.actor);
    const results = await applyCookBuff(entry.actor, diners);
    const fed = results.filter((r) => r.restored > 0 || r.temp > 0);
    entry.lines.push(loc("summary.cook", { count: fed.length }));
    for (const result of fed) {
      const target = report.find((r) => r.actor.id === result.actor.id);
      if (!target) continue;
      if (result.restored) target.lines.push(loc("summary.hitDice", { count: result.restored }));
      if (result.temp) target.lines.push(loc("summary.tempHP", { amount: result.temp }));
    }
  }

  // 3. Slumber, Prepare and the narrative actions.
  for (const entry of report) {
    const { participant, actor } = entry;

    if (usedAction(participant, "slumber")) {
      const extra = Math.max(0, 2 - entry.exhaustionRemoved);
      const removed = extra ? await reduceExhaustion(actor, extra) : 0;
      const total = entry.exhaustionRemoved + removed;
      if (total) entry.lines.push(loc("summary.exhaustion", { count: total }));

      if (setting(SETTINGS.autoInspiration)) {
        const granted = await grantInspiration(actor);
        entry.lines.push(loc(granted ? "summary.inspiration" : "summary.inspirationAlready"));
      }
    }

    if (usedAction(participant, "prepare")) {
      const ability = participant.choices?.prepare?.ability ?? "str";
      await applyPreparationDie(actor, ability);
      entry.lines.push(loc("summary.prepare", { ability: abilityLabel(ability) }));
    }

    for (const id of ["craft", "repair", "task"]) {
      if (usedAction(participant, id)) entry.lines.push(loc(`summary.${id}`));
    }

    if (usedAction(participant, "watch")) {
      const count = watchCount(participant, "watch");
      entry.lines.push(loc("summary.watch", { count }));
    }
  }

  await postCampSummary(report);

  await CampState.replace(blankState());
  ui.notifications.info(loc("notifications.longRestGranted", { count: actors.length }));

  Hooks.callAll(`${MODULE_ID}.campComplete`, report);
  return report;
}

/* -------------------------------------------- */
/*  Encounters                                  */
/* -------------------------------------------- */

/** Save the GM's plan for one watch. */
export async function setEncounter(watch, data) {
  assertGM();
  return CampState.mutate((state) => {
    state.encounters[watch] = foundry.utils.mergeObject(
      blankEncounter(),
      { ...(state.encounters[watch] ?? {}), ...data },
      { inplace: false }
    );
  });
}

/** Attach a Journal Entry, Roll Table, Macro or Actor to a watch. */
export async function addEncounterLink(watch, uuid) {
  assertGM();
  const doc = await fromUuid(uuid);
  if (!doc) {
    ui.notifications.warn(loc("errors.badLink"));
    return;
  }
  return CampState.mutate((state) => {
    const encounter = (state.encounters[watch] ??= blankEncounter());
    if (encounter.links.some((l) => l.uuid === uuid)) return;
    encounter.links.push({
      uuid,
      name: doc.name,
      type: doc.documentName,
      icon: linkIcon(doc.documentName)
    });
  });
}

export async function removeEncounterLink(watch, uuid) {
  assertGM();
  return CampState.mutate((state) => {
    const encounter = state.encounters[watch];
    if (encounter) encounter.links = encounter.links.filter((l) => l.uuid !== uuid);
  });
}

/**
 * Act on a linked document: draw the table, run the macro, or open the sheet.
 * @param {string} uuid
 */
export async function triggerEncounterLink(uuid) {
  const doc = await fromUuid(uuid);
  if (!doc) {
    ui.notifications.warn(loc("errors.badLink"));
    return;
  }

  switch (doc.documentName) {
    case "RollTable":
      return doc.draw();
    case "Macro":
      return doc.execute();
    default:
      return doc.sheet?.render(true);
  }
}

function linkIcon(documentName) {
  return (
    {
      JournalEntry: "fa-solid fa-book",
      JournalEntryPage: "fa-solid fa-file-lines",
      RollTable: "fa-solid fa-dice-d20",
      Macro: "fa-solid fa-code",
      Actor: "fa-solid fa-dragon",
      Scene: "fa-solid fa-map",
      Item: "fa-solid fa-suitcase"
    }[documentName] ?? "fa-solid fa-link"
  );
}

/* -------------------------------------------- */
/*  Chat output                                 */
/* -------------------------------------------- */

async function postInvite(state) {
  const content = await renderTpl(TEMPLATES.chatInvite, {
    participants: Object.values(state.participants),
    watchCount: WATCH_COUNT
  });
  return ChatMessage.create({ speaker: { alias: loc("title") }, content });
}

async function postWatchSummary(watch, entries, sleepers) {
  const content = await renderTpl(TEMPLATES.chatWatch, {
    watch,
    watchCount: WATCH_COUNT,
    entries,
    sleepers,
    anyAwake: entries.length > 0
  });
  return ChatMessage.create({ speaker: { alias: loc("title") }, content });
}

/** The encounter card is whispered: it is the GM's prep, not table-facing text. */
async function postEncounterCard(watch) {
  const encounter = CampState.encounter(watch);
  if (!encounter.title && !encounter.text && !encounter.links.length) return;

  const links = encounter.links
    .map(
      (l) =>
        `<button type="button" class="camp-out-link" data-uuid="${l.uuid}">
           <i class="${l.icon}"></i> ${foundry.utils.escapeHTML?.(l.name) ?? l.name}
         </button>`
    )
    .join("");

  const content = `<div class="camp-out-card camp-out-encounter">
      <h3><i class="fa-solid fa-triangle-exclamation"></i> ${loc("chat.encounterTitle", { watch })}</h3>
      ${encounter.title ? `<h4>${encounter.title}</h4>` : ""}
      ${encounter.text ? `<div class="camp-out-encounter-text">${encounter.text}</div>` : ""}
      ${links ? `<div class="camp-out-links">${links}</div>` : ""}
    </div>`;

  return ChatMessage.create({
    speaker: { alias: loc("title") },
    content,
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id)
  });
}

async function postCampSummary(report) {
  const content = await renderTpl(TEMPLATES.chatSummary, {
    rows: report.map((entry) => ({
      name: entry.actor.name,
      img: entry.actor.img,
      lines: entry.lines,
      note: entry.participant.note
    })),
    system: isDnd5e()
  });
  return ChatMessage.create({ speaker: { alias: loc("title") }, content });
}

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

function usedAction(participant, actionId) {
  return Object.values(participant.assignments ?? {}).includes(actionId);
}

function watchCount(participant, actionId) {
  return Object.values(participant.assignments ?? {}).filter((id) => id === actionId).length;
}

function abilityLabel(key) {
  const config = CONFIG.DND5E?.abilities?.[key];
  return config?.label ?? config ?? String(key ?? "").toUpperCase();
}
