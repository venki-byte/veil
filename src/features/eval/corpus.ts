/**
 * The leak test corpus: ten synthetic documents with planted personal details.
 *
 * Every person, organisation, address and number here is invented. Each
 * document lists exactly which details were planted, so a run can be scored
 * by plain code: was every planted detail hidden before sending?
 *
 * The set mixes form-like documents (labelled fields, where patterns do well)
 * with letters written in sentences (where names and addresses have no fixed
 * shape and only a model can find them).
 */

import type { SensitiveType } from '../../privacy/types'

export interface Planted {
  value: string
  type: SensitiveType
  /** Other ways the same detail is written in the document, e.g. a surname alone. */
  alsoWrittenAs?: string[]
}

export interface EvalDocument {
  id: string
  title: string
  text: string
  planted: Planted[]
}

export const EVAL_CORPUS: EvalDocument[] = [
  {
    id: 'liver-test',
    title: 'Liver function test',
    text: `CITYCARE PATHOLOGY CENTRE
Patient: Mr. Devendra Solanki  Age: 61  Sex: M
DOB: 02/03/1965  UHID: CCP-7741902
Phone: 98201 44567
Ref. Doctor: Dr. Priya Menon

LIVER FUNCTION TEST
Bilirubin Total  1.9 mg/dL  (0.2 - 1.2)  HIGH
SGPT (ALT)  88 U/L  (7 - 56)  HIGH
SGOT (AST)  71 U/L  (5 - 40)  HIGH
Albumin  3.9 g/dL  (3.5 - 5.0)

Comment: Raised liver enzymes. Mr. Solanki should discuss alcohol intake and current medicines with Dr. Menon. Repeat the test after 4 weeks.
Report released to the patient's son, Hitesh Solanki, on request.`,
    planted: [
      { value: 'Devendra Solanki', type: 'PERSON', alsoWrittenAs: ['Solanki'] },
      { value: '02/03/1965', type: 'DATE_OF_BIRTH' },
      { value: 'CCP-7741902', type: 'ID' },
      { value: '98201 44567', type: 'CONTACT' },
      { value: 'Priya Menon', type: 'PERSON', alsoWrittenAs: ['Menon'] },
      { value: 'Hitesh Solanki', type: 'PERSON' },
    ],
  },
  {
    id: 'discharge-summary',
    title: 'Hospital discharge summary',
    text: `DISCHARGE SUMMARY

Shanti Devi Memorial Hospital, Jaipur

Smt. Kamla Bairwa, a 58-year-old woman from 47 Tilak Marg, C-Scheme, Jaipur 302001, was admitted on 3 November 2026 with chest pain and discharged on 8 November 2026. Her IP number is IP/26/118834.

Diagnosis: Unstable angina. Coronary angiography showed 70% narrowing in one artery. She was treated with medicines; no stent was placed.

Medicines on discharge: Aspirin 75 mg once daily, Atorvastatin 40 mg at night, Metoprolol 25 mg twice daily.

Follow up with Dr. Rajeev Kothari in the cardiology OPD after 10 days. In an emergency, her daughter Sunaina Bairwa can be contacted on 94140 66218.

Advice: avoid heavy exertion for 2 weeks, low-salt diet, stop tobacco.`,
    planted: [
      { value: 'Kamla Bairwa', type: 'PERSON' },
      { value: '47 Tilak Marg, C-Scheme, Jaipur 302001', type: 'ADDRESS' },
      { value: 'IP/26/118834', type: 'ID' },
      { value: 'Rajeev Kothari', type: 'PERSON' },
      { value: 'Sunaina Bairwa', type: 'PERSON' },
      { value: '94140 66218', type: 'CONTACT' },
    ],
  },
  {
    id: 'medical-certificate',
    title: 'Doctor\'s travel certificate',
    text: `Dr. Farzana Sheikh, MD
Consultant Endocrinologist
Lotus Speciality Clinic, 12 Convent Road, Camp, Pune 411001

14 November 2026

To whom it may concern

This is to certify that Aditya Narvekar, aged 34, born on 9 July 1992, has been under my care for Type 1 diabetes since 2019. He uses an insulin pump and must carry insulin, needles and glucose tablets at all times, including on flights.

His last HbA1c on 2 November 2026 was 6.9%. He is fit to travel.

For verification please call the clinic on 020 2613 4455 or write to frontdesk@lotusclinic.example. His emergency contact is his wife, Rhea Narvekar, mobile 99230 71184.

Dr. Farzana Sheikh
Reg. No. MMC/2009/04417`,
    planted: [
      { value: 'Farzana Sheikh', type: 'PERSON' },
      { value: 'Aditya Narvekar', type: 'PERSON' },
      { value: '9 July 1992', type: 'DATE_OF_BIRTH' },
      { value: 'Rhea Narvekar', type: 'PERSON' },
      { value: '99230 71184', type: 'CONTACT' },
      { value: 'MMC/2009/04417', type: 'ID' },
    ],
  },
  {
    id: 'rent-agreement',
    title: 'Rent agreement',
    text: `RENT AGREEMENT

This agreement is made on 5 November 2026 between Gurpreet Singh Bhatia, son of Harbans Singh Bhatia, residing at House No. 218, Sector 21-C, Chandigarh 160022 (the Owner), and Nikhil Rao Deshmukh, an employee of Brightpath Analytics Private Limited, holding Aadhaar number 7302 4419 8856 (the Tenant).

The Owner lets out the first floor of House No. 218, Sector 21-C, Chandigarh 160022 for 11 months from 1 December 2026 at a monthly rent of Rs. 24,500, payable by the 7th of each month to account number 331004567781 with Punjab Co-operative Bank.

A security deposit of Rs. 49,000 has been paid. Either side may end the agreement with one month's notice. Rent rises by 5% on renewal. The Tenant pays electricity and water. No subletting.

The Tenant can be reached on 98155 20934 or nikhil.deshmukh@fastmail.example.

Witness: Amarjit Kaur`,
    planted: [
      { value: 'Gurpreet Singh Bhatia', type: 'PERSON' },
      { value: 'Harbans Singh Bhatia', type: 'PERSON' },
      { value: 'House No. 218, Sector 21-C, Chandigarh 160022', type: 'ADDRESS' },
      { value: 'Nikhil Rao Deshmukh', type: 'PERSON' },
      { value: 'Brightpath Analytics Private Limited', type: 'ORG' },
      { value: '7302 4419 8856', type: 'ID' },
      { value: '331004567781', type: 'ACCOUNT' },
      { value: '98155 20934', type: 'CONTACT' },
      { value: 'nikhil.deshmukh@fastmail.example', type: 'CONTACT' },
      { value: 'Amarjit Kaur', type: 'PERSON' },
    ],
  },
  {
    id: 'personal-loan',
    title: 'Personal loan sanction letter',
    text: `SANCTION LETTER - PERSONAL LOAN

Applicant Name: Ms. Tanvi Agnihotri
Date of Birth: 21-06-1990
PAN: BKQPA6612H
Mobile: +91 90040 77315
Email: tanvi.agnihotri@mailhub.example
Address: B-1204, Orchid Heights, Link Road, Malad West, Mumbai 400064
Loan Account No: 60417729003318

Dear Ms. Agnihotri,

We have sanctioned a personal loan of Rs. 4,00,000 for 36 months at 13.5% per annum (fixed). Your EMI is Rs. 13,574, due on the 5th of every month starting 5 January 2027. A processing fee of Rs. 5,900 will be deducted from the loan amount.

Foreclosure is allowed after 6 EMIs with a charge of 4% of the outstanding principal. A bounced EMI attracts Rs. 590 per instance and penal interest of 24% per annum on the overdue amount.

This offer is valid until 30 November 2026.

Relationship Manager: Kunal Bhargava, 022 4890 1177`,
    planted: [
      { value: 'Tanvi Agnihotri', type: 'PERSON', alsoWrittenAs: ['Agnihotri'] },
      { value: '21-06-1990', type: 'DATE_OF_BIRTH' },
      { value: 'BKQPA6612H', type: 'ID' },
      { value: '+91 90040 77315', type: 'CONTACT' },
      { value: 'tanvi.agnihotri@mailhub.example', type: 'CONTACT' },
      { value: 'B-1204, Orchid Heights, Link Road, Malad West, Mumbai 400064', type: 'ADDRESS' },
      { value: '60417729003318', type: 'ACCOUNT' },
      { value: 'Kunal Bhargava', type: 'PERSON' },
      { value: '022 4890 1177', type: 'CONTACT' },
    ],
  },
  {
    id: 'bank-kyc-letter',
    title: 'Bank KYC reminder',
    text: `Coastal Union Bank
Customer Service Cell

Date: 10 November 2026

Dear Customer,

Our records show that the KYC documents for savings account 20045517832 held by Joseph Mathew Kurian have expired. The address on record is Kurian Villa, Church Road, Kadavanthra, Kochi 682020, and the registered mobile number ends with 4471.

Please visit your home branch with your PAN card (on record: AJWPK5521C) and a recent address proof before 15 December 2026. If the documents are not updated, withdrawals from the account will be restricted from 16 December 2026. Deposits will continue to be accepted.

You may also update KYC through a video call by booking a slot with our officer Anjali Nair on 0484 233 9081.

This is a system-generated letter.`,
    planted: [
      { value: '20045517832', type: 'ACCOUNT' },
      { value: 'Joseph Mathew Kurian', type: 'PERSON' },
      { value: 'Kurian Villa, Church Road, Kadavanthra, Kochi 682020', type: 'ADDRESS' },
      { value: 'AJWPK5521C', type: 'ID' },
      { value: 'Anjali Nair', type: 'PERSON' },
      { value: '0484 233 9081', type: 'CONTACT' },
    ],
  },
  {
    id: 'tax-notice',
    title: 'Income tax notice',
    text: `INCOME TAX DEPARTMENT
Intimation of proposed adjustment

PAN: CDMPS8830R
Name: Ritu Saxena
Assessment Year: 2026-27
Document Identification Number: ITBA/AST/2026/1058820391

Address: 3/14, Vikas Khand, Gomti Nagar, Lucknow 226010

We found a difference between the income in your return and the income reported in Form 26AS. Salary reported by your employer, Meridian Infra Projects Limited, is Rs. 14,82,000, but your return shows Rs. 13,20,000. The difference is Rs. 1,62,000.

You must respond within 30 days of this notice, that is by 12 December 2026, either agreeing to the adjustment or disagreeing with reasons. If no response is received, the return will be processed with the adjustment, and additional tax of about Rs. 50,500 with interest may become payable.

Respond online through the e-filing portal.`,
    planted: [
      { value: 'CDMPS8830R', type: 'ID' },
      { value: 'Ritu Saxena', type: 'PERSON' },
      { value: 'ITBA/AST/2026/1058820391', type: 'ID' },
      { value: '3/14, Vikas Khand, Gomti Nagar, Lucknow 226010', type: 'ADDRESS' },
      { value: 'Meridian Infra Projects Limited', type: 'ORG' },
    ],
  },
  {
    id: 'insurance-claim',
    title: 'Health insurance claim letter',
    text: `SURAKSHA GENERAL INSURANCE

Claim reference: CLM-2026-0093317
Policy number: SGI/HLT/44120987

Dear Mr. Imtiaz Qureshi,

We have reviewed the cashless claim for the hospitalisation of your mother, Mrs. Naseem Qureshi, at Greenfield Hospital, Bhopal from 18 October 2026 to 23 October 2026.

Amount claimed: Rs. 2,86,400
Amount approved: Rs. 2,31,900
Amount not payable: Rs. 54,500

The amount not payable includes room rent above the policy limit of Rs. 5,000 per day (Rs. 30,000), consumables (Rs. 14,500) and a 5% co-payment that applies to insured persons above 60 years (Rs. 10,000).

You can ask for a review within 15 days by writing to our grievance cell with the claim reference. The approved amount will be paid directly to the hospital. Any balance must be settled by you at discharge.

Sent to: imtiaz.q@webmail.example, 97530 28846`,
    planted: [
      { value: 'CLM-2026-0093317', type: 'ID' },
      { value: 'SGI/HLT/44120987', type: 'ID' },
      { value: 'Imtiaz Qureshi', type: 'PERSON' },
      { value: 'Naseem Qureshi', type: 'PERSON' },
      { value: 'Greenfield Hospital', type: 'ORG' },
      { value: 'imtiaz.q@webmail.example', type: 'CONTACT' },
      { value: '97530 28846', type: 'CONTACT' },
    ],
  },
  {
    id: 'job-offer',
    title: 'Employment offer letter',
    text: `OFFER OF EMPLOYMENT

12 November 2026

Sneha Kulshreshtha
Flat 5C, Maple Residency, Kondapur, Hyderabad 500084

Dear Sneha,

Quantel Systems India Private Limited is pleased to offer you the position of Senior Analyst, reporting to Varun Tewari. Your employee ID will be QS-118204.

Your annual fixed pay is Rs. 18,40,000, with a variable bonus of up to 10%. A joining bonus of Rs. 1,50,000 will be paid with your first salary and must be returned in full if you leave within 12 months.

Your joining date is 4 January 2027. The probation period is 6 months, during which either side may end employment with 15 days' notice; after that the notice period is 90 days. A non-compete clause restricts you from joining a direct competitor for 6 months after leaving.

Please sign and return this letter by 20 November 2026. For questions, contact Pooja Bedi in HR at pooja.bedi@quantel.example or 040 6677 2290.`,
    planted: [
      { value: 'Sneha Kulshreshtha', type: 'PERSON', alsoWrittenAs: ['Sneha'] },
      { value: 'Flat 5C, Maple Residency, Kondapur, Hyderabad 500084', type: 'ADDRESS' },
      { value: 'Quantel Systems India Private Limited', type: 'ORG' },
      { value: 'Varun Tewari', type: 'PERSON' },
      { value: 'QS-118204', type: 'ID' },
      { value: 'Pooja Bedi', type: 'PERSON' },
      { value: 'pooja.bedi@quantel.example', type: 'CONTACT' },
      { value: '040 6677 2290', type: 'CONTACT' },
    ],
  },
  {
    id: 'legal-notice',
    title: 'Legal notice for a bounced cheque',
    text: `LEGAL NOTICE

From: Adv. Meera Chandrasekhar, Chamber 14, District Court Complex, Coimbatore 641018

To: Mr. Balaji Ramanathan, 22 Avinashi Road, Peelamedu, Coimbatore 641004

Under instructions from my client, Senthil Kumar Palanisamy, I give you this notice under Section 138 of the Negotiable Instruments Act.

You issued cheque number 004512 dated 20 October 2026 for Rs. 3,75,000, drawn on your account 119820044716, towards repayment of a hand loan. The cheque was returned unpaid on 24 October 2026 with the remark "Funds Insufficient".

You are called upon to pay Rs. 3,75,000 to my client within 15 days of receiving this notice. If you fail to pay, my client will file a criminal complaint, which can lead to imprisonment of up to two years, a fine of up to twice the cheque amount, or both, in addition to a civil suit for recovery with interest and costs.

A copy of this notice is kept in my office. You may contact my office on 0422 430 1196.`,
    planted: [
      { value: 'Meera Chandrasekhar', type: 'PERSON' },
      { value: 'Chamber 14, District Court Complex, Coimbatore 641018', type: 'ADDRESS' },
      { value: 'Balaji Ramanathan', type: 'PERSON' },
      { value: '22 Avinashi Road, Peelamedu, Coimbatore 641004', type: 'ADDRESS' },
      { value: 'Senthil Kumar Palanisamy', type: 'PERSON' },
      { value: '119820044716', type: 'ACCOUNT' },
      { value: '0422 430 1196', type: 'CONTACT' },
    ],
  },
]
