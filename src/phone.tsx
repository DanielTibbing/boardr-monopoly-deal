import { useState } from 'react'
import type { PhoneUiProps } from '@boardr/sdk'
import {
  canBuildOn,
  COLOR_LABEL,
  COLORS,
  HOTEL_RENT,
  HOUSE_RENT,
  rentFor,
  setComplete,
  SET_SIZE,
  type Card,
  type Color,
} from './deck'
import { CardChip, COLOR_HEX, inkOn } from './cardUi'
import type { MDPublic } from './logic'
import './phone.css'

type PhoneView = { public: MDPublic; secret: { hand: Card[] } | null }

/** an action card whose targeting is being collected step by step */
interface Flow {
  action: string
  cardId: string
  target?: string
  giveCardId?: string
  color?: Color
}

export default function Phone({ playerID, view, meta, dispatch }: PhoneUiProps<PhoneView>): React.JSX.Element {
  const p = view.public
  const me = playerID
  const myHand = view.secret?.hand ?? []
  const opponents = meta.players.filter((pl) => pl.id !== me)
  const name = (id: string): string => meta.players.find((pl) => pl.id === id)?.name ?? id

  const [sel, setSel] = useState<string | null>(null)
  const [flow, setFlow] = useState<Flow | null>(null)
  const [payIds, setPayIds] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)

  async function act(move: string, args?: unknown): Promise<void> {
    const r = await dispatch(move, args)
    if (r.ok) {
      setSel(null)
      setFlow(null)
      setPayIds([])
      setErr(null)
    } else {
      setErr(r.reason)
    }
  }

  if (meta.gameover) {
    const won = meta.gameover.winner === me
    return (
      <div className="mdp-screen mdp-center">
        <h2>{won ? 'You win! 🏛️' : 'Game over'}</h2>
        <p className="mdp-muted">{name(meta.gameover.winner as string)} completed three sets.</p>
      </div>
    )
  }

  const pend = p.pending
  const myTurn = p.phase === 'playing' && p.turnPlayer === me
  const iDecide = p.phase === 'responding' && pend?.stage === 'block' && pend.decider === me
  const iPay = p.phase === 'responding' && pend?.stage === 'pay' && pend.targets[0] === me
  const holdsJsn = myHand.some((c) => c.action === 'justSayNo')

  // ---- response: block (Just Say No or accept) ----
  if (iDecide) {
    return (
      <div className="mdp-screen">
        <Banner text={p.lastEvent ?? 'Respond'} />
        <p className="mdp-muted mdp-center-text">
          {pend!.by === me
            ? 'Your action was blocked — counter it?'
            : `${name(pend!.by)} is acting against you.`}
          {pend!.jsn > 0 ? ` (${pend!.jsn} × Just Say No so far)` : ''}
        </p>
        <div className="mdp-actions">
          {holdsJsn && (
            <button className="mdp-btn mdp-jsn" onClick={() => void act('justSayNo')}>
              Just Say No!
            </button>
          )}
          <button className="mdp-btn mdp-primary" onClick={() => void act('accept')}>
            {pend!.jsn % 2 === 1 ? 'Let the block stand' : holdsJsn ? 'Allow it' : 'OK'}
          </button>
        </div>
        {err && <p className="mdp-err">{err}</p>}
      </div>
    )
  }

  // ---- response: pay ----
  if (iPay) {
    const table = [
      ...p.bank[me]!.map((c) => ({ c, where: 'bank' as const })),
      ...COLORS.flatMap((col) => p.properties[me]![col]!.map((c) => ({ c, where: col }))),
    ]
    const total = payIds.reduce((s, id) => s + (table.find((t) => t.c.id === id)?.c.value ?? 0), 0)
    const enough = total >= pend!.amount || payIds.length === table.length
    return (
      <div className="mdp-screen">
        <Banner text={`Pay $${pend!.amount}M to ${name(pend!.by)}`} />
        <p className="mdp-muted mdp-center-text">
          Selected ${total}M — no change is given. {payIds.length === table.length ? '(everything you have)' : ''}
        </p>
        <div className="mdp-hand">
          {table.map(({ c }) => (
            <CardChip
              key={c.id}
              card={c}
              selected={payIds.includes(c.id)}
              onClick={() =>
                setPayIds((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]))
              }
            />
          ))}
          {table.length === 0 && <p className="mdp-muted">nothing to pay with</p>}
        </div>
        <button
          className="mdp-btn mdp-primary"
          disabled={!enough}
          onClick={() => void act('pay', { cardIds: payIds })}
        >
          {enough ? `Pay ${payIds.length} card${payIds.length === 1 ? '' : 's'}` : 'Select more'}
        </button>
        {err && <p className="mdp-err">{err}</p>}
      </div>
    )
  }

  // ---- not my turn ----
  if (!myTurn) {
    return (
      <div className="mdp-screen">
        <Banner text={p.turnPlayer === me ? 'Your turn' : `${name(p.turnPlayer)} is playing`} />
        <MyTable p={p} me={me} />
        <p className="mdp-muted mdp-center-text">{p.lastEvent ?? 'Waiting…'}</p>
      </div>
    )
  }

  // ---- my turn: an action is mid-targeting ----
  if (flow) return renderFlow()

  // ---- my turn: hand + controls ----
  const over = myHand.length > 7
  return (
    <div className="mdp-screen">
      <div className="mdp-statusline">
        <span>Play {p.playsMade}/3</span>
        <span>{myHand.length} in hand</span>
        <span>{p.setsWon[me]}/3 sets</span>
      </div>

      <MyTable p={p} me={me} onMoveWild={(cardId, color) => void act('moveWild', { cardId, color })} />

      <div className="mdp-hand">
        {myHand.map((c) => (
          <CardChip key={c.id} card={c} selected={sel === c.id} onClick={() => setSel(sel === c.id ? null : c.id)} />
        ))}
      </div>

      {sel && renderCardActions(myHand.find((c) => c.id === sel)!)}

      <div className="mdp-turnbar">
        {over ? (
          <span className="mdp-muted">Discard down to 7 to end (tap a card below)</span>
        ) : (
          <button className="mdp-btn" onClick={() => void act('endTurn')}>
            End turn
          </button>
        )}
      </div>
      {over && (
        <div className="mdp-hand">
          {myHand.map((c) => (
            <button key={c.id} className="mdp-discard" onClick={() => void act('discard', { cardId: c.id })}>
              discard {c.name}
            </button>
          ))}
        </div>
      )}
      {err && <p className="mdp-err">{err}</p>}
    </div>
  )

  // ---- contextual actions for a selected hand card ----
  function renderCardActions(card: Card): React.JSX.Element {
    if (card.kind === 'money' || (card.kind === 'action' && card.action !== 'justSayNo') || card.kind === 'rent') {
      // bankable + action/rent specifics below; money just banks
    }
    const btns: React.JSX.Element[] = []

    if (card.value > 0) {
      btns.push(
        <button key="bank" className="mdp-btn" onClick={() => void act('bank', { cardId: card.id })}>
          Bank ${card.value}M
        </button>,
      )
    }
    if (card.kind === 'property' || card.kind === 'wild') {
      const colors = card.kind === 'property' ? [card.color!] : card.wildAny ? COLORS : card.colors!
      for (const c of colors) {
        btns.push(
          <button key={`pp-${c}`} className="mdp-btn mdp-primary" onClick={() => void act('playProperty', { cardId: card.id, color: c })}>
            → {COLOR_LABEL[c]}
          </button>,
        )
      }
    }
    if (card.action === 'passGo') {
      btns.push(<button key="pg" className="mdp-btn mdp-primary" onClick={() => void act('passGo', { cardId: card.id })}>Play Pass Go (+2)</button>)
    }
    if (card.action === 'birthday') {
      btns.push(<button key="bd" className="mdp-btn mdp-primary" onClick={() => void act('birthday', { cardId: card.id })}>Charge everyone $2M</button>)
    }
    if (card.action === 'debtCollector') {
      btns.push(<button key="dc" className="mdp-btn mdp-primary" onClick={() => setFlow({ action: 'debtCollector', cardId: card.id })}>Charge a player $5M…</button>)
    }
    if (card.action === 'slyDeal') {
      btns.push(<button key="sd" className="mdp-btn mdp-primary" onClick={() => setFlow({ action: 'slyDeal', cardId: card.id })}>Steal a property…</button>)
    }
    if (card.action === 'forcedDeal') {
      btns.push(<button key="fd" className="mdp-btn mdp-primary" onClick={() => setFlow({ action: 'forcedDeal', cardId: card.id })}>Swap a property…</button>)
    }
    if (card.action === 'dealBreaker') {
      btns.push(<button key="db" className="mdp-btn mdp-primary" onClick={() => setFlow({ action: 'dealBreaker', cardId: card.id })}>Steal a full set…</button>)
    }
    if (card.kind === 'rent') {
      btns.push(<button key="rt" className="mdp-btn mdp-primary" onClick={() => setFlow({ action: 'rent', cardId: card.id })}>Charge rent…</button>)
    }
    if (card.action === 'house') {
      const spots = COLORS.filter((c) => canBuildOn(c) && setComplete(c, p.properties[me]![c]!.length) && !p.buildings[me]![c]!.house)
      for (const c of spots) {
        btns.push(<button key={`h-${c}`} className="mdp-btn mdp-primary" onClick={() => void act('playHouse', { cardId: card.id, color: c })}>House on {COLOR_LABEL[c]}</button>)
      }
      if (spots.length === 0) btns.push(<span key="hn" className="mdp-muted">no completed street set to build on</span>)
    }
    if (card.action === 'hotel') {
      const spots = COLORS.filter((c) => p.buildings[me]![c]!.house && !p.buildings[me]![c]!.hotel)
      for (const c of spots) {
        btns.push(<button key={`ho-${c}`} className="mdp-btn mdp-primary" onClick={() => void act('playHotel', { cardId: card.id, color: c })}>Hotel on {COLOR_LABEL[c]}</button>)
      }
      if (spots.length === 0) btns.push(<span key="hon" className="mdp-muted">need a set with a house first</span>)
    }
    if (card.action === 'doubleRent') {
      btns.push(<span key="dn" className="mdp-muted">play alongside a Rent card (offered when you charge rent)</span>)
    }
    return <div className="mdp-cardactions">{btns}</div>
  }

  // ---- multi-step targeting ----
  function renderFlow(): React.JSX.Element {
    const f = flow!
    const cancel = (
      <button className="mdp-btn mdp-cancel" onClick={() => { setFlow(null); setSel(null) }}>Cancel</button>
    )
    const pickOpponent = (label: string, onPick: (id: string) => void): React.JSX.Element => (
      <FlowStep label={label} cancel={cancel} err={err}>
        {opponents.map((o) => (
          <button key={o.id} className="mdp-btn" onClick={() => onPick(o.id)}>{o.name}</button>
        ))}
      </FlowStep>
    )
    const incompleteProps = (owner: string): Array<{ card: Card; color: Color }> =>
      COLORS.filter((c) => p.properties[owner]![c]!.length < SET_SIZE[c]).flatMap((c) =>
        p.properties[owner]![c]!.map((card) => ({ card, color: c })),
      )

    if (f.action === 'debtCollector') {
      return pickOpponent('Charge which player $5M?', (target) => void act('debtCollector', { cardId: f.cardId, target }))
    }
    if (f.action === 'dealBreaker') {
      if (!f.target) return pickOpponent('Steal a set from whom?', (target) => setFlow({ ...f, target }))
      const fullColors = COLORS.filter((c) => p.properties[f.target!]![c]!.length >= SET_SIZE[c])
      return (
        <FlowStep label={`Which completed set of ${name(f.target)}?`} cancel={cancel} err={err}>
          {fullColors.length === 0 && <p className="mdp-muted">they have no completed set</p>}
          {fullColors.map((c) => (
            <button key={c} className="mdp-btn" style={{ background: COLOR_HEX[c], color: inkOn(c) }} onClick={() => void act('dealBreaker', { cardId: f.cardId, target: f.target, color: c })}>
              {COLOR_LABEL[c]} set
            </button>
          ))}
        </FlowStep>
      )
    }
    if (f.action === 'slyDeal') {
      if (!f.target) return pickOpponent('Steal from whom?', (target) => setFlow({ ...f, target }))
      const steals = incompleteProps(f.target)
      return (
        <FlowStep label={`Take which card from ${name(f.target)}?`} cancel={cancel} err={err}>
          {steals.length === 0 && <p className="mdp-muted">nothing stealable (only completed sets)</p>}
          {steals.map(({ card, color }) => (
            <button key={card.id} className="mdp-cardbtn" onClick={() => void act('slyDeal', { cardId: f.cardId, target: f.target, color, targetCardId: card.id })}>
              <CardChip card={card} size="sm" />
            </button>
          ))}
        </FlowStep>
      )
    }
    if (f.action === 'forcedDeal') {
      if (!f.giveCardId) {
        const mine = incompleteProps(me)
        return (
          <FlowStep label="Give which of your properties?" cancel={cancel} err={err}>
            {mine.length === 0 && <p className="mdp-muted">you have no swappable property</p>}
            {mine.map(({ card }) => (
              <button key={card.id} className="mdp-cardbtn" onClick={() => setFlow({ ...f, giveCardId: card.id, color: undefined })}>
                <CardChip card={card} size="sm" />
              </button>
            ))}
          </FlowStep>
        )
      }
      if (!f.target) return pickOpponent('Swap with whom?', (target) => setFlow({ ...f, target }))
      const theirs = incompleteProps(f.target)
      const giveColor = findColor(p, me, f.giveCardId)
      return (
        <FlowStep label={`Take which card from ${name(f.target)}?`} cancel={cancel} err={err}>
          {theirs.map(({ card, color }) => (
            <button key={card.id} className="mdp-cardbtn" onClick={() => void act('forcedDeal', { cardId: f.cardId, target: f.target, color, targetCardId: card.id, giveColor, giveCardId: f.giveCardId })}>
              <CardChip card={card} size="sm" />
            </button>
          ))}
        </FlowStep>
      )
    }
    if (f.action === 'rent') {
      const card = myHand.find((c) => c.id === f.cardId)!
      const rentAmt = (c: Color): number => {
        const count = p.properties[me]![c]!.length
        let a = rentFor(c, count)
        if (setComplete(c, count)) {
          if (p.buildings[me]![c]!.house) a += HOUSE_RENT
          if (p.buildings[me]![c]!.hotel) a += HOTEL_RENT
        }
        return a
      }
      if (!f.color) {
        const choices = (card.rentAny ? COLORS : card.rentColors!).filter((c) => p.properties[me]![c]!.length > 0)
        return (
          <FlowStep label="Charge rent for which colour?" cancel={cancel} err={err}>
            {choices.length === 0 && <p className="mdp-muted">you own no matching property</p>}
            {choices.map((c) => (
              <button key={c} className="mdp-btn" style={{ background: COLOR_HEX[c], color: inkOn(c) }} onClick={() => setFlow({ ...f, color: c })}>
                {COLOR_LABEL[c]} — ${rentAmt(c)}M
              </button>
            ))}
          </FlowStep>
        )
      }
      if (card.rentAny && !f.target) {
        return pickOpponent('Charge which opponent?', (target) => setFlow({ ...f, target }))
      }
      // confirm — with an optional Double the Rent (uses a second play)
      const amount = rentAmt(f.color)
      const dbl = myHand.find((c) => c.action === 'doubleRent')
      const canDouble = !!dbl && p.playsMade + 2 <= 3
      const rentArgs = { cardId: f.cardId, color: f.color, target: f.target }
      return (
        <FlowStep label={`Charge $${amount}M rent?`} cancel={cancel} err={err}>
          <button className="mdp-btn mdp-primary" onClick={() => void act('playRent', rentArgs)}>Charge ${amount}M</button>
          {canDouble && (
            <button className="mdp-btn mdp-jsn" onClick={() => void act('playRent', { ...rentArgs, doubleCardId: dbl!.id })}>
              Double the Rent → ${amount * 2}M
            </button>
          )}
        </FlowStep>
      )
    }
    return <div />
  }
}

