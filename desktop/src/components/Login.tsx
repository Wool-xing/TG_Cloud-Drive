import { useState, FormEvent } from 'react';

interface Props {
  server: string;
  onLogin: (server: string, token: string) => void;
}

export default function Login({ server: initialServer, onLogin }: Props) {
  const [server, setServer] = useState(initialServer);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${server}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`Login failed: ${res.status} ${msg}`);
      }
      const data = await res.json();
      onLogin(server, data.accessToken);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
          </svg>
        </div>
        <h1>TG Cloud Desktop</h1>
        <form onSubmit={handleSubmit}>
          <label>Server URL</label>
          <input
            type="text"
            value={server}
            onChange={e => setServer(e.target.value)}
            placeholder="http://localhost:3000"
          />
          <label>Username / Email / Phone</label>
          <input
            type="text"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            placeholder="Enter your identifier"
            autoComplete="username"
          />
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter password"
            autoComplete="current-password"
          />
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
