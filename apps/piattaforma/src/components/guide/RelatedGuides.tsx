import Link from 'next/link';
import { otherGuides } from '@/lib/seo/guides';

export function RelatedGuides({ currentSlug }: { currentSlug: string }) {
  const guides = otherGuides(currentSlug);
  if (guides.length === 0) return null;

  return (
    <section className="mx-auto my-14 w-full max-w-3xl px-5 sm:px-6">
      <h2 className="text-[20px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[24px]">
        Continua a leggere
      </h2>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {guides.map((g) => (
          <Link
            key={g.slug}
            href={g.url}
            className="group rounded-[14px] border border-pv-slate-200 bg-white p-5 transition-colors hover:border-pv-navy-300 hover:bg-pv-navy-50"
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
              {g.category}
            </span>
            <h3 className="mt-2 text-[16px] font-bold text-pv-navy-900 group-hover:text-pv-navy-700">
              {g.title}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-pv-slate-500">
              {g.metaDescription}
            </p>
            <p className="mt-3 text-[12px] font-medium text-pv-slate-500">
              {g.readingTimeMin} min di lettura →
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
