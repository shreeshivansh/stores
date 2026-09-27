import { supabase } from '@/lib/supabase';

export async function searchCustomers(query: string) {
  const { data, error } = await supabase
    .from('customers')
    .select('id, full_name, phone, whatsapp, address, reference')
    .ilike('full_name', `%${query}%`)
    .order('full_name')
    .limit(20);
  if (error) throw error;
  return data;
}

export async function createCustomer(params: {
  fullName: string;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  reference?: string | null;
}) {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('customers')
    .insert({
      full_name: params.fullName,
      phone: params.phone || null,
      whatsapp: params.whatsapp || null,
      address: params.address || null,
      reference: params.reference || null,
      created_by: userData.user?.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getCustomerCreditBalance(customerId: string) {
  const { data, error } = await supabase
    .from('v_customer_credit_balance')
    .select('balance_due')
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  return data?.balance_due ?? 0;
}

export async function recordCreditPayment(customerId: string, amount: number, note?: string) {
  const { data, error } = await supabase.rpc('record_credit_payment', {
    p_customer_id: customerId,
    p_amount: amount,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data;
}
