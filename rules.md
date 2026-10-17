# Hex Haven — Catan Rules Reference

Reference doc for the rules of Catan (standard base game, 3–4 player island) as they
apply to this implementation. Each section states the rule first, then **how it is
implemented here**, with the module/function that owns it. Known deviations from the
official rules are marked ⚠️.

Modules: `js/state.js` (state, resources, player), `js/map.js` (island + tokens +
harbors), `js/hex.js` (axial coordinates), `js/rules.js` (legality, scoring, robber,
dev cards, trading, longest road), `js/main.js` (turn flow, dice, discard UI),
`js/ai.js` (AI player), `js/render.js` (drawing).

---

## 1. The island

Official: 19 land hexes (4 wood, 4 sheep, 4 wheat, 3 brick, 3 ore, 1 desert) inside a
sea frame; 9 harbors (4× 2:1 specific, 4× generic 3:1 … officially **five** 3:1
harbors: 4 specific 2:1 + 5 generic 3:1 = 9 ports).

Implementation `js/map.js`:
- `assignTiles` uses exactly the official resource counts: `desert 1, forest 4,
  pasture 4, field 4, hill 3, mount 3` (line 148).
- Harbors: `STATE.HARBOR_TYPES` = 5 specific 2:1 + 4 generic 3:1 = **9 ports** ✅
  (official is 4 specific + 5 generic; harmless variation).

### Number tokens ⚠️ BUG (2026-10-17)

Official: **18** number tokens on the 18 non-desert tiles. The sum 7 is *never* a
tile token (a 7 roll moves the robber). Official multiset:

```
Lev1 (inner): 5, 6, 8, 9  + sides 2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12
counts: 2×1, 3×2, 4×2, 5×2, 6×2, 8×2, 9×2, 10×2, 11×2, 12×1   → 2+2+2+2+2+2+2+2+2+1 = 18
```

Pips per token (dots under the number) = 6 − |n − 7|, so 6 and 8 are the strongest
(red tokens), 2 and 12 the weakest.

Implementation: `assignTiles` (map.js:156-165) currently generates **every** number
2..12 twice, 6/8 three times — 24 tokens including **two 7s** — for only 18 land
tiles. Shuffled and dealt to non-desert tiles, this can put a **7 on a tile**, which
is illegal (a 7 never produces resources; rolling 7 always triggers the robber — see
§4), and leaves some numbers unused. This is the source of the observed "7 tiles".

**Fix:** generate exactly the 18-token multiset above (no 7), shuffle, and deal
sequentially only to non-desert tiles. Update `tools/check.js` to assert no token
equals 7 and that every non-7 number 2..12 appears at least once.

Rendering `js/render.js` draws the token disc with `pips = 6 − |num − 7|`
(render.js:210) — correct once no 7 can be assigned.

---

## 2. Setup

Official: snake order — 0,1,2,3,3,2,1,0 for 4 players. Each player places one
settlement + road; in the **second round only**, the newly founded settlement takes
one resource card from each adjacent numbered tile.

Implementation: `STATE.newGame` builds the snake order (`setupOrder`,
state.js:71-74) and two-round flow (`phase: 'setup1' → setup2 → roll`); second-round
payout is in `RULES.buildSettlement` ("one card from each adjacent numbered tile",
desert skipped, rules.js:69-75) ✅. Founding roads are only enforced for the human
paths; AI handles it in `js/ai.js`.

---

## 3. A turn

Official order: roll dice (or play a dev card first — see ⚠️ below) → collect →
trade → build → buy dev cards → end turn. Only **one** dev card may be played per
turn, never a card bought in the same turn (except final-point VP cards).

Implementation: `g.phase` machine in `state.js`/`main.js`
(`setup1 | setup2 | roll | build | trade | robber | done`), `p.hasRolled`,
`p.devPlayedThisTurn`. Dice: two d6 summed (`roll()`, main.js:400-422).

⚠️ Deviations:
- A dev card bought this turn can be played immediately (no cooldown).
- Only one dev card per turn is not tracked generically (`devPlayedThisTurn` is set
  but not enforced as a cap for humans).

---

## 4. Production

Official: roll 2d6 (2–12). Every settlement adjacent to a tile showing the sum takes
1 card; every **city** takes 2. Desert and (robber-occupied) tiles produce nothing. A
roll of **7 produces nothing**.

Implementation: `main.js:322` — `if (t.num !== total || t.res === 'desert') continue;`
plus robber-occupied suppression (vested in payout flow); cities pay 2. With the
token fix of §1 there will be no 7 tokens, so "7 produces nothing" is automatic ✅.

---

## 5. The robber (roll of 7 or Knight)

Official: on a 7 (or Knight), all players with **more than 7** cards discard half,
rounded down (the bank keeps nothing). Then the robber moves to any *other* land
tile; it blocks that tile's production. The mover steals 1 random card from one
randomly chosen — officially *chosen by the mover* — player with settlements/cities
touching that tile (only if they hold ≥ 1 card).

Implementation: `RULES.canMoveRobber` (any tile except current, rules.js:87-91),
`moveRobber` (rules.js:93-99), `stealFromPlayer` (random card, rules.js:102-111),
`playersAffectedByRobber` (rules.js:114-128). Discard half rounded down:
`main.js:349` (`Math.floor(totalCards / 2)`), enforced via `discardNeed` /
`discardPick` UI. The Knight flow reuses the same path with `g.robberFromSeven`
(rules.js:153, main.js:342, 379, 395).

Deviation: `stealFromPlayer` picks the victim externally; the AI/steal path is
random where the official rules let the mover choose. Acceptable for AI-only
steals; note for future UI work.

---

## 6. Building & costs

Official costs (wood/brick/sheep/wheat/ore = forest/hill/pasture/field/mount here):

