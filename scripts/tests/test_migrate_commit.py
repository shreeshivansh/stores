import json
import re

import pytest
import responses

from migrate_xlsm import SupabaseAdmin, get_admin_user_id, commit_import, Report

BASE = "https://test-project.supabase.co"


@responses.activate
def test_supabase_admin_upsert_sends_prefer_header_and_returns_json():
    responses.add(
        responses.POST,
        f"{BASE}/rest/v1/products",
        json=[{"id": "p1", "product_name": "Tata Salt"}],
        status=201,
    )
    db = SupabaseAdmin(BASE, "service-key")
    result = db.upsert("products", [{"product_name": "Tata Salt"}], on_conflict="product_name")
    assert result == [{"id": "p1", "product_name": "Tata Salt"}]
    sent = responses.calls[0].request
    assert sent.headers["Prefer"].startswith("resolution=merge-duplicates")
    assert sent.headers["apikey"] == "service-key"


@responses.activate
def test_supabase_admin_upsert_raises_on_error_status():
    responses.add(responses.POST, f"{BASE}/rest/v1/products", json={"message": "boom"}, status=400)
    db = SupabaseAdmin(BASE, "service-key")
    with pytest.raises(RuntimeError, match="upsert products failed"):
        db.upsert("products", [{"product_name": "X"}])


@responses.activate
def test_get_admin_user_id_resolves_via_auth_admin_endpoint():
    responses.add(responses.GET, f"{BASE}/rest/v1/profiles", json=[], status=200)
    responses.add(
        responses.GET,
        f"{BASE}/auth/v1/admin/users",
        json={"users": [{"id": "admin-uuid-123"}]},
        status=200,
    )
    db = SupabaseAdmin(BASE, "service-key")
    uid = get_admin_user_id(db, "owner@example.com")
    assert uid == "admin-uuid-123"


@responses.activate
def test_get_admin_user_id_raises_if_no_user_found():
    responses.add(responses.GET, f"{BASE}/rest/v1/profiles", json=[], status=200)
    responses.add(responses.GET, f"{BASE}/auth/v1/admin/users", json={"users": []}, status=200)
    db = SupabaseAdmin(BASE, "service-key")
    with pytest.raises(RuntimeError, match="No auth user found"):
        get_admin_user_id(db, "missing@example.com")


def _minimal_payload():
    return {
        "products": [
            {"product_name": "Tata Salt", "category": "Grocery", "mrp": "30", "cost_per_unit": "24", "offline_sp": "27"},
        ],
        "sales": [
            {
                "row": 3,
                "sale_date": "2026-07-01",
                "customer_ref": "Grocery",
                "item_name": "Tata Salt",
                "qty": "2",
                "sold_inr": "27",
                "payment_mode": "CASH",
                "shift": "MORNING",
                "credit_note": None,
            },
            {
                "row": 4,
                "sale_date": "2026-07-02",
                "customer_ref": None,
                "item_name": "Tata Salt",
                "qty": "1",
                "sold_inr": "27",
                "payment_mode": "CREDIT",
                "shift": "EVENING",
                "credit_note": None,
            },
        ],
        "stock_opening": [{"product_name": "Tata Salt", "opening_qty": "50"}],
        "purchases": [
            {"purchase_date": "2026-06-25", "supplier": "ABC Distributors", "item_name": "Tata Salt",
             "qty": "100", "amount": "2200", "paid_credit": "PAID"},
        ],
        "expenses": [
            {"expense_date": "2026-06-01", "expense_type": "Electricity", "amount": "1500", "mode": "UPI", "notes": None},
        ],
        "daily_accounts": [
            {"account_date": "2026-07-01", "opening_cash": "1000", "cash_in_morning": "2000",
             "cash_in_evening": "1500", "upi_in": "800", "cash_out": "300"},
        ],
    }


