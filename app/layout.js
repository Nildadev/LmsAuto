export const metadata = {
  title: 'LMS360 Auto',
  description: 'Automated lesson solver for LMS360',
}

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  )
}
