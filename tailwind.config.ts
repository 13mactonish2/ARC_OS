import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
    darkMode: "class",
    content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  \textend: {
  \t\tcolors: {
  \t\t\tbackground: 'hsl(var(--background))',
  \t\t\tforeground: 'hsl(var(--foreground))',
  \t\t\tcard: {
  \t\t\t\tDEFAULT: 'hsl(var(--card))',
  \t\t\t\tforeground: 'hsl(var(--card-foreground))'
  \t\t\t},
  \t\t\tpopover: {
  \t\t\t\tDEFAULT: 'hsl(var(--popover))',
  \t\t\t\tforeground: 'hsl(var(--popover-foreground))'
  \t\t\t},
  \t\t\tprimary: {
  \t\t\t\tDEFAULT: 'hsl(var(--primary))',
  \t\t\t\tforeground: 'hsl(var(--primary-foreground))'
  \t\t\t},
  \t\t\tsecondary: {
  \t\t\t\tDEFAULT: 'hsl(var(--secondary))',
  \t\t\t\tforeground: 'hsl(var(--secondary-foreground))'
  \t\t\t},
  \t\t\tmuted: {
  \t\t\t\tDEFAULT: 'hsl(var(--muted))',
  \t\t\t\tforeground: 'hsl(var(--muted-foreground))'
  \t\t\t},
  \t\t\taccent: {
  \t\t\t\tDEFAULT: 'hsl(var(--accent))',
  \t\t\t\tforeground: 'hsl(var(--accent-foreground))'
  \t\t\t},
  \t\t\tdestructive: {
  \t\t\t\tDEFAULT: 'hsl(var(--destructive))',
  \t\t\t\tforeground: 'hsl(var(--destructive-foreground))'
  \t\t\t},
  \t\t\tborder: 'hsl(var(--border))',
  \t\t\tinput: 'hsl(var(--input))',
  \t\t\tring: 'hsl(var(--ring))',
  \t\t\tchart: {
  \t\t\t\t'1': 'hsl(var(--chart-1))',
  \t\t\t\t'2': 'hsl(var(--chart-2))',
  \t\t\t\t'3': 'hsl(var(--chart-3))',
  \t\t\t\t'4': 'hsl(var(--chart-4))',
  \t\t\t\t'5': 'hsl(var(--chart-5))'
  \t\t\t}
  \t\t},
  \t\tborderRadius: {
  \t\t\tlg: 'var(--radius)',
  \t\t\tmd: 'calc(var(--radius) - 2px)',
  \t\t\tsm: 'calc(var(--radius) - 4px)'
  \t\t}
  \t}
  },
  plugins: [tailwindcssAnimate],
};
export default config;
