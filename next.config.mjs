import { withWorkflow } from 'workflow/next';
export default withWorkflow({
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' }
    ] }, { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-store' }] }];
  }
});
