# BYLINE. High-End Visual and Interaction Specification
**This is a directive, not a request for moodboards. Build these qualities into functioning screens.**

## Experience thesis
A great broadcast viewer should say: **This feels like software professional commentators, broadcasters and football fans would actually want to touch.** Not an investor pitch slide. Not an admin dashboard. Premium restraint and instant usefulness are the differentiator. The main screen should visually communicate football first, machine intelligence second.

## Creative direction
Imagine a carefully-designed football broadcast graphics suite crossed with a premium sports editorial magazine. Commanding midnight background, crisp editorial grid, enormous readable numbers, beautifully crafted original team identities, controlled cinematic grass visuals, brass/gold highlight, subtle teal live-system status. Glass effects only where they genuinely improve layering; never cover readability with blur. Editorial clarity over ostentatious sci-fi decoration.

### Colour usage discipline
- 70% dark navy/ink, 20% warm white/soft panels and typography, <=10% special accents.
- Gold conveys a moment worth noticing or current selection; teal indicates verified detection / live flow; red marks card or critical event only.
- Off-white rather than stark white, no neon green text on green grass, no gradient behind every module.
- Team colours are strong but contained within original crests, score blocks and markers; avoid competing with amber highlights.

### Typography and numbers
- Brand BYLINE: custom wordmark in a licensed geometric sans. Subtitle `MATCH INTELLIGENCE` in subtle tracked lettering.
- Clock / score: large high-weight numerals, tabular digits, minimal ornaments. Score always readable from the other side of a desk.
- Insight title: 18-24px desktop, short, verb-led. Large team headline 26-36px; card labels 11-12px uppercase tracking only for utility metadata.
- Body content 14-16px with 1.5 line height for iPad; never long paragraphs in live card.
- Don't use title-sized UI everywhere. Hierarchy should be immediate.

## Desktop spatial layout
- Header fixed height ~72px: left BYLINE mark, centre fixture/score/clock, right compact role switch, settings, synthetic status.
- Hero Match Theatre in central main column. Show richly rendered playable synthetic 2D football simulation. Full width whenever Fan Classic.
- Adjacent insights sidecar ~360px maximum in Commentator or Analyst; collapsible. Information never obscures goalmouth on hero stage.
- Under theatre, thin timeline with meaningful small markers for goals, caution, red, VAR, penalty and AI stories. Hover/tap reveals exact moment and title. Clicking marker seeks replay.
- Companion pane uses 3 strong pieces of information. Never show 12 tiny graphs at once.

## Tablet landscape / portrait
- Designed as a **commentary iPad companion**. Portrait: condensed hero pitch in upper region, split tabs for Team 1 | Team 2, big formation grid. Detail slides from right or bottom and retains position.
- 44px minimum touch targets; player shirt numbers ideally 48-56px; crest tap area at least 72px. Name label must not collide. Glanceable orientation.
- Swap teams in 1 tap, player detail in second tap. Mark Used in third action; in context it's a thumb-reachable control.

## Fan mobile
- Match presentation leads with clean score and synthetic replay. Player selection from contextual sheet, optional Story Radar collapsed behind one unobtrusive `Discover` tab.
- Classic is truly passive: only normal match score and controls, **zero forced AI overlays**.
- Discover gives one small unobtrusive notification dot or tab when meaningful new insight appears. No gambling links or betting nudges.
- Analyst adds bottom sheet with event evidence and reconstructed sequences, controls stay close to thumb zone.

## Component-level blueprint

**1. Match theatre**: Animated Canvas pitch with convincing alternating mow lines, carefully shaded boundary, soft stadium vignette and premium broadcast camera framing; 22 player markers can be stylised miniature shirt silhouettes, shaded chips, or clean readable team-coloured glyphs. Their movement is interpolated, not teleported. Ball is small but high contrast with subtle path line on replay. Score/time and AI graphic overlay are DOM layers above canvas so accessible and crisp. No jagged hard-coded SVG field placeholder. Use Canvas 2D and CSS first; add 3D only if zero-risk proof exists.

