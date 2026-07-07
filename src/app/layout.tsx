import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StoreProvider } from "@/lib/data/store.js";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brains Cash Flow",
  description: "Internal cash-flow & scenario-planning tool",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
