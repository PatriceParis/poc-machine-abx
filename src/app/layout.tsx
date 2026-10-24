import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--police-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--police-mono" });
const titre = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--police-titre" });

export const metadata: Metadata = {
  title: "Machine à leads · Hirondo",
  description: "Comptes, signaux et contacts de la machine ABX Hirondo.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sans.variable} ${mono.variable} ${titre.variable}`}>
      <body>{children}</body>
    </html>
  );
}
