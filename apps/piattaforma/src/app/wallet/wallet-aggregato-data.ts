export const FILTRO_MOVIMENTI_AZIENDA = 'azienda';

export type RigaSede = {
  key: string;
  sedeId: string | null;
  nome: string;
  saldoCent: number;
  saldoOperativoCent: number;
  saldoAffiliazioneCent: number;
};

/**
 * Riconcilia il saldo aggregato con il dettaglio per sede.
 *
 * Il wallet operativo appartiene direttamente alla sede, mentre il wallet
 * affiliazione appartiene all'azienda madre. Le commissioni non ancora pagate
 * conservano però `referenteSedeId`, quindi possono essere attribuite alla sede
 * che le ha generate senza cambiare l'ownership del denaro.
 */
export function costruisciRigheSaldo(input: {
  sedi: { id: string; nome: string }[];
  wallets: { sedeId: string | null; saldoCent: number }[];
  affiliazioni: { referenteSedeId: string | null; saldoCent: number }[];
  saldoAziendaleCent: number;
}): RigaSede[] {
  const saldoOperativo = new Map(
    input.wallets.flatMap((wallet) =>
      wallet.sedeId ? [[wallet.sedeId, wallet.saldoCent] as const] : [],
    ),
  );
  const saldoAffiliazione = new Map<string, number>();
  for (const row of input.affiliazioni) {
    if (!row.referenteSedeId) continue;
    saldoAffiliazione.set(
      row.referenteSedeId,
      (saldoAffiliazione.get(row.referenteSedeId) ?? 0) + row.saldoCent,
    );
  }

  let affiliazioneAttribuitaCent = 0;
  const righe = input.sedi.map((sede): RigaSede => {
    const saldoOperativoCent = saldoOperativo.get(sede.id) ?? 0;
    const saldoAffiliazioneCent = saldoAffiliazione.get(sede.id) ?? 0;
    affiliazioneAttribuitaCent += saldoAffiliazioneCent;
    return {
      key: sede.id,
      sedeId: sede.id,
      nome: sede.nome,
      saldoCent: saldoOperativoCent + saldoAffiliazioneCent,
      saldoOperativoCent,
      saldoAffiliazioneCent,
    };
  });

  // Commissioni legacy senza referenteSedeId, rettifiche o altri movimenti del
  // wallet madre non vanno assegnati arbitrariamente a una filiale. Li rendiamo
  // espliciti: così la somma delle righe resta sempre uguale al totale.
  const nonAttribuitoCent = input.saldoAziendaleCent - affiliazioneAttribuitaCent;
  if (nonAttribuitoCent !== 0) {
    righe.push({
      key: FILTRO_MOVIMENTI_AZIENDA,
      sedeId: null,
      nome: 'Aziendale (senza sede)',
      saldoCent: nonAttribuitoCent,
      saldoOperativoCent: 0,
      saldoAffiliazioneCent: nonAttribuitoCent,
    });
  }

  return righe;
}

export function normalizzaFiltroSede(
  valore: string | undefined,
  sedeIds: readonly string[],
): string | null {
  if (valore === FILTRO_MOVIMENTI_AZIENDA) return valore;
  return valore && sedeIds.includes(valore) ? valore : null;
}

export function filtraMovimentiPerSede<T extends { sedeId: string | null }>(
  movimenti: T[],
  filtroSede: string | null,
): T[] {
  if (!filtroSede) return movimenti;
  if (filtroSede === FILTRO_MOVIMENTI_AZIENDA) {
    return movimenti.filter((movimento) => movimento.sedeId === null);
  }
  return movimenti.filter((movimento) => movimento.sedeId === filtroSede);
}
