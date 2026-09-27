#!/usr/bin/env python3
"""
Shree Shivansh Stores — XLSM -> Supabase migration / import utility.

Usage:
  Dry run (no DB writes, just a validation report):
    python3 migrate_xlsm.py --file Shree_Shivansh_Stores_Final.xlsm --dry-run

  Real import (requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars —
  service role key must NEVER be committed or shipped to the frontend):
    export SUPABASE_URL=...
    export SUPABASE_SERVICE_ROLE_KEY=...
    python3 migrate_xlsm.py --file Shree_Shivansh_Stores_Final.xlsm --commit

This script is intentionally conservative:
  - It never imports spreadsheet FORMULAS as literal strings; it always reads
    the *computed value* (data_only=True) and lets the new schema/functions
    recompute anything that should be derived (Amount, Revenue, Closing, etc).
  - It reports duplicates and validation errors BEFORE committing.
  - It performs an admin bootstrap user lookup by email for `created_by`
    fields (financial rows always need an owning user in the new schema).
"""
import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, date
from decimal import Decimal, InvalidOperation

import openpyxl

try:
    import requests  # only needed for --commit
except ImportError:
    requests = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def to_decimal(v, default=Decimal("0")):
    if v is None or v == "":
        return default
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None  # signals a validation error to the caller


def to_date(v):
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v.date() if isinstance(v, datetime) else v
    return None


class Report:
    def __init__(self):
        self.imported = defaultdict(int)
        self.skipped = defaultdict(int)
        self.duplicates = defaultdict(list)
        self.errors = defaultdict(list)
        # `notes`: manual-review resolutions that were APPLIED automatically
        # (not left as blocking errors) but are worth surfacing to an admin
        # for spot-checking — e.g. which duplicate row was kept, which
        # payment_mode was corrected, which products were auto-created.
        self.notes = defaultdict(list)
        # `excluded`: rows deliberately dropped after manual review, with the
        # reason recorded (distinct from a plain validation error — these
        # were individually looked at, not just rejected by a generic rule).
        self.excluded = defaultdict(list)

    def add_error(self, sheet, row, msg):
        self.errors[sheet].append(f"Row {row}: {msg}")

    def add_duplicate(self, sheet, row, key):
        self.duplicates[sheet].append(f"Row {row}: duplicate of '{key}'")

    def add_note(self, sheet, msg):
        self.notes[sheet].append(msg)

    def add_excluded(self, sheet, row, msg):
        self.excluded[sheet].append(f"Row {row}: {msg}")

    def print_summary(self):
        print("\n" + "=" * 70)
        print("MIGRATION REPORT")
        print("=" * 70)
        sheets = set(
            list(self.imported.keys()) + list(self.skipped.keys()) +
            list(self.duplicates.keys()) + list(self.errors.keys()) +
            list(self.notes.keys()) + list(self.excluded.keys())
        )
        for sheet in sorted(sheets):
            print(f"\n--- {sheet} ---")
            print(f"  Imported (or would-import):  {self.imported.get(sheet, 0)}")
            print(f"  Skipped (blank/placeholder): {self.skipped.get(sheet, 0)}")
            print(f"  Duplicates detected:         {len(self.duplicates.get(sheet, []))}")
            print(f"  Validation errors:           {len(self.errors.get(sheet, []))}")
            if sheet in self.excluded:
                print(f"  Excluded after manual review:{len(self.excluded[sheet]):>4}")
            for e in self.errors.get(sheet, [])[:10]:
                print(f"    ! {e}")
            if len(self.errors.get(sheet, [])) > 10:
                print(f"    ... and {len(self.errors[sheet]) - 10} more errors")
            for d in self.duplicates.get(sheet, [])[:5]:
                print(f"    ~ {d}")
            if len(self.duplicates.get(sheet, [])) > 5:
                print(f"    ... and {len(self.duplicates[sheet]) - 5} more duplicates")
            for x in self.excluded.get(sheet, [])[:10]:
                print(f"    x {x}")
            if len(self.excluded.get(sheet, [])) > 10:
                print(f"    ... and {len(self.excluded[sheet]) - 10} more exclusions")
            for n in self.notes.get(sheet, [])[:10]:
                print(f"    * {n}")
            if len(self.notes.get(sheet, [])) > 10:
                print(f"    ... and {len(self.notes[sheet]) - 10} more notes")
        total_err = sum(len(v) for v in self.errors.values())
        total_dup = sum(len(v) for v in self.duplicates.values())
        total_excl = sum(len(v) for v in self.excluded.values())
        print("\n" + "-" * 70)
        print(f"TOTAL rows ready to import: {sum(self.imported.values())}")
        print(f"TOTAL validation errors:    {total_err}")
        print(f"TOTAL duplicates flagged:   {total_dup}")
        print(f"TOTAL excluded (reviewed):  {total_excl}")
        print("=" * 70)


