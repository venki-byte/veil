import labReport from '../../../samples/lab-report.txt?raw'
import loanLetter from '../../../samples/loan-sanction-letter.txt?raw'
import rentalAgreement from '../../../samples/rental-agreement.txt?raw'
import type { IconName } from '../../components/Icon'

export interface Sample {
  id: string
  title: string
  description: string
  icon: IconName
  text: string
}

/**
 * Synthetic documents for trying Veil. Every person, number and address in
 * them is invented.
 */
export const SAMPLES: Sample[] = [
  {
    id: 'lab-report',
    title: 'Blood test report',
    description: 'Blood count, sugar, cholesterol and thyroid results with a few values out of range.',
    icon: 'file',
    text: labReport,
  },
  {
    id: 'rental-agreement',
    title: 'Rental agreement',
    description: 'An 11-month leave and licence agreement with a lock-in, deposit terms and late fees.',
    icon: 'file',
    text: rentalAgreement,
  },
  {
    id: 'loan-sanction-letter',
    title: 'Home loan sanction letter',
    description: 'A floating-rate loan offer with fees, a validity deadline and eight conditions.',
    icon: 'file',
    text: loanLetter,
  },
]
