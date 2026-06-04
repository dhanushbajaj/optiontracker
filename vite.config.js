import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// base: relative ("./") works under any GitHub Pages subpath
// (e.g. https://user.github.io/option-tracker/). Override with VITE_BASE if needed.
export default defineConfig({
    base: process.env.VITE_BASE || "./",
    plugins: [react()],
    server: {
        port: 5173,
        host: true,
    },
});
