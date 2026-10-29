import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Workflow Studio — Make it Studio",
  description:
    "Build and run creative AI pipelines visually with Workflow Studio by Make it Studio.",
  keywords: [
    "weavy ai alternative",
    "krea nodes alternative",
    "krea workflows alternative",
    "freepik spaces alternative",
    "florafauna ai alternative",
    "open source ai workflow builder",
    "node based ai editor",
    "generative ai pipeline",
    "visual ai workflow",
    "self hosted ai",
    "comfyui alternative",
    "ai image generation workflow",
    "ai video generation pipeline",
    "no code ai workflow",
    "artistic intelligence",
    "Make it Studio",
    "ai workflow automation",
    "workflow studio",
  ],
  openGraph: {
    title: "Workflow Studio — Make it Studio",
    description: "Build creative AI pipelines visually with Make it Studio.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Workflow Studio — Make it Studio",
    description: "Build creative AI pipelines visually with Make it Studio.",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
