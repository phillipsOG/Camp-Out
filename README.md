# Camp Out

A Foundry VTT module that runs a long rest as a structured night in camp, following
[Kibbles' Camp Actions](https://www.gmbinder.com/share/-MK0g94rlPq9A0KprEKC).

The GM starts a camp, the players quietly claim their watches and decide what they
do with their free time, and the GM plays the night out watch by watch — narrating
each shift as it happens, springing whatever they planned for it, and finishing with
one button that hands the whole party their long rest.

| | |
|---|---|
| **Foundry** | v12 – v13 |
| **System** | dnd5e (3.x – 4.x) |
| **Dependencies** | none |

---

## The night at a glance

A long rest is eight hours split into **four two-hour watches**. A character needs six
hours of sleep, which leaves exactly one watch free for a single camp action.

| Action | What it does |
|---|---|
| **Take a Watch** | Stand guard, fully alert. No Perception penalty. Repeatable. |
| **Cook** | Everyone who eats regains an extra hit die. Proficient with cook's utensils? They regain hit dice equal to your proficiency bonus instead, and each die over their maximum becomes 1d4 temporary hit points. |
| **Craft** | Two hours of crafting progress. Needs tools, and a heat source for smithing or alchemy. |
| **Repair** | Craft, pointed at damaged gear. |
| **Prepare** | Pick an ability score, gain a Preparation die (d6 → d4 → d2 as it is spent). |
| **Task** | Two hours on anything else — copying spells, study, research. |
| **Slumber** | Sleep the full eight hours. Exhaustion drops by 2 instead of 1, and you gain Inspiration. Takes the whole night, so no camp action. |

Everything except Take a Watch imposes disadvantage on Perception checks and −5 passive
Perception. Slumber fails Perception outright.

**Elves, eladrin and warforged** are detected automatically. They may stack extra watches
on top of their one camp action, and they receive a **short rest partway through the night**
when their trance or inactive period ends.

---

## Using it

### As the GM

Open the planner from the **campfire icon in the token controls**, or type `/camp`.

1. **Begin Long Rest.** Every player-owned character joins the camp and a chat card
   invites the players to plan their night.
2. **Roster & Shifts** shows the whole party as a grid: characters down the side, the
   four watches across the top. You can set anyone's action yourself, add or remove
   characters, and see at a glance who has short-changed themselves on sleep.
3. **Encounters** is your prep screen. Give each watch a title and notes, and drag in a
   Journal Entry, Roll Table, Macro or Actor. None of it is visible to players.
4. **Start the Night**, then **Play This Watch** four times. Each watch posts a public
   card showing who was awake and what they were doing, whispers your prep to you with
   the linked documents as one-click buttons, and — at the halfway point — gives the
   trance characters their short rest.
5. **Break Camp & Long Rest** applies the system long rest to everyone, then layers the
   camp action benefits on top and posts a summary of exactly what each character got.

### As a player

The same campfire icon opens your camp sheet once a camp is running. Pick an action for
whichever watch you want it on, click it again to go back to sleep, leave a note for the
GM, and mark yourself ready.

You can see who else is in camp, but **not what they chose** — their watches show as `?`
until the GM plays that watch out. That is what lets the GM narrate each shift as a
reveal.

> **A note on hiding:** concealment is enforced in the interface, not by withholding data
> from the client. A player determined to dig through the browser console could read the
> camp state. It is there to keep the table honest, not to defeat a cheater.

---

## Settings

| Setting | Default | Effect |
|---|---|---|
| Reveal Camp Actions | off | Show every player what the rest of the party chose, immediately. |
| Enforce Six Hours of Sleep | on | Warn before starting the night if someone claimed too many watches. |
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
await game.campOut.completeCamp();

game.campOut.state;                                // read-only snapshot
game.campOut.hasTrance(actor);                     // does this actor trance?
await game.campOut.spendPreparationDie(actor);     // roll and step the die down
```

Useful as a macro on a character sheet:

```js
// Spend a Preparation die
await game.campOut.spendPreparationDie(actor);
```

A `camp-out.campComplete` hook fires with the per-character report when a camp is broken.

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
mechanical summaries — please go read
[the original document](https://www.gmbinder.com/share/-MK0g94rlPq9A0KprEKC) and support
their work. This module is an unofficial implementation and is not affiliated with or
endorsed by KibblesTasty.

Licensed under the MIT License. See [LICENSE](LICENSE).
