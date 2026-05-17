import { useState } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

export default function App() {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('tgpan_token'),
  );
  const [server, setServer] = useState<string>(
    () => localStorage.getItem('tgpan_server') || 'http://localhost:3000',
  );

  const handleLogin = (srv: string, tok: string) => {
    setServer(srv);
    setToken(tok);
    localStorage.setItem('tgpan_server', srv);
    localStorage.setItem('tgpan_token', tok);
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('tgpan_token');
  };

  if (!token) {
    return <Login server={server} onLogin={handleLogin} />;
  }

  return <Dashboard server={server} token={token} onLogout={handleLogout} />;
}
