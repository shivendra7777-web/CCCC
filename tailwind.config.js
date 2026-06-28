/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        orbitron: ["Orbitron", "monospace"],
        sora: ["Sora", "sans-serif"],
      },
      colors: {
        bg: "#050508",
        gold: "#FFB800",
        cyan: "#00E5FF",
        green: "#00E096",
        red: "#FF3D71",
        purple: "#C084FC",
        surface: "rgba(255,255,255,0.03)",
        border: "rgba(255,255,255,0.07)",
        // Added so text-text-secondary / text-text-muted work
        "text-primary": "#F1F5F9",
        "text-secondary": "#94A3B8",
        "text-muted": "#64748B",
      },
      backgroundImage: {
        // Added so bg-gradient-radial works in the Mine orb
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
      },
      animation: {
        "spin-slow": "spin 22s linear infinite",
        "spin-reverse": "spin 16s linear infinite reverse",
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
        "float-up": "floatUp 1s ease-out forwards",
        "shimmer": "shimmer 2.5s linear infinite",
        "pulse-live": "pulseLive 2s ease-in-out infinite",
        "drift": "drift 20s ease-in-out infinite",
        "drift-reverse": "driftReverse 25s ease-in-out infinite",
        "rocket-shake": "rocketShake 0.1s ease-in-out infinite",
        "explode": "explode 0.5s ease-out forwards",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 20px rgba(255,184,0,0.2)" },
          "50%": { boxShadow: "0 0 40px rgba(255,184,0,0.4)" },
        },
        floatUp: {
          "0%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(-60px)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% center" },
          "100%": { backgroundPosition: "200% center" },
        },
        pulseLive: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        drift: {
          "0%, 100%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(30px, -30px)" },
        },
        driftReverse: {
          "0%, 100%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(-20px, 20px)" },
        },
        rocketShake: {
          "0%, 100%": { transform: "translateX(0)" },
          "50%": { transform: "translateX(2px)" },
        },
        explode: {
          "0%": { transform: "scale(1)", opacity: "1" },
          "100%": { transform: "scale(2)", opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};