import { describe, expect, it } from 'vitest'
import { detectWithRegex } from './regex'
import labReport from '../../samples/lab-report.txt?raw'
import rental from '../../samples/rental-agreement.txt?raw'
import loan from '../../samples/loan-sanction-letter.txt?raw'

const found = (text: string) => detectWithRegex(text).map((span) => [span.text, span.type])
const values = (text: string) => detectWithRegex(text).map((span) => span.text)

describe('detectWithRegex: contact details', () => {
  it('finds email addresses', () => {
    expect(found('Write to asha.verma+tax@mail.example.com.')).toEqual([
      ['asha.verma+tax@mail.example.com', 'CONTACT'],
    ])
  })

  it.each([
    ['9876543210'],
    ['98765 43210'],
    ['+91 98765 43210'],
    ['+91-9876543210'],
    ['(080) 4123 5567'],
    ['555-123-4567'],
    ['044 2811 4477'],
  ])('finds the phone number %s', (phone) => {
    expect(found(`Call ${phone} today`)).toEqual([[phone, 'CONTACT']])
  })
})

describe('detectWithRegex: identifiers and accounts', () => {
  it('finds a PAN', () => {
    expect(found('PAN: ABCPK4821L')).toEqual([['ABCPK4821L', 'ID']])
  })

  it('finds an Aadhaar-style number', () => {
    expect(found('Aadhaar 4821 7730 9165 verified')).toEqual([['4821 7730 9165', 'ID']])
  })

  it('finds a US social security number', () => {
    expect(found('SSN 123-45-6789')).toEqual([['123-45-6789', 'ID']])
  })

  it('finds bank account numbers and IFSC codes', () => {
    expect(found('account 50100482913377, IFSC HDFC0001742.')).toEqual([
      ['50100482913377', 'ACCOUNT'],
      ['HDFC0001742', 'ACCOUNT'],
    ])
  })

  it('finds an account number written straight after "No."', () => {
    expect(values('A/c No.50100482913377')).toContain('50100482913377')
  })

  it('finds a card number', () => {
    expect(found('Card 4111 1111 1111 1111 charged')).toEqual([['4111 1111 1111 1111', 'ACCOUNT']])
  })

  it('finds ID-shaped reference numbers', () => {
    expect(values('Patient ID: SDL-20261187, Ref: NHF/HL/2026/0048817')).toEqual([
      'SDL-20261187',
      'NHF/HL/2026/0048817',
    ])
  })

  it('ignores common non-personal codes', () => {
    expect(values('ISO-9001 certified in FY2025-26 during COVID-19')).toEqual([])
  })
})

describe('detectWithRegex: dates', () => {
  it('marks a date after a birth cue as a date of birth', () => {
    expect(found('Date of Birth: 14/08/1973')).toEqual([['14/08/1973', 'DATE_OF_BIRTH']])
    expect(found('DOB 14-Aug-1973')).toEqual([['14-Aug-1973', 'DATE_OF_BIRTH']])
    expect(found('born on March 3, 1990')).toEqual([['March 3, 1990', 'DATE_OF_BIRTH']])
  })

  it('marks other dates as plain dates', () => {
    expect(found('Due by 10 February 2027.')).toEqual([['10 February 2027', 'DATE']])
    expect(found('Report Date: 2026-11-10')).toEqual([['2026-11-10', 'DATE']])
  })

  it('does not carry a birth cue over to the next line', () => {
    const spans = found('Date of Birth:\nReport Date: 10/11/2026')
    expect(spans).toEqual([['10/11/2026', 'DATE']])
  })

  it('does not mistake a date and time for a phone number', () => {
    expect(found('Collected: 09/11/2026 07:40')).toEqual([['09/11/2026', 'DATE']])
  })

  it('still finds a phone number that follows a date', () => {
    expect(found('2026-11-16 9876543210')).toEqual([
      ['2026-11-16', 'DATE'],
      ['9876543210', 'CONTACT'],
    ])
  })
})

describe('detectWithRegex: postal codes on their own', () => {
  const found = (text: string) => detectWithRegex(text).map((span) => span.text)

  it('hides a PIN code after a place name', () => {
    expect(found('Tiruchirappalli 620 017')).toEqual(['620 017'])
    expect(found('Service address No. 9, Lake Road, Madurai 625 002 ')).toContain('625 002')
  })

  it('hides a PIN code after a label, even without a space', () => {
    expect(found('Pincode: 641018')).toEqual(['641018'])
    expect(found('PIN 560 038')).toEqual(['560 038'])
    expect(found('ZIP code - 500084')).toEqual(['500084'])
  })

  it('does not hide amounts or other six-digit numbers', () => {
    expect(found('Total 125000 due')).toEqual([])
    expect(found('Platelets 150000')).toEqual([])
    expect(found('Balance Rs 100000')).toEqual([])
  })
})

