-- ============================================================================
-- Migration 0005: Seed default app_settings from workbook BILL sheet
-- These are safe to ship — no secrets. Admin can edit all of this in Settings.
-- ============================================================================

insert into app_settings (key, value) values
(
  'store_profile',
  jsonb_build_object(
    'store_name', 'Shree Shivansh Stores',
    'address_line1', 'Shibnagar College Road Extension',
    'address_line2', 'Behind Ananda Marga School',
    'address_line3', 'P.O: Agartala College 799004',
    'bill_prefix', 'SSS',
    'currency', 'INR',
    'currency_symbol', '₹'
  )
),
(
  'whatsapp_template',
  jsonb_build_object(
    'template',
    'Hello {{customer_name}}, thank you for shopping at {{store_name}}! ' ||
    E'\n\nBill No: {{bill_number}}\nDate: {{bill_date}}\nItems: {{item_summary}}\nTotal: {{currency_symbol}}{{total_amount}}' ||
    E'\n\nView your bill: {{bill_link}}\n\nThank you for your business!'
  )
),
(
  'feature_flags',
  jsonb_build_object(
    'allow_negative_stock', false,
    'low_stock_threshold', 5,
    'offline_sale_entry', false,
    'beta_banner', true
  )
),
(
  'currency',
  jsonb_build_object('code', 'INR', 'symbol', '₹', 'locale', 'en-IN')
)
on conflict (key) do nothing;
