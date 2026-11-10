import type { Metadata } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import "./globals.css";
import { GoldDefs } from "@/components/icons";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const interTight = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"], weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: "ViralKing AI",
  description: "Turn your ideas, product photos and videos into scroll-stopping social ads with your own AI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${interTight.variable} antialiased min-h-screen`}>
        <GoldDefs />
        {children}
      </body>
    </html>
  );
}
