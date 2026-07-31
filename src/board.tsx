import type { BoardUiProps } from '@boardr/sdk'
import { Seat } from '@boardr/sdk/ui'
import { COLOR_LABEL, COLORS, SET_SIZE, rentFor, HOUSE_RENT, HOTEL_RENT, type Card, type Color } from './deck'
import { CardChip, COLOR_HEX, inkOn, HouseIcon, HotelIcon } from './cardUi'
import type { MDPublic } from './logic'
import './board.css'

type BoardView = { public: MDPublic }

/** A single card in a set on the board — regular or wildcard */
function SetCard({ card, setColor }: { card: Card; setColor: Color }): React.JSX.Element {
  if (card.kind !== 'wild') {
    // Plain property card
    return (
      <div
        className="md-setcard"
        style={{ background: COLOR_HEX[setColor], color: inkOn(setColor) }}
        title={COLOR_LABEL[setColor]}
      >
        <span>{COLOR_LABEL[setColor][0]}</span>
      </div>
    )
  }

  if (card.wildAny) {
    return (
      <div
        className="md-setcard md-setcard-wild"
        style={{ background: 'linear-gradient(135deg,#d94f9a,#e8c33a,#2f8f4e)', color: '#fff' }}
        title="Wild (any color)"
      >
        <span>★</span>
        <span className="md-wild-badge md-wild-badge-any">any</span>
      </div>
    )
  }

  // Dual-color wildcard: show both colors, badge the "other" color
  const [c1, c2] = card.colors!
  const altColor = c1 === setColor ? c2! : c1!
  return (
    <div
      className="md-setcard md-setcard-wild"
      style={{
        background: `linear-gradient(135deg, ${COLOR_HEX[c1!]} 0%, ${COLOR_HEX[c1!]} 45%, #1c1f24 45%, #1c1f24 55%, ${COLOR_HEX[c2!]} 55%, ${COLOR_HEX[c2!]} 100%)`,
        color: '#fff',
      }}
      title={`Wildcard: ${COLOR_LABEL[c1!]} / ${COLOR_LABEL[c2!]} — placed as ${COLOR_LABEL[setColor]}`}
    >
      <span className="md-wild-initials">{COLOR_LABEL[c1!][0]}/{COLOR_LABEL[c2!][0]}</span>
      <span className="md-wild-badge" style={{ background: COLOR_HEX[altColor], color: inkOn(altColor) }}>
        also {COLOR_LABEL[altColor]}
      </span>
    </div>
  )
}

/**
 * Prominent wildcard summary shown directly under the set header.
 * Only renders when the set contains at least one wildcard — otherwise returns null.
 */
function WildSummary({ cards, setColor }: { cards: Card[]; setColor: Color }): React.JSX.Element | null {
  const wilds = cards.filter((c) => c.kind === 'wild')
  if (wilds.length === 0) return null
  return (
    <div className="md-wild-summary">
      {wilds.map((card) => {
        if (card.wildAny) {
          return (
            <span key={card.id} className="md-wild-pill md-wild-pill-any" title="Wild — can be any color">
              ★ wildcard (any color)
            </span>
          )
        }
        const [c1, c2] = card.colors!
        const altColor = c1 === setColor ? c2! : c1!
        return (
          <span
            key={card.id}
            className="md-wild-pill"
            style={{
              background: `linear-gradient(90deg, ${COLOR_HEX[c1!]} 0%, ${COLOR_HEX[c1!]} 42%, #1c1f24 42%, #1c1f24 58%, ${COLOR_HEX[c2!]} 58%, ${COLOR_HEX[c2!]} 100%)`,
              color: '#fff',
            }}
            title={`Wildcard: ${COLOR_LABEL[c1!]} / ${COLOR_LABEL[c2!]}`}
          >
            ↔ also {COLOR_LABEL[altColor]}
          </span>
        )
      })}
    </div>
  )
}

