import type { BoardUiProps } from '@boardr/sdk'
import { COLOR_LABEL, COLORS, SET_SIZE, type Card, type Color } from './deck'
import { CardChip, COLOR_HEX, inkOn } from './cardUi'
import type { MDPublic } from './logic'
import './board.css'

type BoardView = { public: MDPublic }

function Tableau({
  bank,
  properties,
  name,
  active,
  sets,
}: {
  bank: Card[]
  properties: Record<Color, Card[]>
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
                {have}/{SET_SIZE[c]}
                {full ? ' ✓' : ''}
              </span>
            </div>
          )
        })}
        {COLORS.every((c) => properties[c].length === 0) && <span className="md-muted">no property yet</span>}
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

      <section className="md-seats">
        {players.map((pl) => (
          <Tableau
            key={pl.id}
            name={pl.name}
            bank={p.bank[pl.id] ?? []}
            properties={p.properties[pl.id]!}
            active={pl.id === p.turnPlayer}
            sets={p.setsWon[pl.id] ?? 0}
          />
        ))}
      </section>

      <footer className="md-legend">
        {players.map((pl) => (
          <div key={pl.id} className="md-bankrow">
            <span className="md-name">{pl.name}</span>
            <div className="md-chips">
              {(p.bank[pl.id] ?? []).map((card) => (
                <CardChip key={card.id} card={card} size="sm" />
              ))}
              {(p.bank[pl.id] ?? []).length === 0 && <span className="md-muted">empty bank</span>}
            </div>
          </div>
        ))}
      </footer>
    </div>
  )
}
