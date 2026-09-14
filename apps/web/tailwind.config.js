/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        arena: {
          bg: '#F4F7F6',
          surface: '#FFFFFF',
          subtle: '#F8FAF9',
          tinted: '#EEF4F2',
          cool: '#EEF3F7',
          text: '#172033',
          secondary: '#667085',
          muted: '#98A2B3',
          border: '#E4E7EC',
          'input-border': '#D9DEE7',
          green: '#14966B',
          'green-hover': '#10805B',
          'green-soft': '#E8F6F0',
          blue: '#3267D6',
          'blue-soft': '#EEF4FF',
          amber: '#C98218',
          'amber-soft': '#FFF5E6',
          error: '#C94A4A',
          'error-soft': '#FDEEEE',
          success: '#16845D',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '14px',
        '2xl': '18px',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(23, 32, 51, 0.04), 0 1px 2px -1px rgba(23, 32, 51, 0.02)',
        elevated: '0 4px 16px -2px rgba(23, 32, 51, 0.05), 0 2px 4px -2px rgba(23, 32, 51, 0.02)',
        glass: '0 8px 32px 0 rgba(23, 32, 51, 0.06)',
        hover: '0 6px 20px -2px rgba(23, 32, 51, 0.06), 0 2px 6px -2px rgba(23, 32, 51, 0.03)',
      }
    },
  },
  plugins: [],
}
