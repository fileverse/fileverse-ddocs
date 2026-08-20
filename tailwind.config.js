export default {
  darkMode: ['class'],
  safelist: ['theme-sepia', 'theme-pink', 'theme-green', 'theme-ultra-dark'],
  content: ['./package/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        mobile: '960px',
      },
    },
  },
  plugins: ['tailwindcss-animate'],
};
