import '../frontend/src/style.css';
export const metadata = {
  title: "Chairman's Office", description: 'Your private fictional executive world',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: "Chairman's Office" },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' }
};
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#101827' };
export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
