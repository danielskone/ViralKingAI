import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter_Tight } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"], weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: "ViralKing AI",
  description: "Turn your ideas, product photos and videos into branded social content.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="bg-black">
      <body className={`${geistSans.variable} ${geistMono.variable} ${display.variable} antialiased min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
