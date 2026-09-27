import { supabase } from '@/lib/supabase';
import type { PaymentMode, SaleItemInput, ShiftType } from '@/types';

export async function searchProducts(query: string) {
  // Reads v_products_public — grant chain enforces cost_per_unit is never
  // present in the response shape at all (see 0003_rls_policies.sql).
  const { data, error } = await supabase
    .from('v_products_public')
    .select('*')
    .ilike('product_name', `%${query}%`)
    .order('product_name')
    .limit(30);
  if (error) throw error;
  return data;
}

export async function registerSale(params: {
  saleDate: string;
  customerId: string | null;
  customerRef: string | null;
  paymentMode: PaymentMode;
  shift: ShiftType | null;
  items: SaleItemInput[];
}) {
  const { data, error } = await supabase.rpc('register_sale', {
    p_sale_date: params.saleDate,
    p_customer_id: params.customerId,
    p_customer_ref: params.customerRef,
    p_payment_mode: params.paymentMode,
    p_shift: params.shift,
    p_items: params.items.map((i) => ({
      product_id: i.product_id,
      qty: i.qty,
      sold_inr: i.sold_inr,
    })),
    p_allow_negative_stock: false,
  });
  if (error) throw error;
  return data as string; // sale_id
}

export async function generateBill(saleId: string) {
  const { data, error } = await supabase.rpc('generate_bill', { p_sale_id: saleId });
  if (error) throw error;
  return data as string; // bill_id
}

export async function getMySalesRegister(limit = 50, offset = 0) {
  // RLS (sales_client_select_own via the sale header join) ensures this
  // returns only the current user's own rows, never another user's sales.
  const { data, error, count } = await supabase
    .from('v_sales_register')
    .select('*', { count: 'exact' })
    .order('sale_date', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return { rows: data, count: count ?? 0 };
}

export async function getBillWithItems(billId: string) {
  const { data: bill, error: billErr } = await supabase.from('bills').select('*').eq('id', billId).single();
  if (billErr) throw billErr;

  const { data: items, error: itemsErr } = await supabase
    .from('sale_items')
    .select('item_name_snap, qty, sold_inr, mrp_snap, amount')
    .eq('sale_id', bill.sale_id)
    .order('created_at');
  if (itemsErr) throw itemsErr;

  let customer = null;
  if (bill.customer_id) {
    const { data: c } = await supabase.from('customers').select('full_name, phone, whatsapp').eq('id', bill.customer_id).single();
    customer = c;
  }

  return { bill, items, customer };
}
