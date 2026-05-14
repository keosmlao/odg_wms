import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "10.0.40.9",
    "192.168.1.62",
    "localhost",
    "127.0.0.1",

    // ถ้ามี domain ภายใน
    "*.odienmall.com",
  ],
};

export default nextConfig;