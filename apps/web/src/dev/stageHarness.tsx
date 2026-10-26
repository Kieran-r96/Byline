import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StageHarnessApp } from './StageHarnessApp'

/** Entry for stage.html (dev and screenshots only). */
const root = document.getElementById('stage-root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <StageHarnessApp />
    </StrictMode>,
  )
}