@responses.activate
def test_commit_import_writes_all_tables_and_resolves_product_ids():
    responses.add(responses.GET, f"{BASE}/rest/v1/profiles", json=[], status=200)
    responses.add(responses.GET, f"{BASE}/auth/v1/admin/users", json={"users": [{"id": "admin-1"}]}, status=200)

    # products upsert -> returns the row with an id
    responses.add(
        responses.POST, f"{BASE}/rest/v1/products",
        json=[{"id": "prod-1", "product_name": "Tata Salt"}], status=201,
    )
    # stock_movements (opening)
    responses.add(responses.POST, f"{BASE}/rest/v1/stock_movements", json=[], status=201)
    # purchases header
    responses.add(
        responses.POST, f"{BASE}/rest/v1/purchases",
        json=[{"id": "purch-1"}], status=201,
    )
    # purchase_items
    responses.add(responses.POST, f"{BASE}/rest/v1/purchase_items", json=[], status=201)
    # stock_movements (purchase) -- second call matches same URL, responses cycles registered entries by default
    responses.add(responses.POST, f"{BASE}/rest/v1/stock_movements", json=[], status=201)

    # sales header x2 + sale_items x2 + stock_movements x2 (SALE)
    responses.add(responses.POST, f"{BASE}/rest/v1/sales", json=[{"id": "sale-1"}], status=201)
    responses.add(
        responses.GET, f"{BASE}/rest/v1/products",
        json=[{"product_name": "Tata Salt", "mrp": 30, "cost_per_unit": 24}], status=200,
    )
    responses.add(responses.POST, f"{BASE}/rest/v1/sale_items", json=[], status=201)
    responses.add(responses.POST, f"{BASE}/rest/v1/stock_movements", json=[], status=201)

    responses.add(responses.POST, f"{BASE}/rest/v1/sales", json=[{"id": "sale-2"}], status=201)
    responses.add(
        responses.GET, f"{BASE}/rest/v1/products",
        json=[{"product_name": "Tata Salt", "mrp": 30, "cost_per_unit": 24}], status=200,
    )
    responses.add(responses.POST, f"{BASE}/rest/v1/sale_items", json=[], status=201)
    responses.add(responses.POST, f"{BASE}/rest/v1/stock_movements", json=[], status=201)

    # expenses
    responses.add(responses.POST, f"{BASE}/rest/v1/expenses", json=[], status=201)
    # daily_accounts
    responses.add(responses.POST, f"{BASE}/rest/v1/daily_accounts", json=[], status=201)

    report = Report()
    commit_import(_minimal_payload(), BASE, "service-key", "owner@example.com", report)

    assert report.imported["Sales Register (committed)"] == 2
    assert report.imported["Purchase Register (committed)"] == 1
    assert report.imported["Stock Register (committed)"] == 1
    # credit sale with no customer_id gets a note, not a credit_ledger write
    assert report.notes["Sales Register (credit, no customer_id)"] or any(
        "no customer_id" in n for notes in report.notes.values() for n in notes
    )


@responses.activate
def test_commit_import_records_error_when_product_unresolved():
    responses.add(responses.GET, f"{BASE}/rest/v1/profiles", json=[], status=200)
    responses.add(responses.GET, f"{BASE}/auth/v1/admin/users", json={"users": [{"id": "admin-1"}]}, status=200)
    # products upsert returns nothing usable, and the follow-up GET also returns nothing
    responses.add(responses.POST, f"{BASE}/rest/v1/products", json=[], status=201)
    responses.add(responses.GET, f"{BASE}/rest/v1/products", json=[], status=200)
    responses.add(responses.POST, f"{BASE}/rest/v1/stock_movements", json=[], status=201)
    responses.add(responses.POST, f"{BASE}/rest/v1/purchases", json=[{"id": "purch-1"}], status=201)
    responses.add(responses.POST, f"{BASE}/rest/v1/purchase_items", json=[], status=201)
    responses.add(responses.POST, f"{BASE}/rest/v1/stock_movements", json=[], status=201)
    responses.add(responses.POST, f"{BASE}/rest/v1/expenses", json=[], status=201)
    responses.add(responses.POST, f"{BASE}/rest/v1/daily_accounts", json=[], status=201)

    payload = _minimal_payload()
    report = Report()
    commit_import(payload, BASE, "service-key", "owner@example.com", report)

    assert report.errors["Purchase Register"]
    assert report.errors["Sales Register"]