function Tableau({
  bank,
  properties,
  buildings,
  name,
  active,
  sets,
}: {
  bank: Card[]
  properties: Record<Color, Card[]>
  buildings: Record<Color, { house: Card | null; hotel: Card | null }>
  name: string
  active: boolean
  sets: number
}): React.JSX.Element {
  const bankTotal = bank.reduce((s, c) => s + c.value, 0)
  return (
    <div className={`md-seat ${active ? 'md-active' : ''}`}>
      <div className="md-seat-top">
        <span className="md-name">{name}</span>
        <span className="md-sets">
          {sets}/3 sets · bank ${bankTotal}M
        </span>
      </div>
      <div className="md-sets-row">
        {COLORS.filter((c) => properties[c].length > 0).map((c) => {
          const have = properties[c].length
          const full = have >= SET_SIZE[c]
          let rentVal = rentFor(c, have)
          if (full) {
            if (buildings[c].house) rentVal += HOUSE_RENT
            if (buildings[c].hotel) rentVal += HOTEL_RENT
          }
          return (
            <div
              key={c}
              className={`md-set ${full ? 'md-full' : ''}`}
              style={{ borderColor: COLOR_HEX[c] }}
            >
              <div className="md-set-header">
                <span className="md-set-chip" style={{ background: COLOR_HEX[c], color: inkOn(c) }}>
                  {COLOR_LABEL[c]}
                </span>
                <span className="md-set-count">
                  {have}/{SET_SIZE[c]} · ${rentVal}M
                  {buildings[c].house && <HouseIcon size={13} />}
                  {buildings[c].hotel && <HotelIcon size={13} />}
                </span>
              </div>
              {/* Wildcard notice — only shows if a wild is in this set */}
              <WildSummary cards={properties[c]} setColor={c} />
              <div className="md-set-cards">
                {properties[c].map((card) => (
                  <SetCard key={card.id} card={card} setColor={c} />
                ))}
              </div>
            </div>
          )
        })}
        {COLORS.every((c) => properties[c].length === 0) && <span className="md-muted">no property yet</span>}
      </div>
      <div className="md-bank-row">
        <span className="md-bank-label">Bank (${bankTotal}M):</span>
        <div className="md-chips">
          {bank.map((card) => (
            <CardChip key={card.id} card={card} size="sm" />
          ))}
          {bank.length === 0 && <span className="md-muted">empty</span>}
        </div>
      </div>
    </div>
  )
}

export default function Board({ view, meta }: BoardUiProps<BoardView>): React.JSX.Element {
  const p = view.public
  const { players, gameover } = meta
  const name = (id: string): string => players.find((pl) => pl.id === id)?.name ?? id

  if (gameover) {
    return (
      <div className="md-table md-center">
        <h1>🏛️ {name(gameover.winner as string)} completes three sets — wins!</h1>
      </div>
    )
  }

  const pend = p.pending

  return (
    <div className="md-table">
      <header className="md-topline">
        <span>Draw {p.deckCount} · Discard {p.discardCount}</span>
        <span className="md-turn">
          {name(p.turnPlayer)}’s turn · play {p.playsMade}/3
        </span>
        <span>First to 3 sets wins</span>
      </header>

      <section className="md-seats">
        {players.map((pl, idx) => (
          <Seat key={pl.id} index={idx} count={players.length}>
            <Tableau
              name={pl.name}
              bank={p.bank[pl.id] ?? []}
              properties={p.properties[pl.id]!}
              buildings={p.buildings[pl.id]!}
              active={pl.id === p.turnPlayer}
              sets={p.setsWon[pl.id] ?? 0}
            />
          </Seat>
        ))}

        <div className="md-center-area">
          {pend ? (
            <div className="md-pending">
              <strong>{p.lastEvent}</strong>
              <span className="md-muted">
                {pend.stage === 'block'
                  ? `waiting on ${name(pend.decider)}${pend.jsn > 0 ? ` — ${pend.jsn} × Just Say No` : ''}`
                  : `${name(pend.targets[0]!)} is paying $${pend.amount}M`}
              </span>
            </div>
          ) : (
            p.lastEvent && <div className="md-log">{p.lastEvent}</div>
          )}
        </div>
      </section>
    </div>
  )
}
