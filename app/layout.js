import './globals.css';

export const metadata = {
  title: 'LMS360 Auto Solver | Premium Edition',
  description: 'Hệ thống tự động hóa giải bài tập tương tác H5P cao cấp cho LMS360',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
