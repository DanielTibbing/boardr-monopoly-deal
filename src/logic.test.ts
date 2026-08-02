import { createTestMatch } from '@boardr/testkit'
import { describe, expect, it } from 'vitest'
import { Match, type PlayerID } from '@boardr/sdk'
import type { Card, Color } from './deck'
import game, { type MDPublic, type MDState } from './logic'

type Harness = ReturnType<typeof createTestMatch<MDState>>

function pub(m: Match<MDState> | Harness): MDPublic {
  const match = m instanceof Match ? m : m.match
  return (match.boardView() as { public: MDPublic }).public
}

function hand(m: Match<MDState>, p: PlayerID): Card[] {
  return (m.playerView(p) as { secret: { hand: Card[] } }).secret.hand
}

/** deterministic card factories (ids unique within a crafted state) */
let n = 0
const money = (v: number): Card => ({ id: `m${v}-${n++}`, kind: 'money', value: v, name: `$${v}M` })
const prop = (color: Color): Card => ({ id: `p-${color}-${n++}`, kind: 'property', value: 2, name: color, color })
const action = (a: Card['action'], v = 3): Card => ({ id: `a-${a}-${n++}`, kind: 'action', value: v, name: a!, action: a })

/** start a real 2–3p game, then overwrite the snapshot with an exact position */
function craft(players: number, mutate: (s: MDState) => void): Match<MDState> {
  n = 0
  const h = createTestMatch(game, { numPlayers: players, seed: 'craft' })
  const snap = h.match.snapshot()
  mutate(snap.state)
  return Match.restore(game, snap)
}

/** put `cards` in a color slot for a player */
function setProps(s: MDState, p: PlayerID, color: Color, cards: Card[]): void {
  s.public.properties[p]![color] = cards
}

describe('setup & turn basics', () => {
  it('deals 5 to each and draws the opener up to a working hand', () => {
    const h = createTestMatch(game, { numPlayers: 3, seed: 'deal' })
    const p = pub(h)
    expect(p.turnPlayer).toBe('p0')
    expect(p.handCounts['p0']).toBe(7) // 5 dealt + 2 drawn
    expect(p.handCounts['p1']).toBe(5)
    expect(p.handCounts['p2']).toBe(5)
    expect(p.deckCount).toBe(107 - 5 * 3 - 2)
  })

  it('never leaks hands or the deck to the board or other players', () => {
    const h = createTestMatch(game, { numPlayers: 2, seed: 'priv' })
    const board = JSON.stringify(h.getState())
    expect(board).not.toContain('"hand"')
    expect(board).not.toContain('"deck"')
    expect(board).not.toContain('"discard"')
    const p0 = JSON.stringify(h.getState('p0'))
    expect(p0.match(/"hand"/g)).toHaveLength(1)
  })

  it('caps plays at 3 and banks money', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [money(5), money(4), money(3), money(2)]
    })
    expect(m.dispatch('bank', { cardId: hand(m, 'p0')[0]!.id }, 'p0').ok).toBe(true)
    expect(m.dispatch('bank', { cardId: hand(m, 'p0')[0]!.id }, 'p0').ok).toBe(true)
    expect(m.dispatch('bank', { cardId: hand(m, 'p0')[0]!.id }, 'p0').ok).toBe(true)
    expect(pub(m).playsMade).toBe(3)
    // fourth play refused
    expect(m.dispatch('bank', { cardId: hand(m, 'p0')[0]!.id }, 'p0')).toMatchObject({ ok: false })
    expect(pub(m).bank['p0']!.map((c) => c.value)).toEqual([5, 4, 3])
  })

  it('plays properties and rejects a wrong colour', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [prop('red')]
    })
    const id = hand(m, 'p0')[0]!.id
    expect(m.dispatch('playProperty', { cardId: id, color: 'green' }, 'p0')).toMatchObject({ ok: false })
    expect(m.dispatch('playProperty', { cardId: id, color: 'red' }, 'p0').ok).toBe(true)
    expect(pub(m).properties['p0']!.red).toHaveLength(1)
  })

  it('refuses to bank property and wild cards', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [
        prop('red'),
        { id: 'w1', kind: 'wild', value: 3, name: 'Red/Yellow', colors: ['red', 'yellow'] },
      ]
    })
    expect(m.dispatch('bank', { cardId: hand(m, 'p0')[0]!.id }, 'p0')).toMatchObject({ ok: false })
    expect(m.dispatch('bank', { cardId: hand(m, 'p0')[1]!.id }, 'p0')).toMatchObject({ ok: false })
    expect(pub(m).bank['p0']).toHaveLength(0)
  })

  it('enforces the 7-card hand limit at end of turn', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = Array.from({ length: 9 }, () => money(1))
    })
    expect(m.dispatch('endTurn', undefined, 'p0')).toMatchObject({ ok: false })
    m.dispatch('discard', { cardId: hand(m, 'p0')[0]!.id }, 'p0')
    m.dispatch('discard', { cardId: hand(m, 'p0')[0]!.id }, 'p0')
    expect(m.dispatch('endTurn', undefined, 'p0').ok).toBe(true)
    expect(pub(m).turnPlayer).toBe('p1')
  })

  it('Pass Go draws two and counts as one play', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('passGo', 1)]
    })
    const before = pub(m).deckCount
    expect(m.dispatch('passGo', { cardId: hand(m, 'p0')[0]!.id }, 'p0').ok).toBe(true)
    expect(pub(m).handCounts['p0']).toBe(2) // -1 passGo + 2 drawn
    expect(pub(m).deckCount).toBe(before - 2)
    expect(pub(m).playsMade).toBe(1)
  })
})

