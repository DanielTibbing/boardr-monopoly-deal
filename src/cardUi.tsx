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
    if (card.wildAny) {
      body = <span>★ any</span>
      style = { background: 'linear-gradient(135deg,#d94f9a,#e8c33a,#2f8f4e)', color: '#fff' }
    } else {
      const [c1, c2] = card.colors!
      body = <span>{COLOR_LABEL[c1!][0]}/{COLOR_LABEL[c2!][0]}</span>
      style = {
        background: `linear-gradient(135deg, ${COLOR_HEX[c1!]} 0%, ${COLOR_HEX[c1!]} 48%, #1c1f24 48%, #1c1f24 52%, ${COLOR_HEX[c2!]} 52%, ${COLOR_HEX[c2!]} 100%)`,
        color: '#fff',
        textShadow: '0 1px 2px rgba(0,0,0,0.6)'
      }
    }
  } else if (card.kind === 'rent') {
    if (card.rentAny) {
      body = <span>RENT ★</span>
      style = { background: '#3a2d55', color: '#e7dcff' }
    } else {
      const [c1, c2] = card.rentColors!
      body = <span>RENT</span>
      style = {
        background: `linear-gradient(135deg, ${COLOR_HEX[c1!]} 0%, ${COLOR_HEX[c1!]} 48%, #1c1f24 48%, #1c1f24 52%, ${COLOR_HEX[c2!]} 52%, ${COLOR_HEX[c2!]} 100%)`,
        color: '#fff',
        textShadow: '0 1px 2px rgba(0,0,0,0.6)'
      }
    }
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

export function HouseIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: '4px', color: '#4ade80' }}
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

export function HotelIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: '4px', color: '#f87171' }}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  )
}

