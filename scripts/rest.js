/**
 * Camp lifecycle: begin the night, resolve it one watch at a time, then cash in
 * the long rest - or lose the lot if something comes out of the dark.
 *
 * Every function here is GM-only. Player interaction goes through socket.js.
 */

import { MODULE_ID, WATCH_COUNT, SETTINGS, TEMPLATES, renderTpl, loc } from "./constants.js";
import { CampState, PHASES, MODES, blankState, blankParticipant, blankEncounter } from "./camp-state.js";
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
import { partyRequirement, partySupply, consumeRations, setItemSaturation } from "./rations.js";

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

  const rationReport = setting(SETTINGS.requireRations) ? await eatRations() : null;
  if (rationReport === false) return; // GM declined to start the night underfed.

  await CampState.mutate((s) => {
    s.phase = PHASES.resolving;
    s.currentWatch = 1;
  });

  if (rationReport) await postRationSummary(rationReport);
}

/**
 * Feed the whole camp before the night starts, warning (with the option to
 * proceed anyway) if the party's packs cannot cover everyone.
 * @returns {Promise<object|null|false>} A consumption report, `null` if
 *   nobody needed feeding, or `false` if the GM backed out.
 */
async function eatRations() {
  const actors = CampState.participants()
    .map((p) => game.actors.get(p.actorId))
    .filter(Boolean);
  if (!actors.length) return null;

  const needed = partyRequirement(actors);
  const supply = partySupply(actors);

  if (supply < needed) {
    const proceed = await confirmDialog(
      loc("dialogs.underfed.title"),
      loc("dialogs.underfed.content", { supply, needed })
    );
    if (!proceed) return false;
  }

  return consumeRations(actors, needed);
}

/** Turn a watch's awake list into the shape the chat card and state want. */
function entriesForWatch(watch) {
  return CampState.awakeDuring(watch).map(({ participant, action, mode }) => ({
    actorId: participant.actorId,
    name: participant.name,
    img: participant.img,
    mode,
    assisting: mode === MODES.assist,
    action: action?.id ?? null,
    actionLabel: action ? actionLabel(action.id) : loc("common.assisting"),
    icon: action?.icon ?? "fa-solid fa-hands-holding-circle"
  }));
}

/**
 * Play out one watch: reveal who was awake, hand the GM their prep, and give
 * trance characters their mid-night short rest.
 *
 * Resolving a watch does not spring its encounter - that is a separate,
 * deliberate act, because springing one ends the camp.
 *
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

  const entries = entriesForWatch(watch);
  const awakeIds = new Set(entries.map((e) => e.actorId));
  const sleepers = CampState.participants()
    .filter((p) => !awakeIds.has(p.actorId))
    .map((p) => ({ actorId: p.actorId, name: p.name, img: p.img }));

  await CampState.mutate((s) => {
    s.resolved[watch] = { watch, at: Date.now(), entries };
    s.currentWatch = Math.min(watch + 1, WATCH_COUNT + 1);
    if (s.encounters[watch]) s.encounters[watch].revealed = true;
  });

  await postWatchSummary(watch, entries, sleepers);
  await postEncounterPrep(watch);

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

    const result = await shortRestActor(actor);
    if (result.ok) rested.push(actor.name);
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
 * Open a linked document: draw the table, run the macro, or show the sheet.
 * This is reference material and does not disturb the camp.
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

/**
 * Spring the encounter planned for a watch.
 *
 * Something comes out of the dark and the night is ruined: the camp breaks
 * immediately and nobody receives the long rest or any camp action benefit.
 * Short rests already taken by trance characters earlier in the night stand,
 * because they had already finished by the time this happened.
 *
 * @param {number} watch
 * @param {object} [options]
 * @param {boolean} [options.confirm] Ask before ending the camp.
 */
export async function triggerEncounter(watch, { confirm = true } = {}) {
  assertGM();
  if (!CampState.active) {
    ui.notifications.warn(loc("errors.noCamp"));
    return null;
  }

  if (confirm) {
    const ok = await confirmDialog(
      loc("dialogs.trigger.title"),
      loc("dialogs.trigger.content", { watch })
    );
    if (!ok) return null;
  }

  const encounter = CampState.encounter(watch);
  const participants = CampState.participants();

  await postEncounterReveal(watch, encounter);
  await postCampBroken(watch, participants);

  await CampState.replace(blankState());
  ui.notifications.warn(loc("notifications.campBroken", { watch }));

  Hooks.callAll(`${MODULE_ID}.campBroken`, { watch, encounter, participants });
  return { watch, encounter };
}

/* -------------------------------------------- */
/*  Provisions                                  */
/* -------------------------------------------- */

