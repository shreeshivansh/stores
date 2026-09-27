import { Link } from 'react-router-dom';

export default function Unauthorized() {
  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-xl2 border border-amber/30 shadow-sm p-8 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-xl font-bold text-forest mb-2">Access Denied</h1>
        <p className="text-darkest/70 mb-6">
          Your account does not have permission to view this area. This isn't just a
          hidden page — the server itself refuses admin data to non-admin accounts,
          so there's nothing to unlock from here.
        </p>
        <Link
          to="/"
          className="inline-block bg-forest text-cream px-5 py-2.5 rounded-lg font-semibold hover:bg-evergreen transition-colors"
        >
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
