import './globals.css';

export const metadata = {
  title: 'Հարսանիքի լուսանկարներ',
  description: 'Գտեք ձեր լուսանկարները սելֆիով',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function RootLayout({ children }) {
  return (
    <html lang="hy">
      <body>{children}</body>
    </html>
  );
}
