import React, { createContext, useState, useContext, useEffect } from 'react';

const ThemeContext = createContext();

// Custom hook - makes it easy to use theme in any component
export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }) => {
  // Load saved theme from localStorage or default to light
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });

  // Apply dark class to <body> whenever theme changes
  // WHY: CSS variables on body element cascade down to all children
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    // Save preference so it persists on refresh
    localStorage.setItem('darkMode', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  const toggleDarkMode = () => {
    setIsDarkMode(prev => !prev);
  };

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
};