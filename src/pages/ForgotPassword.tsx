import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const { error } = await resetPassword(email);
    if (error) setError(error);
    else setSent(true);
  }

  return (
    <div className="min-h-screen bg-forest flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-cream rounded-xl2 p-6 shadow-xl border-2 border-gold/40">
        <h2 className="text-forest font-bold text-lg mb-4">Reset your password</h2>
        {sent ? (
          <p className="text-darkest/70 text-sm">
            If an account exists for that email, a reset link has been sent.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="bg-packred/10 border border-packred/30 text-packred text-sm rounded-lg px-3 py-2 mb-4">{error}</div>}
            <label className="block text-sm font-medium text-darkest/80 mb-1">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-amber/40 px-3 py-2.5 mb-5 bg-white focus:outline-none focus:ring-2 focus:ring-gold" />
            <button type="submit" className="w-full bg-gold text-darkest font-bold py-2.5 rounded-lg hover:bg-honey transition-colors">
              Send reset link
            </button>
          </form>
        )}
        <p className="text-center text-xs text-darkest/60 mt-4">
          <Link to="/login" className="text-evergreen font-semibold hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
