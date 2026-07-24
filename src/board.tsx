import type { BoardUiProps } from '@boardr/sdk'
import { Seat } from '@boardr/sdk/ui'
import { COLOR_LABEL, COLORS, SET_SIZE, rentFor, HOUSE_RENT, HOTEL_RENT, type Card, type Color } from './deck'
import { CardChip, COLOR_HEX, inkOn, HouseIcon, HotelIcon } from './cardUi'
import type { MDPublic } from './logic'
import './board.css'

type BoardView = { public: MDPublic }

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
              <span className="md-set-chip" style={{ background: COLOR_HEX[c], color: inkOn(c) }}>
                {COLOR_LABEL[c]}
              </span>
              <span className="md-set-count">
                {have}/{SET_SIZE[c]} · ${rentVal}M
                {buildings[c].house && <HouseIcon size={13} />}
                {buildings[c].hotel && <HotelIcon size={13} />}
              </span>
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
