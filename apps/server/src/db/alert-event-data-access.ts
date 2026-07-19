// db/alert-event-data-access.ts — 06-DATA-MODEL.md § 0011_observability.sql alert_events +
// 14-INTERFACES.md AlertEventRepo 의 pg 구현체 (error-log/health-history-data-access.ts 동일 패턴).
//   alerting-scheduler(부트스트랩)가 triggerAlert 로 AlertEvent 를 영속화할 때 이 repo 의 insert 를
//   사용한다. list/resolve 는 admin 알림 조회/해제용(AlertEventRepo 계약 충족).
import type { AlertEvent, DataAccess } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type AlertEventDataAccess = Pick<DataAccess, "alertEvents">;

function toAlertEvent(row: Record<string, unknown>): AlertEvent {
  return {
    id: row.id as string,
    ruleId: row.rule_id as string,
    severity: row.severity as AlertEvent["severity"],
    message: (row.message as string | null) ?? "",
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    createdAt: row.created_at as Date,
    resolvedAt: (row.resolved_at as Date | null) ?? null,
  };
}

export function createPgAlertEventDataAccess(): AlertEventDataAccess {
  return {
    alertEvents: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO alert_events (rule_id, severity, message, payload, resolved_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            data.ruleId,
            data.severity,
            data.message ?? null,
            data.payload ?? {},
            data.resolvedAt ?? null,
          ],
        );
        return toAlertEvent(res.rows[0]);
      },
      async bulkInsert(rows) {
        const out: AlertEvent[] = [];
        for (const row of rows) out.push(await this.insert(row));
        return out;
      },
      async update(id, data) {
        const res = await pgPool.query(
          `UPDATE alert_events
             SET message = COALESCE($2, message),
                 severity = COALESCE($3, severity),
                 payload = COALESCE($4, payload),
                 resolved_at = $5
           WHERE id = $1
           RETURNING *`,
          [
            id,
            data.message ?? null,
            data.severity ?? null,
            data.payload ?? null,
            data.resolvedAt ?? null,
          ],
        );
        return toAlertEvent(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query(`DELETE FROM alert_events WHERE id = $1`, [id]);
      },
      async byId(id) {
        const res = await pgPool.query(
          `SELECT * FROM alert_events WHERE id = $1`,
          [id],
        );
        return res.rows[0] ? toAlertEvent(res.rows[0]) : null;
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter?.severity) {
          conditions.push(`severity = $${i}`);
          values.push(filter.severity);
          i++;
        }
        if (filter?.unresolved) {
          conditions.push(`resolved_at IS NULL`);
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 50;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM alert_events ${where} ORDER BY created_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toAlertEvent) };
      },
      async resolve(id) {
        await pgPool.query(
          `UPDATE alert_events SET resolved_at = NOW() WHERE id = $1 AND resolved_at IS NULL`,
          [id],
        );
      },
    },
  };
}
