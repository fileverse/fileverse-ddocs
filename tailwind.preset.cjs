// Consumers: `presets: [require('@fileverse-dev/ddoc/tailwind')]` and add
// node_modules/@fileverse-dev/ddoc/dist/**/*.{js,mjs} plus
// node_modules/@fileverse/ui/dist/**/*.{js,mjs} to `content` (the dist is chunked).
module.exports = {
  presets: [require('@fileverse/ui/tailwind')],
  theme: {
    extend: {
      screens: {
        mobile: '960px',
      },
    },
  },
};
