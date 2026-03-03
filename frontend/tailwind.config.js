export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        nexradar: {
          bg: '#080c14',
          panel: '#0a0f1a',
          border: 'rgba(255,255,255,0.1)',
        },
      },
      keyframes: {
        slideDown: {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        enter: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        leave: {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '100%': { transform: 'scale(0.9)', opacity: '0' },
        },
      },
      animation: {
        slideDown: 'slideDown 0.3s ease-out',
        shimmer: 'shimmer 2s infinite',
        enter: 'enter 0.2s ease-out',
        leave: 'leave 0.15s ease-in forwards',
      },
    },
  },
  plugins: [],
}
