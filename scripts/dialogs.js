/**
 * Version-safe dialogs.
 *
 * v13 prefers `DialogV2`; v12 worlds may still be on the legacy `Dialog`. Both
 * paths are kept here so no caller has to care which one is available.
 */

import { loc } from "./constants.js";

/** @returns {Promise<boolean>} */
export async function confirmDialog(title, content) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2) {
    return DialogV2.confirm({ window: { title }, content, rejectClose: false, modal: true });
  }
  return Dialog.confirm({ title, content });
}

/**
 * Ask for the extra input an action needs before it can be stored.
 * Currently only Prepare, which needs the ability score it applies to.
 *
 * @param {string|null} actionId
 * @returns {Promise<object|undefined>} undefined if the action needs nothing, or
 *   if the player dismissed the prompt.
 */
export async function promptForChoice(actionId) {
  if (actionId !== "prepare") return undefined;

  const abilities = CONFIG.DND5E?.abilities ?? {};
  const options = Object.entries(abilities)
    .map(([key, cfg]) => `<option value="${key}">${cfg?.label ?? cfg ?? key}</option>`)
    .join("");

  // Outside dnd5e there is no ability list to choose from, so take the default.
  if (!options) return { ability: "str" };

  const content = `<p>${loc("dialogs.prepare.content")}</p>
    <div class="form-group">
      <label>${loc("dialogs.prepare.label")}</label>
      <select name="ability">${options}</select>
    </div>`;

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2) {
    const ability = await DialogV2.prompt({
      window: { title: loc("dialogs.prepare.title") },
      content,
      ok: {
        label: loc("common.confirm"),
        callback: (event, button) => button.form.elements.ability.value
      },
      rejectClose: false
    });
    return ability ? { ability } : undefined;
  }

  return new Promise((resolve) => {
    new Dialog({
      title: loc("dialogs.prepare.title"),
      content,
      buttons: {
        ok: {
          label: loc("common.confirm"),
          callback: (html) => resolve({ ability: html.find("[name=ability]").val() })
        }
      },
      close: () => resolve(undefined),
      default: "ok"
    }).render(true);
  });
}