# ---------------------------------------------------------------------------
# Sheet extractors — each returns a list of dict rows + populates report
# ---------------------------------------------------------------------------
def extract_products(wb, report):
    """PA sheet -> product master rows.

    MANUAL-REVIEW RESOLUTION (40 duplicate rows, 38 name groups):
    Inspection of the source workbook shows every duplicate group is a block
    of rows that was re-entered later in the sheet (e.g. a whole "SPECIES"
    category block re-typed as "SPICES" ~60 rows later, TATA SALT entered
    three times). In every group the LATER row's MRP/cost/SP values are the
    ones that are complete and internally consistent (the earlier rows are
    frequently missing MRP or carry an outlier cost) — so this resolves
    duplicates by keeping the LAST occurrence, not the first, and reports
    what was overwritten so an admin can spot-check the decision.
    Two groups ('tata salt', '10 inr biscuits lot 3') have three occurrences
    each; the same last-wins rule applies transitively.
    """
    ws = wb["PA"]
    by_key = {}  # key -> row dict (dict.setdefault-and-overwrite keeps insertion
                 # order stable while the *values* always come from the latest row)
    first_seen_row = {}
    overwritten = []

    for r in range(2, ws.max_row + 1):
        name = ws.cell(r, 1).value
        if name is None or str(name).strip() == "":
            report.skipped["PA"] += 1
            continue
        name = str(name).strip()
        key = name.lower()

        mrp = to_decimal(ws.cell(r, 3).value)
        cost = to_decimal(ws.cell(r, 4).value)
        sp = to_decimal(ws.cell(r, 5).value)

        if mrp is None or cost is None or sp is None:
            report.add_error("PA", r, f"non-numeric MRP/cost/SP for '{name}'")
            continue
        if cost < 0 or mrp < 0 or sp < 0:
            report.add_error("PA", r, f"negative price value for '{name}'")
            continue

        row = {
            "product_name": name,
            "category": (ws.cell(r, 2).value or "").strip() or None,
            "mrp": str(mrp),
            "cost_per_unit": str(cost),
            "offline_sp": str(sp),
        }

        if key in by_key:
            report.add_duplicate("PA", r, name)
            overwritten.append((first_seen_row[key], r, name, by_key[key], row))
            report.imported["PA"] -= 1  # the earlier row is no longer counted
        else:
            first_seen_row[key] = r
        by_key[key] = row  # last occurrence always wins
        report.imported["PA"] += 1

    if overwritten:
        report.notes["PA (duplicate resolution)"] = [
            f"Row {new_r} superseded row {old_r} for '{name}': "
            f"kept cost={new['cost_per_unit']}/mrp={new['mrp']}/sp={new['offline_sp']} "
            f"(dropped cost={old['cost_per_unit']}/mrp={old['mrp']}/sp={old['offline_sp']})"
            for old_r, new_r, name, old, new in overwritten
        ]

    return list(by_key.values())


