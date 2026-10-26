import { useRef, useState } from 'react'
import type { InsightEntry } from '../../services/matchSession'
import {
  AGENT_STEPS,
  categoryLabel,
  insightText,
  isRetracted,
  pendingTitle,
  reachedSteps,
  retractionReason,
  stageInfo,
} from '../../services/matchView'
import { metricChips } from '../../services/evidence'
import { usePrefs } from '../../services/prefs'
import type { PatternCandidate, Storyline } from '../../services/schemas'
import type { TeamId } from '../../types/shell'
import { Crest } from '../brand/Crest'
import { visibleStorylines } from '../../services/storylines'
import { StorylineCard } from '../Storylines/StorylineCard'
import { StoryRadarEmpty } from './StoryRadarEmpty'
import './StoryRadar.css'
import './StoryCards.css'

export interface StoryRadarProps {
  candidates: readonly PatternCandidate[]
  insights: Readonly<Record<string, InsightEntry>>
  activeEvidenceId: string | null
  onShowEvidence: (candidateId: string) => void
  /** Which audience wording to use (same underlying facts). */
  variant?: StoryVariant
  className?: string
  /** Empty-state action: first story with a recorded real verified AI run. */
  firstStory?: { clock: string; label: string } | null
  onJumpFirstStory?: () => void
  /** Persistent storylines (shared state); per-role visibility is applied here. */
  storylines?: readonly Storyline[]
}

export type StoryVariant = 'commentator' | 'discover' | 'analyst'

const FEATURED = 3

function asTeam(id: string | null): TeamId | null {
  return id === 'NBA' || id === 'RVC' ? id : null
}

export function StagePill({ entry, candidate }: { entry: InsightEntry | undefined; candidate?: PatternCandidate }) {
  const retracted = isRetracted(candidate, entry)
  const info = retracted ? { label: 'Withdrawn', tone: 'withdrawn' as const, done: true } : stageInfo(entry)
  return (
    <span className={`stage-pill stage-pill--${info.tone}`} data-done={info.done}>
      <span className="stage-pill__mark" aria-hidden="true" />
      {info.label}
    </span>
  )
}

/** Progress strip that only fills agent steps whose stage was really received. */
export function StageSteps({ entry }: { entry: InsightEntry | undefined }) {
  const reached = reachedSteps(entry)
  const info = stageInfo(entry)
  const noneRan = info.done && reached.size === 0
  return (
    <div className="stage-steps" data-none={noneRan}>
      <ol aria-label="Agent workflow progress">
        {AGENT_STEPS.map((s) => (
          <li key={s.id} data-reached={reached.has(s.id)}>
            <span className="sr-only">
              {s.label}: {reached.has(s.id) ? 'reached' : 'not run'}
            </span>
            <span aria-hidden="true">{s.label}</span>
          </li>
        ))}
      </ol>
      {noneRan && <span className="stage-steps__note">Agents not run</span>}
    </div>
  )
}

