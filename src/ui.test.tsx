import { createTestMatch, renderBoardUi, renderPhoneUi } from '@boardr/testkit'
import { Match } from '@boardr/sdk'
import { describe, expect, it } from 'vitest'
import Board from './board'
import Phone from './phone'
import game, { type MDState } from './logic'

describe('UI smoke tests', () => {
  it('board renders seats and the turn line, and leaks no secrets', () => {
    const h = createTestMatch(game, { numPlayers: 2, seed: 'ui-board' })
    const { html } = renderBoardUi(Board, h.match)
    expect(html).toContain('md-seats')
    expect(html).toContain('’s turn')
    expect(html).not.toContain('"hand"')
    // no secret card ids leak into the board markup
    const p0Hand = (h.getState('p0') as { secret: { hand: Array<{ id: string }> } }).secret.hand
    for (const card of p0Hand) expect(html).not.toContain(card.id)
  })

  it('phone renders the player’s own hand', () => {
    const h = createTestMatch(game, { numPlayers: 2, seed: 'ui-phone' })
    const { html } = renderPhoneUi(Phone, h.match, 'p0')
    const hand = (h.getState('p0') as { secret: { hand: Array<{ name: string }> } }).secret.hand
    expect(hand.length).toBeGreaterThan(0)
    // one card chip per hand card (chip labels are compact, not full names)
    expect(html.match(/md-card-md/g)).toHaveLength(hand.length)
  })

  it('board shows payment value chips on tabled properties', () => {
    const h = createTestMatch<MDState>(game, { numPlayers: 2, seed: 'ui-values' })
    const snap = h.match.snapshot()
    snap.state.secret['p0']!.hand = [
      { id: 'prop-red-1', kind: 'property', value: 3, name: 'Red', color: 'red' },
    ]
    const m = Match.restore(game, snap)
    expect(m.dispatch('playProperty', { cardId: 'prop-red-1', color: 'red' }, 'p0').ok).toBe(true)
    const { html } = renderBoardUi(Board, m)
    expect(html).toContain('md-setcard-val')
    expect(html).toContain('$3')
  })
})