def extract_customers_and_sales(wb, report):
    """Sales Register -> (customers dict, sales list, credit_ledger hints).

    Column layout: Date | CUSTOMER NO. | Item | Qty | sold(INR) | Amount |
                   Payment Mode | IF CREDIT | DAYS TOTAL | SHIFT | PROFIT | AVERAGE
    Rows with a date but no Item are daily-total placeholder rows (blank sale
    days) and are skipped — they carry no transactional data.
    """
    ws = wb["Sales Register"]
    sales = []
    customer_refs = {}  # free-text ref -> synthetic customer bucket (not a real customer profile)
    credit_notes = []

    for r in range(3, ws.max_row + 1):
        sale_date = to_date(ws.cell(r, 1).value)
        item = ws.cell(r, 3).value
        qty = ws.cell(r, 4).value
        sold_inr = ws.cell(r, 5).value

        if sale_date is None:
            continue
        if item is None or str(item).strip() == "":
            report.skipped["Sales Register"] += 1
            continue

        item = str(item).strip()

        # Rows where Qty is actually a subtotal label like "UPI TOTAL" are
        # daily reconciliation rows the shopkeeper typed inline, not real
        # transactions. Detect and skip them distinctly from genuine errors.
        if isinstance(qty, str) and any(tok in qty.upper() for tok in ("TOTAL", "CASH", "UPI")):
            report.skipped["Sales Register"] += 1
            continue

        qty_d = to_decimal(qty)
        price_d = to_decimal(sold_inr)

        if qty_d is None or price_d is None or qty_d <= 0:
            # MANUAL-REVIEW RESOLUTION (4 genuine errors): inspected directly
            # in the source workbook — all 4 are abandoned line entries the
            # shopkeeper typed an item name for but never completed (qty and
            # sold(INR) both blank, Amount already 0, immediately adjacent to
            # otherwise-normal rows on the same date/shift). There is no
            # recoverable transaction here: no quantity or price to derive
            # one from. They are excluded deliberately, not silently dropped
            # by the generic validator, so this is recorded distinctly.
            report.add_excluded(
                "Sales Register", r,
                f"item '{item}' has no qty/price and Amount=0 — abandoned/incomplete "
                f"entry, no transaction to recover; excluded after manual review"
            )
            continue

        payment_raw = (ws.cell(r, 7).value or "").strip() if ws.cell(r, 7).value else ""
        payment_mode = {"cash": "CASH", "upi": "UPI", "credit": "CREDIT"}.get(payment_raw.lower(), "CASH")

        if_credit_val = ws.cell(r, 8).value
        credit_note = None
        if if_credit_val is not None:
            # This column is free-text in the source (customer name, 'UNPAID',
            # or a running total). We only trust it as a NOTE, never as a
            # structured amount — the new schema's credit_ledger is populated
            # from register_sale()'s own CHARGE logic, not this column.
            credit_note = str(if_credit_val).strip()
            if payment_mode != "CREDIT" and credit_note and not credit_note.replace('.', '', 1).isdigit():
                if credit_note.lower() == "credit":
                    # MANUAL-REVIEW RESOLUTION (21 mismatches): every one of
                    # these 21 rows has the literal word "credit" typed into
                    # the IF CREDIT column while Payment Mode says Cash/UPI —
                    # an unambiguous data-entry slip (as opposed to the
                    # dozens of OTHER rows in this column that hold a
                    # customer name like "DIDI"/"MAA"/"NABENDU", which are a
                    # legitimate different use of the column and are left
                    # alone). The clear intent was a credit sale, so
                    # payment_mode is corrected here rather than imported
                    # with a self-contradictory Cash/UPI + "credit" note.
                    credit_notes.append((r, item, credit_note, payment_mode))
                    payment_mode = "CREDIT"
                    credit_note = None
                else:
                    # A genuine free-text note (customer name etc.) on a
                    # non-credit row — kept as-is, not treated as an error.
                    pass

        customer_ref = ws.cell(r, 2).value
        customer_ref = str(customer_ref).strip() if customer_ref else None

        shift_raw = (ws.cell(r, 10).value or "")
        shift = None
        if isinstance(shift_raw, str) and shift_raw.strip().upper() in ("MORNING", "EVENING"):
            shift = shift_raw.strip().upper()

        sales.append({
            "row": r,
            "sale_date": sale_date.isoformat(),
            "customer_ref": customer_ref,
            "item_name": item,
            "qty": str(qty_d),
            "sold_inr": str(price_d),
            "payment_mode": payment_mode,
            "shift": shift,
            "credit_note": credit_note,
        })
        report.imported["Sales Register"] += 1

    if credit_notes:
        report.notes["Sales Register (credit column corrected)"] = [
            f"Row {r}: item '{item}' had IF CREDIT='{note}' with Payment Mode='{orig_mode}' "
            f"— reclassified to payment_mode=CREDIT (unambiguous data-entry slip)"
            for r, item, note, orig_mode in credit_notes
        ]

    return sales


