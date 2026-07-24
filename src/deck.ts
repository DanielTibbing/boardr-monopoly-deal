/**
 * Monopoly Deal cards and the pure rules tables. A card is plain JSON with a
 * unique `id` (the deck has duplicates). This is the CORE deck: House, Hotel,
 * and Double the Rent are deferred (see rules.md), so those cards are absent
 * rather than dealt as dead weight.
 */

export type Color =
  | 'brown'
  | 'lightblue'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'darkblue'
  | 'railroad'
  | 'utility'

export const COLORS: Color[] = [
  'brown',
  'lightblue',
  'pink',
  'orange',
  'red',
  'yellow',
  'green',
  'darkblue',
  'railroad',
  'utility',
]

/** cards needed to complete each color set */
export const SET_SIZE: Record<Color, number> = {
  brown: 2,
  lightblue: 3,
  pink: 3,
  orange: 3,
  red: 3,
  yellow: 3,
  green: 3,
  darkblue: 2,
  railroad: 4,
  utility: 2,
}

/** rent charged, indexed by (cards in set − 1) */
export const RENT: Record<Color, number[]> = {
  brown: [1, 2],
  lightblue: [1, 2, 3],
  pink: [1, 2, 4],
  orange: [1, 3, 5],
  red: [2, 3, 6],
  yellow: [2, 4, 6],
  green: [2, 4, 7],
  darkblue: [3, 8],
  railroad: [1, 2, 3, 4],
  utility: [1, 2],
}

/** bank/cash value of a property card, by color */
const PROP_VALUE: Record<Color, number> = {
  brown: 1,
  lightblue: 1,
  pink: 2,
  orange: 2,
  red: 3,
  yellow: 3,
  green: 4,
  darkblue: 4,
  railroad: 2,
  utility: 2,
}

export const COLOR_LABEL: Record<Color, string> = {
  brown: 'Brown',
  lightblue: 'Light Blue',
  pink: 'Pink',
  orange: 'Orange',
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  darkblue: 'Dark Blue',
  railroad: 'Railroad',
  utility: 'Utility',
}

export type ActionType =
  | 'passGo'
  | 'dealBreaker'
  | 'slyDeal'
  | 'forcedDeal'
  | 'debtCollector'
  | 'birthday'
  | 'justSayNo'

export const ACTION_LABEL: Record<ActionType, string> = {
  passGo: 'Pass Go',
  dealBreaker: 'Deal Breaker',
  slyDeal: 'Sly Deal',
  forcedDeal: 'Forced Deal',
  debtCollector: 'Debt Collector',
  birthday: "It's My Birthday",
  justSayNo: 'Just Say No',
}

export type CardKind = 'money' | 'property' | 'wild' | 'rent' | 'action'

export interface Card {
  id: string
  kind: CardKind
  /** bank value in $M; 0 = cannot be banked (property wildcards) */
  value: number
  name: string
  /** property: its single color */
  color?: Color
  /** wildcard: the colors it may join (2-colour wild); empty + wildAny = any */
  colors?: Color[]
  wildAny?: boolean
  /** rent card: the colours it can charge for; rentAny = any one colour, single target */
  rentColors?: Color[]
  rentAny?: boolean
  action?: ActionType
}

/** true when a color slot holds a complete set */
export function setComplete(color: Color, count: number): boolean {
  return count >= SET_SIZE[color]
}

/** rent for owning `count` cards of `color` (capped at the full set) */
export function rentFor(color: Color, count: number): number {
  if (count <= 0) return 0
  const schedule = RENT[color]
  return schedule[Math.min(count, schedule.length) - 1] ?? 0
}

/** a card is bankable (as money) when it has a positive cash value */
export function bankable(card: Card): boolean {
  return card.value > 0
}

let seq = 0
function mk(card: Omit<Card, 'id'>, tag: string): Card {
  return { ...card, id: `${tag}-${seq++}` }
}

/**
 * The core deck (House/Hotel/Double-the-Rent omitted). Deterministic order;
 * shuffle it with ctx.random.shuffle.
 */
export function buildDeck(): Card[] {
  seq = 0
  const deck: Card[] = []

  // money: $10×1, $5×2, $4×3, $3×3, $2×5, $1×6
  const money: Array<[number, number]> = [
    [10, 1],
    [5, 2],
    [4, 3],
    [3, 3],
    [2, 5],
    [1, 6],
  ]
  for (const [v, n] of money) {
    for (let i = 0; i < n; i++) deck.push(mk({ kind: 'money', value: v, name: `$${v}M` }, `money${v}`))
  }

  // standard properties: SET_SIZE cards of each color
  for (const color of COLORS) {
    for (let i = 0; i < SET_SIZE[color]; i++) {
      deck.push(
        mk({ kind: 'property', value: PROP_VALUE[color], name: COLOR_LABEL[color], color }, `prop-${color}`),
      )
    }
  }

  // property wildcards (11): dual-colour pairs + two multi-colour
  const wilds: Array<[Color, Color]> = [
    ['darkblue', 'green'],
    ['lightblue', 'brown'],
    ['pink', 'orange'],
    ['pink', 'orange'],
    ['red', 'yellow'],
    ['red', 'yellow'],
    ['railroad', 'green'],
    ['railroad', 'lightblue'],
    ['railroad', 'utility'],
  ]
  for (const [a, b] of wilds) {
    deck.push(mk({ kind: 'wild', value: 0, name: `${COLOR_LABEL[a]}/${COLOR_LABEL[b]}`, colors: [a, b] }, 'wild'))
  }
  for (let i = 0; i < 2; i++) {
    deck.push(mk({ kind: 'wild', value: 0, name: 'Wild (any)', colors: [], wildAny: true }, 'wildany'))
  }

  // action cards (core set)
  const actions: Array<[ActionType, number, number]> = [
    ['passGo', 1, 10],
    ['dealBreaker', 5, 2],
    ['slyDeal', 3, 3],
    ['forcedDeal', 3, 3],
    ['debtCollector', 3, 3],
    ['birthday', 2, 3],
    ['justSayNo', 4, 3],
  ]
  for (const [action, value, n] of actions) {
    for (let i = 0; i < n; i++) {
      deck.push(mk({ kind: 'action', value, name: ACTION_LABEL[action], action }, action))
    }
  }

  // rent cards (13): colour-pair rents mirror the wild pairs, plus 3 wild rents
  const rents: Array<[Color, Color]> = [
    ['brown', 'lightblue'],
    ['brown', 'lightblue'],
    ['pink', 'orange'],
    ['pink', 'orange'],
    ['red', 'yellow'],
    ['red', 'yellow'],
    ['green', 'darkblue'],
    ['green', 'darkblue'],
    ['railroad', 'utility'],
    ['railroad', 'utility'],
  ]
  for (const pair of rents) {
    deck.push(
      mk({ kind: 'rent', value: 1, name: `Rent: ${COLOR_LABEL[pair[0]]}/${COLOR_LABEL[pair[1]]}`, rentColors: pair }, 'rent'),
    )
  }
  for (let i = 0; i < 3; i++) {
    deck.push(mk({ kind: 'rent', value: 3, name: 'Rent: any colour', rentColors: [], rentAny: true }, 'rentany'))
  }

  return deck
}
