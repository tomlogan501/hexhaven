// Small i18n layer: a dictionary for the UI strings in English, French,
// Spanish and German, persisted in localStorage. Static HTML carries
// data-i18n keys; dynamic strings call I18N.t() (with {a}-style params).
const I18N = (() => {
  const LANGS = ['en', 'fr', 'es', 'de'];

  const DICT = {
    en: {
      status_loading: 'Generating the island…',
      status_winner: '{name} wins with {n} victory points!',
      status_discard: '{name} must discard {n} cards',
      status_setup1: '{name}: place a settlement',
      status_setup2: '{name}: place a road',
      status_robber: '{name}: move the robber',
      status_roll: '{name}’s turn — roll the dice',
      status_build: '{name}’s turn — build or end turn',
      status_turn: '{name}’s turn',

      panel_players: 'Players', panel_log: 'Log', btn_log: 'Log',
      info_robber: 'Robber: {res} tile ({num})', desertr: 'desert',
      info_robber_none: 'Robber: not placed yet',
      info_deck: 'Development cards left in deck: {n}',

      res_forest: 'Wood', res_pasture: 'Sheep', res_field: 'Grain',
      res_hill: 'Brick', res_mount: 'Ore',
      dev_knight: 'Knight', dev_victory: 'Victory Point',
      dev_roadBuild: 'Road Building', dev_yearPlenty: 'Year of Plenty',
      dev_monopoly: 'Monopoly',

      btn_settlement: 'Settlement', btn_road: 'Road', btn_city: 'City',
      btn_dev: 'Dev card', btn_roll: 'Roll dice', btn_trade: 'Trade',
      btn_pass: 'End turn', btn_new: 'New game',
      debug_play: 'Debug: auto-play', debug_playing: 'Debug: playing…',

      m_play: 'Play', m_rules: 'Rules & objectives', m_lang: 'Language',
      music: 'Music', sfx: 'SFX', vol: 'Volume',
      ai_opponents: 'AI opponents', island_size: 'Island size',
      island_xl: 'XL (double tiles)',
      on: 'on', off: 'off',

      tp_title: 'Trade with players',
      tp_hint: 'Click chips to set quantities.',
      tp_give: 'You give', tp_get: 'You get',
      tp_offer: 'Offer', tp_clear: 'Clear', tp_close: 'Close',
      tp_offerpart: '{g} → {w}. Click a chip to raise its count.',
      tp_nothing: 'nothing',
      tp_tab_players: 'Players',
      tp_tab_bank: 'Bank & harbors',
      tp_bank_title: 'Bank & harbour exchange',
      tp_bank_hint0: 'Pick one resource to give, then one to take. Rates: 2:1 at a matching harbor, 3:1 at a generic harbor, 4:1 at the bank.',
      tp_bank_plan: 'Give {g} at {r}:1 → take 1 {w}.',
      tp_bank_pick: 'Pick exactly one resource to give and one to take.',
      tp_bank_need: 'Not enough: a {r}:1 exchange requires {n} {res}.',

      h_roll_begin: 'Click Roll to begin.',
      h_picktool: 'Pick a build tool, then click a highlighted spot.',
      h_setup1: 'Click a highlighted corner to found your settlement (free).',
      h_setup2: 'Click a highlighted edge to lay a road (free).',
      h_second_settle: 'Place your second settlement.',
      h_after_settle: 'Now place a road from your settlement.',
      h_setup_done: 'Setup complete. Roll the dice to begin.',
      h_first_settle: 'Place your settlement.',
      h_no_settle: 'No legal settlement spot left.',
      h_no_road: 'No legal road spot left.',
      h_robber_tile: 'Click a tile to move the robber, then End turn.',
      h_robber_stay: 'Robber stayed where it was.',
      h_steal: 'You may take 1 card: click a player in the panel.',
      h_discard_chips: 'A 7! Discard from your hand: click the chips below.',
      h_discard_need: 'Discard {n} card{s}: click the chips below ({p}/{n} chosen).',
      h_already: 'You already rolled this turn.',
      h_rolled: 'You rolled {a} + {b} = {t}.',
      h_cost_road: 'A road costs 1 wood and 1 brick.',
      h_deck_empty: 'The development deck is empty.',
      h_dev_cost: 'Not enough resources for a development card.',
      h_drew: 'You drew a {card} card.',
      h_trade_set: 'Set at least one card to give and one to get.',
      h_reject: 'Nobody accepted. Sweeten the offer or close the panel.',
      h_dev_bought_turn: 'A {card} bought this turn can be played on your next turn.',
      h_dev_played_already: 'You already played a development card this turn.',
      h_dev_none: 'No {card} card to play.',
      h_dev_played: 'Played {card}.',
      h_end_robber: 'Move the robber before ending your turn.',
      h_end_steal: 'Take a card first: click a player in the panel.',
      h_roll_dice: 'Roll the dice.',
      h_debug_done: 'Debug run finished. Press New game to play yourself.',

      rules_title: 'Rules & objectives', rules_close: 'Close',
      r_goal: 'Objective: be the first to reach 10 victory points.',
      r_vp: 'Victory points: settlement = 1, city = 2, longest road (5+) = +2, largest army (3+ knights) = +2, Victory Point cards = 1 each.',
      r_turn: 'Turn: roll 2 dice — tiles matching the roll pay resources to their neighbours. Build and/or trade, then end your turn.',
      r_seven: 'On a 7 nobody harvests: move the robber and steal 1 card from a neighbour of the new tile; hands larger than 7 must discard half.',
      r_build: 'Costs — road: 1 wood + 1 brick; settlement: 1 wood + 1 brick + 1 grain + 1 sheep (settlements must be two spaces apart); city: 2 grain + 3 ore.',
      r_harbor: 'Harbours: trade 2:1 at a matching harbour, 3:1 at a generic harbour, and 4:1 with the bank elsewhere.',
      r_dev: 'Development cards (grain + ore + brick): one may be bought per turn, never played on the turn it is bought — except Victory Point cards, which count immediately but stay hidden.',
      r_trade: 'Player trades: offer any bundle to the AIs, who may accept or refuse.',
      r_end: 'The game ends as soon as a player shows 10 or more points.',
      graph_title: 'Resources over turns',
      graph_total: 'Total',
      graph_min: 'Collapse / expand',
      graph_hide: 'Hide',
    },

    fr: {
      status_loading: 'Génération de l’île…',
      status_winner: '{name} gagne avec {n} points de victoire !',
      status_discard: '{name} doit défausser {n} cartes',
      status_setup1: '{name} : placez une colonie',
      status_setup2: '{name} : placez une route',
      status_robber: '{name} : déplacez le voleur',
      status_roll: 'Tour de {name} — lancez les dés',
      status_build: 'Tour de {name} — construisez ou terminez',
      status_turn: 'Tour de {name}',

      panel_players: 'Joueurs', panel_log: 'Journal', btn_log: 'Journal',
      info_robber: 'Voleur : tuile {res} ({num})', desertr: 'désert',
      info_robber_none: 'Voleur : pas encore placé',
      info_deck: 'Cartes développement restantes : {n}',

      res_forest: 'Bois', res_pasture: 'Mouton', res_field: 'Blé',
      res_hill: 'Brique', res_mount: 'Minerai',
      dev_knight: 'Chevalier', dev_victory: 'Point de victoire',
      dev_roadBuild: 'Construction de routes', dev_yearPlenty: 'Année d’abondance',
      dev_monopoly: 'Monopole',

      btn_settlement: 'Colonie', btn_road: 'Route', btn_city: 'Ville',
      btn_dev: 'Carte dev', btn_roll: 'Lancer les dés', btn_trade: 'Échanger',
      btn_pass: 'Terminer le tour', btn_new: 'Nouvelle partie',
      debug_play: 'Débogage : jeu auto', debug_playing: 'Débogage : en cours…',

      m_play: 'Jouer', m_rules: 'Règles & objectifs', m_lang: 'Langue',
      music: 'Musique', sfx: 'Effets', vol: 'Volume',
      ai_opponents: 'Adversaires IA', island_size: 'Taille de l’île',
      island_xl: 'XL (tuiles doublées)',
      on: 'oui', off: 'non',

      tp_title: 'Échanger avec les joueurs',
      tp_hint: 'Cliquez sur les jetons pour définir les quantités.',
      tp_give: 'Vous donnez', tp_get: 'Vous recevez',
      tp_offer: 'Proposer', tp_clear: 'Effacer', tp_close: 'Fermer',
      tp_offerpart: '{g} → {w}. Cliquez sur un jeton pour augmenter sa quantité.',
      tp_nothing: 'rien',
      tp_tab_players: 'Joueurs',
      tp_tab_bank: 'Banque & ports',
      tp_bank_title: 'Échange banque & ports',
      tp_bank_hint0: 'Choisissez 1 ressource à donner, puis 1 à recevoir. Taux : 2:1 au port correspondant, 3:1 au port générique, 4:1 à la banque.',
      tp_bank_plan: 'Donner {g} au taux {r}:1 → recevoir 1 {w}.',
      tp_bank_pick: 'Choisissez exactement une ressource à donner et une à recevoir.',
      tp_bank_need: 'Pas assez : un échange {r}:1 requiert {n} {res}.',

      h_roll_begin: 'Cliquez sur « Lancer les dés » pour commencer.',
      h_picktool: 'Choisissez un outil de construction, puis cliquez sur un point surligné.',
      h_setup1: 'Cliquez sur un coin surligné pour fonder votre colonie (gratuit).',
      h_setup2: 'Cliquez sur une arête surlignée pour poser votre route (gratuit).',
      h_second_settle: 'Placez votre deuxième colonie.',
      h_after_settle: 'Placez maintenant une route depuis votre colonie.',
      h_setup_done: 'Placement terminé. Lancez les dés pour commencer.',
      h_first_settle: 'Placez votre colonie.',
      h_no_settle: 'Plus aucun emplacement de colonie valide.',
      h_no_road: 'Plus aucune route valide.',
      h_robber_tile: 'Cliquez sur une tuile pour déplacer le voleur, puis terminez le tour.',
      h_robber_stay: 'Le voleur est resté là où il était.',
      h_steal: 'Vous pouvez prendre 1 carte : cliquez sur un joueur du panneau.',
      h_discard_chips: 'Un 7 ! Défaussez de votre main : cliquez sur les jetons de ressources.',
      h_discard_need: 'Défaussez {n} carte{s} : cliquez sur les jetons ci-dessous ({p}/{n} choisis).',
      h_already: 'Vous avez déjà lancé les dés ce tour.',
      h_rolled: 'Vous avez obtenu {a} + {b} = {t}.',
      h_cost_road: 'Une route coûte 1 bois et 1 brique.',
      h_deck_empty: 'Le paquet de cartes développement est vide.',
      h_dev_cost: 'Ressources insuffisantes pour une carte développement.',
      h_drew: 'Vous avez tiré une carte « {card} ».',
      h_trade_set: 'Choisissez au moins une carte à donner et une à recevoir.',
      h_reject: 'Personne n’a accepté. Améliorez l’offre ou fermez le panneau.',
      h_dev_bought_turn: 'Une carte « {card} » achetée ce tour sera jouable au prochain.',
      h_dev_played_already: 'Vous avez déjà joué une carte développement ce tour.',
      h_dev_none: 'Aucune carte « {card} » à jouer.',
      h_dev_played: 'Carte « {card} » jouée.',
      h_end_robber: 'Déplacez le voleur avant de terminer votre tour.',
      h_end_steal: 'Prenez d’abord une carte : cliquez sur un joueur du panneau.',
      h_roll_dice: 'Lancez les dés.',
      h_debug_done: 'Partie simulée terminée. Cliquez « Nouvelle partie » pour jouer vous-même.',

      rules_title: 'Règles & objectifs', rules_close: 'Fermer',
      r_goal: 'Objectif : être le premier à atteindre 10 points de victoire.',
      r_vp: 'Points de victoire : colonie = 1, ville = 2, plus longue route (5+) = +2, plus grande armée (3+ chevaliers) = +2, cartes Point de victoire = 1 chacune.',
      r_turn: 'Tour de jeu : lancez 2 dés — les tuiles correspondant au résultat rapportent des ressources à leurs voisins. construisez et/ou échangez, puis terminez votre tour.',
      r_seven: 'Sur un 7, personne ne récolte : déplacez le voleur et volez 1 carte au voisin de la nouvelle tuile ; les mains de plus de 7 cartes doivent défausser la moitié.',
      r_build: 'Coûts — route : 1 bois + 1 brique ; colonie : 1 bois + 1 brique + 1 blé + 1 mouton (colonies espacées de deux cases) ; ville : 2 blé + 3 minerais.',
      r_harbor: 'Ports : échangez 2:1 dans un port de la ressource correspondante, 3:1 dans un port générique, et 4:1 avec la banque ailleurs.',
      r_dev: 'Cartes développement (blé + minerai + brique) : une achat par tour, jamais jouable le tour de l’achat — sauf les cartes Point de victoire, comptées immédiatement mais cachées.',
      r_trade: 'Échanges entre joueurs : proposez n’importe quel lot aux IA, qui peuvent accepter ou refuser.',
      r_end: 'La partie s’arrête dès qu’un joueur affiche 10 points ou plus.',
      graph_title: 'Ressources au fil des tours',
      graph_total: 'Toutes',
      graph_min: 'Réduire / agrandir',
      graph_hide: 'Masquer',
    },

    es: {
      status_loading: 'Generando la isla…',
      status_winner: '¡{name} gana con {n} puntos de victoria!',
      status_discard: '{name} debe descartar {n} cartas',
      status_setup1: '{name}: coloca una colonia',
      status_setup2: '{name}: coloca una carretera',
      status_robber: '{name}: mueve al ladrón',
      status_roll: 'Turno de {name} — lanza los dados',
      status_build: 'Turno de {name} — construye o termina el turno',
      status_turn: 'Turno de {name}',

      panel_players: 'Jugadores', panel_log: 'Registro', btn_log: 'Registro',
      info_robber: 'Ladrón: casilla {res} ({num})', desertr: 'desierto',
      info_robber_none: 'Ladrón: aún sin colocar',
      info_deck: 'Cartas de desarrollo en el mazo: {n}',

      res_forest: 'Madera', res_pasture: 'Oveja', res_field: 'Trigo',
      res_hill: 'Ladrillo', res_mount: 'Mineral',
      dev_knight: 'Caballero', dev_victory: 'Punto de victoria',
      dev_roadBuild: 'Construcción de carreteras', dev_yearPlenty: 'Año de abundancia',
      dev_monopoly: 'Monopolio',

      btn_settlement: 'Colonia', btn_road: 'Carretera', btn_city: 'Ciudad',
      btn_dev: 'Carta de desarrollo', btn_roll: 'Lanzar dados',
      btn_trade: 'Comerciar', btn_pass: 'Terminar turno',
      btn_new: 'Nueva partida',
      debug_play: 'Depuración: automático', debug_playing: 'Depuración: en marcha…',

      m_play: 'Jugar', m_rules: 'Reglas y objetivos', m_lang: 'Idioma',
      music: 'Música', sfx: 'Efectos', vol: 'Volumen',
      ai_opponents: 'Oponentes IA', island_size: 'Tamaño de la isla',
      island_xl: 'XL (fichas dobles)',
      on: 'sí', off: 'no',

      tp_title: 'Comerciar con los jugadores',
      tp_hint: 'Haz clic en las fichas para fijar cantidades.',
      tp_give: 'Entregas', tp_get: 'Recibes',
      tp_offer: 'Ofrecer', tp_clear: 'Limpiar', tp_close: 'Cerrar',
      tp_offerpart: '{g} → {w}. Haz clic en una ficha para subir su cantidad.',
      tp_nothing: 'nada',
      tp_tab_players: 'Jugadores',
      tp_tab_bank: 'Banco y puertos',
      tp_bank_title: 'Intercambio banco y puertos',
      tp_bank_hint0: 'Elige 1 recurso para dar y 1 para recibir. Tasas: 2:1 en el puerto coincidente, 3:1 en el puerto genérico, 4:1 en el banco.',
      tp_bank_plan: 'Dar {g} a {r}:1 → recibir 1 {w}.',
      tp_bank_pick: 'Elige exactamente un recurso para dar y uno para recibir.',
      tp_bank_need: 'No basta: un intercambio {r}:1 requiere {n} {res}.',

      h_roll_begin: 'Haz clic en «Lanzar dados» para empezar.',
      h_picktool: 'Elige una herramienta de construcción y haz clic en un punto resaltado.',
      h_setup1: 'Haz clic en una esquina resaltada para fundar tu colonia (gratis).',
      h_setup2: 'Haz clic en una arista resaltada para colocar tu carretera (gratis).',
      h_second_settle: 'Coloca tu segunda colonia.',
      h_after_settle: 'Ahora coloca una carretera desde tu colonia.',
      h_setup_done: 'Preparación completa. Lanza los dados para empezar.',
      h_first_settle: 'Coloca tu colonia.',
      h_no_settle: 'No queda ningún lugar válido para una colonia.',
      h_no_road: 'No queda ninguna carretera válida.',
      h_robber_tile: 'Haz clic en una casilla para mover al ladrón y luego termina el turno.',
      h_robber_stay: 'El ladrón se quedó donde estaba.',
      h_steal: 'Puedes tomar 1 carta: haz clic en un jugador del panel.',
      h_discard_chips: '¡Un 7! Descarta de tu mano: haz clic en las fichas de recursos.',
      h_discard_need: 'Descarta {n} carta{s}: haz clic en las fichas de abajo ({p}/{n} elegidas).',
      h_already: 'Ya lanzaste los dados este turno.',
      h_rolled: 'Sacaste {a} + {b} = {t}.',
      h_cost_road: 'Una carretera cuesta 1 madera y 1 ladrillo.',
      h_deck_empty: 'El mazo de desarrollo está vacío.',
      h_dev_cost: 'Recursos insuficientes para una carta de desarrollo.',
      h_drew: 'Sacaste una carta «{card}».',
      h_trade_set: 'Elige al menos una carta para dar y otra para recibir.',
      h_reject: 'Nadie aceptó. Mejora la oferta o cierra el panel.',
      h_dev_bought_turn: 'Una carta «{card}» comprada este turno podrá jugarse en el próximo.',
      h_dev_played_already: 'Ya jugaste una carta de desarrollo este turno.',
      h_dev_none: 'No hay carta «{card}» para jugar.',
      h_dev_played: 'Carta «{card}» jugada.',
      h_end_robber: 'Mueve al ladrón antes de terminar tu turno.',
      h_end_steal: 'Toma primero una carta: haz clic en un jugador del panel.',
      h_roll_dice: 'Lanza los dados.',
      h_debug_done: 'Partida simulada terminada. Pulsa «Nueva partida» para jugar tú.',

      rules_title: 'Reglas y objetivos', rules_close: 'Cerrar',
      r_goal: 'Objetivo: ser el primero en llegar a 10 puntos de victoria.',
      r_vp: 'Puntos de victoria: colonia = 1, ciudad = 2, carretera más larga (5+) = +2, ejército más grande (3+ caballeros) = +2, cartas de punto de victoria = 1 cada una.',
      r_turn: 'Turno: lanza 2 dados — las casillas correspondientes pagan recursos a sus vecinos. Construye y/o comercia, y termina tu turno.',
      r_seven: 'Con un 7 nadie cobra: mueve al ladrón y roba 1 carta a un vecino de la nueva casilla; las manos de más de 7 cartas deben descartar la mitad.',
      r_build: 'Costes — carretera: 1 madera + 1 ladrillo; colonia: 1 madera + 1 ladrillo + 1 trigo + 1 oveja (colonias separadas dos casillas); ciudad: 2 trigo + 3 minerales.',
      r_harbor: 'Puertos: intercambia 2:1 en un puerto del recurso correspondiente, 3:1 en un puerto genérico y 4:1 con el banco en el resto.',
      r_dev: 'Cartas de desarrollo (trigo + mineral + ladrillo): se puede comprar una por turno, nunca se juega en el turno de compra — salvo las de punto de victoria, que cuentan de inmediato pero permanecen ocultas.',
      r_trade: 'Intercambios entre jugadores: ofrece cualquier lote a las IA, que pueden aceptar o rechazar.',
      r_end: 'La partida termina en cuanto un jugador muestre 10 puntos o más.',
      graph_title: 'Recursos a lo largo de los turnos',
      graph_total: 'Todas',
      graph_min: 'Plegar / desplegar',
      graph_hide: 'Ocultar',
    },

    de: {
      status_loading: 'Insel wird generiert…',
      status_winner: '{name} gewinnt mit {n} Siegpunkten!',
      status_discard: '{name} muss {n} Karten abwerfen',
      status_setup1: '{name}: Siedlung platzieren',
      status_setup2: '{name}: Straße platzieren',
      status_robber: '{name}: Räuber versetzen',
      status_roll: '{name} ist dran — würfeln',
      status_build: '{name} ist dran — bauen oder Zug beenden',
      status_turn: '{name} ist dran',

      panel_players: 'Spieler', panel_log: 'Protokoll', btn_log: 'Protokoll',
      info_robber: 'Räuber: Feld {res} ({num})', desertr: 'Wüste',
      info_robber_none: 'Räuber: noch nicht versetzt',
      info_deck: 'Entwicklungskarten im Stapel: {n}',

      res_forest: 'Holz', res_pasture: 'Schaf', res_field: 'Getreide',
      res_hill: 'Lehm', res_mount: 'Erz',
      dev_knight: 'Ritter', dev_victory: 'Siegpunkt',
      dev_roadBuild: 'Straßenbau', dev_yearPlenty: 'Jahr der Fülle',
      dev_monopoly: 'Monopol',

      btn_settlement: 'Siedlung', btn_road: 'Straße', btn_city: 'Stadt',
      btn_dev: 'Entwicklungskarte', btn_roll: 'Würfeln', btn_trade: 'Handel',
      btn_pass: 'Zug beenden', btn_new: 'Neues Spiel',
      debug_play: 'Debug: automatisch', debug_playing: 'Debug: läuft…',

      m_play: 'Spielen', m_rules: 'Regeln & Ziele', m_lang: 'Sprache',
      music: 'Musik', sfx: 'Sound', vol: 'Lautstärke',
      ai_opponents: 'KI-Gegner', island_size: 'Inselgröße',
      island_xl: 'XL (doppelte Felder)',
      on: 'an', off: 'aus',

      tp_title: 'Mit den Spielern handeln',
      tp_hint: 'Klicke auf die Chips, um Mengen festzulegen.',
      tp_give: 'Du gibst', tp_get: 'Du bekommst',
      tp_offer: 'Anbieten', tp_clear: 'Leeren', tp_close: 'Schließen',
      tp_offerpart: '{g} → {w}. Klicke auf einen Chip, um die Menge zu erhöhen.',
      tp_nothing: 'nichts',
      tp_tab_players: 'Spieler',
      tp_tab_bank: 'Bank & Häfen',
      tp_bank_title: 'Tausch mit Bank & Häfen',
      tp_bank_hint0: 'Wähle 1 Ressource zum Geben und 1 zum Nehmen. Kurse: 2:1 am passenden Hafen, 3:1 am allgemeinen Hafen, 4:1 an der Bank.',
      tp_bank_plan: '{g} zum Kurs {r}:1 geben → 1 {w} nehmen.',
      tp_bank_pick: 'Wähle genau eine Ressource zum Geben und eine zum Nehmen.',
      tp_bank_need: 'Nicht genug: ein {r}:1-Tausch benötigt {n} {res}.',

      h_roll_begin: 'Klicke auf „Würfeln“, um zu beginnen.',
      h_picktool: 'Wähle ein Bauwerkzeug und klicke auf eine markierte Stelle.',
      h_setup1: 'Klicke auf eine markierte Ecke, um deine Siedlung zu gründen (kostenlos).',
      h_setup2: 'Klicke auf eine markierte Kante, um deine Straße zu bauen (kostenlos).',
      h_second_settle: 'Platziere deine zweite Siedlung.',
      h_after_settle: 'Baue jetzt eine Straße von deiner Siedlung aus.',
      h_setup_done: 'Aufbau abgeschlossen. Würfle, um zu starten.',
      h_first_settle: 'Platziere deine Siedlung.',
      h_no_settle: 'Kein gültiger Siedlungsplatz mehr.',
      h_no_road: 'Keine gültige Straße mehr.',
      h_robber_tile: 'Klicke auf ein Feld, um den Räuber zu versetzen, und beende dann den Zug.',
      h_robber_stay: 'Der Räuber blieb, wo er war.',
      h_steal: 'Du darfst 1 Karte nehmen: Klicke auf einen Spieler im Panel.',
      h_discard_chips: 'Eine 7! Wirf aus deiner Hand ab: Klicke auf die Rohstoff-Chips.',
      h_discard_need: 'Wirf {n} Karte{n} ab: Klicke unten auf die Chips ({p}/{n} gewählt).',
      h_already: 'Du hast in diesem Zug schon gewürfelt.',
      h_rolled: 'Du hast {a} + {b} = {t} gewürfelt.',
      h_cost_road: 'Eine Straße kostet 1 Holz und 1 Lehm.',
      h_deck_empty: 'Der Entwicklungsstapel ist leer.',
      h_dev_cost: 'Nicht genug Rohstoffe für eine Entwicklungskarte.',
      h_drew: 'Du hast eine Karte „{card}“ gezogen.',
      h_trade_set: 'Lege mindestens eine Karte zum Geben und eine zum Nehmen fest.',
      h_reject: 'Niemand hat akzeptiert. Verbessere das Angebot oder schließe das Panel.',
      h_dev_bought_turn: 'Eine Karte „{card}“, die in diesem Zug gekauft wurde, darf erst im nächsten Zug gespielt werden.',
      h_dev_played_already: 'Du hast in diesem Zug schon eine Entwicklungskarte gespielt.',
      h_dev_none: 'Keine Karte „{card}“ zum Ausspielen.',
      h_dev_played: 'Karte „{card}“ gespielt.',
      h_end_robber: 'Versetze den Räuber, bevor du deinen Zug beendest.',
      h_end_steal: 'Nimm zuerst eine Karte: Klicke auf einen Spieler im Panel.',
      h_roll_dice: 'Würfle.',
      h_debug_done: 'Simulationspartie beendet. „Neues Spiel“ drücken, um selbst zu spielen.',

      rules_title: 'Regeln & Ziele', rules_close: 'Schließen',
      r_goal: 'Ziel: als Erster 10 Siegpunkte erreichen.',
      r_vp: 'Siegpunkte: Siedlung = 1, Stadt = 2, längste Straße (5+) = +2, größte Rittermacht (3+) = +2, Siegpunktkarten = je 1.',
      r_turn: 'Zug: 2 Würfel — die passenden Felder zahlen Rohstoffe an ihre Anrainer. Baue und/oder handle, dann beende den Zug.',
      r_seven: 'Bei einer 7 zahlt niemand: versetze den Räuber und nimm 1 Karte vom Nachbarn des neuen Felds; Hände mit mehr als 7 Karten werfen die Hälfte ab.',
      r_build: 'Kosten — Straße: 1 Holz + 1 Lehm; Siedlung: 1 Holz + 1 Lehm + 1 Getreide + 1 Schaf (Siedlungen zwei Plätze auseinander); Stadt: 2 Getreide + 3 Erz.',
      r_harbor: 'Häfen: Tausch 2:1 am passenden Hafen, 3:1 am allgemeinen Hafen und 4:1 mit der Bank sonstwo.',
      r_dev: 'Entwicklungskarten (Getreide + Erz + Lehm): eine pro Zug kaufen, im Kaufzug nie ausspielen — Siegpunktkarten zählen sofort, bleiben aber verborgen.',
      r_trade: 'Handel unter Spielern: biete den KIs beliebige Bündel an, die annehmen oder ablehnen können.',
      r_end: 'Das Spiel endet, sobald ein Spieler 10 oder mehr Punkte vorzeigt.',
      graph_title: 'Rohstoffe im Zugverlauf',
      graph_total: 'Alle',
      graph_min: 'Ein-/Ausklappen',
      graph_hide: 'Ausblenden',
    },
  };

  let current = 'en';
  try {
    const saved = localStorage.getItem('hexhaven-lang');
    if (saved && DICT[saved]) current = saved;
  } catch { /* storage unavailable */ }

  const listeners = [];

  function t(key, params) {
    const dict = DICT[current] || DICT.en;
    let s = dict[key] !== undefined ? dict[key] : (DICT.en[key] || key);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = s.split('{' + k + '}').join(String(v));
      }
    }
    return s;
  }

  function res(resKind) { return t('res_' + resKind); }
  function dev(kind) { return t('dev_' + kind); }
  function yesNo(on) { return t(on ? 'on' : 'off'); }

  // Translate every element that declares data-i18n (text) or
  // data-i18n-title (title attribute).
  function applyStatic(root) {
    const scope = root || document;
    if (!scope || !scope.querySelectorAll) return;
    for (const el of scope.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n);
    }
    for (const el of scope.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.dataset.i18nTitle);
    }
    if (document && document.documentElement) {
      document.documentElement.lang = current;  // may be absent headless
    }
  }

  function set(lang) {
    if (!DICT[lang]) return;
    current = lang;
    try { localStorage.setItem('hexhaven-lang', lang); } catch { /* ignore */ }
    applyStatic();
    for (const fn of listeners) fn();
  }

  return {
    t, res, dev, yesNo, set, applyStatic,
    get: () => current, langs: LANGS.slice(),
    onChange: (fn) => listeners.push(fn),
  };
})();