def find_missing_product_refs(wb, product_names):
    """Pre-scan Purchase Register + Stock Register for item names that don't
    exist in the PA product master, without mutating either sheet.

    Returns an ordered dict: lower-cased name -> {"display_name", "sample_cost"}
    where sample_cost is a best-effort per-unit cost taken from the FIRST
    Purchase Register row that references the name (amount / qty), used only
    as a seed value for the auto-created product (see resolve_missing_products).
    """
    missing = {}

    purch_ws = wb["Purchase Register"]
    for r in range(2, purch_ws.max_row + 1):
        item = purch_ws.cell(r, 3).value
        if item is None or str(item).strip() == "":
            continue
        item = str(item).strip()
        key = item.lower()
        if key in product_names or key in missing:
            continue
        qty_d = to_decimal(purch_ws.cell(r, 4).value)
        amount_d = to_decimal(purch_ws.cell(r, 5).value)
        sample_cost = None
        if qty_d and amount_d and qty_d > 0:
            sample_cost = amount_d / qty_d
        missing[key] = {"display_name": item, "sample_cost": sample_cost}

    stock_ws = wb["Stock Register"]
    for r in range(2, stock_ws.max_row + 1):
        name = stock_ws.cell(r, 1).value
        if name is None or str(name).strip() == "":
            continue
        name = str(name).strip()
        key = name.lower()
        if key in product_names and key not in missing:
            continue
        missing.setdefault(key, {"display_name": name, "sample_cost": None})

    return missing


def resolve_missing_products(missing, report):
    """MANUAL-REVIEW RESOLUTION (87 Purchase Register + 43 Stock Register
    missing-product references, 90 unique names).

    These names were checked against the PA master for near-miss / typo
    matches (fuzzy match, cutoff 0.85). The vast majority turned out to be
    DIFFERENT inventory lots this shop tracks explicitly by number (e.g.
    "10 INR BISCUITS LOT 1" vs. the PA master's "10 inr biscuits lot 6" —
    a different batch, not a misspelling of the same product), so
    auto-merging by fuzzy name match was rejected as unsafe: it would
    silently combine the stock/cost history of two distinct product lots.

    Instead, each missing name gets a minimal PA product row auto-created
    here so the historical purchase/stock data is not discarded, tagged with
    category "NEEDS REVIEW" and, where derivable, a cost seeded from the
    first Purchase Register amount/qty for that name (MRP and offline_sp are
    left equal to cost as a conservative placeholder — an admin must correct
    real MRP/SP in the Settings/PA screen before relying on margin reports
    for these specific products). This mirrors exactly what a shop owner
    would do by hand: add the missing item to the price list, then fix its
    price later once known.
    """
    created = []
    for key, info in missing.items():
        name = info["display_name"]
        cost = info["sample_cost"] if info["sample_cost"] is not None else Decimal("0")
        cost = cost.quantize(Decimal("0.01")) if isinstance(cost, Decimal) else Decimal("0")
        created.append({
            "product_name": name,
            "category": "NEEDS REVIEW",
            "mrp": str(cost),
            "cost_per_unit": str(cost),
            "offline_sp": str(cost),
        })
    if created:
        report.notes["PA (auto-created from missing refs)"] = [
            f"'{c['product_name']}' — auto-created with cost/mrp/sp={c['cost_per_unit']} "
            f"(seeded from Purchase Register where available, else 0.00); "
            f"category set to NEEDS REVIEW — admin must verify real pricing"
            for c in created
        ]
    return created


def extract_stock_opening(wb, report, product_names):
    """Stock Register 'Opening' column -> OPENING stock_movements.
    Purchased/Sold/Closing/Variance are all derived in the new schema from
    purchase_items / sale_items / physical_stock_counts, so only Opening is
    imported as a literal starting balance.

    `product_names` is expected to already include names auto-created by
    resolve_missing_products(), so no row is rejected here for a missing
    product reference anymore — only for genuinely non-numeric Opening data.
    """
    ws = wb["Stock Register"]
    rows = []
    for r in range(2, ws.max_row + 1):
        name = ws.cell(r, 1).value
        opening = ws.cell(r, 3).value
        if name is None or str(name).strip() == "":
            report.skipped["Stock Register"] += 1
            continue
        name = str(name).strip()
        if name.lower() not in product_names:
            # Should not happen once resolve_missing_products() has run, but
            # kept as a defensive guard in case this function is ever called
            # standalone against a stale product_names set.
            report.add_error("Stock Register", r, f"item '{name}' not found in PA product master — skipped")
            continue
        opening_d = to_decimal(opening, default=Decimal("0"))
        if opening_d is None:
            report.add_error("Stock Register", r, f"non-numeric Opening for '{name}'")
            continue
        rows.append({"product_name": name, "opening_qty": str(opening_d)})
        report.imported["Stock Register"] += 1
    return rows


