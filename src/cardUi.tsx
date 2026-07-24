import { COLOR_LABEL, type Card, type Color } from './deck'

export const COLOR_HEX: Record<Color, string> = {
  brown: '#8b5a2b',
  lightblue: '#7fd0e8',
  pink: '#d94f9a',
  orange: '#e08a2b',
  red: '#d0342c',
  yellow: '#e8c33a',
  green: '#2f8f4e',
  darkblue: '#2f4fae',
  railroad: '#2c2c2c',
  utility: '#9aa0a6',
}

/** ink that reads on a given color chip */
export function inkOn(color: Color): string {
  return color === 'lightblue' || color === 'yellow' || color === 'utility' ? '#12140d' : '#fff'
}

export function CardChip({
  card,
  size = 'md',
  selected = false,
  onClick,
}: {
  card: Card
  size?: 'sm' | 'md'
  selected?: boolean
  onClick?: () => void
}): React.JSX.Element {
  const cls = ['md-card', `md-card-${size}`, selected ? 'md-sel' : '', onClick ? 'md-tap' : '']
    .filter(Boolean)
    .join(' ')
  let body: React.JSX.Element
  let style: React.CSSProperties = {}
  if (card.kind === 'money') {
    body = <span className="md-money">${card.value}M</span>
    style = { background: '#2f5f3a', color: '#eafbe9' }
  } else if (card.kind === 'property') {
    body = <span>{COLOR_LABEL[card.color!]}</span>
    style = { background: COLOR_HEX[card.color!], color: inkOn(card.color!) }
  } else if (card.kind === 'wild') {
    body = <span>{card.wildAny ? '★ any' : card.colors!.map((c) => COLOR_LABEL[c][0]).join('/')}</span>
    style = { background: 'linear-gradient(135deg,#d94f9a,#e8c33a,#2f8f4e)', color: '#fff' }
  } else if (card.kind === 'rent') {
    body = <span>RENT{card.rentAny ? ' ★' : ''}</span>
    style = { background: '#3a2d55', color: '#e7dcff' }
  } else {
    body = <span className="md-action">{card.name}</span>
    style = { background: '#403322', color: '#f4e3c4' }
  }
  const el = (
    <div className={cls} style={style}>
      {body}
      {card.value > 0 && card.kind !== 'money' && <span className="md-corner">${card.value}</span>}
    </div>
  )
  return onClick ? (
    <button type="button" className="md-cardbtn" onClick={onClick}>
      {el}
    </button>
  ) : (
    el
  )
}
