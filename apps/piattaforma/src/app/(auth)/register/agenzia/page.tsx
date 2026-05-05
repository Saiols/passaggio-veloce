import { Suspense } from 'react';
import { RegisterWizard } from '../register-wizard';

export const metadata = {
  title: "Registrati come Agenzia · Passaggio Veloce",
};

export default function RegisterAgenziaPage() {
  return (
    <Suspense fallback={null}>
      <RegisterWizard forcedCompanyType="AGENZIA" />
    </Suspense>
  );
}