/** Tag (or untag, with `value <= 0`) an actor's item as food for the Provisions tab. */
export async function setFoodSaturation(actorId, itemId, value) {
  assertGM();
  const item = game.actors.get(actorId)?.items.get(itemId);
  if (!item) return;
  return setItemSaturation(item, value);
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
    const result = await longRestActor(actor);
    const after = Number(actor.system?.attributes?.exhaustion ?? 0);

    const entry = {
      participant,
      actor,
      rested: result.ok,
      exhaustionRemoved: Math.max(0, before - after),
      lines: []
    };
    entry.lines.push(loc(result.ok ? "summary.longRest" : `summary.longRestFailed.${result.reason}`));
    report.push(entry);
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
      const count = watchCount(participant, id);
      if (count) entry.lines.push(loc(`summary.${id}`, { hours: count * 2 }));
    }

    const watches = watchCount(participant, "watch");
    if (watches) entry.lines.push(loc("summary.watch", { count: watches }));

    const assists = CampState.assistWatches(participant);
    if (assists) entry.lines.push(loc("summary.assist", { count: assists }));
  }

  await postCampSummary(report);

  await CampState.replace(blankState());

  const failed = report.filter((r) => !r.rested);
  if (failed.length) {
    ui.notifications.warn(
      loc("notifications.longRestPartial", {
        ok: report.length - failed.length,
        failed: failed.length
      })
    );
  } else {
    ui.notifications.info(loc("notifications.longRestGranted", { count: report.length }));
  }

  Hooks.callAll(`${MODULE_ID}.campComplete`, report);
  return report;
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

/** The camp's rations report, posted once the night's food has been eaten. */
async function postRationSummary({ fed, short, consumed }) {
  const items = consumed
    .map((c) => `<li>${escape(c.name)} ${c.count > 1 ? `&times;${c.count}` : ""}</li>`)
    .join("");

  const content = `<div class="camp-out-card camp-out-rations ${short > 0 ? "is-short" : ""}">
      <h3><i class="fa-solid fa-drumstick-bite"></i> ${loc("chat.rationsTitle")}</h3>
      ${items ? `<ul class="camp-out-card-list">${items}</ul>` : `<p>${loc("chat.rationsNone")}</p>`}
      <p class="camp-out-card-note">${loc(short > 0 ? "chat.rationsShort" : "chat.rationsFed", { fed, short })}</p>
    </div>`;

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

function encounterLinkButtons(encounter) {
  return encounter.links
    .map(
      (l) =>
        `<button type="button" class="camp-out-link" data-uuid="${l.uuid}">
           <i class="${l.icon}"></i> ${escape(l.name)}
         </button>`
    )
    .join("");
}

/** The GM's prep, whispered to them when a watch resolves. Not table-facing. */
async function postEncounterPrep(watch) {
  const encounter = CampState.encounter(watch);
  if (!encounter.title && !encounter.text && !encounter.links.length) return;

  const links = encounterLinkButtons(encounter);
  const content = `<div class="camp-out-card camp-out-encounter is-prep">
      <h3><i class="fa-solid fa-eye"></i> ${loc("chat.encounterPrepTitle", { watch })}</h3>
      ${encounter.title ? `<h4>${escape(encounter.title)}</h4>` : ""}
      ${encounter.text ? `<div class="camp-out-encounter-text">${escape(encounter.text)}</div>` : ""}
      ${links ? `<div class="camp-out-links">${links}</div>` : ""}
      <p class="camp-out-card-note">${loc("chat.encounterPrepHint")}</p>
    </div>`;

  return ChatMessage.create({
    speaker: { alias: loc("title") },
    content,
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id)
  });
}

/** The encounter itself, shown to the whole table when it is sprung. */
async function postEncounterReveal(watch, encounter) {
  const links = encounterLinkButtons(encounter);
  const content = `<div class="camp-out-card camp-out-encounter is-sprung">
      <h3><i class="fa-solid fa-triangle-exclamation"></i> ${loc("chat.encounterTitle", { watch })}</h3>
      ${encounter.title ? `<h4>${escape(encounter.title)}</h4>` : ""}
      ${encounter.text ? `<div class="camp-out-encounter-text">${escape(encounter.text)}</div>` : ""}
      ${links ? `<div class="camp-out-links">${links}</div>` : ""}
    </div>`;
  return ChatMessage.create({ speaker: { alias: loc("title") }, content });
}

async function postCampBroken(watch, participants) {
  const names = participants.map((p) => p.name).join(", ");
  const content = `<div class="camp-out-card camp-out-broken">
      <h3><i class="fa-solid fa-fire-flame-simple"></i> ${loc("chat.brokenTitle")}</h3>
      <p>${loc("chat.brokenBody", { watch })}</p>
      <p class="camp-out-card-note">${loc("chat.brokenNoBenefits", { names })}</p>
    </div>`;
  return ChatMessage.create({ speaker: { alias: loc("title") }, content });
}

async function postCampSummary(report) {
  const content = await renderTpl(TEMPLATES.chatSummary, {
    rows: report.map((entry) => ({
      name: entry.actor.name,
      img: entry.actor.img,
      rested: entry.rested,
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

/** Escape GM-authored text before it goes into a chat card. */
function escape(text) {
  const fn = foundry.utils?.escapeHTML;
  if (fn) return fn(String(text ?? ""));
  return String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
