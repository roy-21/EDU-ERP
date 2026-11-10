/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  async redirects() {
    return [
      {
        source: '/admin/security',
        destination: '/admin/settings/security',
        permanent: true,
      },
      {
        source: '/admin/research/features',
        destination: '/admin/research',
        permanent: true,
      },
      {
        source: '/admin/voting/features',
        destination: '/admin/voting',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
