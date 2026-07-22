/**
 * dnd5e mechanics.
 *
 * Everything that touches the game system lives here so the rest of the module
 * stays about scheduling and presentation. Each helper degrades to a no-op with
 * a console warning rather than throwing, because a half-applied long rest is
 * worse than a missing buff the GM can hand out manually.
 */

import { MODULE_ID, FLAGS, loc } from "./constants.js";
import { PREPARATION_DIE_CHAIN } from "./actions.js";

const ICONS = {
  preparation: "icons/sundries/books/book-open-turquoise.webp",
  wellFed: "icons/consumables/food/berries-pile-red.webp"
};

/** @returns {boolean} */
export function isDnd5e() {
  return game.system.id === "dnd5e";
}

/* -------------------------------------------- */
/*  Hit dice                                    */
/* -------------------------------------------- */

/** dnd5e 4.x moved hit dice onto `system.hd`; 3.x used flat class fields. */
function hitDiceFields(classItem) {
  const hd = classItem.system?.hd;
  if (hd && typeof hd === "object" && "spent" in hd) {
    return {
      spent: hd.spent ?? 0,
      max: (classItem.system.levels ?? 0) + (hd.additional ?? 0),
      denomination: Number(String(hd.denomination ?? "d8").replace(/^d/i, "")) || 8,
      path: "system.hd.spent"
    };
  }
  return {
    spent: classItem.system?.hitDiceUsed ?? 0,
    max: classItem.system?.levels ?? 0,
    denomination: Number(String(classItem.system?.hitDice ?? "d8").replace(/^d/i, "")) || 8,
    path: "system.hitDiceUsed"
  };
}

/**
 * Restore spent hit dice, largest die first.
 *
 * @param {Actor} actor
 * @param {number} count How many to try to restore.
 * @returns {Promise<{restored: number, excess: number}>} `excess` is the portion
 *   that could not be restored because the actor was already at maximum.
 */
export async function restoreHitDice(actor, count) {
  if (!isDnd5e() || count <= 0) return { restored: 0, excess: Math.max(0, count) };

  const classes = actor.items
    .filter((i) => i.type === "class")
    .map((item) => ({ item, ...hitDiceFields(item) }))
    .filter((c) => c.spent > 0)
    .sort((a, b) => b.denomination - a.denomination);

  let remaining = count;
  const updates = [];
  for (const cls of classes) {
    if (remaining <= 0) break;
    const take = Math.min(cls.spent, remaining);
    updates.push({ _id: cls.item.id, [cls.path]: cls.spent - take });
    remaining -= take;
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return { restored: count - remaining, excess: remaining };
}

/* -------------------------------------------- */
/*  Cook                                        */
/* -------------------------------------------- */

/** Is this actor proficient with cook's utensils? */
export function isProficientCook(actor) {
  if (!isDnd5e()) return false;

  const tools = actor.system?.traits?.toolProf;
  if (tools?.value?.has?.("cook")) return true;
  if (typeof tools?.custom === "string" && /cook/i.test(tools.custom)) return true;

  // dnd5e 4.x tracks tool proficiency on `system.tools` instead.
  if (actor.system?.tools && "cook" in actor.system.tools) return true;

  // Fall back to an owned tool item flagged as proficient.
  return actor.items.some(
    (i) => i.type === "tool" && /cook/i.test(i.name) && (i.system?.proficient ?? 0) > 0
  );
}

/**
 * Apply the Cook camp action to everyone who ate.
 *
 * Diners regain one extra hit die, or a number equal to the cook's proficiency
 * bonus if the cook is proficient with cook's utensils. Hit dice that would push
 * a diner over their maximum become 1d4 temporary hit points each instead.
 *
 * @param {Actor} cook
 * @param {Actor[]} diners
 * @returns {Promise<Array<{actor: Actor, restored: number, temp: number}>>}
 */
export async function applyCookBuff(cook, diners) {
  const proficient = isProficientCook(cook);
  const bonus = proficient ? Math.max(1, cook.system?.attributes?.prof ?? 2) : 1;
  const results = [];

  for (const actor of diners) {
    const { restored, excess } = await restoreHitDice(actor, bonus);

    let temp = 0;
    if (proficient && excess > 0) {
      const roll = await new Roll(`${excess}d4`).evaluate();
      temp = roll.total;
      await grantTempHP(actor, temp);
    }

    results.push({ actor, restored, temp });
  }

  return results;
}

/** Temporary hit points do not stack; keep whichever pool is larger. */
export async function grantTempHP(actor, amount) {
  if (!isDnd5e() || amount <= 0) return;
  const current = actor.system?.attributes?.hp?.temp ?? 0;
  if (amount <= current) return;
  return actor.update({ "system.attributes.hp.temp": amount });
}

/* -------------------------------------------- */
/*  Prepare                                     */
/* -------------------------------------------- */

/**
 * Grant a Preparation die for one ability score.
 *
 * The die is stored as an actor flag (the authoritative value) and mirrored into
 * an Active Effect so it is visible on the character sheet. The effect carries no
 * `changes` because the die is added by the player when they choose to spend it.
 *
 * @param {Actor} actor
 * @param {string} ability Ability key, e.g. "str".
 */
export async function applyPreparationDie(actor, ability) {
  if (!isDnd5e()) return null;

  const abilityLabel = abilityName(ability);
  const die = PREPARATION_DIE_CHAIN[0];

  await clearPreparationEffects(actor);
  await actor.setFlag(MODULE_ID, FLAGS.preparation, { ability, die });

  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [
    {
      name: loc("effects.preparation.name", { die, ability: abilityLabel }),
      img: ICONS.preparation,
      origin: actor.uuid,
      description: loc("effects.preparation.description", { die, ability: abilityLabel }),
      duration: { rounds: null, seconds: null },
      changes: [],
      flags: { [MODULE_ID]: { [FLAGS.preparation]: true } }
    }
  ]);

  return effect;
}

