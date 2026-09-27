import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { StoreProfileSettings } from '@/types';

interface WhatsAppTemplateSettings {
  template: string;
}

interface FeatureFlagSettings {
  allow_negative_stock: boolean;
  low_stock_threshold: number;
  offline_sale_entry: boolean;
  beta_banner: boolean;
}

const DEFAULT_STORE_PROFILE: StoreProfileSettings = {
  store_name: '',
  address_line1: '',
  address_line2: '',
  address_line3: '',
  bill_prefix: '',
  currency: 'INR',
  currency_symbol: '₹',
};

const DEFAULT_TEMPLATE: WhatsAppTemplateSettings = {
  template:
    'Hello {{customer_name}}, thank you for shopping at {{store_name}}!\n\nBill No: {{bill_number}}\nDate: {{bill_date}}\nItems: {{item_summary}}\nTotal: {{currency_symbol}}{{total_amount}}\n\nThank you for your business!',
};

const DEFAULT_FLAGS: FeatureFlagSettings = {
  allow_negative_stock: false,
  low_stock_threshold: 5,
  offline_sale_entry: false,
  beta_banner: true,
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function SettingsPage() {
  const [storeProfile, setStoreProfile] = useState<StoreProfileSettings>(DEFAULT_STORE_PROFILE);
  const [whatsapp, setWhatsapp] = useState<WhatsAppTemplateSettings>(DEFAULT_TEMPLATE);
  const [flags, setFlags] = useState<FeatureFlagSettings>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Admin sees the raw app_settings rows directly (app_settings_admin_all);
    // clients only ever see the narrower v_public_settings projection.
    supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['store_profile', 'whatsapp_template', 'feature_flags'])
      .then(({ data }) => {
        for (const row of data ?? []) {
          if (row.key === 'store_profile') setStoreProfile({ ...DEFAULT_STORE_PROFILE, ...(row.value as object) });
          if (row.key === 'whatsapp_template') setWhatsapp({ ...DEFAULT_TEMPLATE, ...(row.value as object) });
          if (row.key === 'feature_flags') setFlags({ ...DEFAULT_FLAGS, ...(row.value as object) });
        }
      })
      .then(
        () => setLoading(false),
        () => setLoading(false)
      );
  }, []);

  async function saveSetting(key: string, value: unknown) {
    setSaveState('saving');
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error: upsertError } = await supabase
        .from('app_settings')
        .upsert({ key, value, updated_by: userData.user?.id, updated_at: new Date().toISOString() });
      if (upsertError) throw upsertError;
      await supabase
        .rpc('log_audit_event', {
          p_action: 'settings.update',
          p_entity_table: 'app_settings',
          p_entity_id: key,
          p_after: value,
        })
        .then(
          () => {},
          () => {}
        );
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (e: any) {
      setError(e.message ?? 'Failed to save settings');
      setSaveState('error');
    }
  }

  if (loading) return <div className="text-darkest/50">Loading settings…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-forest">Settings</h1>
        <p className="text-sm text-darkest/60">
          Stored in <code className="bg-cream px-1 rounded">app_settings</code> — never secrets, just store profile and behavioral
          configuration. Every save here is recorded in the Audit Logs.
        </p>
      </div>

      {error && <div className="bg-packred/10 border border-packred/30 text-packred text-sm rounded-lg px-3 py-2">{error}</div>}
      {saveState === 'saved' && <div className="bg-fresh/10 border border-fresh/30 text-fresh text-sm rounded-lg px-3 py-2">Saved.</div>}

      {/* Store profile */}
      <section className="bg-white rounded-xl2 border border-amber/20 shadow-sm p-5 space-y-3">
        <h2 className="font-bold text-forest">Store Profile</h2>
        <Field label="Store Name" value={storeProfile.store_name} onChange={(v) => setStoreProfile({ ...storeProfile, store_name: v })} />
        <Field label="Address Line 1" value={storeProfile.address_line1} onChange={(v) => setStoreProfile({ ...storeProfile, address_line1: v })} />
        <Field label="Address Line 2" value={storeProfile.address_line2} onChange={(v) => setStoreProfile({ ...storeProfile, address_line2: v })} />
        <Field label="Address Line 3" value={storeProfile.address_line3} onChange={(v) => setStoreProfile({ ...storeProfile, address_line3: v })} />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Bill Prefix"
            value={storeProfile.bill_prefix}
            onChange={(v) => setStoreProfile({ ...storeProfile, bill_prefix: v.toUpperCase() })}
            hint="Used by next_bill_number(): PREFIX-YYYYMM-000001"
          />
          <Field label="Currency Symbol" value={storeProfile.currency_symbol} onChange={(v) => setStoreProfile({ ...storeProfile, currency_symbol: v })} />
        </div>
        <button
          onClick={() => saveSetting('store_profile', storeProfile)}
          disabled={saveState === 'saving'}
          className="bg-forest text-cream font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          Save Store Profile
        </button>
      </section>

      {/* WhatsApp template */}
      <section className="bg-white rounded-xl2 border border-amber/20 shadow-sm p-5 space-y-3">
        <h2 className="font-bold text-forest">WhatsApp Message Template</h2>
        <p className="text-xs text-darkest/60">
          Available placeholders: <code>{'{{customer_name}}'}</code> <code>{'{{store_name}}'}</code> <code>{'{{bill_number}}'}</code>{' '}
          <code>{'{{bill_date}}'}</code> <code>{'{{item_summary}}'}</code> <code>{'{{total_amount}}'}</code>{' '}
          <code>{'{{currency_symbol}}'}</code> <code>{'{{bill_link}}'}</code>. This can only prefill a text message — WhatsApp gives
          no public API to auto-attach a PDF, so the bill PDF is shared/downloaded separately.
        </p>
        <textarea
          value={whatsapp.template}
          onChange={(e) => setWhatsapp({ template: e.target.value })}
          rows={7}
          className="w-full border border-amber/30 rounded-lg px-3 py-2 text-sm font-mono bg-cream/40"
        />
        <button
          onClick={() => saveSetting('whatsapp_template', whatsapp)}
          disabled={saveState === 'saving'}
          className="bg-forest text-cream font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          Save Template
        </button>
      </section>

      {/* Feature flags */}
      <section className="bg-white rounded-xl2 border border-amber/20 shadow-sm p-5 space-y-3">
        <h2 className="font-bold text-forest">Feature Flags</h2>
        <ToggleRow
          label="Allow negative stock on sale"
          hint="If off, register_sale() rejects a sale that would take a product below zero stock."
          checked={flags.allow_negative_stock}
          onChange={(v) => setFlags({ ...flags, allow_negative_stock: v })}
        />
        <div className="flex items-center justify-between py-2 border-b border-amber/10">
          <div>
            <div className="text-sm font-medium">Low stock warning threshold</div>
            <div className="text-xs text-darkest/50">Units remaining at which a sale triggers a stock.low_warning audit event.</div>
          </div>
          <input
            type="number"
            min={0}
            value={flags.low_stock_threshold}
            onChange={(e) => setFlags({ ...flags, low_stock_threshold: Number(e.target.value) })}
            className="w-20 border border-amber/30 rounded px-2 py-1 text-sm text-center"
          />
        </div>
        <ToggleRow
          label="Offline sale entry"
          hint="Reserved for a future offline-queue feature; currently informational only."
          checked={flags.offline_sale_entry}
          onChange={(v) => setFlags({ ...flags, offline_sale_entry: v })}
        />
        <ToggleRow
          label="Show Beta banner"
          hint="Controls a 'Beta V1' banner shown to all users."
          checked={flags.beta_banner}
          onChange={(v) => setFlags({ ...flags, beta_banner: v })}
        />
        <button
          onClick={() => saveSetting('feature_flags', flags)}
          disabled={saveState === 'saving'}
          className="bg-forest text-cream font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          Save Feature Flags
        </button>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <label className="text-sm font-medium text-darkest/80 block mb-1">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-amber/30 rounded-lg px-3 py-2 text-sm bg-cream/40" />
      {hint && <p className="text-xs text-darkest/50 mt-1">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-amber/10 last:border-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-darkest/50">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition-colors relative ${checked ? 'bg-fresh' : 'bg-amber/30'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