function StoryCard({
  candidate,
  entry,
  priority,
  active,
  whyOpen,
  onToggleWhy,
  onShowEvidence,
  variant,
  embedded = false,
}: {
  embedded?: boolean
  variant: StoryVariant
  candidate: PatternCandidate
  entry: InsightEntry | undefined
  priority: boolean
  active: boolean
  whyOpen: boolean
  onToggleWhy: () => void
  onShowEvidence: () => void
}) {
  const insight = entry?.update.insight ?? null
  const team = asTeam(candidate.team_id)
  const retracted = isRetracted(candidate, entry)
  const reason = retractionReason(candidate, entry)
  const { lang } = usePrefs()
  const localTitle = insightText(insight, 'title', lang)
  const title = localTitle.text ?? pendingTitle(candidate)
  const field = variant === 'discover' ? 'fan_discover' : variant === 'analyst' ? 'fan_analyst' : 'commentator'
  const variantText = insightText(insight, field, lang)
  // Detector summaries reuse the title as the fan line; show the facts instead.
  const usable = variantText.text && variantText.text.trim() !== insight?.title.trim()
  const localClaim = usable ? variantText : insightText(insight, 'canonical_claim', lang)
  const claim = localClaim.text ?? candidate.factual_summary
  const translated = !!insight && (localTitle.translated || localClaim.translated)
  const englishOnly = lang === 'es' && !translated
  const chips = variant === 'analyst' ? metricChips((insight?.metric_provenance ?? candidate.calculated_metrics) as Record<string, unknown>).slice(0, 4) : []
  const whyId = `why-${candidate.candidate_id}`
  return (
    <article
      className="story"
      data-priority={priority && !embedded}
      data-active={active}
      data-retracted={retracted}
      data-embedded={embedded}
      aria-labelledby={`title-${candidate.candidate_id}`}
    >
      {!embedded && (
        <header className="story__meta">
          {team && <Crest teamId={team} size={20} label="" />}
          <span className="story__category">{categoryLabel(candidate)}</span>
          <span className="story__clock numeric">{candidate.display_clock}</span>
        </header>
      )}
      <h3 className="story__title" id={`title-${candidate.candidate_id}`} lang={localTitle.translated ? 'es' : 'en'}>
        {title}
      </h3>
      <div className="story__state">
        <StagePill entry={entry} candidate={candidate} />
        {variant !== 'discover' && <StageSteps entry={entry} />}
      </div>
      {retracted && (
        <p className="story__retraction">
          <strong>Withdrawn</strong>
          {reason ? ` · ${reason.replace(/[.\s]+$/, '')}` : ''}. Kept for the record; not for broadcast.
        </p>
      )}
      <p className="story__claim" data-variant={variant} lang={localClaim.translated ? 'es' : 'en'}>
        {claim}
      </p>
      {lang === 'es' && (
        <p className="story__lang" lang="es">
          {translated ? 'Traducción automática · el inglés es la versión de referencia' : englishOnly ? 'Solo en inglés' : ''}
        </p>
      )}
      {chips.length > 0 && (
        <ul className="story__chips" aria-label="Key numbers">
          {chips.map((c) => (
            <li key={c.label}>
              <span>{c.label}</span> <strong className="numeric">{c.value}</strong>
            </li>
          ))}
        </ul>
      )}
      <div className="story__actions">
        {variant === 'discover' ? (
          <span className="story__why-pending">{candidate.display_clock} · {candidate.team_id ?? ''}</span>
        ) : insight?.why_it_matters ? (
          <button
            type="button"
            className="story__why-toggle"
            aria-expanded={whyOpen}
            aria-controls={whyId}
            onClick={onToggleWhy}
          >
            Why it matters
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="story__chev">
              <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          <span className="story__why-pending">Analysis pending</span>
        )}
        <button
          type="button"
          className="story__evidence"
          onClick={onShowEvidence}
          aria-pressed={active}
          data-evidence-for={candidate.candidate_id}
        >
          {variant === 'discover' ? 'Why?' : 'Show why'}
        </button>
      </div>
      {insight?.why_it_matters && (
        <p className="story__why" id={whyId} hidden={!whyOpen}>
          {insight.why_it_matters}
        </p>
      )}
    </article>
  )
}

/**
 * Story Radar: at most three featured stories, newest first; older ones sit
 * in a compact inbox. New stories never shift content under a reader: once
 * the list is scrolled, a "why" is open or evidence is showing, they wait
 * behind an "N new" pill.
 */
