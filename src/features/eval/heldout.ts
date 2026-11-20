/**
 * The held-out leak test set: ten more synthetic documents, written on
 * 2026-11-21 after the detection patterns and prompts were last changed.
 *
 * RULE: these documents are for measuring only. Never change a detection
 * pattern, prompt or filter because of a result on this set; that would turn
 * it into another development set and make its numbers meaningless. Tune on
 * EVAL_CORPUS (corpus.ts) instead, and report both.
 *
 * Every person, organisation, address and number here is invented. The set
 * deliberately leans on what is hard: names inside sentences, first names on
 * their own, addresses without PIN codes, organisations without a legal
 * suffix, and a non-Indian document.
 */

import type { EvalDocument } from './corpus'

export const HELDOUT_CORPUS: EvalDocument[] = [
  {
    id: 'dental-estimate',
    title: 'Dental treatment estimate',
    text: `BRIGHTSMILE DENTAL CARE
Opp. Ganesh Temple, Station Road, Nashik

Treatment estimate prepared for Rukmini Joshi on 18 November 2026

Dear Rukmini,

Thank you for visiting us. After the X-ray, Dr. Aarav Kapadia found deep decay in two lower molars. He recommends a root canal on tooth 36 followed by a ceramic crown, and a filling on tooth 37.

Root canal treatment (tooth 36)  Rs. 7,500
Ceramic crown (tooth 36)  Rs. 9,000
Composite filling (tooth 37)  Rs. 1,800
Total estimate  Rs. 18,300

The crown needs two visits, about ten days apart. Payment of 50% is due before the root canal begins. Estimates are valid for 30 days.

Your file number is BSD/NSK/4471. To book, call our front desk on 0253 245 8890 or message Lalitha at the reception on 93700 51126.`,
    planted: [
      { value: 'Rukmini Joshi', type: 'PERSON', alsoWrittenAs: ['Rukmini'] },
      { value: 'Aarav Kapadia', type: 'PERSON' },
      { value: 'BRIGHTSMILE DENTAL CARE', type: 'ORG' },
      { value: 'BSD/NSK/4471', type: 'ID' },
      { value: '0253 245 8890', type: 'CONTACT' },
      { value: 'Lalitha', type: 'PERSON' },
      { value: '93700 51126', type: 'CONTACT' },
    ],
  },
  {
    id: 'school-fee',
    title: 'School fee reminder',
    text: `St. Columba's High School
Accounts Office

12 November 2026

To the parent of Ishaan Mehrotra, Class VII-B
Admission number: SCHS/2019/0882

This is a reminder that the second-term fee of Rs. 46,500 for Ishaan is unpaid. The due date was 31 October 2026. A late fee of Rs. 50 per day is being added from 1 November 2026.

Please pay through the school portal or by bank transfer to account 2291 0045 6618 at Western Coastal Bank, IFSC WCBK0001290, quoting the admission number.

If you have already paid, please send the receipt to accounts@stcolumbas.example. For a payment plan, please speak to Mr. Joseph D'Mello, Accounts Officer.

Mrs. Neelam Mehrotra is listed as the fee-paying parent.`,
    planted: [
      { value: 'Ishaan Mehrotra', type: 'PERSON', alsoWrittenAs: ['Ishaan'] },
      { value: 'SCHS/2019/0882', type: 'ID' },
      { value: '2291 0045 6618', type: 'ACCOUNT' },
      { value: 'WCBK0001290', type: 'ACCOUNT' },
      { value: 'accounts@stcolumbas.example', type: 'CONTACT' },
      { value: "Joseph D'Mello", type: 'PERSON' },
      { value: 'Neelam Mehrotra', type: 'PERSON' },
    ],
  },
  {
    id: 'electricity-notice',
    title: 'Electricity disconnection notice',
    text: `DAKSHIN POWER DISTRIBUTION
Disconnection notice

Consumer: Gopal Krishna Hegde
Consumer number: 4102 7735 0961
Service address: Door 12/3, 4th Main, Saraswathipuram, Mysuru
Meter number: DPD-M-558214

Your bill of Rs. 6,742 for September and October 2026 is overdue. If it is not paid within 7 days of this notice, supply to the above service connection will be disconnected without further notice.

Reconnection after disconnection costs Rs. 300 in addition to the dues. If you think this bill is wrong, you may ask for a meter test by writing to the Assistant Engineer, Saraswathipuram sub-division.

Notice served on 15 November 2026 by lineman Basavaraj in the presence of the consumer's son, Pradeep.`,
    planted: [
      { value: 'Gopal Krishna Hegde', type: 'PERSON' },
      { value: '4102 7735 0961', type: 'ID' },
      { value: 'Door 12/3, 4th Main, Saraswathipuram, Mysuru', type: 'ADDRESS' },
      { value: 'DPD-M-558214', type: 'ID' },
      { value: 'Basavaraj', type: 'PERSON' },
      { value: 'Pradeep', type: 'PERSON' },
    ],
  },
  {
    id: 'motor-insurance',
    title: 'Car insurance renewal notice',
    text: `RENEWAL NOTICE: PRIVATE CAR PACKAGE POLICY

Policy number: MTR/24/7781903
Insured: Charulata Banerjee
Vehicle: Hyundai i20, registration WB 02 AK 4417
Policy expires: 30 November 2026

Dear Ms. Banerjee,

Your car policy expires soon. The renewal premium is Rs. 14,208 including GST. This includes a No Claim Bonus of 35% because no claim was made last year.

If the policy lapses for more than 90 days, the No Claim Bonus is lost. A vehicle inspection may also be needed before cover restarts.

Nominee on record: Dipankar Banerjee (husband).

Your advisor Sourav Mitra can renew it for you over the phone. Reach him on 98300 66142.`,
    planted: [
      { value: 'MTR/24/7781903', type: 'ID' },
      { value: 'Charulata Banerjee', type: 'PERSON', alsoWrittenAs: ['Banerjee'] },
      { value: 'WB 02 AK 4417', type: 'OTHER' },
      { value: 'Dipankar Banerjee', type: 'PERSON' },
      { value: 'Sourav Mitra', type: 'PERSON' },
      { value: '98300 66142', type: 'CONTACT' },
    ],
  },
  {
    id: 'card-statement',
    title: 'Credit card payment reminder',
    text: `Payment reminder

Card ending 7716 | Card holder: Vikram Aditya Rathore

Total amount due: Rs. 58,920
Minimum amount due: Rs. 2,946
Payment due date: 25 November 2026

Dear Vikram,

Your payment for the statement dated 5 November 2026 is due soon. If you pay only the minimum amount, interest of 3.75% per month (45% per year) is charged on the unpaid balance from the date of each purchase, and new purchases do not get an interest-free period.

A late payment charge of Rs. 950 applies if the minimum amount is not received by the due date.

Your relationship manager, Ayesha Siddiqa, is available on 022 6644 9013 between 10 am and 6 pm.

Billing address on record: 701 Sea Breeze Towers, Carter Road, Bandra West, Mumbai`,
    planted: [
      { value: 'Vikram Aditya Rathore', type: 'PERSON', alsoWrittenAs: ['Vikram'] },
      { value: 'Ayesha Siddiqa', type: 'PERSON' },
      { value: '022 6644 9013', type: 'CONTACT' },
      { value: '701 Sea Breeze Towers, Carter Road, Bandra West, Mumbai', type: 'ADDRESS' },
    ],
  },
  {
    id: 'mri-report',
    title: 'MRI report',
    text: `MEDIVISTA IMAGING CENTRE

Patient: Harpreet Kaur Sandhu
UHID: MVI-00384712
DOB: 07/04/1981
Referring doctor: Dr. Manpreet Gill

MRI LUMBAR SPINE (PLAIN)

Findings: Mild disc bulge at L4-L5 indenting the thecal sac, with mild narrowing of the left neural foramen. The L5-S1 disc shows early degenerative change. No fracture. The spinal cord ends normally at L1.

Impression: L4-L5 disc bulge with mild left foraminal narrowing, which may explain the left leg pain described by Mrs. Sandhu. Clinical correlation is advised.

Reported by Dr. Ritika Malhotra, Consultant Radiologist, on 19 November 2026. Images can be collected from the front desk by Harpreet or her daughter Simran.`,
    planted: [
      { value: 'MEDIVISTA IMAGING CENTRE', type: 'ORG' },
      { value: 'Harpreet Kaur Sandhu', type: 'PERSON', alsoWrittenAs: ['Sandhu', 'Harpreet'] },
      { value: 'MVI-00384712', type: 'ID' },
      { value: '07/04/1981', type: 'DATE_OF_BIRTH' },
      { value: 'Manpreet Gill', type: 'PERSON' },
      { value: 'Ritika Malhotra', type: 'PERSON' },
      { value: 'Simran', type: 'PERSON' },
    ],
  },
  {
    id: 'warning-letter',
    title: 'Employment warning letter',
    text: `Strictly confidential

20 November 2026

Mr. Tushar Pawar
Employee ID: LGX-30958
Warehouse Operations, Bhiwandi

Subject: Written warning for unauthorised absence

Dear Tushar,

Our records show that you were absent without approved leave on 3, 4 and 10 November 2026. Your shift supervisor, Rakesh Yadav, tried to reach you on each of these days without success.

This is a formal written warning under clause 14 of the Standing Orders. Any further unauthorised absence in the next six months may lead to suspension or termination.

You may reply in writing within 7 days. You may also ask for a meeting, at which you may bring a colleague. Please contact Sheetal Kulkarni in Human Resources to arrange this.

Logistix Supply Chain Solutions
Human Resources`,
    planted: [
      { value: 'Tushar Pawar', type: 'PERSON', alsoWrittenAs: ['Tushar'] },
      { value: 'LGX-30958', type: 'ID' },
      { value: 'Rakesh Yadav', type: 'PERSON' },
      { value: 'Sheetal Kulkarni', type: 'PERSON' },
      { value: 'Logistix Supply Chain Solutions', type: 'ORG' },
    ],
  },
  {
    id: 'society-notice',
    title: 'Housing society dues notice',
    text: `GREEN MEADOWS CO-OPERATIVE HOUSING SOCIETY
Registration No. TNA/HSG/2011/4417

Notice of arrears

To: Mrs. Prerna Vaidya, Flat C-1103

Our records show maintenance arrears of Rs. 27,600 for the six months from May to October 2026, plus interest of Rs. 1,656 at 21% per year as allowed by the society's bye-laws.

Please clear the dues by 10 December 2026. If they are not cleared, the committee may stop issuing a no-objection certificate for the sale or rental of the flat, and may recover the amount under section 101 of the Co-operative Societies Act.

Payments can be made to the society's account or at the office on Saturdays between 10 am and 1 pm. For queries, contact the secretary, Anil Bhanushali, or the treasurer, Mrs. Fatima Khan.`,
    planted: [
      { value: 'GREEN MEADOWS CO-OPERATIVE HOUSING SOCIETY', type: 'ORG' },
      { value: 'TNA/HSG/2011/4417', type: 'ID' },
      { value: 'Prerna Vaidya', type: 'PERSON' },
      { value: 'C-1103', type: 'ADDRESS' },
      { value: 'Anil Bhanushali', type: 'PERSON' },
      { value: 'Fatima Khan', type: 'PERSON' },
    ],
  },
  {
    id: 'court-summons',
    title: 'Summons in a civil suit',
    text: `IN THE COURT OF THE PRINCIPAL CIVIL JUDGE, VADODARA

Civil Suit No. 1188 of 2026

Mahendra Bhailal Parikh ... Plaintiff
versus
Kishore Ranchhod Solanki ... Defendant

SUMMONS

To Kishore Ranchhod Solanki, residing at 14 Akota Garden Society, Akota, Vadodara.

Whereas the plaintiff has filed a suit against you for recovery of Rs. 6,40,000 lent in March 2025, with interest at 12% per year, you are hereby summoned to appear in this court in person or through an advocate on 15 January 2027 at 11 am, and to file your written statement.

If you do not appear on that date, the suit may be heard and decided in your absence.

Advocate for the plaintiff: Nayana Desai.

Given under my hand and the seal of this court on 18 November 2026.`,
    planted: [
      { value: 'Mahendra Bhailal Parikh', type: 'PERSON' },
      { value: 'Kishore Ranchhod Solanki', type: 'PERSON' },
      { value: '14 Akota Garden Society, Akota, Vadodara', type: 'ADDRESS' },
      { value: 'Nayana Desai', type: 'PERSON' },
    ],
  },
  {
    id: 'us-medical-bill',
    title: 'US hospital bill',
    text: `Riverbend Community Hospital
Patient billing statement

Statement date: November 14, 2026
Account number: 880-2214-5397
Patient: Daniel Okafor
Guarantor: Grace Okafor
Mailing address: 2417 Willow Creek Lane, Apt 3B, Columbus, OH 43215
Date of birth: 09/22/1979

Emergency department visit on October 30, 2026
Total charges: $4,862.00
Insurance paid: $3,410.50
Insurance adjustment: $812.00
Amount you owe: $639.50

Payment is due by December 14, 2026. If you cannot pay the full amount, you may qualify for a payment plan or financial assistance. Call our billing office at (614) 555-0187 and ask for Marisol.

Daniel's insurer was billed under member ID QHP-77231-04.`,
    planted: [
      { value: 'Riverbend Community Hospital', type: 'ORG' },
      { value: '880-2214-5397', type: 'ACCOUNT' },
      { value: 'Daniel Okafor', type: 'PERSON', alsoWrittenAs: ['Daniel'] },
      { value: 'Grace Okafor', type: 'PERSON' },
      { value: '2417 Willow Creek Lane, Apt 3B, Columbus, OH 43215', type: 'ADDRESS' },
      { value: '09/22/1979', type: 'DATE_OF_BIRTH' },
      { value: '(614) 555-0187', type: 'CONTACT' },
      { value: 'Marisol', type: 'PERSON' },
      { value: 'QHP-77231-04', type: 'ID' },
    ],
  },
]
