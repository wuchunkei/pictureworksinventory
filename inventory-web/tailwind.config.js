import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        }
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Display", "Avenir Next", "Helvetica Neue", "Arial", "sans-serif"],
        display: ["Cormorant Garamond", "Georgia", "serif"]
      },
      boxShadow: {
        glass: "0 24px 80px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.18)",
        halo: "0 0 80px rgba(245, 245, 245, 0.10)"
      },
      backgroundImage: {
        "liquid-radial": "radial-gradient(circle at 20% 20%, rgba(255,255,255,.20), transparent 18%), radial-gradient(circle at 78% 16%, rgba(134,197,255,.18), transparent 24%), radial-gradient(circle at 50% 86%, rgba(255,255,255,.10), transparent 26%)"
      },
      keyframes: {
        drift: {
          "0%, 100%": { transform: "translate3d(-2%, -1%, 0) scale(1)" },
          "50%": { transform: "translate3d(2%, 2%, 0) scale(1.06)" }
        },
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" }
        }
      },
      animation: {
        drift: "drift 16s ease-in-out infinite",
        scanline: "scanline 5.8s linear infinite"
      }
    }
  },
  plugins: [animate]
};
