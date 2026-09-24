import { db } from "../db";

export type NotificationAlertType = "entrega" | "resposta";
export type NotificationChannel = "Telegram" | "Whapi";

const insertStmt = db.prepare(`
  INSERT INTO notification_deliveries (tipo, origem_id, canal, enviado_em)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(tipo, origem_id, canal) DO UPDATE SET enviado_em = excluded.enviado_em
`);

const markMany = db.transaction((tipo: NotificationAlertType, canal: NotificationChannel, ids: number[]) => {
  for (const id of ids) insertStmt.run(tipo, id, canal);
});

/** Marca a entrega somente no canal que realmente confirmou o recebimento do alerta. */
export function markNotificationDelivered(
  tipo: NotificationAlertType,
  canal: NotificationChannel,
  ids: number[]
): void {
  if (ids.length === 0) return;
  markMany(tipo, canal, ids);
}
