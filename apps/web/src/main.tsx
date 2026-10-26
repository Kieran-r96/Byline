import './lib/zodConfig'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import { App } from './app/App'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