describe('charges & payment', () => {
  it('Debt Collector: opens a window, target pays from the table, money moves over', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('debtCollector')]
      s.public.bank['p1'] = [money(5), money(1)]
    })
    const id = hand(m, 'p0')[0]!.id
    expect(m.dispatch('debtCollector', { cardId: id, target: 'p1' }, 'p0').ok).toBe(true)
    expect(pub(m).phase).toBe('responding')
    expect(m.actors()).toEqual(['p1'])
    // p1 has no Just Say No → accept, then pay
    expect(m.dispatch('accept', undefined, 'p1').ok).toBe(true)
    expect(pub(m).pending!.stage).toBe('pay')
    const bankIds = pub(m).bank['p1']!.map((c) => c.id)
    expect(m.dispatch('pay', { cardIds: [bankIds[0]!] }, 'p1').ok).toBe(true) // the $5
    expect(pub(m).phase).toBe('playing')
    expect(pub(m).bank['p0']!.reduce((s, c) => s + c.value, 0)).toBe(5)
    expect(pub(m).bank['p1']!.reduce((s, c) => s + c.value, 0)).toBe(1)
  })

  it('pays a debt with a wild card off the table at its printed value', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('debtCollector')]
      setProps(s, 'p1', 'red', [
        { id: 'w1', kind: 'wild', value: 3, name: 'Red/Yellow', colors: ['red', 'yellow'] },
        prop('red'),
        prop('red'),
      ])
    })
    m.dispatch('debtCollector', { cardId: hand(m, 'p0')[0]!.id, target: 'p1' }, 'p0')
    m.dispatch('accept', undefined, 'p1')
    // owes 5: the wild ($3) plus one red property ($2) covers it
    const red = pub(m).properties['p1']!.red!
    const wild = red.find((c) => c.kind === 'wild')!
    const single = red.find((c) => c.kind === 'property')!
    expect(m.dispatch('pay', { cardIds: [wild.id, single.id] }, 'p1').ok).toBe(true)
    // the wild moves to p0's table as a property, never into a bank
    expect(pub(m).bank['p0']).toHaveLength(0)
    expect(pub(m).properties['p0']!.red).toHaveLength(2)
    expect(pub(m).properties['p1']!.red).toHaveLength(1)
  })

  it('no change: paying a $5 for a $2 debt gives the whole $5', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('birthday', 2)]
      s.public.bank['p1'] = [money(5)]
    })
    m.dispatch('birthday', { cardId: hand(m, 'p0')[0]!.id }, 'p0')
    m.dispatch('accept', undefined, 'p1')
    expect(m.dispatch('pay', { cardIds: [pub(m).bank['p1']![0]!.id] }, 'p1').ok).toBe(true)
    expect(pub(m).bank['p0']![0]!.value).toBe(5) // no change given
    expect(pub(m).bank['p1']).toHaveLength(0)
  })

  it('insufficient funds: pay everything, owe nothing further', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('debtCollector')]
      s.public.bank['p1'] = [money(1)]
      setProps(s, 'p1', 'red', [prop('red')])
    })
    m.dispatch('debtCollector', { cardId: hand(m, 'p0')[0]!.id, target: 'p1' }, 'p0')
    m.dispatch('accept', undefined, 'p1')
    // owes 5, only has 1 + a property (value 2) = 3 → must hand over everything
    const all = [...pub(m).bank['p1']!, ...pub(m).properties['p1']!.red].map((c) => c.id)
    expect(m.dispatch('pay', { cardIds: all }, 'p1').ok).toBe(true)
    expect(pub(m).phase).toBe('playing')
    expect(pub(m).bank['p1']).toHaveLength(0)
    expect(pub(m).properties['p1']!.red).toHaveLength(0)
    expect(pub(m).bank['p0']!.length + pub(m).properties['p0']!.red.length).toBe(2)
  })

  it('It’s My Birthday charges every opponent in turn', () => {
    const m = craft(3, (s) => {
      s.secret['p0']!.hand = [action('birthday', 2)]
      s.public.bank['p1'] = [money(2)]
      s.public.bank['p2'] = [money(3)]
    })
    m.dispatch('birthday', { cardId: hand(m, 'p0')[0]!.id }, 'p0')
    expect(m.actors()).toEqual(['p1'])
    m.dispatch('accept', undefined, 'p1')
    m.dispatch('pay', { cardIds: [pub(m).bank['p1']![0]!.id] }, 'p1')
    expect(m.actors()).toEqual(['p2']) // advanced to the next target
    m.dispatch('accept', undefined, 'p2')
    m.dispatch('pay', { cardIds: [pub(m).bank['p2']![0]!.id] }, 'p2')
    expect(pub(m).phase).toBe('playing')
    expect(pub(m).bank['p0']!.reduce((s, c) => s + c.value, 0)).toBe(5)
  })

  it('a target with nothing to pay is skipped automatically', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('debtCollector')]
      s.public.bank['p1'] = []
    })
    m.dispatch('debtCollector', { cardId: hand(m, 'p0')[0]!.id, target: 'p1' }, 'p0')
    m.dispatch('accept', undefined, 'p1')
    expect(pub(m).phase).toBe('playing') // nothing to take, window closed
  })
})

