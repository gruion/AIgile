import "./globals.css";

export const metadata = {
  title: "Jira AI Dashboard",
  description: "AI-powered Jira task overview",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