describe('detectWithRegex: other countries', () => {
  const found = (text: string) => detectWithRegex(text).map((span) => span.text)

  it('hides a US street address ending in a state and ZIP code', () => {
    expect(found('Property: 123 Main St, Springfield, IL 62701.')).toContain('123 Main St, Springfield, IL 62701')
    expect(found('Mail to 88 Oak Avenue, Apt 4, Austin TX 78701-1234')).toContain('88 Oak Avenue, Apt 4, Austin TX 78701-1234')
  })

  it('hides a UK postcode', () => {
    expect(found('The flat at 10 Downing Street, London SW1A 2AA is let')).toContain('SW1A 2AA')
    expect(found('Office: M1 1AE')).toContain('M1 1AE')
  })

  it('hides IBANs and UK National Insurance numbers', () => {
    expect(found('IBAN GB82 WEST 1234 5698 7654 32 for payment')).toContain('GB82 WEST 1234 5698 7654 32')
    expect(found('NI number AB 12 34 56 C')).toContain('AB 12 34 56 C')
  })

  it('leaves ordinary text and numbers alone', () => {
    expect(found('Section 12 of the Act applies in the 2026 season')).toEqual([])
    expect(found('Page 5 of 10, item 3A, grade A1')).toEqual([])
  })
})

describe('detectWithRegex: what must stay visible', () => {
  it('leaves amounts alone', () => {
    expect(values('Loan of Rs. 62,00,000 at 8.85% with EMI Rs. 55,180')).toEqual([])
    expect(values('Total 125000000.50 due')).toEqual([])
  })

  it('leaves lab values and ranges alone', () => {
    expect(values('Haemoglobin 10.8 g/dL 12.0 - 15.0 LOW')).toEqual([])
    expect(values('Total WBC Count 7,400 cells/cumm 4,000 - 11,000')).toEqual([])
    expect(values('Platelets 150000 45 120 88')).toEqual([])
  })
})

describe('detectWithRegex: labelled values', () => {
  it('finds a name after a label and leaves the honorific and next field out', () => {
    const spans = found('Patient Name: Mrs. Meenakshi Raghavan          Age/Sex: 52 Y / Female')
    expect(spans).toEqual([['Meenakshi Raghavan', 'PERSON']])
  })

  it('finds names after role labels', () => {
    expect(values('Tenant: Ms. Farah Siddiqui\nGuarantor - Rohan Mathew')).toEqual([
      'Farah Siddiqui',
      'Rohan Mathew',
    ])
  })

  it('finds a name after "Verified by" and stops at the qualification', () => {
    expect(found('Verified by: Dr. Kavitha Subramaniam, MD (Pathology), Reg. No. KMC-48213')).toEqual([
      ['Kavitha Subramaniam', 'PERSON'],
      ['KMC-48213', 'ID'],
    ])
  })

  it('finds a name after a personal title anywhere in the text', () => {
    expect(values('To,\nMr. Karthik Venugopal\nCo-applicant')).toEqual(['Karthik Venugopal'])
    expect(values('Mrs. Raghavan is advised to see Dr. Deshpande at the earliest.')).toEqual([
      'Raghavan',
      'Deshpande',
    ])
    expect(values('The doctor will call. Dr. is a title.')).toEqual([])
  })

  it('treats a lettered reference with hyphenated digits as one ID', () => {
    expect(found('Application No. APP-2026-338104 received')).toEqual([['APP-2026-338104', 'ID']])
  })

  it('finds a name in a letter salutation but not a generic one', () => {
    expect(found('Dear Mr. Venugopal,\nYour loan')).toEqual([['Venugopal', 'PERSON']])
    expect(values('Dear Customer,\nYour loan')).toEqual([])
    expect(values('Dear Sir/Madam,')).toEqual([])
  })

  it('finds a parent name after S/o or D/o', () => {
    expect(values('Farah, D/o Imran Siddiqui residing')).toContain('Imran Siddiqui')
  })

  it('ignores labels whose value is not a name', () => {
    expect(values('Name: hemoglobin test')).toEqual([])
    expect(values('Tenant-occupied premises are excluded')).toEqual([])
  })

  it('hides a whole address after an address label, including its PIN code', () => {
    const spans = found('Address: Flat 302, Shantiniketan Apartments, Karve Road, Pune 411004\nNext')
    expect(spans).toEqual([
      ['Flat 302, Shantiniketan Apartments, Karve Road, Pune 411004', 'ADDRESS'],
    ])
  })
})

