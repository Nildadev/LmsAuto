/** @type {import('next').NextConfig} */
const nextConfig = {
  // Playwright có binary native — không bundle vào server, require trực tiếp lúc chạy.
  serverExternalPackages: ['playwright'],
};

module.exports = nextConfig;
