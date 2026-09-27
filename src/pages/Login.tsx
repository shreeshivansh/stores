import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) {
      setError(error);
    } else {
      navigate('/');
    }
  }

  return (
    <div className="min-h-screen bg-forest flex items-center justify-center p-6">
      <div className="max-w-sm w-full">
        <div className="flex flex-col items-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-source.png`} alt="Shree Shivansh Stores" className="w-20 h-20 rounded-full border-4 border-gold shadow-lg mb-3" />
          <h1 className="text-cream text-xl font-extrabold tracking-wide text-center">SHREE SHIVANSH STORES</h1>
          <span className="text-honey text-xs font-semibold uppercase tracking-widest mt-1">Beta V1</span>
        </div>

        <form onSubmit={handleSubmit} className="bg-cream rounded-xl2 p-6 shadow-xl border-2 border-gold/40">
          <h2 className="text-forest font-bold text-lg mb-4">Sign in</h2>

          {error && (
            <div className="bg-packred/10 border border-packred/30 text-packred text-sm rounded-lg px-3 py-2 mb-4">
              {error}
            </div>
          )}

          <label className="block text-sm font-medium text-darkest/80 mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-amber/40 px-3 py-2.5 mb-4 focus:outline-none focus:ring-2 focus:ring-gold bg-white"
            placeholder="you@example.com"
          />

          <label className="block text-sm font-medium text-darkest/80 mb-1">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-amber/40 px-3 py-2.5 mb-2 focus:outline-none focus:ring-2 focus:ring-gold bg-white"
            placeholder="••••••••"
          />

          <div className="text-right mb-5">
            <Link to="/forgot-password" className="text-xs text-evergreen font-medium hover:underline">
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-gold text-darkest font-bold py-2.5 rounded-lg hover:bg-honey transition-colors disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>

          <p className="text-center text-xs text-darkest/60 mt-4">
            New here?{' '}
            <Link to="/signup" className="text-evergreen font-semibold hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
