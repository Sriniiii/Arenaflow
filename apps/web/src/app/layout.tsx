import './globals.css';
import React from 'react';
import { AuthProvider } from '../context/AuthContext';

export const metadata = {
  title: 'ArenaFlow',
  description: 'Run tournaments. Track every point.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
