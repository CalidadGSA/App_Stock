import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/vencimientos/vencidos',
        destination: '/vencimientos/para-devolver',
        permanent: true,
      },
    ];
  },
  // En este repo la app vive en subcarpeta; fijamos la raiz
  // para que Turbopack resuelva dependencias (ej. tailwindcss) correctamente.
  turbopack: {
    root: __dirname,
  },
  // Cron legacy (node-cron) + drivers MySQL/MSSQL en el proceso del servidor Node
  serverExternalPackages: ["node-cron", "mysql2", "mssql", "bcryptjs", "dotenv"],
  outputFileTracingIncludes: {
    "/*": ["./scripts/**/*", "./src/jobs/**/*", "./src/load-env.js"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(config.externals ?? []),
        "child_process",
        "module",
        "path",
        "url",
        "fs",
        "os",
        "crypto",
      ];
    }
    return config;
  },
};

export default nextConfig;
