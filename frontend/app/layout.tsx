import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
    title: "Orchestra - Sistema de Gestión de Servidores",
    description: "Sistema de gestión de servidores con Ansible",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="es">
            <head>
                <script
                    dangerouslySetInnerHTML={{
                        __html: `
                            (function() {
                                try {
                                    const theme = localStorage.getItem('theme');
                                    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                                    const finalTheme = theme || systemTheme;
                                    if (finalTheme === 'dark') {
                                        document.documentElement.classList.add('dark');
                                    } else {
                                        document.documentElement.classList.remove('dark');
                                    }
                                } catch (e) {}
                            })();
                        `,
                    }}
                />
            </head>
            <body className="antialiased bg-gray-50 dark:bg-gray-900">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
