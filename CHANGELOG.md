# Changelog

All notable changes to Hex Haven. Official-rules fixes reference the rules in
`rules.md` (§ = section there).

## 2026-10-17 — Harbor trade fix + bank exchange UI

### Fixed — 2:1 harbor matched the wrong resource (§9)
- `tradeRateFor` resolved the harbor rate against the **wanted** resource, so a
  2:1 forest harbor e.g. served *non-forest* trades. Officially a 2:1 port
  trades 2 of **its own** resource for 1 of any other — the rate is now
  resolved against the resource you **give** (`js/rules.js`).
- `harborTrade` now rejects any `n` other than the player's real rate for the
  given resource; `bestHarborTrade` picks the cheapest applicable rate first,
  then the biggest pile to dump.
- `rules.md` §9 updated.

### Added — Human bank/harbor exchange UI (§9)
- The trade panel (bottom bar) now has two tabs: **Players** and **Bank &
  harbors**. The bank tab lists the same give/get chips: pick one resource to
  give, one to take, and Trade executes a 4:1 bank trade or a 2:1/3:1 harbor
  trade at the player's best rate — previously only the AI could use
  `harborTrade`/`bankTrade` (`js/main.js`, `index.html`, `css/style.css`).
- New i18n keys (en/fr/es/de) for the tabs, plan hint, and not-enough message.

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

### Fixed — Harbor mix (397b947, then corrected — §1)
- Official mix: **5 specific 2:1 ports — one per resource type (rulebook:
  "there is only 1 special harbor for each type of resource") — plus 4 generic
  3:1 ports**; asserted by `tools/check.js`. (This entry initially shipped
  inverted as 4 specific + 5 generic; the rulebook quote settles it and the
  original ratio was restored.)
- Exchange **rates** are official and unchanged: bank **4:1**, generic harbor
  **3:1**, matching specific harbor **2:1** (`tradeRateFor`).
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
