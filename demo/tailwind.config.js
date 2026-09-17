import preset from '../tailwind.preset.cjs';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    '../package/**/*.{js,ts,tsx,jsx}',
    '../node_modules/@fileverse/ui/dist/**/*.{js,mjs}',
  ],
};
