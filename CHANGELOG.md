# Changelog

All notable changes to Hex Haven. Official-rules fixes reference the rules in
`rules.md` (§ = section there).

## 2026-10-17 — Official-rules alignment (one fix per branch, merged to master)

### Fixed — Longest Road (bab5c8f, §8)
- A road chain can no longer pass **through** a vertex occupied by an
  opponent's settlement or city — official chains are cut there by
  `roadVertexBlocks` / `trailLengthFrom` (`js/rules.js`).
- The card is now recomputed for **every** player when any player builds a road
  or settlement (`recomputeLongestRoad`), so split chains release the card.
- Official transfer rules: awarded at a uniquely longest chain of ≥ 5; taken
  only by a **strictly** longer chain; the holder **keeps** it on a tie;
  otherwise it returns to the table. The stored length now refreshes even when
  the holder keeps the card (stale-length bug found by the new tests).

### Fixed — Road & settlement placement (cebc8cf, §6)
- Roads may finally be built **continuing your own road network** — previously
  roads could only touch your own settlements/cities, making chain extension
  impossible. Connection through an opponent's settlement is blocked
  (`roadSpotFree`).
- Settlements after setup must attach to your road network
  (`settlementConnects`), enforced in the human UI, the AI (`bestSettlement
  requireConnection`; setup rounds exempt), and the board highlights
  (`render.js`).

### Fixed — Development card turn rules (739c27b, §4)
- At most **one** development card per turn and never a card bought the same
  turn — both now enforced (`devPlayedThisTurn`, new `devBoughtThisTurn`).
- Victory Point cards are exempt from both restrictions (may be revealed the
  same turn) and now bank a **permanent** point when revealed via the new
  `vpRevealed` counter — previously playing a VP card lost its point entirely.
- Human refusal reasons are surfaced as hints; the AI/debug auto-play no longer
  buys-and-plays in the same turn.

### Fixed — Year of Plenty (b102415, §4)
- Takes **2 resource cards from the bank** (chosen via
  `playDevCard(..., 'yearPlenty', [resA, resB])`; without a target the two
  scarcest needed resources are taken) — previously it wrongly drew **2 dev
  cards** from the deck instead.

### Fixed — Monopoly (39a3fd2, §4)
- Names **one** resource type and takes **all** cards of that type from every
  other player (previously: 1 card *of each* type per opponent). Without an
  explicit target the AI takes the type the opponents collectively hold most.

### Fixed — Road Building (483b4b9, §4)
- Grants **2 free roads** on the player's turn via `freeRoads` credits spent by
  `buildRoad` — previously the card only logged a message and did nothing.
- Roads now **refuse** when the player can't pay 1 wood + 1 brick and has no
  credit (this also closed a hole where the human build path never checked
  affordability; the AI honours credits too).

### Fixed — Robber steal (6eb1453, §5)
- Rolling a 7 (or playing a Knight) now steals **exactly ONE random card from
  ONE victim chosen by the mover** — previously the mover robbed *every*
  affected player. Legal targets (`stealCandidates`): players adjacent to the
  robber tile holding at least 1 card, mover excluded.
- With several qualifyng victims the human clicks the highlighted row in the
  players panel (must be done before ending the turn); the AI steals from the
  richest candidate.

### Fixed — Harbor mix (397b947, §1)
- Official mix of **4 specific 2:1 ports + 5 generic 3:1 ports** (was 5 + 4);
  asserted by `tools/check.js` on every run.

### Fixed — AI player name typo (92049f1)
- The third default player was named "Tomas"; now "Thomas" (`js/state.js`),
  with the AI-trade log assertions updated accordingly.

## 2026-10-17 (earlier) — Number tokens & rules reference (5f5a61a)

### Fixed — Illegal 7 number tokens (§1)
- Tokens now deal from the official 18-token multiset (2 and 12 once, 3–11
  twice, **no 7**) sequentially over non-desert tiles, repeating per island
  "round" on XL boards; desert tiles take/consume no token. No tile can
  produce on a rolled 7 — that roll is reserved for the robber.
- `tools/check.js` asserts the exact multiset and that no tile shows a 7.
- Added `rules.md`: full Catan rules → implementation mapping, including a
  deviation list (§11) that drove the fixes above.

## 2026-10-16 — Features

### Added — AI player-to-player trading (b2cbb52)
- AI players offer reciprocal 1:1 resource trades to other players on their
  turn, with acceptance/refusal heuristics; all partner-trade log lines are
  centralised (`partnerTrade`).

### Added — Configurable opponents & XL board (1367c35)
- New game lets you pick the number of AI opponents (2–4 players total) and an
  XL island size; the token multiset scales per island round.

### Improved — Sound effects (86089f8)
- Reworked game SFX with a persistent sound on/off toggle.
