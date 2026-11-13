import type { Metadata } from "next"; import "./globals.css";
export const metadata:Metadata={title:"S.D Pay — Payments for Uganda",description:"Payment infrastructure for Ugandan businesses, platforms and developers."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}