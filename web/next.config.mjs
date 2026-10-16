/** @type {import('next').NextConfig} */
const BACKEND = process.env.BACKEND_URL || "http://127.0.0.1:8000";

const nextConfig = {
  // No gzip so server sent events stream live.
  compress: false,
  // Agent calls can be slow. Keep the proxied stream open.
  experimental: { proxyTimeout: 600000 },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND}/api/:path*` }];
  },
};
export default nextConfig;
