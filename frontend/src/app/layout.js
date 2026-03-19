import "./globals.css";
import Sidebar from "../components/Sidebar";
import Toaster from "../components/Toaster";

export const metadata = {
  title: "Jira AI Dashboard",
  description: "AI-powered Jira task overview",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-50">
        <Sidebar />
        <div className="min-h-screen" id="main-content">
          {children}
        </div>
        <Toaster />
      </body>
    </html>
  );
}
