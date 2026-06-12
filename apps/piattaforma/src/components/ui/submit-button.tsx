'use client';

import type { ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from './button';

type Props = Omit<ComponentProps<typeof Button>, 'loading' | 'type'>;

/**
 * Bottone di submit per <form action={serverAction}>. Legge useFormStatus()
 * e mostra automaticamente lo spinner del Button mentre la server action è in
 * corso. Drop-in di <Button type="submit"> dentro un <form>.
 */
export function SubmitButton(props: Props) {
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} {...props} />;
}
