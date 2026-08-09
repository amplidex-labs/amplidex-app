/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#f8f9f3', 100: '#f3f5ec', 200: '#daddd3', 300: '#b9bdb2',
          400: '#969a91', 500: '#73776f', 600: '#565a53', 700: '#373a35',
          800: '#1c1f1b', 900: '#11130f', 950: '#090a09'
        },
        cyan: { 50:'#fbffe8', 100:'#f4ffc2', 200:'#eaff82', 300:'#e1ff5c', 400:'#d8ff3e', 500:'#b8df22', 600:'#8dad14', 700:'#687f13', 800:'#536516', 900:'#465519', 950:'#222e06' }
      },
      boxShadow: { glow: '0 0 50px rgba(216,255,62,.12)' },
      fontFamily: {
        sans: ['Manrope', 'ui-sans-serif', 'system-ui'],
        mono: ['DM Mono', 'monospace']
      }
    }
  },
  plugins: []
};
