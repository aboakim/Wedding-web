/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    'sharp',
    'pg',
    '@electric-sql/pglite',
    '@electric-sql/pglite-socket',
  ],
  async headers() {
    const headers = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=()' },
    ];
    if (process.env.NODE_ENV === 'production') {
      headers.push({ key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' });
    }
    return [{ source: '/:path*', headers }];
  },
  experimental: {
    middlewareClientMaxBodySize: '32mb',
  },
};

export default nextConfig;
