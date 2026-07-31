import {
  defineGame,
  type Ctx,
  type GameState,
  type PlayerID,
  type PlayerInfo,
  type RandomAPI,
} from '@boardr/sdk'

/** the subset of ctx the pure helpers need — works for both Ctx and SetupCtx */
type WithPlayers = { players: PlayerInfo[] }
import {
  ACTION_LABEL,
  bankable,
  buildDeck,
  canBuildOn,
  COLOR_LABEL,
  COLORS,
  HOTEL_RENT,
  HOUSE_RENT,
  rentFor,
  setComplete,
  type ActionType,
  type Card,
  type Color,
} from './deck'

/**
 * Monopoly Deal — CORE (House, Hotel, Double the Rent deferred; see rules.md).
 *
 * Zones: hand (secret), bank + properties (public — the whole point of the
 * game is reading the table). Deck and discard order live in `internal`.
 *
 * The interesting part is the interrupt model. A targeted action doesn't
 * resolve immediately: it opens a response window (the engine `actors` hook)
 * where each target may play Just Say No — reactively, out of their turn, and
 * JSN can be countered by another JSN. Charges then open a payment window
 * where the target chooses which table cards to hand over. The turn holder
 * stays `currentPlayer` throughout; `actors` redirects who may act.
 */

export const SETS_TO_WIN = 3
export const HAND_LIMIT = 7
export const MAX_PLAYS = 3
const DEBT_COLLECTOR = 5
const BIRTHDAY = 2

export type Phase = 'playing' | 'responding' | 'over'

export type PendingKind =
  | { type: 'sly'; color: Color; cardId: string }
  | { type: 'forced'; color: Color; cardId: string; giveColor: Color; giveCardId: string }
  | { type: 'deal'; color: Color }
  | { type: 'charge' }

export interface Pending {
  action: ActionType | 'rent'
  by: PlayerID
  /** targets still to resolve; [0] is current */
  targets: PlayerID[]
  stage: 'block' | 'pay'
  /** Just Say No played in the current target's chain (even ⇒ applies) */
  jsn: number
  /** who acts now during a 'block' stage */
  decider: PlayerID
  /** debt each target owes (charges only) */
  amount: number
  kind: PendingKind
  label: string
}

export interface MDPublic {
  phase: Phase
  turnPlayer: PlayerID
  playsMade: number
  deckCount: number
  discardCount: number
  bank: Record<PlayerID, Card[]>
  properties: Record<PlayerID, Record<Color, Card[]>>
  /** houses/hotels sitting on each completed set */
  buildings: Record<PlayerID, Record<Color, { house: Card | null; hotel: Card | null }>>
  handCounts: Record<PlayerID, number>
  pending: Pending | null
  setsWon: Record<PlayerID, number>
  lastEvent: string | null
}

export interface MDSecret {
  hand: Card[]
}

export interface MDInternal {
  deck: Card[]
  discard: Card[]
}

export type MDState = GameState<MDPublic, MDSecret, MDInternal>

// --- helpers ----------------------------------------------------------------

function ids(ctx: WithPlayers): PlayerID[] {
  return ctx.players.map((p) => p.id)
}

function nextPlayer(ctx: WithPlayers, from: PlayerID): PlayerID {
  const order = ids(ctx)
  return order[(order.indexOf(from) + 1) % order.length]!
}

function emptyProps(): Record<Color, Card[]> {
  return Object.fromEntries(COLORS.map((c) => [c, [] as Card[]])) as Record<Color, Card[]>
}

function emptyBuildings(): Record<Color, { house: Card | null; hotel: Card | null }> {
  return Object.fromEntries(COLORS.map((c) => [c, { house: null, hotel: null }])) as Record<
    Color,
    { house: Card | null; hotel: Card | null }
  >
}

/** rent for a colour, including any house/hotel bonus once the set is complete */
function rentAmount(state: MDState, player: PlayerID, color: Color): number {
  const count = state.public.properties[player]![color]!.length
  let amount = rentFor(color, count)
  if (setComplete(color, count)) {
    const b = state.public.buildings[player]![color]!
    if (b.house) amount += HOUSE_RENT
    if (b.hotel) amount += HOTEL_RENT
  }
  return amount
}

/**
 * A set that is no longer complete can't hold buildings — the house/hotel drop
 * into the owner's bank as cash (faithful to "move it or bank it"). Call after
 * any card leaves one of a player's colour sets.
 */
