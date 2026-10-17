// Game state, resource definitions, and board setup.
const STATE = (() => {
  const RES = {
    forest:  { label: 'Wood',  color: '#3f7a3f', icon: '🌲' },
    pasture: { label: 'Sheep', color: '#8ec06c', icon: '🐑' },
    field:   { label: 'Grain', color: '#d8c35a', icon: '🌾' },
    hill:    { label: 'Brick', color: '#b0764a', icon: '🧱' },
    mount:   { label: 'Ore',   color: '#8d8d95', icon: '⛰' },
  };

  const PLAYER_COLORS = ['#e05c5c', '#4a90d9', '#57b85b', '#e0a83c'];

  const DEV_CARDS = {
    knight:     { count: 14, label: 'Knight',       vp: 0 },
    victory:    { count: 5,  label: 'Victory Point', vp: 1 },
    roadBuild:  { count: 2,  label: 'Road Building', vp: 0 },
    yearPlenty: { count: 2,  label: 'Year of Plenty', vp: 0 },
    monopoly:   { count: 2,  label: 'Monopoly',     vp: 0 },
  };

  // Official harbor mix: 4 specific 2:1 ports + 5 generic 3:1 ports.
  const HARBOR_TYPES = [
    { ratio: 2, res: 'forest' }, { ratio: 2, res: 'pasture' },
    { ratio: 2, res: 'field' },  { ratio: 2, res: 'hill' },
    { ratio: 3, res: null }, { ratio: 3, res: null }, { ratio: 3, res: null },
    { ratio: 3, res: null }, { ratio: 3, res: null },
  ];

  function emptyHand() {
    return { forest: 0, pasture: 0, field: 0, hill: 0, mount: 0 };
  }

  function newPlayer(id, name, isAI) {
    return {
      id, name, isAI,
      color: PLAYER_COLORS[id % PLAYER_COLORS.length],
      hand: emptyHand(),
      settlements: [],   // vertex ids
      cities: [],        // vertex ids
      roads: [],         // edge ids
      score: 0,
      devCards: [],      // held development cards
      devBoughtThisTurn: [], // card types bought this turn (may not be played yet)
      freeRoads: 0,      // free-road credits from Road Building
      vpRevealed: 0,     // Victory Point cards revealed (permanent points)
      playedKnights: 0,  // knights played this game
      hasRolled: false,
      builtThisTurn: 0,
      devPlayedThisTurn: false,
      // UI state
      tradeOffer: null,  // { give: {}, want: {} }
    };
  }

  function shuffleDevDeck() {
    const deck = [];
    for (const [type, info] of Object.entries(DEV_CARDS)) {
      for (let i = 0; i < info.count; i++) deck.push(type);
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function newGame(playerCount = 2, radius = 2) {
    const map = MAPGEN.build(radius);
    const names = ['You', 'Mira', 'Thomas', 'Ada'];
    const players = [];
    for (let i = 0; i < playerCount; i++) {
      players.push(newPlayer(i, names[i], i !== 0));
    }
    // Standard Catan setup order: 0,1,2,3,3,2,1,0 for 4 players
    const order = [];
    for (let i = 0; i < playerCount; i++) order.push(i);
    for (let i = playerCount - 1; i >= 0; i--) order.push(i);
    return {
      map,
      players,
      current: 0,
      phase: 'setup1',   // setup1 | setup2 | roll | build | trade | robber | done
      setupOrder: order,
      setupRound: 0,     // 0 or 1
      dice: null,
      robber: null,      // tile key
      robberFromSeven: false,
      discardTarget: null, // player who must discard
      deck: shuffleDevDeck(),
      longest: { player: null, length: 0 },
      largestArmy: { player: null, size: 0 },
      log: [],
      winner: null,
      pendingTrade: null,
    };
  }

  function currentPlayer(g) {
    return g.players[g.current];
  }

  function addLog(g, msg) {
    g.log.push(msg);
    if (g.log.length > 200) g.log.shift();
  }

  function payout(g, player, res, n) {
    player.hand[res] += n;
  }

  function totalCards(p) {
    return Object.values(p.hand).reduce((a, b) => a + b, 0);
  }

  function handOverSeven(p) {
    return totalCards(p) > 7;
  }

  return {
    RES, PLAYER_COLORS, DEV_CARDS, HARBOR_TYPES,
    newGame, newPlayer, currentPlayer, addLog, payout, emptyHand,
    shuffleDevDeck, totalCards, handOverSeven,
  };
})();
