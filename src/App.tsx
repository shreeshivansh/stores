import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { RequireAuth, RequireAdmin, RequireClient } from '@/components/shared/RouteGuards';

import ClientShell from '@/components/client/ClientShell';
import AdminShell from '@/components/admin/AdminShell';

import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import ForgotPassword from '@/pages/ForgotPassword';
import Unauthorized from '@/pages/Unauthorized';

import ClientHome from '@/pages/client/ClientHome';
import RegisterSale from '@/pages/client/RegisterSale';
import SalesList from '@/pages/client/SalesList';
import CustomersPage from '@/pages/client/CustomersPage';
import BillsList from '@/pages/client/BillsList';
import BillView from '@/pages/client/BillView';

import AdminDashboard from '@/pages/admin/AdminDashboard';
import PAPage from '@/pages/admin/PAPage';
import AdminSalesPage from '@/pages/admin/AdminSalesPage';
import StockPage from '@/pages/admin/StockPage';
import PurchasesPage from '@/pages/admin/PurchasesPage';
import ExpensesPage from '@/pages/admin/ExpensesPage';
import DailyAccountsPage from '@/pages/admin/DailyAccountsPage';
import MonthlySummaryPage from '@/pages/admin/MonthlySummaryPage';
import AdminCustomersPage from '@/pages/admin/AdminCustomersPage';
import AdminBillsPage from '@/pages/admin/AdminBillsPage';
import AuditLogsPage from '@/pages/admin/AuditLogsPage';
import ExportsPage from '@/pages/admin/ExportsPage';
import SettingsPage from '@/pages/admin/SettingsPage';

// `base` (see vite.config.ts) already handles the GitHub Pages subpath for
// asset URLs. BrowserRouter needs the SAME value as its `basename`, or every
// route match will be off by the repo-name segment once deployed.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <Routes>
          {/* Public, unauthenticated routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          {/* Everything below requires a signed-in session */}
          <Route element={<RequireAuth />}>
            {/* Client-facing shell — any authenticated user (including admins
                who want the simple sales view) can reach these. */}
            <Route element={<RequireClient />}>
              <Route element={<ClientShell />}>
                <Route path="/" element={<ClientHome />} />
                <Route path="/sale/new" element={<RegisterSale />} />
                <Route path="/sales" element={<SalesList />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/bills" element={<BillsList />} />
                <Route path="/bills/:billId" element={<BillView />} />
              </Route>
            </Route>

            {/* Admin-only shell — RequireAdmin redirects non-admins to
                /unauthorized. The database enforces the real boundary
                (see RouteGuards.tsx); this is UX-level only. */}
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<AdminShell />}>
                <Route index element={<AdminDashboard />} />
                <Route path="pa" element={<PAPage />} />
                <Route path="sales" element={<AdminSalesPage />} />
                <Route path="stock" element={<StockPage />} />
                <Route path="purchases" element={<PurchasesPage />} />
                <Route path="expenses" element={<ExpensesPage />} />
                <Route path="daily-accounts" element={<DailyAccountsPage />} />
                <Route path="monthly-summary" element={<MonthlySummaryPage />} />
                <Route path="customers" element={<AdminCustomersPage />} />
                <Route path="bills" element={<AdminBillsPage />} />
                <Route path="bills/:billId" element={<BillView />} />
                <Route path="audit-logs" element={<AuditLogsPage />} />
                <Route path="exports" element={<ExportsPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>
          </Route>

          {/* Fallback: unknown paths go home (or to /login if signed out,
              handled automatically by RequireAuth on the next render). */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
