/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Bảng màu Material Design 3 (tông sáng)
      colors: {
        primary: '#0b57d0',
        'on-primary': '#ffffff',
        'primary-container': '#d3e3fd',
        'on-primary-container': '#041e49',
        surface: '#ffffff',
        'surface-container-low': '#f8fafd',
        'surface-container': '#f1f3f4',
        'surface-container-high': '#e8eaed',
        background: '#f8fafd',
        'on-surface': '#1f1f1f',
        'on-surface-variant': '#5f6368',
        outline: '#dadce0',
        'outline-variant': '#e8eaed',
        success: '#188038',
        'success-container': '#ceead6',
        'on-success-container': '#052e16',
        warning: '#b06000',
        'warning-container': '#feefc3',
        error: '#d93025',
        'error-container': '#fce8e6',
        'on-error-container': '#410e0b',
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        full: '9999px',
      },
      fontFamily: {
        'body-base': ['Roboto', 'system-ui', 'sans-serif'],
        'mono-label': ['Roboto Mono', 'monospace'],
        terminal: ['Roboto Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        'display-xl': ['40px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg': ['28px', { lineHeight: '1.2', fontWeight: '600' }],
        'headline-md': ['22px', { lineHeight: '1.3', fontWeight: '600' }],
        'body-base': ['16px', { lineHeight: '1.5', fontWeight: '400' }],
        'body-sm': ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        'mono-label': ['12px', { lineHeight: '1', letterSpacing: '0.04em', fontWeight: '500' }],
        terminal: ['13px', { lineHeight: '1.6', fontWeight: '400' }],
      },
      boxShadow: {
        'md-1': '0 1px 2px rgba(60,64,67,.10), 0 1px 3px 1px rgba(60,64,67,.08)',
        'md-2': '0 1px 3px rgba(60,64,67,.14), 0 4px 8px 3px rgba(60,64,67,.10)',
      },
    },
  },
  plugins: [],
};
