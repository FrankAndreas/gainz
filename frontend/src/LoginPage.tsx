import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { TOKEN_KEY } from './App';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface User {
  id: string;
  name: string;
}

interface LoginPageProps {
  onLogin: (token: string) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios.get(`${API_URL}/users`).then(r => {
      const loaded: User[] = r.data.users;
      setUsers(loaded);
      if (loaded.length > 0) setSelectedUserId(loaded[0].id);
    }).catch(() => {
      setError('Failed to load users. Please refresh the page.');
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await axios.post(`${API_URL}/login`, {
        user_id: selectedUserId,
        password,
      });
      localStorage.setItem(TOKEN_KEY, r.data.access_token);
      onLogin(r.data.access_token);
    } catch {
      setError('Invalid user or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">Fitness Tracker</h1>
        <p className="login-subtitle">Sign in to continue</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="login-user">Who are you?</label>
            <select
              id="login-user"
              value={selectedUserId}
              onChange={e => setSelectedUserId(e.target.value)}
            >
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div className="message message-error" role="alert">{error}</div>
          )}
          <button className="btn login-btn" type="submit" disabled={loading || !selectedUserId}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
