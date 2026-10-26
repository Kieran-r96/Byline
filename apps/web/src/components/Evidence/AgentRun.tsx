import { useState } from 'react'

import { sanitiseIssue } from '../../services/matchView'
import type { AgentTrace, Insight } from '../../services/schemas'
import './AgentRun.css'

type Step = AgentTrace['steps'][number]

const ROLE: Record<string, { title: string; does: string }> = {
  investigator: { title: 'Investigator', does: 'Gathers evidence with bounded, read-only tools' },
  analyst: { title: 'Analyst', does: 'Writes one claim and the audience versions from the dossier' },
  verifier: { title: 'Verifier', does: 'Independently checks every claim against the events' },
  deterministic_validator: { title: 'Rule check', does: 'Recomputes numbers, names and event ids (no model)' },
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function joined(v: unknown): string {
  return arr(v)
    .map((x) => str(x).trim().replace(/[.;]+$/, ''))
    .filter(Boolean)
    .join('; ')
}

function ms(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`
}

function when(epochS: number | undefined): string {
  if (!epochS) return ''
  return new Date(epochS * 1000).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function toolLabel(name: string, args: Record<string, unknown>): string {
  const ids = arr(args.event_ids)
  if (ids.length) return `${name} (${ids.length} events)`
  if (typeof args.team_id === 'string') return `${name} (${args.team_id}, ${String(args.minutes ?? '')} min)`
  if (typeof args.player_id === 'string') return `${name} (${args.player_id})`
  return name
}

function StepBody({ step }: { step: Step }) {
  const out = step.output ?? {}
  if (step.agent === 'investigator') {
    return (
      <>
        <p className="run__said">{str(out.candidate_finding)}</p>
        {arr(out.cannot_establish).length > 0 && (
          <p className="run__note">Cannot establish: {joined(out.cannot_establish)}</p>
        )}
      </>
    )
  }
  if (step.agent === 'analyst') {
    return <p className="run__said">“{str(out.canonical_claim)}”</p>
  }
  if (step.agent === 'verifier') {
    const checks = arr(out.checks) as Record<string, unknown>[]
    const verdict = str(out.verdict)
    return (
      <>
        <p className={`run__verdict run__verdict--${verdict}`}>Verdict: {verdict.replace('_', ' ')}</p>
        {checks.length > 0 && (
          <ul className="run__checks">
            {checks.slice(0, 5).map((c, i) => (
              <li key={i}>
                <span aria-label={c.supported ? 'supported' : 'not supported'}>{c.supported ? '✓' : '✗'}</span>{' '}
                {str(c.claim)}
              </li>
            ))}
          </ul>
        )}
        {arr(out.issues).length > 0 && <p className="run__note">Issues: {joined(out.issues)}</p>}
      </>
    )
  }
  if (step.agent === 'deterministic_validator') {
    const issues = arr(out.issues).map(str)
    return issues.length ? (
      <p className="run__verdict run__verdict--needs_revision">Blocked: {issues.join('; ')}</p>
    ) : (
      <p className="run__verdict run__verdict--approved">Passed: every number, name and event id checks out</p>
    )
  }
  return null
}

export interface AgentRunProps {
  trace: AgentTrace
  insight: Insight | null
}

/** How the AI reached this: the real recorded agent chain, then the same claim for each audience. */
export function AgentRun({ trace, insight }: AgentRunProps) {
  const [open, setOpen] = useState(false)
  const firstStart = trace.steps.find((s) => s.started_at)?.started_at
  const responseIds = trace.steps.flatMap((s) => s.response_ids)
  const live = trace.provider === 'foundry'
  const av = insight?.audience_variants
  const es = av?.translations ?? {}
  return (
    <div className="run">
      <p className="run__stamp">
        <span className="run__badge">{live ? 'Real Foundry run' : 'Test mock'}</span>
        {trace.cache_hit ? 'Recorded' : 'Ran'} {when(firstStart)} · <span className="run__nowrap">{trace.model_deployment ?? 'model'}</span> ·{' '}
        <span className="numeric">
          {trace.total_model_calls} model calls · {trace.total_tokens.toLocaleString('en-GB')} tokens ·{' '}
          {ms(trace.total_latency_ms)}
        </span>
        {trace.cache_hit && <> · served from cache, no new model call</>}
      </p>

      <button type="button" className="run__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Show'} how the AI reached this
      </button>

      {open && (
        <>
          <ol className="run__chain">
            {trace.steps.map((s, i) => {
              const role = ROLE[s.agent] ?? { title: s.agent, does: '' }
              return (
                <li key={`${s.agent}-${i}`} className="run__step" data-agent={s.agent}>
                  <div className="run__head">
                    <strong>
                      {role.title}
                      {s.attempt && s.attempt > 1 ? ` · revision ${s.attempt - 1}` : ''}
                    </strong>
                    <span className="run__meta numeric">
                      {s.model_calls > 0
                        ? `${s.model_calls} call${s.model_calls === 1 ? '' : 's'} · ${s.input_tokens + s.output_tokens} tokens · ${ms(s.latency_ms)}`
                        : `no model · ${ms(s.latency_ms)}`}
                    </span>
                  </div>
                  <p className="run__does">{role.does}</p>
                  {s.tool_calls.length > 0 && (
                    <p className="run__tools">
                      Tools: {s.tool_calls.map((t) => toolLabel(t.name, t.arguments)).join(' → ')}
                    </p>
                  )}
                  <StepBody step={s} />
                  {s.error && <p className="run__note">{sanitiseIssue(s.error)}</p>}
                  {s.handoff_to && <p className="run__handoff">Hands off to {s.handoff_to}</p>}
                </li>
              )
            })}
          </ol>
          {responseIds.length > 0 && (
            <p className="run__ids">
              Model response ids: {responseIds.map((r) => `${r.slice(0, 14)}…`).join(', ')}
            </p>
          )}

          {av && (
            <div className="run__lenses" aria-label="Same verified claim for each audience">
              <h4 className="run__h">One verified claim, every audience</h4>
              <dl>
                {av.commentator && (
                  <div>
                    <dt>Commentator</dt>
                    <dd>{av.commentator}</dd>
                  </div>
                )}
                {av.studio && (
                  <div>
                    <dt>Studio graphic</dt>
                    <dd>
                      <strong>{av.studio.headline}</strong> · {av.studio.subtitle}
                    </dd>
                  </div>
                )}
                {av.fan_discover && (
                  <div>
                    <dt>Fan · Discover</dt>
                    <dd>{av.fan_discover}</dd>
                  </div>
                )}
                {av.fan_analyst && (
                  <div>
                    <dt>Fan · Analyst</dt>
                    <dd>{av.fan_analyst}</dd>
                  </div>
                )}
                {es['es.fan_discover'] && (
                  <div>
                    <dt>Español (traducción automática)</dt>
                    <dd lang="es">{es['es.fan_discover']}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </>
      )}
    </div>
  )
}
