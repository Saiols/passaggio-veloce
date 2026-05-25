import Link from 'next/link';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { breadcrumbJsonLd } from '@/lib/seo/jsonLd';

export type BreadcrumbItem = {
  name: string;
  url: string;
};

export function Breadcrumbs({ items }: { items: readonly BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(items as { name: string; url: string }[])} />
      <nav aria-label="Breadcrumb" className="mx-auto w-full max-w-3xl px-5 pt-6 sm:px-6">
        <ol className="flex flex-wrap items-center gap-1 text-[13px] text-pv-slate-500">
          {items.map((item, i) => {
            const isLast = i === items.length - 1;
            return (
              <li key={item.url} className="flex items-center gap-1">
                {isLast ? (
                  <span aria-current="page" className="font-medium text-pv-navy-900">
                    {item.name}
                  </span>
                ) : (
                  <>
                    <Link href={item.url} className="hover:text-pv-navy-700 hover:underline">
                      {item.name}
                    </Link>
                    <span className="text-pv-slate-300" aria-hidden="true">/</span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
