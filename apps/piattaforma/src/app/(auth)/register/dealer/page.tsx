import { Suspense } from 'react';
import { RegisterWizard } from '../register-wizard';

export const metadata = {
  title: 'Registrati come Dealer · Passaggio Veloce',
};

export default function RegisterDealerPage() {
  return (
    <Suspense fallback={null}>
      <RegisterWizard forcedCompanyType="DEALER" />
    </Suspense>
  );
}
