import "./globals.css";
import Toaster from "../components/Toaster";
import { AppConfigProvider } from "../context/AppConfigContext";
import LayoutShell from "../components/LayoutShell";

export const metadata = {
  title: "AIgileCoach",
  description: "AI-powered agile coaching & project compliance dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-50">
        <AppConfigProvider>
          <LayoutShell>{children}</LayoutShell>
          <Toaster />
        </AppConfigProvider>
      </body>
    </html>
  );
}