function findColor(p: MDPublic, player: string, cardId: string): Color | undefined {
  return COLORS.find((c) => p.properties[player]![c]!.some((x) => x.id === cardId))
}

function Banner({ text }: { text: string }): React.JSX.Element {
  return <div className="mdp-banner">{text}</div>
}

function FlowStep({
  label,
  cancel,
  err,
  children,
}: {
  label: string
  cancel: React.JSX.Element
  err: string | null
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mdp-screen">
      <Banner text={label} />
      <div className="mdp-actions">{children}</div>
      {err && <p className="mdp-err">{err}</p>}
      <div className="mdp-turnbar">{cancel}</div>
    </div>
  )
}

function MyTable({
  p,
  me,
  onMoveWild,
}: {
  p: MDPublic
  me: string
  onMoveWild?: (cardId: string, color: Color) => void
}): React.JSX.Element {
  const [moving, setMoving] = useState<string | null>(null)
  const props = p.properties[me]!
  const shown = COLORS.filter((c) => props[c].length > 0)
  return (
    <div className="mdp-mytable">
      {shown.length === 0 && <span className="mdp-muted">your properties appear here</span>}
      {shown.map((c) => (
        <div key={c} className="mdp-myset">
          <span className="mdp-setchip" style={{ background: COLOR_HEX[c], color: inkOn(c) }}>
            {COLOR_LABEL[c]} {props[c].length}/{SET_SIZE[c]}
          </span>
          {onMoveWild &&
            props[c]
              .filter((card) => card.kind === 'wild')
              .map((card) => (
                <button key={card.id} className="mdp-wildmove" onClick={() => setMoving(moving === card.id ? null : card.id)}>
                  move wild
                </button>
              ))}
        </div>
      ))}
      {moving && onMoveWild && (
        <div className="mdp-actions">
          {COLORS.map((c) => (
            <button key={c} className="mdp-btn" style={{ background: COLOR_HEX[c], color: inkOn(c) }} onClick={() => { onMoveWild(moving, c); setMoving(null) }}>
              {COLOR_LABEL[c]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
