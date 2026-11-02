// Метка отдела в листе: иконка отдела в круге и значок состояния.
// Состояние читается не только по цвету: пунктирный круг ждёт, галочка значит «нет долга», восклицательный знак значит долг.
import { useEffect, useId, useRef, type CSSProperties } from 'react'
import { BookOpen, Check, GraduationCap, House, Laptop, Shield, Wallet, type LucideIcon } from 'lucide-react'
import type { DeptId, MarkState } from '../../domain/clearance'
import { useT } from '../i18n'
import { EMBLEM_PATHS, EMBLEM_VIEWBOX } from './aituEmblem'

export const DEPT_ICONS: Record<DeptId, LucideIcon> = {
  library: BookOpen,
  accounting: Wallet,
  dorm: House,
  military: Shield,
  it: Laptop,
  academic: GraduationCap,
}

interface MarkProps {
  dept: DeptId
  state: MarkState | 'identity' // identity: просто значок отдела, без состояния
  size?: number
  label?: string
  className?: string
}

export function Mark({ dept, state, size = 40, label, className = '' }: MarkProps) {
  const Icon = DEPT_ICONS[dept]
  // Анимируем только смену состояния, а не первую отрисовку: кабинет открывается без хореографии.
  const prev = useRef(state)
  const animate = useRef(false)
  if (prev.current !== state) animate.current = true
  useEffect(() => {
    prev.current = state
  }, [state])

  return (
    <span
      className={`mark mark--${state} ${animate.current ? 'mark--anim' : ''} ${className}`}
      style={{ '--size': `${size}px` } as CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.75} aria-hidden="true" />
      {(state === 'clear' || state === 'debt') && (
        <span key={state} className="mark-badge">
          {state === 'clear' ? (
            <Check strokeWidth={3.5} aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v9" />
              <circle cx="12" cy="19" r="1.6" />
            </svg>
          )}
        </span>
      )}
    </span>
  )
}

// Печать закрытого листа: эмблема AITU, номер и дата закрытия. Та же печать стоит в PDF и на странице проверки.
export function Seal({ number, closedAt, size = 180, stamped = true, label }: { number: string; closedAt: string; size?: number; stamped?: boolean; label?: string }) {
  const t = useT()
  const id = useId()
  const date = new Date(closedAt).toLocaleDateString('ru-RU')
  const ring = t('КОЛЛЕДЖ ASTANA IT UNIVERSITY · ОБХОДНОЙ ЛИСТ ЗАКРЫТ · ', 'ASTANA IT UNIVERSITY КОЛЛЕДЖІ · АЙНАЛМА ПАРАҚ ЖАБЫЛДЫ · ')
  return (
    <svg className={`seal ${stamped ? 'seal--on' : ''}`} width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={label ?? `${t('Печать', 'Мөр')}: № ${number}, ${date}`}>
      <defs>
        <path id={`ring${id}`} d="M100 100 m-77 0 a77 77 0 1 1 154 0 a77 77 0 1 1 -154 0" />
      </defs>
      {/* подложка цвета фона: печать перекрывает лист под собой, а не просвечивает */}
      <circle className="seal-ground" cx="100" cy="100" r="97.5" />
      <circle className="seal-line" cx="100" cy="100" r="96" strokeWidth="3" />
      <circle className="seal-line" cx="100" cy="100" r="62" strokeWidth="1.2" />
      <text className="seal-ring-text">
        <textPath href={`#ring${id}`} textLength="480" lengthAdjust="spacingAndGlyphs">
          {ring}
        </textPath>
      </text>
      <svg x="69" y="44" width="62" height="62" viewBox={EMBLEM_VIEWBOX}>
        {EMBLEM_PATHS.map((p, i) => (
          <path key={i} d={p.d} className={p.accent ? 'seal-emblem seal-emblem--accent' : 'seal-emblem'} />
        ))}
      </svg>
      <text className="seal-number" x="100" y="127" textAnchor="middle">
        № {number}
      </text>
      <text className="seal-date" x="100" y="145" textAnchor="middle">
        {date}
      </text>
    </svg>
  )
}
