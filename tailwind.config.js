/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors');
const defaultTheme = require('tailwindcss/defaultTheme');
const plugin = require('tailwindcss/plugin');

module.exports = {
    content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
    plugins: [
        plugin(function({ addBase, theme }) {
            addBase({
                'a': {
                    color: theme('colors.blue.300'),
                    '&:hover': {
                        color: theme('colors.blue.600'),
                    },
                },
                'button': {
                    backgroundColor: theme('colors.blue.500'),
                    paddingLeft: '0.5rem',
                    paddingRight: '0.5rem',
                },
                'body': {
                    backgroundColor: theme('colors.gray.800'),
                    color: theme('colors.white'),
                },
                'div': {
                    backgroundColor: theme('colors.gray.800'),
                    color: theme('colors.white'),
                },
                'img': {
                    backgroundColor: theme('colors.gray.800'),
                    color: theme('colors.white'),
                },
                'input': {
                    backgroundColor: theme('colors.gray.700'),
                    color: theme('colors.gray.200'),
                },
                'select': {
                    backgroundColor: theme('colors.gray.700'),
                    color: theme('colors.gray.200'),
                },
                'textarea': {
                    backgroundColor: theme('colors.gray.700'),
                    color: theme('colors.gray.200'),
                },
            });
        }),
    ],
    theme: {
        extend: {
            borderColor: {
                DEFAULT: colors.gray['700'],
            },
            colors: {
                bg: colors.gray['800'],
                bghi: colors.gray['700'],
                error: colors.red['500'],
            },
            fontFamily: {
                sans: ['Inter var', ...defaultTheme.fontFamily.sans],
            },
        },
    },
};

