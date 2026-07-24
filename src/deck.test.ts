import { describe, expect, it } from 'vitest'
import { bankable, buildDeck, rentFor, setComplete, type Card } from './deck'

function counts(deck: Card[]): Record<string, number> {
  const c: Record<string, number> = {}
  for (const card of deck) c[card.kind] = (c[card.kind] ?? 0) + 1
  return c
}

describe('deck', () => {
  it('builds the core deck with unique ids and the right kind counts', () => {
    const deck = buildDeck()
    // money 20, property 28, wild 11, action 27 (core: no House/Hotel/DoubleRent), rent 13
    expect(counts(deck)).toEqual({ money: 20, property: 28, wild: 11, action: 27, rent: 13 })
    expect(deck).toHaveLength(20 + 28 + 11 + 27 + 13)
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length)
  })

  it('money totals the standard $57M spread', () => {
    const total = buildDeck()
      .filter((c) => c.kind === 'money')
      .reduce((s, c) => s + c.value, 0)
    expect(total).toBe(10 + 5 * 2 + 4 * 3 + 3 * 3 + 2 * 5 + 1 * 6)
  })

  it('is deterministic', () => {
    expect(buildDeck().map((c) => c.id)).toEqual(buildDeck().map((c) => c.id))
  })

  it('property wildcards cannot be banked, everything else with value can', () => {
    const deck = buildDeck()
    expect(deck.filter((c) => c.kind === 'wild').every((c) => !bankable(c))).toBe(true)
    expect(deck.filter((c) => c.kind === 'money').every(bankable)).toBe(true)
    expect(deck.filter((c) => c.kind === 'action').every(bankable)).toBe(true)
  })

  it('setComplete respects each colour’s size', () => {
    expect(setComplete('brown', 2)).toBe(true)
    expect(setComplete('brown', 1)).toBe(false)
    expect(setComplete('railroad', 3)).toBe(false)
    expect(setComplete('railroad', 4)).toBe(true)
    expect(setComplete('green', 5)).toBe(true) // extra cards still count as complete
  })

  it('rentFor reads the schedule and caps at the full set', () => {
    expect(rentFor('green', 0)).toBe(0)
    expect(rentFor('green', 1)).toBe(2)
    expect(rentFor('green', 3)).toBe(7)
    expect(rentFor('green', 9)).toBe(7) // capped
    expect(rentFor('darkblue', 2)).toBe(8)
    expect(rentFor('railroad', 4)).toBe(4)
  })
})