export function StoryRadar({
  candidates,
  insights,
  activeEvidenceId,
  onShowEvidence,
  variant = 'commentator',
  className,
  firstStory,
  onJumpFirstStory,
  storylines = [],
}: StoryRadarProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const allIds = candidates.map((c) => c.candidate_id)
  const [visibleIds, setVisibleIds] = useState<string[]>(allIds)
  const [prevKey, setPrevKey] = useState(allIds.join('|'))
  const [scrolled, setScrolled] = useState(false)
  const [openWhy, setOpenWhy] = useState<string | null>(null)
  const engaged = scrolled || openWhy !== null || activeEvidenceId !== null

  // Adjust state while rendering when the candidate set changes (no effect).
  const key = allIds.join('|')
  if (key !== prevKey) {
    setPrevKey(key)
    const existing = new Set(allIds)
    if (!engaged) setVisibleIds(allIds)
    else setVisibleIds((ids) => ids.filter((id) => existing.has(id)))
  }

  const byId = new Map(candidates.map((c) => [c.candidate_id, c]))
  const visible = visibleIds
    .map((id) => byId.get(id))
    .filter((c): c is PatternCandidate => !!c)
    .sort((a, b) => b.detected_at_ms - a.detected_at_ms)
  const pending = allIds.filter((id) => !visibleIds.includes(id))
  // Live storylines lead; each carries its own published story. Other stories fill the remaining slots.
  const lines = visibleStorylines(storylines, variant)
  const lineOf = new Map<string, string>()
  for (const sl of lines) for (const cid of sl.candidate_ids) lineOf.set(cid, sl.storyline_id)
  // The latest story leads, even when VAR withdrew it: a correction stays visible, struck through with its reason.
  const storyOf = (ids: readonly string[]): PatternCandidate | undefined =>
    ids
      .map((id) => byId.get(id))
      .filter((c): c is PatternCandidate => !!c)
      .sort((a, b) => b.detected_at_ms - a.detected_at_ms)[0]
  const standalone = visible.filter((c) => !lineOf.has(c.candidate_id))
  const slots = Math.max(0, FEATURED - lines.length)
  const featured = standalone.slice(0, slots)
  const inbox = standalone.slice(slots)
  const lineStories = lines.map((sl) => storyOf(sl.candidate_ids))
  const live = [...featured, ...lineStories.filter((c): c is PatternCandidate => !!c)].filter(
    (c) => !isRetracted(c, insights[c.candidate_id]),
  )
  const priorityId = live.length
    ? live.reduce((best, c) => ((c.score ?? 0) > (best.score ?? 0) ? c : best)).candidate_id
    : null

  const showPending = () => {
    setVisibleIds(allIds)
    setScrolled(false)
    listRef.current?.scrollTo({ top: 0 })
  }

  const storyCard = (c: PatternCandidate, embedded: boolean) => (
    <StoryCard
      key={c.candidate_id}
      candidate={c}
      variant={variant}
      embedded={embedded}
      entry={insights[c.candidate_id]}
      priority={c.candidate_id === priorityId}
      active={activeEvidenceId === c.candidate_id}
      whyOpen={openWhy === c.candidate_id}
      onToggleWhy={() => setOpenWhy((cur) => (cur === c.candidate_id ? null : c.candidate_id))}
      onShowEvidence={() => onShowEvidence(c.candidate_id)}
    />
  )
  const tracker = lines.length > 0 && (
    <section className="radar__lines" aria-label="Storylines">
      <h3 className="label radar__section">Live storylines</h3>
      <ul className="storylines">
        {lines.map((sl, i) => {
          const c = lineStories[i]
          return (
            <StorylineCard
              key={sl.storyline_id}
              storyline={sl}
              variant={variant}
              priority={!!c && c.candidate_id === priorityId}
              story={c ? storyCard(c, true) : undefined}
            />
          )
        })}
      </ul>
    </section>
  )
  if (candidates.length === 0) {
    if (lines.length === 0) return <StoryRadarEmpty firstStory={firstStory} onJumpFirstStory={onJumpFirstStory} />
    const empty = <StoryRadarEmpty firstStory={firstStory} onJumpFirstStory={onJumpFirstStory} compact />
    return (
      <div className={['radar', className ?? ''].join(' ').trim()}>
        <div className="radar__list">
          {tracker}
          {empty}
        </div>
      </div>
    )
  }

  return (
    <div className={['radar', className ?? ''].join(' ').trim()}>
      {pending.length > 0 && (
        <button type="button" className="radar__new" onClick={showPending}>
          {pending.length} new {pending.length === 1 ? 'story' : 'stories'}
        </button>
      )}
      <div
        ref={listRef}
        className="radar__list"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
      >
        {tracker}
        {featured.length > 0 && lines.length > 0 && <h3 className="label radar__section">Stories</h3>}
        {featured.map((c) => storyCard(c, false))}
        {inbox.length > 0 && (
          <section className="radar__inbox" aria-label="Earlier stories">
            <h3 className="label radar__inbox-title">Earlier stories</h3>
            <ul>
              {inbox.map((c) => {
                const entry = insights[c.candidate_id]
                return (
                  <li key={c.candidate_id}>
                    <button
                      type="button"
                      className="radar__inbox-row"
                      data-retracted={isRetracted(c, entry)}
                      onClick={() => onShowEvidence(c.candidate_id)}
                      data-evidence-for={c.candidate_id}
                    >
                      <span className="radar__inbox-clock numeric">{c.display_clock}</span>
                      <span className="radar__inbox-text">
                        <span className="radar__inbox-name">{entry?.update.insight?.title ?? pendingTitle(c)}</span>
                        <span className="radar__inbox-cat">{categoryLabel(c)}</span>
                      </span>
                      <StagePill entry={entry} candidate={c} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
