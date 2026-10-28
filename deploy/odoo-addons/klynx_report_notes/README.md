# Quotation note privacy

The native Odoo 18 sale report renders `sale.order.note`. Real two-company CI
reported `rental_tags_visible=True` before this addon. The base64 metadata check
was false in that run; its substring check did not account for PDF line wrapping,
so absence of metadata was not conclusively established.

This addon inherits only the report's `order_note` span. It renders a sanitized
copy without reserved Rental OS tags or Klynx base64 metadata. Customer HTML and
terms remain; stored notes, searches and booking metadata are never written.
There are no new fields, accounting actions, migrations or PDF generators.

CI mounts and installs it only in disposable company stacks, checks native QWeb
rendering and then checks actual quotation PDF text. These checks must pass before
rollout. Installing the addon in live Odoo is a separate manual administrator step:
make this addon available on that company's Odoo addons path, install
`klynx_report_notes`, restart/reload Odoo, and verify an existing quotation PDF.
The repository does not alter live company manifests or production settings.

Uninstalling restores the original native report (and its marker leak). Existing
data needs no migration. Moving metadata to dedicated fields instead would need
backfill, dual-read compatibility, and changes to note writers and search domains;
that is a larger migration and was deliberately avoided.
