# Klynx rental security deposits (Odoo 18 Community)

This optional addon uses Community `sale` and `account` only. It requires no new
service, database, payment provider, or Enterprise subscription. Klynx continues
to call Odoo through the existing tenant-scoped FastAPI middleware.

Install `klynx_rental_deposits` on each intended company database after adding
this directory's parent to that Odoo server's addons path. Restart/reload Odoo
and update the app list. Installing the addon does not change existing invoices,
product accounts, bank accounts, or historical balances.

In **Invoicing → Configuration → Settings → Klynx security deposits**, select:

- A **current liability** account with reconciliation enabled, dedicated to
  refundable security deposits.
- An **income** account for damage compensation.
- A **general** journal for deposit retention adjustments.

Use tax-free security deposit products with an internal reference beginning
`DEP-`. Rental advances (`is_downpayment`) remain ordinary Odoo advances and
are unaffected. New DEP invoice lines use the configured liability account.
Review taxes with the company's accountant before enabling this workflow;
taxed deposits are intentionally rejected here instead of guessing a treatment.

A separate real bank account is optional. If the agency uses one, create/select
its existing Odoo bank journal. `klynx_create_deposit_invoice()` invoices just
the DEP lines, so the normal invoice payment form can record that receipt in
the dedicated journal without including rent. It reuses a deposit-only draft,
rejects mixed drafts, and leaves final rent invoicing to Odoo. Refund journals
need a manual outbound payment method and an outstanding payment account.
These actions **record** money received/returned; they do not initiate a bank
transfer. Bank reconciliation remains native Odoo behavior.

## API methods on `sale.order`

- `klynx_deposit_snapshot()` returns booking `currency`, `currency_rounding`, `required_amount`, `collected_amount`,
  `refunded_amount`, `retained_amount`, `held_amount`, `legacy_issue`, and `events`.
- `klynx_create_deposit_invoice()` returns native draft `invoice_ids` and
  `existing_draft`. Post and record the receipt through the existing invoice API.
- `klynx_save_return_inspection(data)` saves the completed return's three basic
  checks, approval, damage flag, and damage notes. It preserves the existing
  return record and all other booking metadata.
- `klynx_deposit_settle(data)` accepts a UUID `request_id`, `action` (`refund`
  or `retain`), positive `amount` in booking currency, `note`, and refund
  `journal_id`. It returns `event`, `deposit`, and `already`.

Refunds require all checks and either an approved undamaged vehicle or damage
compensation already retained. Retention requires all checks, a damage flag,
damage notes, and a settlement reason. After the first settlement, inspection
evidence is locked. A partial retention can be followed by refunding the held
remainder. Amounts cannot exceed the balance held.

Each settlement takes a booking row lock, then locks its known source invoices,
settlement entries, refund payments, and journal items in deterministic order.
It validates refreshed accounting evidence and runs inside one Odoo transaction:
native credit note plus native outbound payment for a refund, or a balanced
liability-to-income entry for damage retention, together with the saved history.
Reusing the same request UUID returns the original event; changed request
details are rejected. Fully settled liability lines are reconciled. There is
no separate frontend ledger. Unreconciled refunds, posted reversals, changed
account configuration, and payments linked to a different credit note fail
validation instead of continuing to count as settled deposits. An accountant
can still adjust native records after a settlement commits; the next snapshot
detects these changes and requires review.
The existing `security_deposit` note metadata
stores totals and native accounting references for the API and analytics.

## Existing deposits and boundaries

Only posted, fully paid/in-payment deposit invoice lines provide collection
evidence. An invoice that combines rent and deposit must be fully paid: a
partial payment cannot safely be attributed to its deposit line. Deposits
already booked to income, taxed deposits, ambiguous multi-order invoice lines,
or external credit notes require accountant review in Odoo. The addon displays
the issue and blocks automated settlement; it never silently duplicates a
refund or rewrites posted history. Foreign-currency settlements remain in
Odoo Accounting for exchange-rate review.

Native transaction tests are in `tests/test_deposits.py`. Run against a
**disposable Odoo 18 Community database with a chart of accounts**:

```text
odoo --stop-after-init -i klynx_rental_deposits --test-enable --test-tags=/klynx_rental_deposits --without-demo=all -d TEST_DATABASE
```

The regular backend pytest suite does not run Odoo transaction tests. Validate
this addon on staging before enabling its accounting actions for a live company.
