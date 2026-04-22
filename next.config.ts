import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // En este repo la app vive en subcarpeta; fijamos la raiz
  // para que Turbopack resuelva dependencias (ej. tailwindcss) correctamente.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