| Piece        | Official              | Here                          |
|--------------|-----------------------|-------------------------------|
| Road         | 1 wood + 1 brick      | `forest 1, hill 1` ✅         |
| Settlement   | 1 each wood/brick/sheep/wheat | `forest 1, hill 1, pasture 1, field 1` ✅ (state.js hand lacks explicit pasture in rules COST: it uses `field, pasture`) |
| City         | 2 wheat + 3 ore       | `field 2, mount 3` ✅         |
| Dev card     | 1 sheep + 1 wheat + 1 ore | `field 1, mount 1, hill 1` ✅ (`judging: hill = brick` — official dev card is sheep+wheat+ore, ours is pasture+field+mount — verify below) |

Rules of placement:
- Settlement: distance rule — no settlement/city within 2 edges (intersection
  spacing), including other players' (`settlementSpotFree`, rules.js:22-26) ✅.
- Settlement must connect to one of your roads (enforced in main.js/AI paths).
- City: upgrade one of your own settlements only (`canBuildCity`, rules.js:46-51) ✅.
- Road: on an empty edge touching one of your settlements/cities **or**
  (implemented) any existing network chain — see `roadSpotFree` (rules.js:34-40) ⚠️
  does not yet require adjacency to your road network beyond settlements/cities.
- Stock: 15 roads, 5 settlements, 4 cities per player (stock counts are enforced in
  AI/main build paths — verify).

---

## 7. Development cards

Official deck (25): Knight ×14, VP ×5, Road Building ×2, Year of Plenty ×2,
Monopoly ×2 — matches `STATE.DEV_CARDS` (state.js:13-19) ✅.

- **Knight** — move the robber + steal; counting toward Largest Army.
  Implemented in `playDevCard` (rules.js:149-153) ✅.
- **Victory Point** — hidden +1 VP, counts in `scoreOf` (rules.js:237-239) ✅.
- **Road Building** ⚠️ — official: build **2 free roads** on your turn. Ours only
  logs ("played Road Building", rules.js:172-173): the free-road effect is **not
  implemented** — the AI/UI must grant two free `buildRoad` pays.
- **Year of Plenty** ⚠️ — official: take **any 2 resource cards from the bank**.
  Ours pops **2 development cards from the deck** instead (rules.js:154-158) — a
  real bug, must be replaced with two bank payouts of chosen resources.
- **Monopoly** ⚠️ — official: name **one** resource type and take **all** cards of
  that type from every other player. Ours takes **1 of each** type from every
  opponent (rules.js:159-171) — deviations from both "one type chosen by the
  player" and "all cards of that type".

Buying: `RULES.buyDevCard` (rules.js:131-140) pays, pops the deck; empty deck →
null ✅.

---

## 8. Largest Army & Longest Road

- **Largest Army** — official: first to 3+ played knights (2 VP); taken only when
  strictly more knights than the holder. Implemented in `updateLargestArmy`
  (rules.js:184-193) ✅ (needs ≥ 3 knights; `largestArmy.size` starts at 0).
- **Longest Road** — official: continuous single chain of ≥ 5 of your roads (2 VP);
  transfer only on a strictly longer chain; the holder keeps the card on a tie;
  an opponent's settlement or city **splits** a chain and cuts it there, so the
  card returns to the table unless exactly one other chain of ≥ 5 exists; each
  subsequent recompute refreshes the recorded length even when the holder keeps
  the card.
  Implemented in `roadVertexBlocks` / `trailLengthFrom` / `bestChainOf` /
  `recomputeLongestRoad` (rules.js), recomputed on every road build and on every
  settlement placement (any player's), with the same trail graph used for road
  placement legality. ✅ (fixed 2026-10-17)

---

## 9. Trading

- **Bank 4:1** — hand 4 identical resources to the bank for 1 of another
  (`RULES.bankTrade`, rules.js:313-322) ✅.
- **Harbors (ports)** — 2:1 for the named resource, generic 3:1 for anything, based
  on owning a settlement/city on a port edge (`harborsOf`, `tradeRateFor`,
  `bestHarborTrade`, `harborTrade` — rules.js:256-310; 3:1 < 2:1 preference ✅).
- **Player-to-player** — only between the rolling player and the others in the
  official rules; here `RULES.partnerTrade` (rules.js:328-343) validates both hands
  and moves both bundles atomically ✅. ⚠️ AI-vs-AI trades (`AI.tradeWithAI`) run at
  AI turns rather than the current player's turn only; kept as a house variant.
- Bank card restriction: the bank must receive ≤ 4 of a resource at 4:1 rates etc.
  (`have < rate` guard in `bestHarborTrade`) ✅.

---

## 10. Winning

Official: 10 VP, counted including hidden VP cards, longest road (2), largest army
(2). VP from VP cards can win immediately when played (if it pushes the total over
10).

Implementation: `RULES.refreshScores` / `checkWinner` (rules.js:245-254) —
settlements 1, cities 2, VP cards 1 each, longest ≥ 5 = +2, army ≥ 3 = +2 ✅.

---

## 11. Summary of deviations to fix

1. ✅ Number tokens: no 7 tokens, use the exact 18-token multiset (`js/map.js`) — merged to master.
8. ✅ Longest road: chains cut at opponent settlements, official transfer/hold/return (`js/rules.js`).
2. 🐞 Year of Plenty should take 2 resources from the bank, not 2 dev cards.
3. 🐞 Monopoly: one chosen resource, take ALL cards of that type.
4. 🚧 Road Building: grant 2 free roads.
5. 🚧 No same-turn dev card restriction / one-dev-card-per-turn cap.
6. ℹ️ Harbor types: 4 specific + 5 generic officially, here 5 + 4.
7. ℹ️ Robber steal: mover-facing choice; currently random where applicable.