/**
 * Spend one step of a Preparation die: d6 -> d4 -> d2 -> gone.
 * @param {Actor} actor
 * @returns {Promise<{die: string|null, ability: string}|null>} The die that was
 *   rolled, or null if the actor had none.
 */
export async function spendPreparationDie(actor) {
  const data = actor.getFlag(MODULE_ID, FLAGS.preparation);
  if (!data?.die) {
    ui.notifications.warn(loc("errors.noPreparationDie", { name: actor.name }));
    return null;
  }

  const roll = await new Roll(`1${data.die}`).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: loc("effects.preparation.spend", {
      die: data.die,
      ability: abilityName(data.ability)
    })
  });

  const next = PREPARATION_DIE_CHAIN[PREPARATION_DIE_CHAIN.indexOf(data.die) + 1] ?? null;
  if (next) {
    await actor.setFlag(MODULE_ID, FLAGS.preparation, { ...data, die: next });
    const effect = preparationEffect(actor);
    if (effect) {
      await effect.update({
        name: loc("effects.preparation.name", { die: next, ability: abilityName(data.ability) }),
        description: loc("effects.preparation.description", {
          die: next,
          ability: abilityName(data.ability)
        })
      });
    }
  } else {
    await actor.unsetFlag(MODULE_ID, FLAGS.preparation);
    await clearPreparationEffects(actor);
    ui.notifications.info(loc("effects.preparation.depleted", { name: actor.name }));
  }

  return { die: data.die, ability: data.ability, total: roll.total };
}

function preparationEffect(actor) {
  return actor.effects.find((e) => e.getFlag(MODULE_ID, FLAGS.preparation));
}

async function clearPreparationEffects(actor) {
  const ids = actor.effects.filter((e) => e.getFlag(MODULE_ID, FLAGS.preparation)).map((e) => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

function abilityName(key) {
  const config = CONFIG.DND5E?.abilities?.[key];
  return config?.label ?? config ?? String(key ?? "").toUpperCase();
}

/* -------------------------------------------- */
/*  Slumber                                     */
/* -------------------------------------------- */

/** @returns {Promise<boolean>} True if inspiration was newly granted. */
export async function grantInspiration(actor) {
  if (!isDnd5e()) return false;
  if (actor.system?.attributes?.inspiration === true) return false;
  await actor.update({ "system.attributes.inspiration": true });
  return true;
}

/**
 * Reduce exhaustion, floored at zero.
 * @returns {Promise<number>} How many levels were actually removed.
 */
export async function reduceExhaustion(actor, amount = 1) {
  if (!isDnd5e()) return 0;
  const current = Number(actor.system?.attributes?.exhaustion ?? 0);
  if (current <= 0) return 0;
  const next = Math.max(0, current - amount);
  await actor.update({ "system.attributes.exhaustion": next });
  return current - next;
}

/* -------------------------------------------- */
/*  Rests                                       */
/* -------------------------------------------- */

/**
 * Trigger a system long rest.
 *
 * dnd5e has reshaped this signature across major versions, so the config object
 * is tried first and a bare call second. The result reports whether the rest
 * actually happened, so the camp summary can say so plainly instead of implying
 * a rest that silently failed.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function longRestActor(actor, { newDay = true } = {}) {
  if (!isDnd5e()) return { ok: false, reason: "system" };
  try {
    await actor.longRest({ dialog: false, chat: false, newDay, advanceTime: false });
    return { ok: true };
  } catch (err) {
    console.warn(`${MODULE_ID} | longRest config rejected, retrying with defaults`, err);
    try {
      await actor.longRest();
      return { ok: true };
    } catch (inner) {
      console.error(`${MODULE_ID} | Long rest failed for ${actor.name}`, inner);
      return { ok: false, reason: "error" };
    }
  }
}

/**
 * Trigger a system short rest, used for trance/sentry characters mid-night.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function shortRestActor(actor) {
  if (!isDnd5e()) return { ok: false, reason: "system" };
  try {
    await actor.shortRest({ dialog: false, chat: false, autoHD: false, advanceTime: false });
    return { ok: true };
  } catch (err) {
    console.warn(`${MODULE_ID} | shortRest config rejected, retrying with defaults`, err);
    try {
      await actor.shortRest();
      return { ok: true };
    } catch (inner) {
      console.error(`${MODULE_ID} | Short rest failed for ${actor.name}`, inner);
      return { ok: false, reason: "error" };
    }
  }
}
