#!/usr/bin/env python3
"""
Generate a realistic test contract PDF for accuracy validation.
Usage: python3 generate_test_contract.py

Outputs: contracts/sample-saas-contract.pdf

Known values (to verify extraction accuracy):
  counterparty_name:   Acme Software Ltd
  effective_date:      2024-03-01
  expiry_date:         2025-02-28
  auto_renew:          true
  notice_period_days:  30
  notice_period_text:  "30 days' written notice"
  contract_value:      £24,000 per annum + VAT
"""

from fpdf import FPDF
import pathlib

OUT = pathlib.Path(__file__).parent / "contracts" / "sample-saas-contract.pdf"

CONTRACT_TEXT = """
SOFTWARE AS A SERVICE AGREEMENT

This Software as a Service Agreement ("Agreement") is entered into as of 1 March 2024
("Effective Date") by and between:

Meridian Software Ltd, a company incorporated in England and Wales with company number 12345678,
having its registered office at 10 Tech Street, London, EC1A 1BB ("Provider")

and

Acme Software Ltd, a company incorporated in England and Wales with company number
87654321, having its registered office at 25 Commerce Road, Manchester, M1 2AB ("Customer").

1. SERVICES

1.1 The Provider shall make the SaaS platform ("Service") available to the Customer
    during the Term, subject to the terms of this Agreement.

1.2 The Service includes contract management, automated alerts, and AI-powered
    extraction features as described in Schedule 1.

2. TERM

2.1 This Agreement shall commence on the Effective Date of 1 March 2024 and shall
    continue for an initial period of twelve (12) months, expiring on 28 February 2025
    (the "Initial Term"), unless terminated earlier in accordance with this Agreement.

2.2 AUTO-RENEWAL: Following the Initial Term, this Agreement shall automatically
    renew for successive periods of twelve (12) months each (each a "Renewal Term")
    unless either party provides the other with at least 30 days' written notice of
    its intention not to renew, such notice to be given prior to the expiry of the
    then-current Term.

3. FEES AND PAYMENT

3.1 In consideration of the Services provided under this Agreement, the Customer shall
    pay the Provider a subscription fee of £24,000 per annum + VAT, invoiced quarterly
    in advance.

3.2 All invoices are payable within 30 days of the invoice date.

3.3 The Provider reserves the right to suspend access to the Service if any invoice
    remains unpaid for more than 14 days after its due date.

4. TERMINATION

4.1 Either party may terminate this Agreement by providing not less than 30 days'
    written notice to the other party prior to the end of the then-current Term.

4.2 Either party may terminate this Agreement immediately upon written notice if the
    other party commits a material breach that remains uncured for 30 days after
    written notice of such breach.

5. INTELLECTUAL PROPERTY

5.1 The Provider retains all intellectual property rights in the Service and any
    related documentation. Nothing in this Agreement transfers any intellectual
    property rights to the Customer.

6. DATA PROTECTION

6.1 Each party shall comply with all applicable data protection legislation including
    the UK GDPR and the Data Protection Act 2018.

6.2 The Provider shall act as a data processor on behalf of the Customer with respect
    to any personal data processed through the Service.

7. LIABILITY

7.1 Neither party shall be liable for any indirect, special, or consequential loss
    arising out of or in connection with this Agreement.

7.2 The Provider's total aggregate liability under this Agreement shall not exceed
    the fees paid by the Customer in the twelve months preceding the claim.

8. GOVERNING LAW

8.1 This Agreement shall be governed by and construed in accordance with the laws
    of England and Wales, and the parties submit to the exclusive jurisdiction of
    the courts of England and Wales.

IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first
written above.

MERIDIAN SOFTWARE LTD               ACME SOFTWARE LTD

Signed: _____________________       Signed: _____________________
Name:   Sarah Chen                  Name:   James Whitfield
Title:  Chief Executive Officer     Title:  Head of Operations
Date:   1 March 2024                Date:   1 March 2024


SCHEDULE 1 — SERVICE DESCRIPTION

The Service comprises the following features:
- Automated contract ingestion and storage
- AI-powered extraction of key dates and terms
- Tiered alert notifications at 60, 30, and 7 days before renewal
- Renewal dashboard with contract portfolio overview
- CSV export functionality
- Email and Slack integration for alert delivery

Support: Standard support (business hours, email) is included.
SLA: 99.5% monthly uptime guarantee.
"""


def generate():
    pdf = FPDF()
    pdf.add_page()
    pdf.set_margins(20, 20, 20)
    pdf.set_auto_page_break(auto=True, margin=20)

    import re
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "SOFTWARE AS A SERVICE AGREEMENT", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(4)

    pdf.set_font("Helvetica", "", 10)
    def clean(s):
        return (s.replace("\u2014", "-").replace("\u2013", "-")
                 .replace("\u2019", "'").replace("\u2018", "'")
                 .replace("\u201c", '"').replace("\u201d", '"')
                 .replace("\u00a3", "GBP"))

    for line in CONTRACT_TEXT.strip().split("\n"):
        line = clean(line.rstrip())
        if line.startswith("SOFTWARE AS A SERVICE AGREEMENT"):
            continue
        if line.strip() == "":
            pdf.ln(3)
        else:
            if re.match(r"^\d+\. [A-Z ]+$", line.strip()) or re.match(r"^SCHEDULE", line.strip()):
                pdf.set_font("Helvetica", "B", 10)
                pdf.multi_cell(170, 5, line)
                pdf.set_font("Helvetica", "", 10)
            else:
                pdf.multi_cell(170, 5, line)

    OUT.parent.mkdir(parents=True, exist_ok=True)

    pdf.output(str(OUT))
    print(f"Generated: {OUT}")
    print()
    print("Expected extraction results:")
    print("  counterparty_name:   Acme Software Ltd")
    print("  effective_date:      2024-03-01")
    print("  expiry_date:         2025-02-28")
    print("  auto_renew:          true")
    print("  notice_period_days:  30")
    print("  notice_period_text:  30 days' written notice")
    print("  contract_value:      £24,000 per annum + VAT")


if __name__ == "__main__":
    generate()
