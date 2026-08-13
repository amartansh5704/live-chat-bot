import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { UploadProvider } from './context/UploadContext';
import Login from './pages/Login';
import UsersHome from './pages/UsersHome';
import ChatScreen from './pages/ChatScreen';
import FilesPage from './pages/FilesPage';
import UploadWidget from './components/UploadWidget';
import './App.css';

function App() {
  const [operator, setOperator] = useState(null);

  useEffect(() => {
    const info = localStorage.getItem('operatorInfo');
    if (info) setOperator(JSON.parse(info));
  }, []);

  const handleLogin = (data) => setOperator(data);
  const handleLogout = () => {
    localStorage.removeItem('operatorInfo');
    setOperator(null);
  };

  return (
    <ThemeProvider>
      <UploadProvider>
        <Router>
          <Routes>
            <Route
              path="/login"
              element={operator ? <Navigate to="/" /> : <Login onLogin={handleLogin} />}
            />
            <Route
              path="/"
              element={operator ? <UsersHome operator={operator} onLogout={handleLogout} /> : <Navigate to="/login" />}
            />
            <Route
              path="/chat/:userId"
              element={operator ? <ChatScreen operator={operator} /> : <Navigate to="/login" />}
            />
            <Route
              path="/files"
              element={operator ? <FilesPage operator={operator} onLogout={handleLogout} /> : <Navigate to="/login" />}
            />
          </Routes>

          {/* ⭐ Widget lives GLOBALLY - visible on all pages */}
          {operator && <UploadWidget />}
        </Router>
      </UploadProvider>
    </ThemeProvider>
  );
}

export default App;