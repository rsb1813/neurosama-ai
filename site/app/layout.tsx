// Neru 사이트의 전역 메타데이터와 문서 골격을 제공하는 루트 레이아웃
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neru — Intelligence, with a stage presence.",
  description: "Meet Neru, a local-first open-source AI VTuber with voice, memory, and expression.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
