# Changelog

## 1.1.1

**Camp supplies, BG3-style.** A new *Provisions* tab lets the GM tag any consumable as
food with a saturation value. Turn on **Require Rations to Camp** and the party has to
carry enough of it to feed everyone before the night can start - more for bigger
creatures, from 3 saturation for a Tiny creature up to 80 for Gargantuan. Pressing
**Start the Night** eats down the party's shared stock (cheapest items first) and posts a
chat card reporting what was consumed; a short GM can start the night anyway, and
whatever food remains is still eaten. The setting defaults to off, and the Provisions tab
keeps tracking supply either way. New API: `requiredSaturation`, `partyFoodRequirement`,
`partyFoodSupply`, `setItemSaturation`.

## 1.1.0

**Trance now shortens sleep instead of skipping it.** Elves, eladrin, drow and warforged
need four hours (two watches) rather than six, which buys them a second free watch rather
than exempting them from the sleep requirement entirely.

**Spare waking hours are put to use.** A watch a character is awake for but has not filled
becomes *Assisting*: they are up and helping whoever has the guard, and they are listed as
such on the roster and in the watch chat cards. Tasks are now repeatable, so that time can
be spent productively instead.

**Springing an encounter ends the camp.** Each planned watch gets a *Spring It* button.
Using it reveals the encounter to the table and closes the camp on the spot, with no long
rest and no camp action benefits for anyone. Resolving a watch no longer reveals its
encounter by itself: your notes stay whispered until you choose to act.

**Species detection rewritten.** Trance is determined from the character's species/race
item (dnd5e 4.x) or `system.details.race` (3.x), falling back to traits named *Trance* or
*Sentry's Rest*. Unrelated elf-flavoured feats on a sleeping species no longer trigger it,
and half-elves are excluded.

**Dark mode, on by default.** Both windows ship dark with a per-user light theme, toggled
from the header button or from Configure Settings. The interface has been tightened
throughout: denser grid, smaller action cards, two-column encounter prep.

Also:

- The long rest result is now checked per character. If the system call fails, the summary
  says so instead of implying a rest that never happened.
- All em and en dashes replaced with plain hyphens.
- New `camp-out.campBroken` hook, and `triggerEncounter` / `speciesName` added to the API.

## 1.0.0

First release.

- Four-watch long rest structure with a GM planner and per-player camp sheets.
- All seven camp actions: Take a Watch, Cook, Craft, Repair, Prepare, Task and Slumber.
- Players' choices stay hidden from each other until the GM plays each watch out.
- Per-watch encounter prep with notes and drag-dropped Journal Entries, Roll Tables,
  Macros and Actors, whispered to the GM when the watch resolves.
- Automated benefits on breaking camp: system long rest, Cook's extra hit dice and
  temporary hit points, Slumber's Inspiration and doubled exhaustion recovery, and the
  Prepare die as a tracked Active Effect that steps down as it is spent.
- Elves, eladrin and warforged detected automatically, with a short rest at the midpoint.
- Foundry v12 and v13, dnd5e 3.x and 4.x, no dependencies.
