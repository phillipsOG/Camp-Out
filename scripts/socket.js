/**
 * Player -> GM relay.
 *
 * Players cannot write world settings, so every edit a player makes to the camp
 * is emitted here and applied by the active GM client. The resulting setting
 * update propagates back to everyone through Foundry's own replication.
 */

import { MODULE_ID, SOCKET_NAME, SOCKET_TYPES, loc } from "./constants.js";
import { CampState } from "./camp-state.js";

/** @returns {boolean} True if this client is the one GM responsible for writes. */
function isHandlingGM() {
  return game.user.isGM && game.users.activeGM?.id === game.user.id;
}

/**
 * May `user` edit the participant record for `actorId`?
 * GMs always may; players need ownership of the actor.
 */
function canEdit(user, actorId) {
  if (!user) return false;
  if (user.isGM) return true;
  const actor = game.actors.get(actorId);
  return actor?.testUserPermission(user, "OWNER") ?? false;
}

export function registerSocket() {
  game.socket.on(SOCKET_NAME, handleMessage);
}

async function handleMessage(message) {
  const { type, payload, userId } = message ?? {};
  if (!type) return;

  switch (type) {
    case SOCKET_TYPES.setAssignment:
    case SOCKET_TYPES.clearAssignments:
    case SOCKET_TYPES.setReady:
    case SOCKET_TYPES.setNote:
      if (!isHandlingGM()) return;
      return applyStateChange(type, payload, game.users.get(userId));

    case SOCKET_TYPES.openSheet: {
      const targets = payload?.userIds;
      if (Array.isArray(targets) && !targets.includes(game.user.id)) return;
      if (game.user.isGM) return;
      const { CampSheet } = await import("./apps/camp-sheet.js");
      return CampSheet.show();
    }

    case SOCKET_TYPES.refresh:
      return refreshApps();

    default:
      console.warn(`${MODULE_ID} | Unhandled socket message`, message);
  }
}

/**
 * Apply a state change on behalf of a user. Runs on the GM client only, and
 * re-checks permission because socket payloads are not trustworthy.
 */
async function applyStateChange(type, payload, user) {
  const { actorId } = payload ?? {};
  if (!actorId || !canEdit(user, actorId)) {
    console.warn(`${MODULE_ID} | Rejected ${type} from ${user?.name ?? "unknown user"}`);
    return;
  }

  switch (type) {
    case SOCKET_TYPES.setAssignment:
      return setAssignment(actorId, payload.watch, payload.actionId, payload.choice);
    case SOCKET_TYPES.clearAssignments:
      return clearAssignments(actorId);
    case SOCKET_TYPES.setReady:
      return setReady(actorId, payload.ready);
    case SOCKET_TYPES.setNote:
      return setNote(actorId, payload.note);
  }
}

/**
 * Route a state change: apply it directly when we are the GM, otherwise ask the
 * GM to. `game.socket.emit` does not loop back to the sender, so the branch is
 * required rather than merely an optimisation.
 */
async function request(type, payload) {
  if (game.user.isGM) return applyStateChange(type, payload, game.user);
  if (!game.users.activeGM) {
    ui.notifications.warn(loc("errors.noActiveGM"));
    return;
  }
  game.socket.emit(SOCKET_NAME, { type, payload, userId: game.user.id });
}

/* -------------------------------------------- */
/*  Public mutators                             */
/* -------------------------------------------- */

/**
 * Assign (or clear) a camp action for one watch.
 * @param {string} actorId
 * @param {number} watch
 * @param {string|null} actionId
 * @param {object} [choice] Extra input, e.g. `{ability: "str"}` for Prepare.
 */
export async function setAssignment(actorId, watch, actionId, choice) {
  if (!game.user.isGM) return request(SOCKET_TYPES.setAssignment, { actorId, watch, actionId, choice });

  const participant = CampState.participant(actorId);
  if (!participant) return;

  const error = CampState.validateAssignment(participant, watch, actionId);
  if (error) {
    notifyUser(actorId, loc(`errors.${error}`));
    return;
  }

  return CampState.mutate((state) => {
    const target = state.participants[actorId];
    if (!target) return;

    if (actionId === "slumber") {
      // Slumber consumes the whole night, so it overwrites every watch.
      for (const w of Object.keys(target.assignments)) target.assignments[w] = "slumber";
    } else {
      if (CampState.isSlumbering(target)) {
        for (const w of Object.keys(target.assignments)) target.assignments[w] = null;
      }
      target.assignments[watch] = actionId;
    }

    if (choice) target.choices = { ...target.choices, [actionId]: choice };
    target.ready = false;
  });
}

/** Clear every assignment for an actor, returning them to a full night's sleep. */
export async function clearAssignments(actorId) {
  if (!game.user.isGM) return request(SOCKET_TYPES.clearAssignments, { actorId });
  return CampState.mutate((state) => {
    const target = state.participants[actorId];
    if (!target) return;
    for (const w of Object.keys(target.assignments)) target.assignments[w] = null;
    target.ready = false;
  });
}

/** Flag a participant as done planning. */
export async function setReady(actorId, ready) {
  if (!game.user.isGM) return request(SOCKET_TYPES.setReady, { actorId, ready });
  return CampState.mutate((state) => {
    const target = state.participants[actorId];
    if (target) target.ready = !!ready;
  });
}

/** Store a participant's free-text note about their night. */
export async function setNote(actorId, note) {
  if (!game.user.isGM) return request(SOCKET_TYPES.setNote, { actorId, note });
  return CampState.mutate((state) => {
    const target = state.participants[actorId];
    if (target) target.note = String(note ?? "").slice(0, 1000);
  });
}

/** Ask player clients to pop open their camp sheet. */
export function broadcastOpenSheet(userIds = null) {
  game.socket.emit(SOCKET_NAME, {
    type: SOCKET_TYPES.openSheet,
    payload: { userIds },
    userId: game.user.id
  });
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Surface a rejection to whoever owns the actor, not just to the GM. */
function notifyUser(actorId, text) {
  const actor = game.actors.get(actorId);
  const owners = game.users.filter((u) => u.active && !u.isGM && actor?.testUserPermission(u, "OWNER"));
  if (!owners.length || owners.some((u) => u.id === game.user.id)) {
    ui.notifications.warn(text);
    return;
  }
  ChatMessage.create({
    content: `<p class="camp-out-whisper">${text}</p>`,
    whisper: owners.map((u) => u.id),
    speaker: { alias: loc("title") }
  });
}

/** Re-render any open Camp Out window. */
export function refreshApps() {
  for (const app of Object.values(ui.windows ?? {})) {
    if (app?.constructor?.CAMP_OUT_APP) app.render(false);
  }
  // ApplicationV2 instances are not tracked in ui.windows on v13.
  for (const app of foundry.applications?.instances?.values?.() ?? []) {
    if (app?.constructor?.CAMP_OUT_APP) app.render(false);
  }
}
