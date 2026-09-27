/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: '#19470B',
        evergreen: '#046139',
        leaf: '#437010',
        fresh: '#05800A',
        gold: '#F6B814',
        amber: '#DE8610',
        honey: '#F7CD45',
        softgold: '#F7DD7B',
        spiced: '#B85A08',
        deepbrown: '#882C06',
        packred: '#CE0B0A',
        darkest: '#0C1603',
        cream: '#FAF5E6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
};
