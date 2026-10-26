import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AgentTraceSchema, InsightSchema } from '../../services/schemas'
import { AgentRun } from './AgentRun'

// Shaped like apps/api/recorded/insights/*.json (a real recorded Foundry run).
const trace = AgentTraceSchema.parse({
  case_id: 'C-1',
  provider: 'foundry',
  model_deployment: 'gpt-4.1-mini',
  total_model_calls: 5,
  total_tokens: 7990,
  total_latency_ms: 18536,
  cache_hit: true,
  steps: [
    {
      agent: 'investigator', attempt: 1, started_at: 1792529629.9, latency_ms: 8700, model_calls: 2,
      input_tokens: 3000, output_tokens: 400, response_ids: ['chatcmpl-abcdefghijklmnop'],
      tool_calls: [{ name: 'get_events', arguments: { event_ids: ['e1', 'e2', 'e3'] } }],
      output: { candidate_finding: 'Northbridge overloaded the left.', cannot_establish: ['intent'] },
      handoff_to: 'analyst',
    },
    {
      agent: 'analyst', attempt: 1, latency_ms: 4300, model_calls: 1, input_tokens: 2000, output_tokens: 500,
      output: { canonical_claim: 'Three left-side entries in four minutes.' }, handoff_to: 'verifier',
    },
    {
      agent: 'verifier', attempt: 1, latency_ms: 4200, model_calls: 2, input_tokens: 1800, output_tokens: 290,
      output: { verdict: 'approved', checks: [{ claim: 'Three entries', supported: true }], issues: [] },
    },
    { agent: 'deterministic_validator', attempt: 1, latency_ms: 3, output: { issues: [] } },
  ],
})

const insight = InsightSchema.parse({
  insight_id: 'I-1', candidate_id: 'P-1', match_id: 'BYLINE-01', status: 'verified', insight_type: 'tactical', title: 'Left overload',
  canonical_claim: 'Three left-side entries in four minutes.', why_it_matters: 'x', certainty: 'high',
  evidence_event_ids: ['e1'], metric_provenance: {}, verification: { verdict: 'approved', issues: [], checker_name: 'verifier' },
  audience_variants: {
    commentator: 'Northbridge keep going down the left.',
    fan_discover: 'They keep attacking one side.',
    fan_analyst: '3 entries, 4 minutes.',
    studio: { headline: 'LEFT OVERLOAD', subtitle: '3 entries in 4 min' },
    translations: { 'es.fan_discover': 'Siguen atacando por un lado.' },
  },
})

describe('AgentRun', () => {
  it('labels a cached run as recorded and states no new model call was made', () => {
    render(<AgentRun trace={trace} insight={insight} />)
    expect(screen.getByText('Real Foundry run')).toBeInTheDocument()
    expect(screen.getByText(/served from cache, no new model call/)).toBeInTheDocument()
    expect(screen.getByText(/5 model calls · 7,990 tokens · 18\.5 s/)).toBeInTheDocument()
    expect(screen.queryByText('Investigator')).not.toBeInTheDocument()
  })

  it('walks the agent chain and shows the same claim for each audience', async () => {
    render(<AgentRun trace={trace} insight={insight} />)
    await userEvent.click(screen.getByRole('button', { name: /show how the ai reached this/i }))
    expect(screen.getByText('Investigator')).toBeInTheDocument()
    expect(screen.getByText(/get_events \(3 events\)/)).toBeInTheDocument()
    expect(screen.getByText('Hands off to analyst')).toBeInTheDocument()
    expect(screen.getByText('Verdict: approved')).toBeInTheDocument()
    expect(screen.getByText(/Passed: every number/)).toBeInTheDocument()
    expect(screen.getByText('no model · 3 ms')).toBeInTheDocument()
    expect(screen.getByText(/chatcmpl-abcde…/)).toBeInTheDocument()
    expect(screen.getByText('LEFT OVERLOAD')).toBeInTheDocument()
    expect(screen.getByText('Siguen atacando por un lado.')).toHaveAttribute('lang', 'es')
  })

  it('does not claim a recording when the run is fresh', () => {
    render(<AgentRun trace={{ ...trace, cache_hit: false }} insight={null} />)
    expect(screen.queryByText(/served from cache/)).not.toBeInTheDocument()
    expect(screen.getByText(/^Ran /, { exact: false })).toBeInTheDocument()
  })
})
