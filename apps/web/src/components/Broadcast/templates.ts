/**
 * Graphics templates as typed data (simulated: there is no broadcast integration).
 *
 * A broadcaster supplies a template package: its own type, colour and layout tokens, its own names for
 * each field, and its own motion. BYLINE fills the template's fields from verified data only, and a
 * producer still approves every graphic. Two packages ship with the demo: BYLINE's house package and a
 * clearly fictional partner sample, so the same verified packet can be seen dressed two ways.
 */

/** Where a value on a graphic comes from. Every filled field carries one. */
export type SourceKind = 'official' | 'measured' | 'foundry' | 'history' | 'teamsheet' | 'counted'

export const SOURCE_LABEL: Record<SourceKind, string> = {
  official: 'Official match event',
  measured: 'Measured from tracking',
  foundry: 'Verified by Foundry agents',
  history: 'Fictional history',
  teamsheet: 'Team sheet',
  counted: 'Counted from official events',
}

/** The provenance dot each source uses (primitives.css `.provenance[data-source]`). */
export const SOURCE_DOT: Record<SourceKind, 'measured' | 'ai' | 'history'> = {
  official: 'measured',
  measured: 'measured',
  foundry: 'ai',
  history: 'history',
  teamsheet: 'history',
  counted: 'measured',
}

/** The verified fields BYLINE can bind to a template. */
export type FieldKey =
  | 'headline'
  | 'strap'
  | 'player'
  | 'number'
  | 'metric'
  | 'lane'
  | 'rule'
  | 'decision'
  | 'corrected'
  | 'team'
  | 'kit'
  | 'clock'
  | 'score'
  | 'on'
  | 'off'
  | 'shape'
  | 'rows'

/** Graphic families: each has its own composition and choreography. */
export type Family = 'spotlight' | 'breakthrough' | 'milestone' | 'change' | 'comparison' | 'decision' | 'story'

export const FAMILY_OF: Record<string, Family> = {
  goal_story: 'spotlight',
  tactical_moment: 'breakthrough',
  player_record: 'milestone',
  player_milestone: 'milestone',
  substitution: 'change',
  stat_comparison: 'comparison',
  referee_decision: 'decision',
  channel_pressure: 'story',
  transition_breakdown: 'story',
  full_time_recap: 'story',
}

export function familyOf(templateId: string): Family {
  return FAMILY_OF[templateId] ?? 'story'
}

export type TemplateId = 'byline' | 'northgate'

/**
 * How a graphic is laid out on the frame. The template names and choreographs each format, so a
 * broadcaster's package decides what a lower third, a corner box, a player card or a full frame looks like.
 */
export type FormatId = 'lower' | 'pip' | 'spotlight' | 'full'
export const FORMAT_IDS: FormatId[] = ['lower', 'pip', 'spotlight', 'full']

export interface FormatSpec {
  /** As the producer sees it in the format switcher. */
  name: string
  /** One line on where it sits. */
  place: string
  /** The take and take-off transition the package plays for this format (always 600 ms or less). */
  transition: 'wipe' | 'shutter' | 'push'
  ms: number
}

export interface GraphicTemplate {
  id: TemplateId
  /** As the producer sees it in the selector. */
  name: string
  /** Who supplied the package. */
  supplier: string
  /** A fictional partner sample, not a real broadcaster. */
  sample: boolean
  /** One line on what makes the package distinct. */
  note: string
  /** Read by the graphics as CSS custom properties (`--tpl-<name>`). */
  tokens: {
    plate: string
    plateInk: string
    strap: string
    strapInk: string
    accent: string
    accentInk: string
    rule: string
    display: string
    text: string
    displayStretch: string
    displayWeight: string
    radius: string
  }
  layout: {
    /** Lower thirds sit at the left title-safe edge or centred. */
    align: 'left' | 'centre'
    /** Where the score and clock bug sits. */
    bug: 'left' | 'right'
    /** Names and headlines set in capitals. */
    caps: boolean
    /** How a team is named on air. */
    teamLabel: 'short' | 'code'
    /** How a player is pictured: a shirt in kit colours, or a numeral block. */
    playerArt: 'shirt' | 'numeral'
  }
  /** The package's own field names, bound to BYLINE's verified fields. */
  slots: Record<FieldKey, string>
  /** What the package calls each graphic family. */
  families: Record<Family, string>
  /** The package's four layouts. */
  formats: Record<FormatId, FormatSpec>
  /** The layout a family airs in unless the producer picks another. */
  defaultFormat: Record<Family, FormatId>
}

const DEFAULT_FORMAT: Record<Family, FormatId> = {
  spotlight: 'lower',
  breakthrough: 'pip',
  milestone: 'lower',
  change: 'lower',
  comparison: 'full',
  decision: 'lower',
  story: 'lower',
}