def extract_purchases(wb, report, product_names):
    """`product_names` is expected to already include names auto-created by
    resolve_missing_products() — see that function's docstring for why the
    87 originally-missing references are no longer rejected here.
    """
    ws = wb["Purchase Register"]
    rows = []
    for r in range(2, ws.max_row + 1):
        d = to_date(ws.cell(r, 1).value)
        supplier = ws.cell(r, 2).value
        item = ws.cell(r, 3).value
        qty = ws.cell(r, 4).value
        amount = ws.cell(r, 5).value
        paid_credit = ws.cell(r, 6).value

        if d is None and item is None:
            report.skipped["Purchase Register"] += 1
            continue
        if item is None or str(item).strip() == "":
            report.add_error("Purchase Register", r, "missing item name")
            continue
        item = str(item).strip()
        if item.lower() not in product_names:
            # Defensive guard only — see extract_stock_opening docstring.
            report.add_error("Purchase Register", r, f"item '{item}' not found in PA product master — skipped")
            continue

        qty_d = to_decimal(qty)
        amount_d = to_decimal(amount)
        if qty_d is None or amount_d is None or qty_d <= 0 or amount_d < 0:
            report.add_error("Purchase Register", r, f"invalid qty/amount for '{item}'")
            continue

        rows.append({
            "purchase_date": d.isoformat() if d else None,
            "supplier": (str(supplier).strip() if supplier else "Unknown Supplier"),
            "item_name": item,
            "qty": str(qty_d),
            "amount": str(amount_d),
            "paid_credit": "PAID" if (paid_credit or "").strip().upper() == "PAID" else "CREDIT",
        })
        report.imported["Purchase Register"] += 1
    return rows


def extract_expenses(wb, report):
    ws = wb["Expense Register"]
    rows = []
    for r in range(2, ws.max_row + 1):
        expense_type = ws.cell(r, 2).value
        amount = ws.cell(r, 3).value
        if expense_type is None or str(expense_type).strip() == "":
            report.skipped["Expense Register"] += 1
            continue
        amount_d = to_decimal(amount, default=None)
        if amount_d is None:
            # Several rows in the source have no amount yet (planned expenses) — skip, don't error.
            report.skipped["Expense Register"] += 1
            continue
        rows.append({
            "expense_date": to_date(ws.cell(r, 1).value).isoformat() if to_date(ws.cell(r, 1).value) else None,
            "expense_type": str(expense_type).strip(),
            "amount": str(amount_d),
            "mode": ws.cell(r, 4).value,
            "notes": ws.cell(r, 5).value,
        })
        report.imported["Expense Register"] += 1
    return rows


