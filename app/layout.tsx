import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { JsonLd } from "@/components/seo/JsonLd";
import { site } from "@/data/site";
import { pageMetadata, websiteData } from "@/lib/seo";
import "./globals.css";
import "../styles/typography.css";
import "../styles/job-pay.css";
import "../styles/brand.css";
import "../styles/street.css";
import "../styles/street-interior.css";
import "../styles/street-motion.css";
const thicccboi = localFont({
  src: [
    {
      path: "../public/fonts/thicccboi/THICCCBOI-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/thicccboi/THICCCBOI-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/thicccboi/THICCCBOI-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/fonts/thicccboi/THICCCBOI-Bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../public/fonts/thicccboi/THICCCBOI-ExtraBold.woff2",
      weight: "800",
      style: "normal",
    },
  ],
  variable: "--font-thicccboi",
  display: "swap",
});
export const metadata: Metadata = {
  ...pageMetadata({ title: "Hiring Skilled Workers in the Philippines", description: site.description, path: "/" }),
  metadataBase: new URL(site.url),
  title: {
    default: site.title,
    template: "%s | Jobs Street Croatia",
  },
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION.trim() } } : {}),
};
export const viewport: Viewport = { themeColor: "#164B83" };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={thicccboi.variable}
      data-scroll-behavior="smooth"
    >
      <body>
        <JsonLd data={websiteData()} />
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Navbar />
        <main id="main-content">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
