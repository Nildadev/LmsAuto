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
      // Màu Material 3 đọc từ CSS variable -> tự đổi sáng/tối (xem globals.css)
      colors: {
        primary: 'rgb(var(--md-primary) / <alpha-value>)',
        'on-primary': 'rgb(var(--md-on-primary) / <alpha-value>)',
        'primary-container': 'rgb(var(--md-primary-container) / <alpha-value>)',
        'on-primary-container': 'rgb(var(--md-on-primary-container) / <alpha-value>)',
        surface: 'rgb(var(--md-surface) / <alpha-value>)',
        'surface-container-low': 'rgb(var(--md-surface-container-low) / <alpha-value>)',
        'surface-container': 'rgb(var(--md-surface-container) / <alpha-value>)',
        'surface-container-high': 'rgb(var(--md-surface-container-high) / <alpha-value>)',
        background: 'rgb(var(--md-bg) / <alpha-value>)',
        'on-surface': 'rgb(var(--md-on-surface) / <alpha-value>)',
        'on-surface-variant': 'rgb(var(--md-on-surface-variant) / <alpha-value>)',
        outline: 'rgb(var(--md-outline) / <alpha-value>)',
        success: 'rgb(var(--md-success) / <alpha-value>)',
        'success-container': 'rgb(var(--md-success-container) / <alpha-value>)',
        warning: 'rgb(var(--md-warning) / <alpha-value>)',
        error: 'rgb(var(--md-error) / <alpha-value>)',
        'error-container': 'rgb(var(--md-error-container) / <alpha-value>)',
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
        'md-1': '0 1px 2px rgba(0,0,0,.10), 0 1px 3px 1px rgba(0,0,0,.08)',
        'md-2': '0 1px 3px rgba(0,0,0,.14), 0 4px 8px 3px rgba(0,0,0,.10)',
      },
    },
  },
  plugins: [],
};