function demolishIfBroken(state: MDState, player: PlayerID, color: Color): void {
  const count = state.public.properties[player]![color]!.length
  if (setComplete(color, count)) return
  const b = state.public.buildings[player]![color]!
  for (const key of ['hotel', 'house'] as const) {
    if (b[key]) {
      state.public.bank[player]!.push(b[key]!)
      b[key] = null
    }
  }
}

function completeSets(state: MDState, player: PlayerID): number {
  const props = state.public.properties[player]!
  return COLORS.filter((c) => setComplete(c, props[c]!.length)).length
}

function refreshSets(state: MDState, ctx: WithPlayers): void {
  for (const p of ids(ctx)) state.public.setsWon[p] = completeSets(state, p)
}

function syncCounts(state: MDState, ctx: WithPlayers): void {
  for (const p of ids(ctx)) state.public.handCounts[p] = state.secret[p]?.hand.length ?? 0
  state.public.deckCount = state.internal!.deck.length
  state.public.discardCount = state.internal!.discard.length
}

/** draw n cards for a player, reshuffling the discard into the deck if needed */
function draw(state: MDState, player: PlayerID, n: number, random: RandomAPI): void {
  const int = state.internal!
  const hand = state.secret[player]!.hand
  for (let i = 0; i < n; i++) {
    if (int.deck.length === 0) {
      if (int.discard.length === 0) break // nothing left anywhere
      int.deck = random.shuffle(int.discard)
      int.discard = []
    }
    hand.push(int.deck.pop()!)
  }
}

function beginTurn(state: MDState, player: PlayerID, random: RandomAPI): void {
  state.public.turnPlayer = player
  state.public.playsMade = 0
  const empty = (state.secret[player]?.hand.length ?? 0) === 0
  draw(state, player, empty ? 5 : 2, random)
}

/** locate a property/wild card on a player's table */
function findProp(state: MDState, player: PlayerID, cardId: string): { color: Color; card: Card } | null {
  const props = state.public.properties[player]!
  for (const color of COLORS) {
    const card = props[color]!.find((c) => c.id === cardId)
    if (card) return { color, card }
  }
  return null
}

function allTableCards(state: MDState, player: PlayerID): Card[] {
  const props = state.public.properties[player]!
  return [...state.public.bank[player]!, ...COLORS.flatMap((c) => props[c]!)]
}

function takeFromHand(state: MDState, player: PlayerID, cardId: string): Card | null {
  const hand = state.secret[player]!.hand
  const i = hand.findIndex((c) => c.id === cardId)
  if (i === -1) return null
  return hand.splice(i, 1)[0]!
}

/** colours a card may be placed under */
function wildColors(card: Card): Color[] {
  if (card.kind === 'property') return [card.color!]
  if (card.kind === 'wild') return card.wildAny ? COLORS : (card.colors ?? [])
  return []
}

// --- action setup + resolution ----------------------------------------------

function openWindow(
  state: MDState,
  by: PlayerID,
  action: ActionType | 'rent',
  targets: PlayerID[],
  amount: number,
  kind: PendingKind,
  label: string,
): void {
  state.public.phase = 'responding'
  state.public.pending = {
    action,
    by,
    targets,
    stage: 'block',
    jsn: 0,
    decider: targets[0]!,
    amount,
    kind,
    label,
  }
}

/** move a card to a player's table (bank if money-ish, else its property slot) */
function receiveCard(state: MDState, to: PlayerID, card: Card, color?: Color): void {
  if (card.kind === 'property' || card.kind === 'wild') {
    const slot = color ?? wildColors(card)[0] ?? 'brown'
    state.public.properties[to]![slot]!.push(card)
  } else {
    state.public.bank[to]!.push(card)
  }
}

