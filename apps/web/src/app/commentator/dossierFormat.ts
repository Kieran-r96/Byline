/** A dossier date (ISO) as broadcast notes write it: 17 Oct 2026. */
export const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export const STREAK: Record<string, string> = { unbeaten: 'Unbeaten', winning: 'Won', winless: 'Without a win', losing: 'Lost', scoring: 'Scored in', clean_sheet: 'Clean sheets in' }
