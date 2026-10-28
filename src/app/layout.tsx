import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth-context";
import { AgencyThemeProvider } from "@/components/agency/AgencyThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Make It — Votre équipe marketing digitale propulsée par l'IA",
  description:
    "Make It est l'équivalent numérique d'une équipe marketing complète : stratège, créateur, monteur, community manager et analyste — propulsés par l'IA.",
  keywords: [
    "Make It",
    "marketing IA",
    "contenu",
    "social media",
    "campagnes",
    "automatisation marketing",
    "SaaS marketing",
  ],
  authors: [{ name: "Make It" }],
  icons: { icon: "/logo.svg" },
  openGraph: {
    title: "Make It — Votre équipe marketing digitale propulsée par l'IA",
    description: "Une équipe marketing complète, dans une seule application.",
    siteName: "Make It",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <AuthProvider>
            <AgencyThemeProvider />
            {children}
            <Toaster />
            <Sonner />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
