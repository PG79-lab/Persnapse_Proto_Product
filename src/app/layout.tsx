import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Persnapse",
    template: "%s · Persnapse",
  },
  description: "사람과 만남의 맥락을 기억하는 Business Relationship Memory",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