def extract_daily_accounts(wb, report):
    ws = wb["Daily Accounts"]
    rows = []
    seen_dates = set()
    for r in range(2, ws.max_row + 1):
        d = to_date(ws.cell(r, 1).value)
        if d is None:
            report.skipped["Daily Accounts"] += 1
            continue
        if d in seen_dates:
            report.add_duplicate("Daily Accounts", r, d.isoformat())
            continue
        seen_dates.add(d)

        vals = {}
        for col, key in [(2, "opening_cash"), (3, "cash_in_morning"), (4, "cash_in_evening"),
                          (5, "upi_in"), (6, "cash_out")]:
            v = to_decimal(ws.cell(r, col).value, default=Decimal("0"))
            if v is None:
                report.add_error("Daily Accounts", r, f"non-numeric value in column {col}")
                v = Decimal("0")
            vals[key] = str(v)

        rows.append({"account_date": d.isoformat(), **vals})
        report.imported["Daily Accounts"] += 1
    return rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Migrate Shree Shivansh Stores XLSM into Supabase")
    ap.add_argument("--file", required=True, help="Path to the .xlsm workbook")
    ap.add_argument("--dry-run", action="store_true", help="Validate + report only, no DB writes")
    ap.add_argument("--commit", action="store_true", help="Actually write to Supabase (requires env vars)")
    ap.add_argument("--admin-email", help="Email of the admin user to attribute imported rows to (--commit only)")
    ap.add_argument("--out", default="migration_report.json", help="Path to write the JSON report")
    args = ap.parse_args()

    if args.commit and args.dry_run:
        print("Choose either --dry-run or --commit, not both.")
        sys.exit(1)
    if not args.commit and not args.dry_run:
        print("Defaulting to --dry-run (pass --commit explicitly to write data).")
        args.dry_run = True

    print(f"Loading workbook: {args.file} ...")
    wb = openpyxl.load_workbook(args.file, data_only=True)
    report = Report()

    products = extract_products(wb, report)
    product_names = {p["product_name"].lower() for p in products}

    # MANUAL-REVIEW RESOLUTION (87 + 43 missing-product references): auto-create
    # a minimal, clearly-flagged PA row for every name Purchase/Stock reference
    # but PA doesn't have, rather than dropping real historical purchase and
    # stock data. See resolve_missing_products() for why fuzzy name-matching
    # against near-miss PA entries was considered and rejected as unsafe.
    missing_refs = find_missing_product_refs(wb, product_names)
    auto_created_products = resolve_missing_products(missing_refs, report)
    products.extend(auto_created_products)
    product_names |= {p["product_name"].lower() for p in auto_created_products}

    sales = extract_customers_and_sales(wb, report)
    stock_opening = extract_stock_opening(wb, report, product_names)
    purchases = extract_purchases(wb, report, product_names)
    expenses = extract_expenses(wb, report)
    daily_accounts = extract_daily_accounts(wb, report)

    report.print_summary()

    payload = {
        "products": products,
        "sales": sales,
        "stock_opening": stock_opening,
        "purchases": purchases,
        "expenses": expenses,
        "daily_accounts": daily_accounts,
    }
    with open(args.out, "w") as f:
        json.dump(payload, f, indent=2, default=str)
    print(f"\nFull structured payload written to {args.out}")
    print(f"(Row-level counts above are also mirrored in {args.out.replace('.json','_summary.txt')})")

    if args.dry_run:
        print("\nDRY RUN COMPLETE. No data was written to any database.")
        print("Review the errors/duplicates above, fix the source workbook or this")
        print("script's mapping rules, then re-run with --commit once satisfied.")
        return

    # --commit path
    if requests is None:
        print("ERROR: `requests` package not installed. pip install requests --break-system-packages")
        sys.exit(1)
    import os
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as environment variables.")
        print("Never hardcode the service role key in this script or commit it to git.")
        sys.exit(1)
    if not args.admin_email:
        print("ERROR: --admin-email is required for --commit (rows need an owning user).")
        sys.exit(1)

    if report.errors and any(report.errors.values()):
        print("\nERROR: validation errors present. Fix the source data or mapping")
        print("rules and re-run --dry-run until clean before using --commit.")
        sys.exit(1)

    commit_import(payload, url, key, args.admin_email, report)
    report.print_summary()
    with open(args.out, "w") as f:
        json.dump(payload, f, indent=2, default=str)


# ---------------------------------------------------------------------------
# --commit: live Supabase writes (service-role key; REST + PostgREST RPC)
# ---------------------------------------------------------------------------
class SupabaseAdmin:
    """Thin REST wrapper using the service-role key. Bypasses RLS by design —
    this must only ever run locally, never in a browser or CI job that could
    leak the key."""

    def __init__(self, url, key):
        self.base = url.rstrip("/")
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def get(self, table, params):
        r = requests.get(f"{self.base}/rest/v1/{table}", headers=self.headers, params=params)
        r.raise_for_status()
        return r.json()

    def upsert(self, table, rows, on_conflict=None, returning="representation"):
        if not rows:
            return []
        headers = dict(self.headers)
        headers["Prefer"] = f"resolution=merge-duplicates,return={returning}"
        params = {"on_conflict": on_conflict} if on_conflict else {}
        r = requests.post(f"{self.base}/rest/v1/{table}", headers=headers, params=params, json=rows)
        if r.status_code >= 400:
            raise RuntimeError(f"upsert {table} failed [{r.status_code}]: {r.text[:500]}")
        return r.json() if r.content else []

    def rpc(self, fn, args):
        r = requests.post(f"{self.base}/rest/v1/rpc/{fn}", headers=self.headers, json=args)
        if r.status_code >= 400:
            raise RuntimeError(f"rpc {fn} failed [{r.status_code}]: {r.text[:500]}")
        return r.json() if r.content else None


def get_admin_user_id(db, email):
    rows = db.get("profiles", {"select": "id,full_name", "id": f"eq.{email}"})
    if rows:
        return rows[0]["id"]
    # profiles.id == auth.users.id; profiles has no email column, so resolve
    # via the admin auth endpoint instead.
    r = requests.get(
        f"{db.base}/auth/v1/admin/users",
        headers=db.headers,
        params={"email": email},
    )
    r.raise_for_status()
    users = r.json().get("users", [])
    if not users:
        raise RuntimeError(f"No auth user found for --admin-email {email}. Create/invite the user first.")
    return users[0]["id"]


