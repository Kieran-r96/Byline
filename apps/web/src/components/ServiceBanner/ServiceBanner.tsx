import { Icon } from '../icons/Icon'
import './ServiceBanner.css'

export interface ServiceBannerProps {
  onRetry: () => void
}

/** Calm, professional degraded-service notice. Never shows raw errors. */
export function ServiceBanner({ onRetry }: ServiceBannerProps) {
  return (
    <div className="service-banner" role="status">
      <span className="service-banner__rule" aria-hidden="true" />
      <p className="service-banner__text">
        <strong>Live match service unavailable.</strong> <span>Retrying…</span>
      </p>
      <button type="button" className="service-banner__retry" onClick={onRetry}>
        <Icon name="refresh" size={18} />
        Retry now
      </button>
    </div>
  )
}
