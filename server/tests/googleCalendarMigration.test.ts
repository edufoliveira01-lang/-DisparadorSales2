import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrations";

describe("migração dos destinos do Google Agenda", () => {
  it("remove o limite antigo de dois destinos sem perder vínculos", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE google_calendar_event_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pericia_id INTEGER NOT NULL,
        destination INTEGER NOT NULL CHECK(destination IN (1, 2)),
        calendar_id TEXT NOT NULL,
        google_event_id TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'sincronizado' CHECK(sync_status IN ('sincronizado','pendente','erro')),
        last_error TEXT,
        synced_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(pericia_id, destination)
      );
      INSERT INTO google_calendar_event_links
        (pericia_id, destination, calendar_id, google_event_id)
      VALUES (10, 1, 'agenda-1', 'evento-1');
    `);

    runMigrations(database);
    database.prepare(
      `INSERT INTO google_calendar_event_links
         (pericia_id, destination, calendar_id, google_event_id)
       VALUES (?, ?, ?, ?)`
    ).run(10, 3, "agenda-3", "evento-3");

    const destinations = database.prepare(
      "SELECT destination FROM google_calendar_event_links ORDER BY destination"
    ).all() as Array<{ destination: number }>;
    expect(destinations.map((item) => item.destination)).toEqual([1, 3]);
    database.close();
  });
});