/** apply the effect of the current pending to its current target (jsn was even) */
function applyToTarget(state: MDState, ctx: Ctx, target: PlayerID): void {
  const pend = state.public.pending!
  const kind = pend.kind
  const by = pend.by
  const pub = state.public

  if (kind.type === 'sly') {
    const found = findProp(state, target, kind.cardId)
    if (found) {
      pub.properties[target]![found.color] = pub.properties[target]![found.color]!.filter(
        (c) => c.id !== kind.cardId,
      )
      demolishIfBroken(state, target, found.color)
      receiveCard(state, by, found.card, found.color)
    }
    finishTarget(state, ctx)
    return
  }
  if (kind.type === 'forced') {
    const mine = findProp(state, by, kind.giveCardId)
    const theirs = findProp(state, target, kind.cardId)
    if (mine && theirs) {
      pub.properties[by]![mine.color] = pub.properties[by]![mine.color]!.filter((c) => c.id !== mine.card.id)
      pub.properties[target]![theirs.color] = pub.properties[target]![theirs.color]!.filter(
        (c) => c.id !== theirs.card.id,
      )
      receiveCard(state, target, mine.card, mine.color)
      receiveCard(state, by, theirs.card, theirs.color)
      demolishIfBroken(state, by, mine.color)
      demolishIfBroken(state, target, theirs.color)
    }
    finishTarget(state, ctx)
    return
  }
  if (kind.type === 'deal') {
    const color = kind.color
    const stolen = pub.properties[target]![color]!
    pub.properties[target]![color] = []
    for (const card of stolen) pub.properties[by]![color]!.push(card)
    // Deal Breaker takes the set whole, buildings and all
    const fromB = pub.buildings[target]![color]!
    const toB = pub.buildings[by]![color]!
    toB.house = fromB.house
    toB.hotel = fromB.hotel
    fromB.house = null
    fromB.hotel = null
    finishTarget(state, ctx)
    return
  }

  // charge: enter the payment stage (skip if nothing to pay)
  if (pend.amount <= 0 || allTableCards(state, target).length === 0) {
    finishTarget(state, ctx)
    return
  }
  pend.stage = 'pay'
}

/** current target resolved — advance to the next, or close the window */
function finishTarget(state: MDState, ctx: WithPlayers): void {
  const pend = state.public.pending!
  pend.targets.shift()
  refreshSets(state, ctx)
  if (pend.targets.length === 0) {
    state.public.pending = null
    state.public.phase = 'playing'
  } else {
    pend.stage = 'block'
    pend.jsn = 0
    pend.decider = pend.targets[0]!
  }
  syncCounts(state, ctx)
}

function playerName(ctx: WithPlayers, id: string): string {
  return ctx.players.find((p) => p.id === id)?.name ?? id
}

function label(action: ActionType | 'rent', byName: string, extra = ''): string {
  const actionName = action === 'rent' ? 'Rent' : ACTION_LABEL[action]
  return `${byName} played ${actionName}${extra}`
}

// --- guards -----------------------------------------------------------------

function requireTurn(state: MDState, ctx: Ctx): void {
  if (state.public.phase !== 'playing') ctx.invalid('you cannot do that right now')
  if (ctx.playerID !== state.public.turnPlayer) ctx.invalid('not your turn')
  if (state.public.playsMade >= MAX_PLAYS) ctx.invalid('you have used all 3 plays this turn')
}

const inBlock = (state: MDState, p: PlayerID): boolean =>
  state.public.phase === 'responding' &&
  state.public.pending?.stage === 'block' &&
  state.public.pending.decider === p

const inPay = (state: MDState, p: PlayerID): boolean =>
  state.public.phase === 'responding' &&
  state.public.pending?.stage === 'pay' &&
  state.public.pending.targets[0] === p

function holdsJustSayNo(state: MDState, p: PlayerID): boolean {
  return (state.secret[p]?.hand ?? []).some((c) => c.action === 'justSayNo')
}

// --- game definition --------------------------------------------------------

