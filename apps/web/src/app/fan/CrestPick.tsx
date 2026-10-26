import { useRef } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { Crest } from '../../components/brand/Crest'
import type { WorldIndex } from '../../services/matchView'
import { asTeam } from '../liveData'

/**
 * The two club crests as one radiogroup: the way a fan picks a side, and later flips to the other side's view.
 * One tab stop; arrow keys move and select (WAI-ARIA radio pattern). "big" is the first-run picker, "compact"
 * the switch that stays beside your player. The same buttons morph between the two, so focus is never lost.
 */
export function CrestRadios({
  world,
  value,
  onChange,
  size,
  label,
}: {
  world: WorldIndex
  value: string | null
  onChange: (team: string) => void
  size: 'big' | 'compact'
  label: string
}) {
  const ids = [world.homeId, world.awayId]
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const checkedIndex = ids.indexOf(value as (typeof ids)[number])
  const move = (i: number) => {
    const next = (i + ids.length) % ids.length
    const id = ids[next]
    if (!id) return
    onChange(id)
    refs.current[next]?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(i + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(i - 1)
    else return
    e.preventDefault()
  }
  return (
    <div role="radiogroup" aria-label={label} className={`crests crests--${size}`}>
      {ids.map((id, i) => {
        const t = world.teams.get(id)
        const checked = i === checkedIndex
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (checkedIndex < 0 && i === 0) ? 0 : -1}
            className="crests__team"
            data-side={i === 0 ? 'home' : 'away'}
            style={{ '--kit': t?.kit.primary ?? '#888', '--kit-2': t?.kit.secondary ?? '#fff' } as CSSProperties}
            onClick={() => onChange(id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <Crest teamId={asTeam(id)} size={size === 'big' ? 76 : 26} label="" className="crests__crest" />
            <span className="crests__name">{size === 'big' ? (t?.name ?? id) : (t?.short_name ?? id)}</span>
            {size === 'big' && (
              <span className="crests__meta">
                {i === 0 ? 'Home' : 'Away'} · {t?.formation}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
