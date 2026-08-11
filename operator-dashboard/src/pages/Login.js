import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import Hyperspeed from '../components/Hyperspeed';

const Login = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const navigate = useNavigate();

  // ── MEMOIZE effectOptions ──
  // WHY: This is CRITICAL. If effectOptions is a new object on every render,
  //      the WebGL scene gets destroyed and recreated → screen flickers.
  //      useMemo ensures the object reference stays the same.
  const hyperspeedOptions = useMemo(() => ({
    distortion: 'turbulentDistortion',
    length: 400,
    roadWidth: 10,
    islandWidth: 2,
    lanesPerRoad: 4,
    fov: 90,
    fovSpeedUp: 150,
    speedUp: 2,
    carLightsFade: 0.4,
    totalSideLightSticks: 20,
    lightPairsPerRoadWay: 40,
    shoulderLinesWidthPercentage: 0.05,
    brokenLinesWidthPercentage: 0.1,
    brokenLinesLengthPercentage: 0.5,
    lightStickWidth: [0.12, 0.5],
    lightStickHeight: [1.3, 1.7],
    movingAwaySpeed: [60, 80],
    movingCloserSpeed: [-120, -160],
    carLightsLength: [400 * 0.03, 400 * 0.2],
    carLightsRadius: [0.05, 0.14],
    carWidthPercentage: [0.3, 0.5],
    carShiftX: [-0.8, 0.8],
    carFloorSeparation: [0, 5],
    colors: {
      roadColor: 0x080808,
      islandColor: 0x0a0a0a,
      background: 0x000000,
      shoulderLines: 0xFFFFFF,
      brokenLines: 0xFFFFFF,
      leftCars: [0xD856BF, 0x6750A2, 0xC247AC],
      rightCars: [0x03B3C3, 0x0E5EA5, 0x324555],
      sticks: 0x03B3C3
    }
  }), []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = isRegister ? '/operator/register' : '/operator/login';
      const body = isRegister ? { username, email, password } : { email, password };
      const { data } = await api.post(endpoint, body);
      localStorage.setItem('operatorInfo', JSON.stringify(data));
      onLogin(data);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="op-login-container">
      {/* ── ANIMATED HYPERSPEED BACKGROUND ── */}
      <div className="hyperspeed-bg">
        <Hyperspeed effectOptions={hyperspeedOptions} />
      </div>

      {/* ── LOGIN CARD ON TOP ── */}
      <div className="op-login-card">
        <div className="op-login-logo">
          <div className="op-login-logo-icon">🖥️</div>
        </div>

        <h1>Operator Portal</h1>
        <p className="op-login-subtitle">
          {isRegister ? 'Create your operator account' : 'Sign in to manage chats'}
        </p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p className="toggle-auth" onClick={() => setIsRegister(!isRegister)}>
          {isRegister ? 'Already have an account? Sign In' : 'Need an account? Register'}
        </p>

        <div className="op-login-hint">
          💡 Click anywhere on background to speed up
        </div>
      </div>
    </div>
  );
};

export default Login;