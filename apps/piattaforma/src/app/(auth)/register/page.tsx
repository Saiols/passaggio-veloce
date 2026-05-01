import { Suspense } from 'react';
import { RegisterWizard } from './register-wizard';

export default function RegisterPage() {
  // <Suspense> richiesto perché RegisterWizard usa useSearchParams() per
  // leggere il codice di affiliazione (?ref=). Senza il boundary il build
  // statico di Next 16 fallisce con "missing-suspense-with-csr-bailout".
  return (
    <Suspense fallback={null}>
      <RegisterWizard />
    </Suspense>
  );
}