describe('Just Say No', () => {
  it('cancels a charge, and the target keeps its money', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('debtCollector')]
      s.secret['p1']!.hand = [action('justSayNo', 4)]
      s.public.bank['p1'] = [money(5)]
    })
    m.dispatch('debtCollector', { cardId: hand(m, 'p0')[0]!.id, target: 'p1' }, 'p0')
    expect(m.dispatch('justSayNo', undefined, 'p1').ok).toBe(true)
    // now the decision bounces back to p0, who has no JSN → accept lets the block stand
    expect(m.actors()).toEqual(['p0'])
    expect(m.dispatch('accept', undefined, 'p0').ok).toBe(true)
    expect(pub(m).phase).toBe('playing')
    expect(pub(m).bank['p1']!.reduce((s, c) => s + c.value, 0)).toBe(5) // untouched
    expect(pub(m).bank['p0']).toHaveLength(0)
  })

  it('JSN can be countered by JSN — the original then applies', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('debtCollector'), action('justSayNo', 4)]
      s.secret['p1']!.hand = [action('justSayNo', 4)]
      s.public.bank['p1'] = [money(5)]
    })
    m.dispatch('debtCollector', { cardId: hand(m, 'p0').find((c) => c.action === 'debtCollector')!.id, target: 'p1' }, 'p0')
    m.dispatch('justSayNo', undefined, 'p1') // block (jsn=1)
    expect(m.actors()).toEqual(['p0'])
    m.dispatch('justSayNo', undefined, 'p0') // counter (jsn=2)
    expect(m.actors()).toEqual(['p1'])
    // p1 has no more JSN → accept, the charge stands, p1 pays
    m.dispatch('accept', undefined, 'p1')
    expect(pub(m).pending!.stage).toBe('pay')
    m.dispatch('pay', { cardIds: [pub(m).bank['p1']![0]!.id] }, 'p1')
    expect(pub(m).bank['p0']![0]!.value).toBe(5)
  })
})

