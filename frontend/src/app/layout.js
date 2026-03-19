import "./globals.css";
import Sidebar from "../components/Sidebar";
import Toaster from "../components/Toaster";
import SetupGuard from "../components/SetupGuard";

export const metadata = {
  title: "AIgileCoach",
  description: "AI-powered agile coaching & project compliance dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-50">
        <Sidebar />
        <div className="min-h-screen" id="main-content">
          <SetupGuard />
          {children}
        </div>
        <Toaster />
      </body>
    </html>
  );
}
