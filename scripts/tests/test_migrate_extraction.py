from decimal import Decimal

from migrate_xlsm import (
    Report,
    extract_products,
    extract_customers_and_sales,
    find_missing_product_refs,
    resolve_missing_products,
    extract_stock_opening,
    extract_purchases,
    extract_expenses,
    extract_daily_accounts,
)


def test_extract_products_keeps_last_occurrence_on_duplicate(loaded_wb):
    report = Report()
    products = extract_products(loaded_wb, report)
    names = {p["product_name"]: p for p in products}

    assert names["Tata Salt"]["mrp"] == "30"
    assert names["Tata Salt"]["cost_per_unit"] == "24"
    assert report.duplicates["PA"], "expected a duplicate to be recorded"


def test_extract_products_flags_non_numeric_and_negative(loaded_wb):
    report = Report()
    products = extract_products(loaded_wb, report)
    names = {p["product_name"] for p in products}

    assert "Bad Item" not in names
    assert "Negative Item" not in names
    assert len(report.errors["PA"]) == 2


def test_extract_products_skips_blank_rows(loaded_wb):
    report = Report()
    extract_products(loaded_wb, report)
    assert report.skipped["PA"] == 1


def test_sales_register_reclassifies_credit_typo(loaded_wb):
    report = Report()
    sales = extract_customers_and_sales(loaded_wb, report)
    parle = next(s for s in sales if s["item_name"] == "Parle G")
    assert parle["payment_mode"] == "CREDIT"
    assert parle["credit_note"] is None
    assert report.notes["Sales Register (credit column corrected)"]


def test_sales_register_keeps_customer_name_note_untouched(loaded_wb):
    report = Report()
    sales = extract_customers_and_sales(loaded_wb, report)
    row = next(s for s in sales if s["sale_date"] == "2026-07-02" and s["item_name"] == "Tata Salt")
    assert row["payment_mode"] == "CREDIT"
    assert row["credit_note"] == "Ramesh"


def test_sales_register_skips_daily_total_rows(loaded_wb):
    report = Report()
    sales = extract_customers_and_sales(loaded_wb, report)
    assert all(s["item_name"] != "" for s in sales)
    assert report.skipped["Sales Register"] >= 1


def test_sales_register_excludes_abandoned_entries(loaded_wb):
    report = Report()
    sales = extract_customers_and_sales(loaded_wb, report)
    assert not any(s["item_name"] == "Incomplete Item" for s in sales)
    assert report.excluded["Sales Register"]


def test_sales_register_amount_matches_qty_times_price(loaded_wb):
    report = Report()
    sales = extract_customers_and_sales(loaded_wb, report)
    salt = next(s for s in sales if s["item_name"] == "Tata Salt" and s["sale_date"] == "2026-07-01")
    assert Decimal(salt["qty"]) * Decimal(salt["sold_inr"]) == Decimal("50")


def test_missing_product_refs_detected_and_resolved(loaded_wb):
    report = Report()
    products = extract_products(loaded_wb, report)
    product_names = {p["product_name"].lower() for p in products}

    missing = find_missing_product_refs(loaded_wb, product_names)
    assert "new widget" in missing
    assert missing["new widget"]["sample_cost"] == Decimal("20")  # 400/20

    created = resolve_missing_products(missing, report)
    created_names = {c["product_name"] for c in created}
    assert "New Widget" in created_names
    widget = next(c for c in created if c["product_name"] == "New Widget")
    assert widget["category"] == "NEEDS REVIEW"
    assert widget["cost_per_unit"] == "20.00"
    assert report.notes["PA (auto-created from missing refs)"]


def test_stock_opening_requires_resolved_product_names(loaded_wb):
    report = Report()
    products = extract_products(loaded_wb, report)
    product_names = {p["product_name"].lower() for p in products}
    missing = find_missing_product_refs(loaded_wb, product_names)
    created = resolve_missing_products(missing, report)
    product_names |= {c["product_name"].lower() for c in created}

    rows = extract_stock_opening(loaded_wb, report, product_names)
    by_name = {r["product_name"]: r for r in rows}
    assert by_name["Tata Salt"]["opening_qty"] == "50"
    assert "New Widget" in by_name
    assert not report.errors["Stock Register"]


def test_stock_opening_errors_without_product_resolution(loaded_wb):
    report = Report()
    products = extract_products(loaded_wb, report)
    product_names = {p["product_name"].lower() for p in products}  # New Widget NOT resolved

    extract_stock_opening(loaded_wb, report, product_names)
    assert report.errors["Stock Register"]


def test_extract_purchases_valid_rows(loaded_wb):
    report = Report()
    products = extract_products(loaded_wb, report)
    product_names = {p["product_name"].lower() for p in products}
    missing = find_missing_product_refs(loaded_wb, product_names)
    created = resolve_missing_products(missing, report)
    product_names |= {c["product_name"].lower() for c in created}

    rows = extract_purchases(loaded_wb, report, product_names)
    assert len(rows) == 2
    salt_purchase = next(r for r in rows if r["item_name"] == "Tata Salt")
    assert salt_purchase["paid_credit"] == "PAID"
    widget_purchase = next(r for r in rows if r["item_name"] == "New Widget")
    assert widget_purchase["paid_credit"] == "CREDIT"


def test_extract_expenses_skips_rows_without_amount(loaded_wb):
    report = Report()
    rows = extract_expenses(loaded_wb, report)
    assert len(rows) == 1
    assert rows[0]["expense_type"] == "Electricity"
    assert report.skipped["Expense Register"] == 1


def test_extract_daily_accounts_flags_duplicate_dates(loaded_wb):
    report = Report()
    rows = extract_daily_accounts(loaded_wb, report)
    assert len(rows) == 1
    assert rows[0]["account_date"] == "2026-07-01"
    assert report.duplicates["Daily Accounts"]


def test_extract_daily_accounts_computed_values(loaded_wb):
    report = Report()
    rows = extract_daily_accounts(loaded_wb, report)
    row = rows[0]
    assert row["opening_cash"] == "1000"
    assert row["cash_out"] == "300"
