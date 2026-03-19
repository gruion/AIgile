import "./globals.css";
import Sidebar from "../components/Sidebar";
import Toaster from "../components/Toaster";
import SetupGuard from "../components/SetupGuard";
import { AppConfigProvider } from "../context/AppConfigContext";

export const metadata = {
  title: "AIgileCoach",
  description: "AI-powered agile coaching & project compliance dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-50">
        <AppConfigProvider>
          <Sidebar />
          <div className="min-h-screen" id="main-content">
            <SetupGuard />
            {children}
          </div>
          <Toaster />
        </AppConfigProvider>
      </body>
    </html>
  );
}
