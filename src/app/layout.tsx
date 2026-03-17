import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "신순주 | 24년 경력 보험 전문 PB",
  description:
    "업계 상위 1% 보험 전문가 신순주 지점장. 24년간 쌓아온 전문성과 신뢰로 고객의 자산을 지킵니다.",
  openGraph: {
    title: "신순주 | 24년 경력 보험 전문 PB",
    description:
      "업계 상위 1% 보험 전문가 신순주 지점장. 24년간 쌓아온 전문성과 신뢰로 고객의 자산을 지킵니다.",
    type: "website",
  },
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
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
