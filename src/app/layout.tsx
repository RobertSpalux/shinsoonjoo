import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { BRAND, getCareer } from "@/lib/brand";

const { years } = getCareer();

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.siteUrl),
  title: {
    default: `${BRAND.siteName} | ${years}년 차 GA명장 신순주`,
    template: `%s | ${BRAND.siteName}`,
  },
  description: `${years}년 경력 우수인증설계사 · GA명장 신순주. 생활경제, 금융뉴스, 보험 보상 꿀팁까지 — 당신의 위기보다 한 발 앞서는 가장 선한 금융 파트너.`,
  verification: {
    google: "WTI52aUJD8W-Io7DJLV-vNDSMwOdUIrBQSX8fY95hgc",
  },
  openGraph: {
    title: `${BRAND.siteName} | ${years}년 차 GA명장 신순주`,
    description: `우수인증설계사 8년 연속 · GA명장. 보험과 생활경제의 모든 것, ${BRAND.siteName}.`,
    type: "website",
    locale: "ko_KR",
    siteName: BRAND.siteName,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600;700&display=swap"
        />
      </head>
      <body className="antialiased">
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
