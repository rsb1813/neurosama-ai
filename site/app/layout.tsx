// Neru 사이트의 전역 메타데이터와 문서 골격을 제공하는 루트 레이아웃
import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Neru — Intelligence, with a stage presence.";
const description = "Meet Neru, a local-first open-source AI VTuber with voice, memory, and expression.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