**2. Studio graphics**: No glitter. Dark editorial plate with large title, optional club-colour edge, narrow gold timeline marker. Show a small live preview in the queue, clear `Review` and `Approve` actions. The on-air mock graphic respects bottom third safe margin, font scales with viewport. It only appears in studio demo with approval.

**3. Story Radar**: Smart signal not alarm feed. At most three stories: `The pattern`, `The evidence`, `Why it matters`. Text ~1.5 lines each. Candidate state stays in visual queue with progress indicator that does not fake agent outcome. Highest priority candidate gets tasteful gold vertical rule. Sidecar can disappear with one action.

**4. Evidence drawer**: Two sections: timeline of exact source events and a replay window highlighting the relevant attacking channel/players when coordinates exist. Evidence chip `E031, E040, E049`; source of numeric calculations. The drawer has a bold `What we know` and subtle `What we cannot establish` note. Good tool for judges to assess explainability.

**5. Commentary formation**: 4-2-3-1/4-3-3 layout based on seeded lineup roles, each starting shirt number in a touch target, player surnames legible. Drawer header features original photo-free player ident (initials/card), club, shirt number and tiny role; factual panels for Quick, Records, Stories, Match. Fact cards with `Pin`, `Mark Used`, `Undo`, `Sources`; no scrolling through 40 stats.

**6. Match decisions**: Bold event types `YELLOW CARD`, `SECOND YELLOW`, `OFFSIDE`, `PENALTY`, `VAR CHECK`, `DIRECT FREE KICK`, `INDIRECT FREE KICK`. Outcome card: action, official explanation, relevant Law version and impact. Show when decision is provisional. Scoreline should never appear confirmed if check ongoing.

**7. Fan control**: Three-state toggle `Classic | Discover | Analyst` visibly changes BOTH density and wording. Persistent viewer preference. Favourite team/participant selection filters relevance rather than inventing facts.

**8. Recap**: Editorial cover moment with large score, concise headline, three annotated turning points, match 'story of the night', discipline timeline where relevant. Not a chaotic stat sheet. A `Sources` link expands event citations.

## Interaction standards
- Seek/rewind UI responds without rerendering entire DOM tree on every animation frame.
- Avoid network-dependence for every rendered movement. Draw animated positions from recent frames in browser and interpolate.
- Low bandwidth/reduced motion fallback still shows score/event timeline and core info.
- Sticky reading drawers never close because a new event arrives. When latest story appears, a badge increments until user elects to view.
- Error states should sound professional: `Live AI insight is temporarily unavailable. Match events remain available.` not giant red stack traces.
- No gradient button farms. Flat outline vs filled buttons used intentionally by action priority.

## Screenshot review rubric: reject a design if
- The pitch looks like a school diagram with dots drawn inside a plain rectangle.
- The app looks like a SaaS CRM/admin template with football text pasted in.
- A commentator must pinch-zoom or hunt for a tiny clickable shirt number.
- The interface produces overlays every few seconds with no user opt-in.
- Most of screen real estate is arbitrary charts or giant decorative panels, not football.
- Decorative icons or coloured badges dominate typography.
- Contrast is poor; sensitive red/yellow status depends only on colour.
- It isn't obvious which controls are touchable or which element has focus.
- Empty/missing values show `undefined`, no-data fake metrics or visibly broken placeholder assets.

## Developer acceptance proof
Screenshots with working data and live engine at desktop 1440x900, iPad-like 1024x768/820x1180 and iPhone-like 390x844. Short clip of match event -> candidate -> evidence; clip of formation -> fact -> Used; clip of studio approval -> overlay; clip of fan Classic vs Discover. If there's a tradeoff, choose one finished pixel-perfect end-to-end screen over five generic incomplete panels.