describe('property actions', () => {
  it('Sly Deal steals a single card from an incomplete set', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('slyDeal')]
      setProps(s, 'p1', 'green', [prop('green')]) // incomplete (needs 3)
    })
    const steal = pub(m).properties['p1']!.green[0]!.id
    m.dispatch('slyDeal', { cardId: hand(m, 'p0')[0]!.id, target: 'p1', color: 'green', targetCardId: steal }, 'p0')
    m.dispatch('accept', undefined, 'p1') // no JSN
    expect(pub(m).properties['p1']!.green).toHaveLength(0)
    expect(pub(m).properties['p0']!.green.map((c) => c.id)).toEqual([steal])
  })

  it('Sly Deal cannot touch a completed set', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('slyDeal')]
      setProps(s, 'p1', 'darkblue', [prop('darkblue'), prop('darkblue')]) // complete (2)
    })
    const target = pub(m).properties['p1']!.darkblue[0]!.id
    expect(
      m.dispatch('slyDeal', { cardId: hand(m, 'p0')[0]!.id, target: 'p1', color: 'darkblue', targetCardId: target }, 'p0'),
    ).toMatchObject({ ok: false })
  })

  it('Deal Breaker steals an entire completed set', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('dealBreaker', 5)]
      setProps(s, 'p1', 'darkblue', [prop('darkblue'), prop('darkblue')])
    })
    m.dispatch('dealBreaker', { cardId: hand(m, 'p0')[0]!.id, target: 'p1', color: 'darkblue' }, 'p0')
    m.dispatch('accept', undefined, 'p1')
    expect(pub(m).properties['p1']!.darkblue).toHaveLength(0)
    expect(pub(m).properties['p0']!.darkblue).toHaveLength(2)
    expect(pub(m).setsWon['p0']).toBe(1)
  })

  it('Forced Deal swaps two incomplete-set properties', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('forcedDeal')]
      setProps(s, 'p0', 'red', [prop('red')])
      setProps(s, 'p1', 'green', [prop('green')])
    })
    const give = pub(m).properties['p0']!.red[0]!.id
    const take = pub(m).properties['p1']!.green[0]!.id
    m.dispatch(
      'forcedDeal',
      { cardId: hand(m, 'p0')[0]!.id, target: 'p1', color: 'green', targetCardId: take, giveColor: 'red', giveCardId: give },
      'p0',
    )
    m.dispatch('accept', undefined, 'p1')
    expect(pub(m).properties['p0']!.green.map((c) => c.id)).toEqual([take])
    expect(pub(m).properties['p1']!.red.map((c) => c.id)).toEqual([give])
  })
})

