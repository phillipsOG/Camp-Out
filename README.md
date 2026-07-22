# Camp Out

A Foundry VTT module that runs a long rest as a structured night in camp, following
[Kibbles' Camp Actions](https://www.gmbinder.com/share/-MK0g94rlPq9A0KprEKC).

The GM starts a camp, the players quietly claim their watches and decide what they
do with their free time, and the GM plays the night out watch by watch - narrating
each shift as it happens, springing whatever they planned for it, and finishing with
one button that hands the whole party their long rest.

| | |
|---|---|
| **Foundry** | v12 - v13 |
| **System** | dnd5e (3.x - 4.x) |
| **Dependencies** | none |

---

## The night at a glance

A long rest is eight hours split into **four two-hour watches**.

Most characters need six hours of sleep, which leaves **one free watch**. Elves,
eladrin, drow and warforged trance or rest inactively for four hours instead, which
leaves them **two**.

| Action | What it does |
|---|---|
| **Take a Watch** | Stand guard, fully alert. No Perception penalty. Repeatable. |
| **Cook** | Everyone who eats regains an extra hit die. Proficient with cook's utensils? They regain hit dice equal to your proficiency bonus instead, and each die over their maximum becomes 1d4 temporary hit points. |
| **Craft** | Two hours of crafting progress. Needs tools, and a heat source for smithing or alchemy. |
| **Repair** | Craft, pointed at damaged gear. |
| **Prepare** | Pick an ability score, gain a Preparation die (d6, stepping down to d4 then d2 as it is spent). |
| **Task** | Two hours on anything else: copying spells, study, research. Repeatable. |
| **Slumber** | Sleep the full eight hours. Exhaustion drops by 2 instead of 1, and you gain Inspiration. Takes the whole night, so no camp action. |

Everything except Take a Watch imposes disadvantage on Perception checks and -5 passive
Perception. Slumber fails Perception outright.

You get **one main camp action per night** (Cook, Craft, Repair or Prepare). Take a Watch
and Task are fillers: repeat them freely to use up whatever time is left.

### Spare hours and passive assistance

If a character is awake with nothing assigned - the second free watch an elf gets, say -
they are not idle. That watch becomes **Assisting**: they are up and about, lending an
extra pair of eyes to whoever has the watch, and the camp roster and watch chat cards
list them alongside the guards.

Assisting grants no dice bonus on its own; it tells the table who is awake and available.
If you would rather the time were spent productively, drop a **Task** into that watch
instead.

### Camp supplies

Turn on **Require Rations to Camp** and the party has to feed itself before the night
can start. Any consumable can be tagged as food on the **Provisions** tab: give it a
saturation value there, and it counts toward the party's shared stock. Each creature in
camp needs to eat some of that stock based on its size:

| Size | Saturation needed |
|---|---|
| Tiny | 3 |
| Small | 5 |
| Medium | 10 |
| Large | 20 |
| Huge | 40 |
| Gargantuan | 80 |

When the GM presses **Start the Night**, the party eats down its shared stock - cheapest
items first, so a handful of berries goes before anyone opens a fresh sack of rations -
and a chat card reports what was eaten. Short on food? The GM is warned and can start the
night anyway; whatever is left still gets eaten, and some of the party goes to bed hungry.

The Provisions tab keeps tracking supply even with the setting off, so a table that wants
the bookkeeping without the hard requirement can just watch the numbers.

### Trance

Species detection reads the character's **species/race item** first (dnd5e 4.x), then
`system.details.race` (3.x), and only then looks for a trait actually named *Trance* or
*Sentry's Rest*. That ordering means an unrelated feat like Elven Accuracy on a human
cannot trip it, and half-elves are excluded outright. Override per-actor with the
`camp-out.trance` flag.

Trance characters also receive a **short rest at the midpoint of the night**, when their
trance or inactive period ends.

---

## Using it

### As the GM

Open the planner from the **campfire icon in the token controls**, or type `/camp`.

1. **Begin Long Rest.** Every player-owned character joins the camp and a chat card
   invites the players to plan their night.
2. **Roster & Shifts** shows the whole party as a grid: characters down the side, the
   four watches across the top. Set anyone's action yourself, add or remove characters,
   and see at a glance who has short-changed themselves on sleep.
3. **Encounters** is your prep screen. Give each watch a title and notes, and drag in a
   Journal Entry, Roll Table, Macro or Actor. None of it is visible to players.
4. **Provisions** tracks the party's food. Tag any consumable with a saturation value and
   watch the running total against what camp needs - see [Camp supplies](#camp-supplies).
5. **Start the Night** moves you into Play It Out and - if rations are required - is when
   the party eats from its supplies. Press **Play This Watch** four times from there. Each
   watch posts a public card showing who was awake and what they were doing, whispers your
   notes privately to you, and - at the halfway point - gives the trance characters their
   short rest.
6. **Break Camp & Long Rest** applies the system long rest to everyone, then layers the
   camp action benefits on top and posts a summary of exactly what each character got.

### Springing an encounter

Each planned watch gets a **Spring It** button on the Play It Out tab.

> **Springing an encounter ends the camp immediately.** The encounter is revealed to the
> whole table, and **nobody receives the long rest or any camp action benefit.** The night
> is lost. You are asked to confirm first.

Resolving a watch never springs its encounter on its own - your notes stay whispered to
you until you choose to. Opening a linked Journal, Table or Macro is likewise just
reference material and leaves the camp running.

Short rests already handed to trance characters earlier in the night are kept, since they
had finished before the interruption.

### As a player

Your camp sheet **pops open automatically** the moment the GM begins the night - no need
to go hunting for the campfire icon. It opens again any time the GM presses **Notify
Players**, and you can always bring it back yourself from the campfire icon or `/camp`.

The night is shown as a single horizontal timeline, one segment per watch. Click a segment
to select it, then pick its action from the cards below - click the same action again to
go back to sleep. Once the GM starts playing the night out, your timeline follows along
automatically, jumping to whichever watch is currently in progress; click an earlier
segment any time to look back at what you chose for it. Leave a note for the GM and mark
yourself ready from the header.

You can see who else is in camp, but **not what they chose** - their mini timelines show
`?` until the GM plays that watch out (or turns on **Reveal Camp Actions**). That is what
lets the GM narrate each shift as a reveal.

> **A note on hiding:** concealment is enforced in the interface, not by withholding data
> from the client. A player determined to dig through the browser console could read the
> camp state. It is there to keep the table honest, not to defeat a cheater.

---

## Appearance

Camp Out ships **dark by default**. Toggle light mode from the sun/moon button in either
window's header, or set it under *Configure Settings*. The choice is per-user.

---

## Settings

| Setting | Default | Effect |
|---|---|---|
| Appearance | Dark | Colour scheme for the Camp Out windows. Per-user. |
| Reveal Camp Actions | off | Show every player what the rest of the party chose, immediately. |
| Enforce Sleep Requirement | on | Warn before starting the night if someone claimed too many watches. |
| Require Rations to Camp | off | Warn before starting the night if the party's tagged food falls short of what camp needs. |
| Grant Inspiration for Slumber | on | Automatically give Inspiration to characters who slumbered. |
| Automatic Trance Short Rest | on | Short rest for elves and warforged at the halfway point. |
| Advance World Time | off | Advance the world clock two hours per resolved watch. |

---

## API

Exposed as `game.campOut` and on `game.modules.get("camp-out").api`.

```js
await game.campOut.beginCamp();                    // every player character
await game.campOut.beginCamp([actorA, actorB]);    // or a specific list

await game.campOut.startResolving();
await game.campOut.resolveWatch(1);
await game.campOut.completeCamp();                 // long rest for everyone

await game.campOut.triggerEncounter(2);            // springs it, ends the camp
await game.campOut.cancelCamp();                   // quiet abort, no benefits

game.campOut.state;                                // read-only snapshot
game.campOut.hasTrance(actor);                     // does this actor trance?
game.campOut.speciesName(actor);                   // resolved species string
await game.campOut.spendPreparationDie(actor);     // roll and step the die down

game.campOut.requiredSaturation(actor);            // saturation this actor needs to eat
game.campOut.partyFoodRequirement(actors);         // total saturation a party needs
game.campOut.partyFoodSupply(actors);              // total saturation a party is carrying
await game.campOut.setItemSaturation(item, 10);    // tag an item as food worth 10 saturation
```

Useful as a macro on a character sheet:

```js
// Spend a Preparation die
await game.campOut.spendPreparationDie(actor);
```

Hooks:

- `camp-out.ready` - fired with the API once the module is up.
- `camp-out.campComplete` - fired with the per-character report when camp is broken normally.
- `camp-out.campBroken` - fired with `{watch, encounter, participants}` when an encounter ends the night.

---

## Installation

**Manifest URL**

```
https://raw.githubusercontent.com/phillipsOG/Camp-Out/main/module.json
```

Paste that into Foundry's *Install Module* dialog, or drop the repository into
`Data/modules/camp-out`.

---

## Credits

The camp action rules are the work of **KibblesTasty** and are reproduced here only as
mechanical summaries - please go read
[the original document](https://www.gmbinder.com/share/-MK0g94rlPq9A0KprEKC) and support
their work. This module is an unofficial implementation and is not affiliated with or
endorsed by KibblesTasty.

Repeatable Tasks and passive assistance are deliberate extensions rather than rules as
written, added so that shorter sleep requirements have somewhere sensible to go.

Licensed under the MIT License. See [LICENSE](LICENSE).
