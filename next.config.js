/** @type {import('next').NextConfig} */
const nextConfig = {
  // Playwright có binary native — không bundle vào server, require trực tiếp lúc chạy.
  serverExternalPackages: ['playwright'],

  // Cho phép dev server nhận request từ IP LAN (mở web từ điện thoại cùng wifi).
  // Mặc định Next.js chỉ cho phép localhost; mở qua IP LAN sẽ bị chặn asset/JS
  // → trang hiện nhưng KHÔNG hydrate → không bấm được gì.
  allowedDevOrigins: [
    '192.168.1.23', // IP LAN hiện tại của máy chạy server
    '192.168.*.*',  // dự phòng khi IP LAN đổi (cùng dải 192.168.x.x)
  ],
};

module.exports = nextConfig;
