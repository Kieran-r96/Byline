// Imported first by main.tsx. The production Content-Security-Policy has no 'unsafe-eval'; zod v4 would
// otherwise probe `new Function` to JIT-compile object parsers (a CSP violation on every page load).
// Jitless mode validates exactly the same way without that probe (docs/security-audit.md).
import { z } from 'zod'

z.config({ jitless: true })
