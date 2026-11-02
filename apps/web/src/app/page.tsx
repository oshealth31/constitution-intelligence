import Link from 'next/link';
import { brand } from '@/lib/brand';

/**
 * Placeholder home page for the Stage 2 foundation.
 * Product screens (portals, consoles) are built in later stages.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="bg-navy-900 px-6 py-5 text-ivory-50">
        <p className="text-lg font-semibold tracking-tight">{brand.name}</p>
      </header>

      <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-3xl font-semibold leading-tight text-navy-900 sm:text-4xl">
          {brand.name}
        </h1>
        <p className="mt-4 text-lg text-teal-600">{brand.tagline}</p>
        <p className="mt-8 rounded-lg border border-teal-100 bg-white p-4 text-sm text-muted">
          Organisation portals will appear here in upcoming releases.
        </p>
        <p className="mt-6 text-sm">
          <Link href="/admin" className="font-medium text-teal-600 underline underline-offset-4">
            Platform administrators: control centre
          </Link>
        </p>
      </section>

      <footer className="border-t border-ivory-100 px-6 py-4 text-xs text-muted">
        © {brand.name}
      </footer>
    </main>
  );
}