export default defineGame<MDState>({
  name: 'monopoly-deal',
  minPlayers: 2,
  maxPlayers: 5,

  setup: (ctx) => {
    const players = ctx.players.map((p) => p.id)
    const state: MDState = {
      public: {
        phase: 'playing',
        turnPlayer: players[0]!,
        playsMade: 0,
        deckCount: 0,
        discardCount: 0,
        bank: Object.fromEntries(players.map((p) => [p, [] as Card[]])),
        properties: Object.fromEntries(players.map((p) => [p, emptyProps()])),
        buildings: Object.fromEntries(players.map((p) => [p, emptyBuildings()])),
        handCounts: Object.fromEntries(players.map((p) => [p, 0])),
        pending: null,
        setsWon: Object.fromEntries(players.map((p) => [p, 0])),
        lastEvent: null,
      },
      secret: Object.fromEntries(players.map((p) => [p, { hand: [] as Card[] }])),
      internal: { deck: ctx.random.shuffle(buildDeck()), discard: [] },
    }
    // deal 5 to each, then the opener draws their turn's 2
    for (const p of players) draw(state, p, 5, ctx.random)
    beginTurn(state, players[0]!, ctx.random)
    syncCounts(state, ctx)
    return state
  },

  actors: (state, ctx) => {
    const pend = state.public.pending
    if (state.public.phase !== 'responding' || !pend) return [ctx.currentPlayer]
    return [pend.stage === 'block' ? pend.decider : pend.targets[0]!]
  },

  moves: {
    // --- turn plays ---------------------------------------------------------
    bank: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        state.public.playsMade < MAX_PLAYS,
      move: (state, ctx, args) => {
        requireTurn(state, ctx)
        const cardId = (args as { cardId?: string } | undefined)?.cardId
        const card = state.secret[ctx.playerID]!.hand.find((c) => c.id === cardId)
        if (!card) return ctx.invalid('that card is not in your hand')
        if (!bankable(card)) return ctx.invalid('property wildcards have no cash value')
        takeFromHand(state, ctx.playerID, card.id)
        state.public.bank[ctx.playerID]!.push(card)
        state.public.playsMade++
        state.public.lastEvent = `${playerName(ctx, ctx.playerID)} banked ${card.name}`
        syncCounts(state, ctx)
      },
    },

    playProperty: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        state.public.playsMade < MAX_PLAYS,
      move: (state, ctx, args) => {
        requireTurn(state, ctx)
        const { cardId, color } = (args ?? {}) as { cardId?: string; color?: Color }
        const card = state.secret[ctx.playerID]!.hand.find((c) => c.id === cardId)
        if (!card) return ctx.invalid('that card is not in your hand')
        if (card.kind !== 'property' && card.kind !== 'wild') return ctx.invalid('not a property card')
        if (!color || !wildColors(card).includes(color)) return ctx.invalid('that colour is not valid for this card')
        takeFromHand(state, ctx.playerID, card.id)
        state.public.properties[ctx.playerID]![color]!.push(card)
        state.public.playsMade++
        state.public.lastEvent = `${playerName(ctx, ctx.playerID)} played ${COLOR_LABEL[color]} property`
        refreshSets(state, ctx)
        syncCounts(state, ctx)
      },
    },

    /** shuffle a wildcard already on your table to another colour — free */
    moveWild: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' && ctx.playerID === state.public.turnPlayer,
      move: (state, ctx, args) => {
        if (state.public.phase !== 'playing' || ctx.playerID !== state.public.turnPlayer) {
          return ctx.invalid('not your turn')
        }
        const { cardId, color } = (args ?? {}) as { cardId?: string; color?: Color }
        const found = findProp(state, ctx.playerID, cardId ?? '')
        if (!found || found.card.kind !== 'wild') return ctx.invalid('pick a wildcard on your table')
        if (!color || !wildColors(found.card).includes(color)) return ctx.invalid('invalid colour for that wildcard')
        const props = state.public.properties[ctx.playerID]!
        props[found.color] = props[found.color]!.filter((c) => c.id !== found.card.id)
        props[color]!.push(found.card)
        refreshSets(state, ctx)
      },
    },

    passGo: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        state.public.playsMade < MAX_PLAYS &&
        (state.secret[ctx.playerID]?.hand ?? []).some((c) => c.action === 'passGo'),
      move: (state, ctx, args) => {
        requireTurn(state, ctx)
        const cardId = (args as { cardId?: string } | undefined)?.cardId
        const card = state.secret[ctx.playerID]!.hand.find((c) => c.id === cardId && c.action === 'passGo')
        if (!card) return ctx.invalid('you have no Pass Go card selected')
        takeFromHand(state, ctx.playerID, card.id)
        state.internal!.discard.push(card)
        draw(state, ctx.playerID, 2, ctx.random)
        state.public.playsMade++
        state.public.lastEvent = `${playerName(ctx, ctx.playerID)} played Pass Go`
        syncCounts(state, ctx)
      },
    },

    /** put a House on one of your completed street sets (+$3M rent) */
    playHouse: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        state.public.playsMade < MAX_PLAYS &&
        (state.secret[ctx.playerID]?.hand ?? []).some((c) => c.action === 'house'),
      move: (state, ctx, args) => {
        requireTurn(state, ctx)
        const { cardId, color } = (args ?? {}) as { cardId?: string; color?: Color }
        const card = state.secret[ctx.playerID]!.hand.find((c) => c.id === cardId && c.action === 'house')
        if (!card) return ctx.invalid('no House selected')
        if (!color || !canBuildOn(color)) return ctx.invalid('houses go on street sets, not railroads or utilities')
        if (!setComplete(color, state.public.properties[ctx.playerID]![color]!.length)) {
          return ctx.invalid(`complete your ${COLOR_LABEL[color]} set before building on it`)
        }
        if (state.public.buildings[ctx.playerID]![color]!.house) return ctx.invalid('that set already has a house')
        takeFromHand(state, ctx.playerID, card.id)
        state.public.buildings[ctx.playerID]![color]!.house = card
        state.public.playsMade++
        state.public.lastEvent = `${playerName(ctx, ctx.playerID)} built a house on ${COLOR_LABEL[color]}`
        syncCounts(state, ctx)
      },
    },

    /** put a Hotel on a completed set that already has a house (+$4M rent) */
    playHotel: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        state.public.playsMade < MAX_PLAYS &&
        (state.secret[ctx.playerID]?.hand ?? []).some((c) => c.action === 'hotel'),
      move: (state, ctx, args) => {
        requireTurn(state, ctx)
        const { cardId, color } = (args ?? {}) as { cardId?: string; color?: Color }
        const card = state.secret[ctx.playerID]!.hand.find((c) => c.id === cardId && c.action === 'hotel')
        if (!card) return ctx.invalid('no Hotel selected')
        if (!color || !canBuildOn(color)) return ctx.invalid('hotels go on street sets only')
        if (!setComplete(color, state.public.properties[ctx.playerID]![color]!.length)) {
          return ctx.invalid('that set is not complete')
        }
        const b = state.public.buildings[ctx.playerID]![color]!
        if (!b.house) return ctx.invalid('build a house before a hotel')
        if (b.hotel) return ctx.invalid('that set already has a hotel')
        takeFromHand(state, ctx.playerID, card.id)
        b.hotel = card
        state.public.playsMade++
        state.public.lastEvent = `${playerName(ctx, ctx.playerID)} built a hotel on ${COLOR_LABEL[color]}`
        syncCounts(state, ctx)
      },
    },

    // --- targeted actions (open a response window) --------------------------
    debtCollector: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        state.public.playsMade < MAX_PLAYS &&
        (state.secret[ctx.playerID]?.hand ?? []).some((c) => c.action === 'debtCollector'),
      move: (state, ctx, args) => {
        requireTurn(state, ctx)
        const { cardId, target } = (args ?? {}) as { cardId?: string; target?: PlayerID }
        const card = state.secret[ctx.playerID]!.hand.find((c) => c.id === cardId && c.action === 'debtCollector')
        if (!card) return ctx.invalid('no Debt Collector selected')
        if (!target || target === ctx.playerID || !ids(ctx).includes(target)) {
          return ctx.invalid('choose an opponent to charge')
        }
        takeFromHand(state, ctx.playerID, card.id)
        state.internal!.discard.push(card)
        state.public.playsMade++
        openWindow(state, ctx.playerID, 'debtCollector', [target], DEBT_COLLECTOR, { type: 'charge' }, '')
        state.public.lastEvent = label('debtCollector', playerName(ctx, ctx.playerID), ` on ${playerName(ctx, target)} ($${DEBT_COLLECTOR}M)`)
        syncCounts(state, ctx)
      },
    },

    birthday: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        state.public.playsMade < MAX_PLAYS &&
        (state.secret[ctx.playerID]?.hand ?? []).some((c) => c.action === 'birthday'),
      move: (state, ctx, args) => {
        requireTurn(state, ctx)
        const cardId = (args as { cardId?: string } | undefined)?.cardId
        const card = state.secret[ctx.playerID]!.hand.find((c) => c.id === cardId && c.action === 'birthday')
        if (!card) return ctx.invalid('no It’s My Birthday selected')
        takeFromHand(state, ctx.playerID, card.id)
        state.internal!.discard.push(card)
        state.public.playsMade++
        const targets = ids(ctx).filter((p) => p !== ctx.playerID)
        openWindow(state, ctx.playerID, 'birthday', targets, BIRTHDAY, { type: 'charge' }, '')
        state.public.lastEvent = label('birthday', playerName(ctx, ctx.playerID), ` — everyone owes $${BIRTHDAY}M`)
        syncCounts(state, ctx)
      },
    },

    playRent: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        state.public.playsMade < MAX_PLAYS &&
        (state.secret[ctx.playerID]?.hand ?? []).some((c) => c.kind === 'rent'),
      move: (state, ctx, args) => {
        requireTurn(state, ctx)
        const { cardId, color, target, doubleCardId } = (args ?? {}) as {
          cardId?: string
          color?: Color
          target?: PlayerID
          doubleCardId?: string
        }
        const card = state.secret[ctx.playerID]!.hand.find((c) => c.id === cardId && c.kind === 'rent')
        if (!card) return ctx.invalid('no Rent card selected')
        const choices = card.rentAny ? COLORS : (card.rentColors ?? [])
        if (!color || !choices.includes(color)) return ctx.invalid('choose a colour this rent card covers')
        let amount = rentAmount(state, ctx.playerID, color)
        if (amount <= 0) return ctx.invalid(`you own no ${COLOR_LABEL[color]} property to charge rent on`)

        // Double the Rent: a second card played alongside — it uses a 2nd play
        const dbl = doubleCardId
          ? state.secret[ctx.playerID]!.hand.find((c) => c.id === doubleCardId && c.action === 'doubleRent')
          : undefined
        if (doubleCardId && !dbl) return ctx.invalid('no Double the Rent card to add')
        const playsNeeded = dbl ? 2 : 1
        if (state.public.playsMade + playsNeeded > MAX_PLAYS) {
          return ctx.invalid('Double the Rent needs two plays available this turn')
        }

        let targets: PlayerID[]
        if (card.rentAny) {
          if (!target || target === ctx.playerID || !ids(ctx).includes(target)) {
            return ctx.invalid('wild rent charges one chosen opponent')
          }
          targets = [target]
        } else {
          targets = ids(ctx).filter((p) => p !== ctx.playerID)
        }
        takeFromHand(state, ctx.playerID, card.id)
        state.internal!.discard.push(card)
        if (dbl) {
          takeFromHand(state, ctx.playerID, dbl.id)
          state.internal!.discard.push(dbl)
          amount *= 2
        }
        state.public.playsMade += playsNeeded
        openWindow(state, ctx.playerID, 'rent', targets, amount, { type: 'charge' }, '')
        state.public.lastEvent = `${playerName(ctx, ctx.playerID)} charged ${COLOR_LABEL[color]} rent ($${amount}M${dbl ? ', doubled' : ''})`
        syncCounts(state, ctx)
      },
    },

    slyDeal: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        state.public.playsMade < MAX_PLAYS &&
        (state.secret[ctx.playerID]?.hand ?? []).some((c) => c.action === 'slyDeal'),
      move: (state, ctx, args) => {
        requireTurn(state, ctx)
        const { cardId, target, color, targetCardId } = (args ?? {}) as {
          cardId?: string
          target?: PlayerID
          color?: Color
          targetCardId?: string
        }
        const card = state.secret[ctx.playerID]!.hand.find((c) => c.id === cardId && c.action === 'slyDeal')
        if (!card) return ctx.invalid('no Sly Deal selected')
        if (!target || !color || !targetCardId) return ctx.invalid('pick a property to steal')
        if (setComplete(color, state.public.properties[target]?.[color]?.length ?? 0)) {
          return ctx.invalid('you cannot steal from a completed set')
        }
        const found = findProp(state, target, targetCardId)
        if (!found || found.color !== color) return ctx.invalid('that card is not there')
        takeFromHand(state, ctx.playerID, card.id)
        state.internal!.discard.push(card)
        state.public.playsMade++
        const slyCard = found.card
        openWindow(state, ctx.playerID, 'slyDeal', [target], 0, { type: 'sly', color, cardId: targetCardId }, '')
        state.public.lastEvent = label('slyDeal', playerName(ctx, ctx.playerID), ` — trying to steal ${slyCard.name} (${COLOR_LABEL[color]}) from ${playerName(ctx, target)}`)
        syncCounts(state, ctx)
      },
    },

    forcedDeal: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        state.public.playsMade < MAX_PLAYS &&
        (state.secret[ctx.playerID]?.hand ?? []).some((c) => c.action === 'forcedDeal'),
      move: (state, ctx, args) => {
        requireTurn(state, ctx)
        const { cardId, target, color, targetCardId, giveColor, giveCardId } = (args ?? {}) as {
          cardId?: string
          target?: PlayerID
          color?: Color
          targetCardId?: string
          giveColor?: Color
          giveCardId?: string
        }
        const card = state.secret[ctx.playerID]!.hand.find((c) => c.id === cardId && c.action === 'forcedDeal')
        if (!card) return ctx.invalid('no Forced Deal selected')
        if (!target || !color || !targetCardId || !giveColor || !giveCardId) {
          return ctx.invalid('pick a card to give and one to take')
        }
        if (setComplete(color, state.public.properties[target]?.[color]?.length ?? 0)) {
          return ctx.invalid('you cannot take from a completed set')
        }
        if (setComplete(giveColor, state.public.properties[ctx.playerID]?.[giveColor]?.length ?? 0)) {
          return ctx.invalid('you cannot give from a completed set')
        }
        const theirProp = findProp(state, target, targetCardId)
        const myProp = findProp(state, ctx.playerID, giveCardId)
        if (!theirProp || !myProp) {
          return ctx.invalid('one of those cards is not on the table')
        }
        takeFromHand(state, ctx.playerID, card.id)
        state.internal!.discard.push(card)
        state.public.playsMade++
        openWindow(
          state,
          ctx.playerID,
          'forcedDeal',
          [target],
          0,
          { type: 'forced', color, cardId: targetCardId, giveColor, giveCardId },
          '',
        )
        state.public.lastEvent = label('forcedDeal', playerName(ctx, ctx.playerID), ` — swapping their ${theirProp.card.name} (${COLOR_LABEL[color]}) with ${playerName(ctx, target)}`)
        syncCounts(state, ctx)
      },
    },

    dealBreaker: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        state.public.playsMade < MAX_PLAYS &&
        (state.secret[ctx.playerID]?.hand ?? []).some((c) => c.action === 'dealBreaker'),
      move: (state, ctx, args) => {
        requireTurn(state, ctx)
        const { cardId, target, color } = (args ?? {}) as {
          cardId?: string
          target?: PlayerID
          color?: Color
        }
        const card = state.secret[ctx.playerID]!.hand.find((c) => c.id === cardId && c.action === 'dealBreaker')
        if (!card) return ctx.invalid('no Deal Breaker selected')
        if (!target || !color) return ctx.invalid('choose a completed set to steal')
        if (!setComplete(color, state.public.properties[target]?.[color]?.length ?? 0)) {
          return ctx.invalid('Deal Breaker only takes a completed set')
        }
        takeFromHand(state, ctx.playerID, card.id)
        state.internal!.discard.push(card)
        state.public.playsMade++
        openWindow(state, ctx.playerID, 'dealBreaker', [target], 0, { type: 'deal', color }, '')
        state.public.lastEvent = label('dealBreaker', playerName(ctx, ctx.playerID), ` — trying to steal ${playerName(ctx, target)}'s ${COLOR_LABEL[color]} set`)
        syncCounts(state, ctx)
      },
    },

    // --- response window ----------------------------------------------------
    justSayNo: {
      canMove: (state, ctx) => inBlock(state, ctx.playerID) && holdsJustSayNo(state, ctx.playerID),
      move: (state, ctx) => {
        if (!inBlock(state, ctx.playerID)) return ctx.invalid('nothing to say no to right now')
        const pend = state.public.pending!
        const card = (state.secret[ctx.playerID]!.hand ?? []).find((c) => c.action === 'justSayNo')
        if (!card) return ctx.invalid('you have no Just Say No')
        takeFromHand(state, ctx.playerID, card.id)
        state.internal!.discard.push(card)
        pend.jsn++
        // the decision bounces to the other party in this target's chain
        pend.decider = pend.decider === pend.by ? pend.targets[0]! : pend.by
        state.public.lastEvent = `${playerName(ctx, ctx.playerID)} said Just Say No!`
        syncCounts(state, ctx)
      },
    },

    /** decline to block — let the chain settle (even JSN ⇒ the action lands) */
    accept: {
      canMove: (state, ctx) => inBlock(state, ctx.playerID),
      move: (state, ctx) => {
        if (!inBlock(state, ctx.playerID)) return ctx.invalid('nothing to accept right now')
        const pend = state.public.pending!
        const target = pend.targets[0]!
        if (pend.jsn % 2 === 1) {
          // an odd number of "no"s means the action was blocked
          state.public.lastEvent = `blocked — ${pend.action === 'rent' ? 'rent' : ACTION_LABEL[pend.action as ActionType]} cancelled`
          finishTarget(state, ctx)
        } else {
          applyToTarget(state, ctx, target)
        }
        syncCounts(state, ctx)
      },
    },

    pay: {
      canMove: (state, ctx) => inPay(state, ctx.playerID),
      move: (state, ctx, args) => {
        if (!inPay(state, ctx.playerID)) return ctx.invalid('you are not paying anything right now')
        const pend = state.public.pending!
        const payer = ctx.playerID
        const cardIds = (args as { cardIds?: string[] } | undefined)?.cardIds
        if (!Array.isArray(cardIds)) return ctx.invalid('pay expects { cardIds }')

        const table = allTableCards(state, payer)
        const chosen = cardIds.map((id) => table.find((c) => c.id === id)).filter(Boolean) as Card[]
        if (chosen.length !== cardIds.length) return ctx.invalid('you can only pay with cards on your table')
        const total = chosen.reduce((s, c) => s + c.value, 0)
        // must cover the debt, unless you're handing over everything you have
        if (total < pend.amount && chosen.length < table.length) {
          return ctx.invalid(`that is only $${total}M of the $${pend.amount}M owed`)
        }

        const brokenColors = new Set<Color>()
        for (const card of chosen) {
          const inBank = state.public.bank[payer]!.some((c) => c.id === card.id)
          if (inBank) {
            state.public.bank[payer] = state.public.bank[payer]!.filter((c) => c.id !== card.id)
            receiveCard(state, pend.by, card)
          } else {
            const found = findProp(state, payer, card.id)!
            state.public.properties[payer]![found.color] = state.public.properties[payer]![
              found.color
            ]!.filter((c) => c.id !== card.id)
            brokenColors.add(found.color)
            receiveCard(state, pend.by, card, found.color)
          }
        }
        for (const color of brokenColors) demolishIfBroken(state, payer, color)
        state.public.lastEvent = `${playerName(ctx, payer)} paid ${playerName(ctx, pend.by)} $${total}M`
        finishTarget(state, ctx)
        syncCounts(state, ctx)
      },
    },

    // --- end of turn --------------------------------------------------------
    discard: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        (state.secret[ctx.playerID]?.hand.length ?? 0) > HAND_LIMIT,
      move: (state, ctx, args) => {
        if (state.public.phase !== 'playing' || ctx.playerID !== state.public.turnPlayer) {
          return ctx.invalid('not your turn')
        }
        const cardId = (args as { cardId?: string } | undefined)?.cardId
        const card = takeFromHand(state, ctx.playerID, cardId ?? '')
        if (!card) return ctx.invalid('that card is not in your hand')
        state.internal!.discard.push(card)
        syncCounts(state, ctx)
      },
    },

    endTurn: {
      canMove: (state, ctx) =>
        state.public.phase === 'playing' &&
        ctx.playerID === state.public.turnPlayer &&
        (state.secret[ctx.playerID]?.hand.length ?? 0) <= HAND_LIMIT,
      move: (state, ctx) => {
        if (state.public.phase !== 'playing' || ctx.playerID !== state.public.turnPlayer) {
          return ctx.invalid('not your turn')
        }
        if ((state.secret[ctx.playerID]?.hand.length ?? 0) > HAND_LIMIT) {
          return ctx.invalid(`discard down to ${HAND_LIMIT} cards first`)
        }
        const next = nextPlayer(ctx, ctx.playerID)
        beginTurn(state, next, ctx.random)
        state.public.lastEvent = `${playerName(ctx, next)}'s turn`
        syncCounts(state, ctx)
        ctx.events.endTurn({ next })
      },
    },
  },

  endIf: (state, ctx) => {
    const winner = ids(ctx).find((p) => completeSets(state, p) >= SETS_TO_WIN)
    if (!winner) return undefined
    return { winner, scores: Object.fromEntries(ids(ctx).map((p) => [p, completeSets(state, p)])) }
  },
})
