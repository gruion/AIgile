/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        jira: {
          blue: "#0052CC",
          "blue-light": "#DEEBFF",
          green: "#36B37E",
          yellow: "#FFAB00",
          red: "#FF5630",
          purple: "#6554C0",
          gray: "#97A0AF",
        },
      },
    },
  },
  plugins: [],
};