describe('detectWithRegex: addresses without a label', () => {
  const addresses = (text: string) => detectWithRegex(text).filter((span) => span.type === 'ADDRESS').map((span) => span.text)

  it.each([
    '14, Lake View Road, Indiranagar, Bengaluru 560038',
    'Flat 5C, Maple Residency, Kondapur, Hyderabad 500084',
    'House No. 218, Sector 21-C, Chandigarh 160022',
    '47 Tilak Marg, C-Scheme, Jaipur 302001',
    'B-1204, Orchid Heights, Link Road, Malad West, Mumbai 400064',
    'Chamber 14, District Court Complex, Coimbatore 641018',
    '22 Avinashi Road, Peelamedu, Coimbatore 641004',
  ])('finds %s inside a sentence', (address) => {
    expect(addresses(`He lives at ${address}. Please write to him there.`)).toEqual([address])
  })

  it('finds the address at the start of a line and stops at the line end', () => {
    expect(addresses('SUNRISE LAB\n14, Lake View Road, Indiranagar, Bengaluru 560038\nPhone: 98450 12367')).toEqual([
      '14, Lake View Road, Indiranagar, Bengaluru 560038',
    ])
  })

  it('does not swallow the words before a flat number', () => {
    expect(addresses('Purpose: Purchase of Flat B-904, Palm Grove Heights, Sholinganallur, Chennai 600119.')).toEqual([
      'Flat B-904, Palm Grove Heights, Sholinganallur, Chennai 600119',
    ])
  })

  it('hides the whole address as one unit, not the PIN code separately', () => {
    const spans = detectWithRegex('Send to 14, Lake View Road, Indiranagar, Bengaluru 560038 today')
    expect(spans.map((span) => span.type)).toEqual(['ADDRESS'])
  })

  it.each([
    'The loan of Rs. 62,00,000 is for 240 months at 8.85% with an EMI of Rs. 55,180.',
    'On 12 November 2026, the report was released, and the patient was told, in person, to return.',
    'The 5th floor, the lift, the stairs and the gate are shared by all tenants.',
    'Haemoglobin 10.8, MCV 74, platelets 2.6, WBC 7,400, glucose 132, TSH 6.8',
    'Rate 8.85%, tenure 240 months, EMI 55,180, fee 31,000 plus GST, due 10 February 2027.',
  ])('does not treat ordinary text as an address: %s', (text) => {
    expect(addresses(text)).toEqual([])
  })

  it('needs a number in the first part and a PIN code at the end', () => {
    expect(addresses('Maple Residency, Kondapur, Hyderabad 500084')).toEqual([])
    expect(addresses('14, Lake View Road, Indiranagar, Bengaluru')).toEqual([])
  })
})

describe('detectWithRegex: company names', () => {
  const orgs = (text: string) => detectWithRegex(text).filter((span) => span.type === 'ORG').map((span) => span.text)

  it.each([
    ['Quantel Systems India Private Limited', 'Quantel Systems India Private Limited'],
    ['Brightpath Analytics Private Limited', 'Brightpath Analytics Private Limited'],
    ['Meridian Infra Projects Limited', 'Meridian Infra Projects Limited'],
    ['Acme Traders Pvt. Ltd.', 'Acme Traders Pvt. Ltd.'],
    ['Northfield Housing LLP', 'Northfield Housing LLP'],
    ['NORTHFIELD HOUSING FINANCE LIMITED', 'NORTHFIELD HOUSING FINANCE LIMITED'],
  ])('finds %s', (name, expected) => {
    expect(orgs(`Offer from ${name} is attached.`)).toEqual([expected])
  })

  it('leaves out the words that start the phrase', () => {
    expect(orgs('Regards,\nFor Northfield Housing Finance Limited\nBranch Manager')).toEqual(['Northfield Housing Finance Limited'])
    expect(orgs('Sent by The Meridian Infra Projects Limited today')).toEqual(['Meridian Infra Projects Limited'])
  })

  it('does not match a legal suffix on its own or in ordinary phrases', () => {
    expect(orgs('Limited liability applies. The offer is limited to residents. Incorporated in 1999.')).toEqual([])
    expect(orgs('Unlimited data and a Limited Edition watch')).toEqual([])
  })
})

describe('detectWithRegex: general behaviour', () => {
  it('returns sorted, non-overlapping spans with correct offsets', () => {
    for (const text of [labReport, rental, loan]) {
      const spans = detectWithRegex(text)
      expect(spans.length).toBeGreaterThan(5)
      spans.forEach((span, index) => {
        expect(text.slice(span.start, span.end)).toBe(span.text)
        if (index > 0) expect(span.start).toBeGreaterThanOrEqual(spans[index - 1].end)
      })
    }
  })

  it('finds the planted details in the lab report sample', () => {
    const texts = values(labReport)
    for (const planted of [
      'Meenakshi Raghavan',
      'Anil Deshpande',
      'meenakshi.raghavan@mailbox.example',
      '98450 12367',
      'SDL-20261187',
      '14/08/1973',
      'KMC-48213',
    ]) {
      expect(texts).toContain(planted)
    }
  })

  it('finds the planted details in the rental sample', () => {
    const texts = values(rental)
    for (const planted of [
      'Prakash Kulkarni',
      'Farah Siddiqui',
      'ABCPK4821L',
      'BQTPS7719M',
      '4821 7730 9165',
      '+91 97654 32180',
      'farah.siddiqui@inbox.example',
      '50100482913377',
      'HDFC0001742',
    ]) {
      expect(texts).toContain(planted)
    }
  })

  it('finds the planted details in the loan sample', () => {
    const texts = values(loan)
    for (const planted of [
      'Divya Karthik',
      'Venugopal',
      '90031 55742',
      'karthik.venugopal@postbox.example',
      'AFKPV3391Q',
      'CUST00771845',
      '007701529934',
      'CSTB0000457',
    ]) {
      expect(texts).toContain(planted)
    }
  })

  it('returns nothing for text without personal details', () => {
    expect(detectWithRegex('The interest rate is floating and may change.')).toEqual([])
  })
})
