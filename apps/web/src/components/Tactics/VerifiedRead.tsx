import { useState } from 'react'
import type { TacticalInsight } from '../../services/tacticalInsight'
import './VerifiedRead.css'

/**
 * Deep analysis: the Foundry agents' verified reading of a measured moment, kept visibly separate from the
 * deterministic measurements, with its real provenance one click away.
 */
export function VerifiedRead({ data, audience, lang = 'en' }: { data: TacticalInsight; audience: 'commentator' | 'studio' | 'fan'; lang?: 'en' | 'es' }) {
  const [open, setOpen] = useState(false)
  const ins = data.insight
  const prov = data.provenance
  if (!ins) return null
  const tr = ins.audience.translations ?? {}
  const es = lang === 'es'
  const text =
    audience === 'fan'
      ? (es ? tr['es.fan_plain'] : undefined) ?? ins.audience.fan_plain
      : audience === 'studio'
        ? `${ins.audience.studio_title}. ${ins.audience.studio_subtitle}`
        : (es ? tr['es.commentator'] : undefined) ?? ins.audience.commentator
  const when = prov?.finished_at_iso ? new Date(prov.finished_at_iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : null
  return (
    <section className="vread" aria-label="Deep analysis verified by Foundry agents">
      <p className="vread__kicker">
        <span className="vread__dot" aria-hidden="true" />
        Deep analysis · verified by Foundry agents
      </p>
      <p className="vread__text">{text}</p>
      {audience !== 'fan' && <p className="vread__claim">{ins.canonical_claim}</p>}
      <p className="vread__unc">
        <span>What it cannot say:</span> {ins.uncertainty}
      </p>
      <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide how it was checked' : 'How it was checked'}
      </button>
      {open && (
        <div className="vread__how">
          <p>
            Investigator, analyst and an independent verifier ({prov?.model_deployment ?? 'gpt-4.1-mini'} on Microsoft Foundry), then a deterministic rule check: every number must be one we measured, every name a player in the moment, and no outcome, probability or intent may be claimed.
          </p>
          {ins.verifier && (
            <ul className="vread__checks">
              {ins.verifier.checks.map((c) => (
                <li key={c.claim} data-ok={c.supported}>
                  {c.supported ? 'Supported' : 'Not supported'}: {c.claim}
                </li>
              ))}
            </ul>
          )}
          {ins.validator && (
            <p>
              Rule check {ins.validator.passed ? 'passed' : 'failed'}
              {ins.validator.attempts.length > 1 ? ` on draft ${ins.validator.attempts.length} (earlier draft sent back: ${ins.validator.attempts[0]?.join('; ')})` : ''}.
            </p>
          )}
          {prov && (
            <table className="vread__calls">
              <caption>
                {prov.model_calls} real model calls · {prov.input_tokens.toLocaleString('en-GB')} in / {prov.output_tokens.toLocaleString('en-GB')} out tokens · {(prov.total_latency_ms / 1000).toFixed(1)} s · about US${prov.est_cost_usd.toFixed(4)}
                {when ? ` · recorded ${when} UTC` : ''}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Latency</th>
                  <th scope="col">Tokens in/out</th>
                </tr>
              </thead>
              <tbody>
                {prov.calls.map((c, i) => (
                  <tr key={i}>
                    <td>{c.role}</td>
                    <td className="numeric">{(c.latency_ms / 1000).toFixed(1)} s</td>
                    <td className="numeric">
                      {c.input_tokens}/{c.output_tokens}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="fine">{data.notice}</p>
        </div>
      )}
    </section>
  )
}