export const TEMPLATES: Record<TemplateId, GraphicTemplate> = {
  byline: {
    id: 'byline',
    name: 'BYLINE house',
    supplier: 'BYLINE',
    sample: false,
    note: 'Ink plates, team-colour notch, chalk slash. Left-aligned lower thirds; wipes from the notch.',
    tokens: {
      plate: '#0d151c',
      plateInk: '#f4f1ea',
      strap: '#f4f1ea',
      strapInk: '#10171d',
      accent: '#f4f1ea',
      accentInk: '#0d151c',
      rule: 'rgba(244, 241, 234, 0.16)',
      display: "'Archivo Variable', 'Archivo', system-ui, sans-serif",
      text: "'Instrument Sans Variable', 'Instrument Sans', system-ui, sans-serif",
      displayStretch: '72%',
      displayWeight: '800',
      radius: '0.25cqw',
    },
    layout: { align: 'left', bug: 'left', caps: true, teamLabel: 'short', playerArt: 'shirt' },
    slots: {
      headline: 'Headline',
      strap: 'Strap',
      player: 'Player',
      number: 'Shirt number',
      metric: 'Key figure',
      lane: 'Telestration',
      rule: 'Law or rule',
      decision: 'Decision',
      corrected: 'What changes',
      team: 'Team',
      kit: 'Team colours',
      clock: 'Clock',
      score: 'Score',
      on: 'Player on',
      off: 'Player off',
      shape: 'Shape line',
      rows: 'Stat rows',
    },
    families: {
      spotlight: 'Player spotlight · goal',
      breakthrough: 'Tactical breakthrough',
      milestone: 'Record and milestone',
      change: 'Substitution and shape',
      comparison: 'Match comparison',
      decision: 'Refereeing decision',
      story: 'Story lower third',
    },
    formats: {
      lower: { name: 'Lower third', place: 'Bottom left, inside title-safe', transition: 'wipe', ms: 460 },
      pip: { name: 'Corner box', place: 'Upper right, over the live picture', transition: 'push', ms: 420 },
      spotlight: { name: 'Player spotlight', place: 'Full-height panel, left', transition: 'wipe', ms: 520 },
      full: { name: 'Full-screen analysis', place: 'Covers the picture inside title-safe', transition: 'wipe', ms: 560 },
    },
    defaultFormat: DEFAULT_FORMAT,
  },
  northgate: {
    id: 'northgate',
    name: 'Northgate Sports',
    supplier: 'Northgate Sports (fictional sample partner)',
    sample: true,
    note: 'A fictional partner package: white plates, ultramarine strap, centred supers, top-right bug, shutter reveals.',
    tokens: {
      plate: '#f7f6f1',
      plateInk: '#11131a',
      strap: '#2433c4',
      strapInk: '#ffffff',
      accent: '#d4f53c',
      accentInk: '#11131a',
      rule: 'rgba(17, 19, 26, 0.14)',
      display: "'Barlow Condensed', 'Archivo Variable', system-ui, sans-serif",
      text: "'Manrope', 'Instrument Sans Variable', system-ui, sans-serif",
      displayStretch: '100%',
      displayWeight: '700',
      radius: '0',
    },
    layout: { align: 'centre', bug: 'right', caps: true, teamLabel: 'code', playerArt: 'numeral' },
    slots: {
      headline: 'HEADLINE_TXT',
      strap: 'SUBLINE_TXT',
      player: 'NAME_SUPER',
      number: 'SHIRT_NO',
      metric: 'STAT_VALUE',
      lane: 'TELESTRATION_LAYER',
      rule: 'LAW_REF',
      decision: 'DECISION_TXT',
      corrected: 'OUTCOME_TXT',
      team: 'TEAM_NAME',
      kit: 'TEAM_COLOUR',
      clock: 'MATCH_CLOCK',
      score: 'SCORE_TXT',
      on: 'PLAYER_ON',
      off: 'PLAYER_OFF',
      shape: 'SHAPE_TXT',
      rows: 'STATS_TABLE',
    },
    families: {
      spotlight: 'NG Goal super',
      breakthrough: 'NG Tactics strap',
      milestone: 'NG Record',
      change: 'NG Sub board',
      comparison: 'NG Stats full-frame',
      decision: 'NG Ref watch',
      story: 'NG Story super',
    },
    formats: {
      lower: { name: 'NG Lower super', place: 'Bottom centre, inside title-safe', transition: 'shutter', ms: 420 },
      pip: { name: 'NG Corner box', place: 'Upper right, under the bug', transition: 'shutter', ms: 420 },
      spotlight: { name: 'NG Player card', place: 'Full-height panel, right', transition: 'shutter', ms: 460 },
      full: { name: 'NG Full frame', place: 'Covers the picture inside title-safe', transition: 'shutter', ms: 520 },
    },
    defaultFormat: DEFAULT_FORMAT,
  },
}

export const TEMPLATE_IDS: TemplateId[] = ['byline', 'northgate']

/** Every surface showing graphic output carries this, verbatim. */
export const SIMULATED_NOTICE = 'Simulated output · local demo · no broadcast integration'
