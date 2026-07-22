/**
 * Camp supplies, BG3-style: food items carry a saturation value, and every
 * creature in camp needs to eat some of it - more for bigger creatures -
 * before the night can properly begin.
 *
 * An item becomes food purely by carrying the `saturation` flag (see
 * {@link setItemSaturation}); nothing about its dnd5e item type matters to the
 * maths here; that only shapes which items the Provisions tab bothers to list.
 */

import { MODULE_ID, FLAGS, SIZE_SATURATION } from "./constants.js";

/** @param {Item} item @returns {number} Saturation this item is worth, 0 if it is not food. */
export function itemSaturation(item) {
  const value = Number(item?.getFlag?.(MODULE_ID, FLAGS.saturation) ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Mark (or, given 0 or less, unmark) an item as food worth this much
 * saturation per unit in its stack.
 * @param {Item} item
 * @param {number} value
 */
export async function setItemSaturation(item, value) {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  if (!amount) return item.unsetFlag(MODULE_ID, FLAGS.saturation);
  return item.setFlag(MODULE_ID, FLAGS.saturation, amount);
}

/** @param {Actor} actor @returns {string} A key from {@link SIZE_SATURATION}, defaulting to medium. */
export function actorSize(actor) {
  const size = actor?.system?.traits?.size;
  return size && SIZE_SATURATION[size] !== undefined ? size : "med";
}

/** @param {Actor} actor @returns {number} Saturation this actor must eat to be fed for the night. */
export function requiredSaturation(actor) {
  return SIZE_SATURATION[actorSize(actor)] ?? SIZE_SATURATION.med;
}

/** @param {Actor[]} actors @returns {number} Total saturation the whole camp needs to eat. */
export function partyRequirement(actors) {
  return actors.reduce((sum, actor) => sum + requiredSaturation(actor), 0);
}

/**
 * This actor's items flagged as food, each with its saturation and how many
 * are stacked. Only items with a positive saturation and a positive quantity
 * count toward the camp's supply.
 * @param {Actor} actor
 * @returns {Array<{item: Item, saturation: number, quantity: number}>}
 */
export function foodItems(actor) {
  if (!actor) return [];
  return (actor.items ?? [])
    .map((item) => ({ item, saturation: itemSaturation(item), quantity: Number(item.system?.quantity ?? 1) }))
    .filter((entry) => entry.saturation > 0 && entry.quantity > 0);
}

/**
 * Every item worth showing the GM on the Provisions tab: anything already
 * flagged as food, plus dnd5e consumables in general so a fresh ration can be
 * tagged without hunting through the rest of the sheet.
 * @param {Actor} actor
 * @returns {Array<{itemId: string, name: string, img: string, quantity: number, saturation: number}>}
 */
export function foodCandidates(actor) {
  if (!actor) return [];
  return (actor.items ?? [])
    .filter((item) => item.type === "consumable" || itemSaturation(item) > 0)
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      img: item.img,
      quantity: Number(item.system?.quantity ?? 1),
      saturation: itemSaturation(item)
    }));
}

/** @param {Actor[]} actors @returns {number} Total saturation carried across every participant's pack. */
export function partySupply(actors) {
  return actors.reduce(
    (sum, actor) => sum + foodItems(actor).reduce((s, e) => s + e.saturation * e.quantity, 0),
    0
  );
}

/**
 * Eat down to `amount` saturation from the party's shared stock. Smallest
 * stacks go first, so a spare piece of fruit is used up before cracking open
 * a big sack of rations. GM only - callers are expected to have already
 * checked `game.user.isGM`.
 *
 * @param {Actor[]} actors
 * @param {number} amount Saturation to consume, clamped to what is available.
 * @returns {Promise<{fed: number, short: number, consumed: Array<{name: string, count: number}>}>}
 */
export async function consumeRations(actors, amount) {
  const need = Math.max(0, Math.round(amount));
  let remaining = need;
  const consumed = [];
  const updatesByActor = new Map();

  const pool = actors
    .flatMap((actor) => foodItems(actor).map((entry) => ({ ...entry, actor })))
    .sort((a, b) => a.saturation - b.saturation);

  for (const entry of pool) {
    if (remaining <= 0) break;

    const unitsNeeded = Math.ceil(remaining / entry.saturation);
    const unitsUsed = Math.min(entry.quantity, unitsNeeded);
    if (unitsUsed <= 0) continue;

    remaining -= unitsUsed * entry.saturation;
    consumed.push({ name: entry.item.name, count: unitsUsed });

    const list = updatesByActor.get(entry.actor.id) ?? [];
    list.push({ id: entry.item.id, leftover: entry.quantity - unitsUsed });
    updatesByActor.set(entry.actor.id, list);
  }

  for (const [actorId, updates] of updatesByActor) {
    const actor = actors.find((a) => a.id === actorId);
    if (!actor) continue;
    const toUpdate = updates.filter((u) => u.leftover > 0).map((u) => ({ _id: u.id, "system.quantity": u.leftover }));
    const toDelete = updates.filter((u) => u.leftover <= 0).map((u) => u.id);
    if (toUpdate.length) await actor.updateEmbeddedDocuments("Item", toUpdate);
    if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
  }

  return { fed: need - Math.max(0, remaining), short: Math.max(0, remaining), consumed };
}
