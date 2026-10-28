// Make It — NextAuth v4 configuration (credentials provider, JWT strategy).
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Make It",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password ?? "";
        if (!email) return null;
        const user = await db.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) return null;
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;
        return { id: user.id, name: user.name ?? user.email, email: user.email } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as any).id = token.id as string;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET || "make-it-dev-nextauth-secret",
};

// Helper: get the authenticated user from the request, plus their active workspace.
import { getServerSession } from "next-auth/next";

export async function getSessionUser(): Promise<{ id: string; email: string; name: string | null } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const id = (session.user as any).id as string | undefined;
  if (!id) return null;
  return { id, email: session.user.email!, name: session.user.name ?? null };
}

// Hash a password (used by seed / register).
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