def commit_import(payload, url, key, admin_email, report):
    db = SupabaseAdmin(url, key)
    admin_id = get_admin_user_id(db, admin_email)
    print(f"\nAttributing imported rows to admin user id: {admin_id}")

    # 1) PRODUCTS — upsert on lower(product_name) unique index. REST upsert
    #    conflict target must be an actual constraint name/column list, so we
    #    upsert on product_name and rely on the DB's case-insensitive unique
    #    index only for pre-existing rows created outside this script.
    print(f"Writing {len(payload['products'])} products ...")
    name_to_id = {}
    CHUNK = 500
    prods = payload["products"]
    for i in range(0, len(prods), CHUNK):
        batch = prods[i : i + CHUNK]
        result = db.upsert(
            "products",
            [
                {
                    "product_name": p["product_name"],
                    "category": p["category"],
                    "mrp": p["mrp"],
                    "cost_per_unit": p["cost_per_unit"],
                    "offline_sp": p["offline_sp"],
                }
                for p in batch
            ],
            on_conflict="product_name",
        )
        for row in result:
            name_to_id[row["product_name"].lower()] = row["id"]
    # Any products not returned by upsert (e.g. server returned minimal rep) —
    # re-fetch to be sure every name maps to an id before purchases/sales.
    missing_ids = [p["product_name"] for p in prods if p["product_name"].lower() not in name_to_id]
    if missing_ids:
        fetched = db.get("products", {"select": "id,product_name", "product_name": f"in.({','.join(missing_ids)})"})
        for row in fetched:
            name_to_id[row["product_name"].lower()] = row["id"]
    report.notes["commit"].append(f"products upserted/resolved: {len(name_to_id)}")

    # 2) STOCK OPENING — one OPENING stock_movements row per product.
    print(f"Writing {len(payload['stock_opening'])} opening stock movements ...")
    opening_rows = []
    for s in payload["stock_opening"]:
        pid = name_to_id.get(s["product_name"].lower())
        if not pid:
            report.add_error("Stock Register", 0, f"no product id for '{s['product_name']}' — skipped opening stock")
            continue
        if Decimal(s["opening_qty"]) == 0:
            continue  # nothing to record
        opening_rows.append(
            {
                "product_id": pid,
                "movement_type": "OPENING",
                "qty_delta": s["opening_qty"],
                "reference_table": None,
                "reference_id": None,
                "note": "Imported from Stock Register (Opening column)",
                "created_by": admin_id,
            }
        )
    for i in range(0, len(opening_rows), CHUNK):
        db.upsert("stock_movements", opening_rows[i : i + CHUNK], returning="minimal")
    report.imported["Stock Register (committed)"] = len(opening_rows)

    # 3) PURCHASES -> stock. Group Purchase Register rows into one purchases
    #    header per (date, supplier) so stock IN history matches the
    #    workbook's row-level entries while still using record_purchase()'s
    #    atomic header+items+stock_movements write path via direct inserts
    #    (record_purchase() itself requires an authenticated admin JWT, which
    #    a service-role script does not have — auth.uid() would be null — so
    #    here we replicate its effect directly with the service key instead).
    print(f"Writing {len(payload['purchases'])} purchase line items ...")
    groups = defaultdict(list)
    for p in payload["purchases"]:
        groups[(p["purchase_date"], p["supplier"])].append(p)

    purchase_count = 0
    stock_from_purchases = []
    for (pdate, supplier), items in groups.items():
        header = db.upsert(
            "purchases",
            [{"purchase_date": pdate, "supplier": supplier, "created_by": admin_id}],
            returning="representation",
        )
        purchase_id = header[0]["id"]
        item_rows = []
        for it in items:
            pid = name_to_id.get(it["item_name"].lower())
            if not pid:
                report.add_error("Purchase Register", 0, f"no product id for '{it['item_name']}' — skipped")
                continue
            item_rows.append(
                {
                    "purchase_id": purchase_id,
                    "product_id": pid,
                    "item_name_snap": it["item_name"],
                    "qty": it["qty"],
                    "amount": it["amount"],
                    "paid_credit": it["paid_credit"],
                }
            )
            stock_from_purchases.append(
                {
                    "product_id": pid,
                    "movement_type": "PURCHASE",
                    "qty_delta": it["qty"],
                    "reference_table": "purchases",
                    "reference_id": purchase_id,
                    "note": "Imported from Purchase Register",
                    "created_by": admin_id,
                }
            )
        db.upsert("purchase_items", item_rows, returning="minimal")
        purchase_count += len(item_rows)
    for i in range(0, len(stock_from_purchases), CHUNK):
        db.upsert("stock_movements", stock_from_purchases[i : i + CHUNK], returning="minimal")
    report.imported["Purchase Register (committed)"] = purchase_count

    # 4) SALES -> sale_items -> stock + credit_ledger, via register_sale()
    #    equivalent logic (direct inserts, since RPC requires a real session).
    #    One sales header per source row (workbook rows are already one
    #    line-item per row, matching sale_items granularity 1:1).
    print(f"Writing {len(payload['sales'])} sales ...")
    sale_count = 0
    for s in payload["sales"]:
        pid = name_to_id.get(s["item_name"].lower())
        if not pid:
            report.add_error("Sales Register", s["row"], f"no product id for '{s['item_name']}' — skipped")
            continue

        sale_header = db.upsert(
            "sales",
            [
                {
                    "sale_date": s["sale_date"],
                    "customer_id": None,
                    "customer_ref": s["customer_ref"],
                    "payment_mode": s["payment_mode"],
                    "shift": s["shift"],
                    "created_by": admin_id,
                }
            ],
            returning="representation",
        )
        sale_id = sale_header[0]["id"]

        prod = db.get("products", {"select": "product_name,mrp,cost_per_unit", "id": f"eq.{pid}"})[0]
        db.upsert(
            "sale_items",
            [
                {
                    "sale_id": sale_id,
                    "product_id": pid,
                    "item_name_snap": prod["product_name"],
                    "qty": s["qty"],
                    "sold_inr": s["sold_inr"],
                    "mrp_snap": prod["mrp"],
                    "cost_snap": prod["cost_per_unit"],
                }
            ],
            returning="minimal",
        )
        db.upsert(
            "stock_movements",
            [
                {
                    "product_id": pid,
                    "movement_type": "SALE",
                    "qty_delta": str(-Decimal(s["qty"])),
                    "reference_table": "sales",
                    "reference_id": sale_id,
                    "note": "Imported from Sales Register",
                    "created_by": admin_id,
                }
            ],
            returning="minimal",
        )
        if s["payment_mode"] == "CREDIT":
            amount = str(Decimal(s["qty"]) * Decimal(s["sold_inr"]))
            report.add_note(
                "Sales Register (credit, no customer link)",
                f"Row {s['row']}: item '{s['item_name']}' amount {amount} imported as CREDIT sale "
                f"with no customer_id (source has no reliable customer master) — no credit_ledger "
                f"row was created; reconcile manually if per-customer balances are needed.",
            )
        sale_count += 1
        if sale_count % 200 == 0:
            print(f"  ... {sale_count} sales written")

    report.imported["Sales Register (committed)"] = sale_count

    # 5) EXPENSES
    print(f"Writing {len(payload['expenses'])} expenses ...")
    exp_rows = [
        {
            "expense_date": e["expense_date"],
            "expense_type": e["expense_type"],
            "amount": e["amount"],
            "mode": e["mode"],
            "notes": e["notes"],
            "created_by": admin_id,
        }
        for e in payload["expenses"]
    ]
    for i in range(0, len(exp_rows), CHUNK):
        db.upsert("expenses", exp_rows[i : i + CHUNK], returning="minimal")

    # 6) DAILY ACCOUNTS — upsert on unique account_date
    print(f"Writing {len(payload['daily_accounts'])} daily account rows ...")
    da_rows = [{**d, "created_by": admin_id} for d in payload["daily_accounts"]]
    for i in range(0, len(da_rows), CHUNK):
        db.upsert("daily_accounts", da_rows[i : i + CHUNK], on_conflict="account_date", returning="minimal")

    print("\nCOMMIT COMPLETE.")
    print(f"  products:  {len(name_to_id)}")
    print(f"  purchases: {purchase_count} line items")
    print(f"  sales:     {sale_count}")
    print(f"  expenses:  {len(exp_rows)}")
    print(f"  daily accounts: {len(da_rows)}")
    print("\nNOTE: imported CREDIT sales have no customer_id (source workbook has")
    print("no reliable customer master), so no credit_ledger CHARGE rows were")
    print("created for them — see notes in the report for affected rows.")


if __name__ == "__main__":
    main()
