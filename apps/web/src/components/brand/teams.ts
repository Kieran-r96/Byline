import type { TeamId } from '../../types/shell'

/**
 * Original fictional club identities. Not affiliated with, and deliberately
 * unlike, any real club. All backstory is synthetic demo data.
 */
export interface TeamIdentity {
  id: TeamId
  name: string
  shortName: string
  primary: string
  secondary: string
}

export const TEAMS: Record<TeamId, TeamIdentity> = {
  NBA: {
    id: 'NBA',
    name: 'Northbridge Athletic',
    shortName: 'NBA',
    primary: '#8E1F3A',
    secondary: '#F2E6D0',
  },
  RVC: {
    id: 'RVC',
    name: 'Riverton City',
    shortName: 'RVC',
    primary: '#1F6FEB',
    secondary: '#DCEBFF',
  },
}
