// Inietta uno o più oggetti JSON-LD in un <script type="application/ld+json">.
// Escape di `<` per safety XSS anche se il payload tipicamente non contiene
// user input (per ora i nostri schema sono interamente derivati da BRAND).

type Props = {
  data: object | object[];
};

export function JsonLd({ data }: Props) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