describe('rent & winning', () => {
  it('Rent charges the schedule value for the chosen colour', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [{ id: 'r1', kind: 'rent', value: 1, name: 'rent', rentColors: ['green', 'darkblue'] }]
      setProps(s, 'p0', 'green', [prop('green'), prop('green')]) // 2 greens → rent 4
      s.public.bank['p1'] = [money(4), money(1)]
    })
    m.dispatch('playRent', { cardId: 'r1', color: 'green' }, 'p0')
    expect(pub(m).pending!.amount).toBe(4)
    m.dispatch('accept', undefined, 'p1')
    m.dispatch('pay', { cardIds: [pub(m).bank['p1']![0]!.id] }, 'p1') // the $4
    expect(pub(m).bank['p0']!.reduce((s, c) => s + c.value, 0)).toBe(4)
  })

  it('wildcards can be freely moved between colours on your turn', () => {
    const m = craft(2, (s) => {
      s.public.properties['p0']!.red = [{ id: 'w1', kind: 'wild', value: 0, name: 'wild', colors: ['red', 'yellow'] }]
    })
    expect(m.dispatch('moveWild', { cardId: 'w1', color: 'yellow' }, 'p0').ok).toBe(true)
    expect(pub(m).properties['p0']!.red).toHaveLength(0)
    expect(pub(m).properties['p0']!.yellow).toHaveLength(1)
    // can't move to a colour the card doesn't allow
    expect(m.dispatch('moveWild', { cardId: 'w1', color: 'green' }, 'p0')).toMatchObject({ ok: false })
  })

  it('House and Hotel add rent to a completed set', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('house', 3), action('hotel', 4), { id: 'r1', kind: 'rent', value: 1, name: 'rent', rentColors: ['green', 'darkblue'] }]
      setProps(s, 'p0', 'green', [prop('green'), prop('green'), prop('green')]) // complete (rent 7)
      s.public.bank['p1'] = [money(10), money(5)]
    })
    expect(m.dispatch('playHouse', { cardId: hand(m, 'p0')[0]!.id, color: 'green' }, 'p0').ok).toBe(true)
    expect(m.dispatch('playHotel', { cardId: hand(m, 'p0')[0]!.id, color: 'green' }, 'p0').ok).toBe(true)
    // rent for a full green set is 7, +3 house +4 hotel = 14
    m.dispatch('playRent', { cardId: 'r1', color: 'green' }, 'p0')
    expect(pub(m).pending!.amount).toBe(14)
  })

  it('House needs a completed street set — not railroads', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('house', 3)]
      setProps(s, 'p0', 'railroad', [prop('railroad'), prop('railroad'), prop('railroad'), prop('railroad')])
      setProps(s, 'p0', 'green', [prop('green')]) // incomplete
    })
    const id = hand(m, 'p0')[0]!.id
    expect(m.dispatch('playHouse', { cardId: id, color: 'railroad' }, 'p0')).toMatchObject({ ok: false })
    expect(m.dispatch('playHouse', { cardId: id, color: 'green' }, 'p0')).toMatchObject({ ok: false })
  })

  it('Deal Breaker steals a completed set together with its house', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('dealBreaker', 5)]
      setProps(s, 'p1', 'brown', [prop('brown'), prop('brown')])
      s.public.buildings['p1']!.brown = { house: action('house', 3), hotel: null }
    })
    m.dispatch('dealBreaker', { cardId: hand(m, 'p0')[0]!.id, target: 'p1', color: 'brown' }, 'p0')
    m.dispatch('accept', undefined, 'p1')
    expect(pub(m).properties['p0']!.brown).toHaveLength(2)
    expect(pub(m).buildings['p0']!.brown.house).not.toBeNull()
    expect(pub(m).buildings['p1']!.brown.house).toBeNull()
  })

  it('paying with a property from a built set banks the building for the payer', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [action('debtCollector')]
      // p1 has a completed brown set with a house, and nothing else to pay
      setProps(s, 'p1', 'brown', [prop('brown'), prop('brown')])
      s.public.buildings['p1']!.brown = { house: action('house', 3), hotel: null }
    })
    m.dispatch('debtCollector', { cardId: hand(m, 'p0')[0]!.id, target: 'p1' }, 'p0')
    m.dispatch('accept', undefined, 'p1')
    // the house can't be handed over directly; paying the browns empties the
    // set (that's all p1 has for the $5M), so the house drops into p1's bank
    const brownIds = pub(m).properties['p1']!.brown.map((c) => c.id)
    m.dispatch('pay', { cardIds: brownIds }, 'p1')
    expect(pub(m).buildings['p1']!.brown.house).toBeNull()
    expect(pub(m).bank['p1']!.some((c) => c.action === 'house')).toBe(true)
    expect(pub(m).properties['p0']!.brown).toHaveLength(2) // browns went to the creditor
  })

  it('Double the Rent doubles the charge and uses a second play', () => {
    const m = craft(2, (s) => {
      s.secret['p0']!.hand = [
        { id: 'r1', kind: 'rent', value: 1, name: 'rent', rentColors: ['green', 'darkblue'] },
        action('doubleRent', 1),
      ]
      setProps(s, 'p0', 'green', [prop('green'), prop('green')]) // rent 4
      s.public.bank['p1'] = [money(10)]
    })
    const dbl = hand(m, 'p0').find((c) => c.action === 'doubleRent')!.id
    m.dispatch('playRent', { cardId: 'r1', color: 'green', doubleCardId: dbl }, 'p0')
    expect(pub(m).pending!.amount).toBe(8) // 4 × 2
    expect(pub(m).playsMade).toBe(2) // rent + double
  })

  it('Double the Rent is refused without two plays left', () => {
    const m = craft(2, (s) => {
      s.public.playsMade = 2 // only one play remaining
      s.secret['p0']!.hand = [
        { id: 'r2', kind: 'rent', value: 1, name: 'rent', rentColors: ['green', 'darkblue'] },
        action('doubleRent', 1),
      ]
      setProps(s, 'p0', 'green', [prop('green'), prop('green')])
    })
    const dbl = hand(m, 'p0').find((c) => c.action === 'doubleRent')!.id
    expect(m.dispatch('playRent', { cardId: 'r2', color: 'green', doubleCardId: dbl }, 'p0')).toMatchObject({
      ok: false,
    })
    // but a plain rent (one play) still works
    expect(m.dispatch('playRent', { cardId: 'r2', color: 'green' }, 'p0').ok).toBe(true)
  })

  it('the game ends the moment a player completes a third set', () => {
    const m = craft(2, (s) => {
      // two complete sets down; a third completes on this play
      setProps(s, 'p0', 'brown', [prop('brown'), prop('brown')])
      setProps(s, 'p0', 'darkblue', [prop('darkblue'), prop('darkblue')])
      setProps(s, 'p0', 'utility', [prop('utility')]) // one short
      s.secret['p0']!.hand = [prop('utility')]
    })
    expect(m.gameover).toBeNull()
    m.dispatch('playProperty', { cardId: hand(m, 'p0')[0]!.id, color: 'utility' }, 'p0')
    expect(m.gameover).toMatchObject({ winner: 'p0' })
    expect(m.gameover!.scores!['p0']).toBe(3)
  })
})
