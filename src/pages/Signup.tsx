import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

export default function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await signUp(email, password, fullName);
    setBusy(false);
    if (error) setError(error);
    else setDone(true);
  }

  if (done) {
    return (
      <div className="min-h-screen bg-forest flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-cream rounded-xl2 p-6 shadow-xl border-2 border-gold/40 text-center">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-forest font-bold text-lg mb-2">Check your email</h2>
          <p className="text-darkest/70 text-sm mb-4">
            Confirm your address to activate your account. New accounts start with standard
            client access — admin access is granted separately by store management.
          </p>
          <button onClick={() => navigate('/login')} className="text-evergreen font-semibold hover:underline">
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-forest flex items-center justify-center p-6">
      <div className="max-w-sm w-full">
        <div className="flex flex-col items-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-source.png`} alt="Shree Shivansh Stores" className="w-16 h-16 rounded-full border-4 border-gold shadow-lg mb-2" />
          <h1 className="text-cream text-lg font-extrabold tracking-wide">SHREE SHIVANSH STORES</h1>
        </div>
        <form onSubmit={handleSubmit} className="bg-cream rounded-xl2 p-6 shadow-xl border-2 border-gold/40">
          <h2 className="text-forest font-bold text-lg mb-4">Create account</h2>
          {error && <div className="bg-packred/10 border border-packred/30 text-packred text-sm rounded-lg px-3 py-2 mb-4">{error}</div>}

          <label className="block text-sm font-medium text-darkest/80 mb-1">Full name</label>
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-lg border border-amber/40 px-3 py-2.5 mb-4 bg-white focus:outline-none focus:ring-2 focus:ring-gold" />

          <label className="block text-sm font-medium text-darkest/80 mb-1">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-amber/40 px-3 py-2.5 mb-4 bg-white focus:outline-none focus:ring-2 focus:ring-gold" />

          <label className="block text-sm font-medium text-darkest/80 mb-1">Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-amber/40 px-3 py-2.5 mb-5 bg-white focus:outline-none focus:ring-2 focus:ring-gold" />

          <button type="submit" disabled={busy} className="w-full bg-gold text-darkest font-bold py-2.5 rounded-lg hover:bg-honey transition-colors disabled:opacity-60">
            {busy ? 'Creating…' : 'Create Account'}
          </button>

          <p className="text-center text-xs text-darkest/60 mt-4">
            Already have an account? <Link to="/login" className="text-evergreen font-semibold hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
