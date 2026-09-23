import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O editor de PPTX salva slides com imagens embutidas (data URL): corpo grande.
  experimental: {
    proxyClientMaxBodySize: '80mb',
    // Exportar o PPTX editável de uma apresentação grande passa de 30s (padrão).
    proxyTimeout: 5 * 60 * 1000,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3001/api/:path*",
      },
      {
        source: "/exports/:path*",
        destination: "http://localhost:3001/exports/:path*",
      },
    ];
  },
};

export default nextConfig;
