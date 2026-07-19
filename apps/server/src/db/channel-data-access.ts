// db/channel-data-access.ts — 0041_channels.sql 의 pg 구현체 (db/note-data-access.ts 미러, P22-T6-12).
// 계약 승인 C8: Channel/ChannelMember/ChannelMessage/ChannelReaction + 동명 Repo 는
//   packages/interfaces 단일 출처(FROZEN 화이트리스트 범위).
// dev/test DATABASE_URL role 은 superuser 라 RLS(0041)를 우회한다 —
//   org 경계와 멤버십 경계는 routes/channels.ts 가 application 레벨에서 강제한다
//   (cross-org 는 403 이 아니라 404 — existence-leak 방지).
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelReaction,
  DataAccess,
} from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type ChannelDataAccess = Pick<
  DataAccess,
  "channels" | "channelMembers" | "channelMessages" | "channelReactions"
>;

function toChannel(row: Record<string, unknown>): Channel {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    description: row.description as string,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toMember(row: Record<string, unknown>): ChannelMember {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    channelId: row.channel_id as string,
    userId: row.user_id as string,
    role: row.role as ChannelMember["role"],
    createdAt: row.created_at as Date,
  };
}

function toMessage(row: Record<string, unknown>): ChannelMessage {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    channelId: row.channel_id as string,
    userId: (row.user_id as string | null) ?? null,
    role: row.role as ChannelMessage["role"],
    content: row.content as string,
    parentId: (row.parent_id as string | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

function toReaction(row: Record<string, unknown>): ChannelReaction {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    messageId: row.message_id as string,
    userId: row.user_id as string,
    emoji: row.emoji as string,
    createdAt: row.created_at as Date,
  };
}

/** SET 절을 동적으로 만든다 — data 에 실제로 존재하는 키만 반영(부분 갱신). */
function buildSet(
  data: Record<string, unknown>,
  columns: ReadonlyArray<readonly [string, string]>,
): { fields: string[]; values: unknown[] } {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of columns) {
    if (key in data) {
      fields.push(`${col} = $${values.length + 1}`);
      values.push(data[key]);
    }
  }
  return { fields, values };
}

export function createPgChannelDataAccess(): ChannelDataAccess {
  return {
    channels: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO channels (org_id, name, description, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [data.orgId, data.name ?? "", data.description ?? "", data.createdBy],
        );
        return toChannel(res.rows[0]);
      },
      async bulkInsert(rows) {
        const out: Channel[] = [];
        for (const row of rows) out.push(await this.insert(row));
        return out;
      },
      async update(id, data) {
        const { fields, values } = buildSet(
          data as Record<string, unknown>,
          [
            ["name", "name"],
            ["description", "description"],
          ] as const,
        );
        fields.push("updated_at = NOW()");
        values.push(id);
        const res = await pgPool.query(
          `UPDATE channels SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`,
          values,
        );
        return toChannel(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM channels WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query("SELECT * FROM channels WHERE id = $1", [
          id,
        ]);
        return res.rows[0] ? toChannel(res.rows[0]) : null;
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        if (filter?.orgId) {
          values.push(filter.orgId);
          conditions.push(`org_id = $${values.length}`);
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        values.push(pagination?.limit ?? 100);
        const res = await pgPool.query(
          `SELECT * FROM channels ${where} ORDER BY updated_at DESC LIMIT $${values.length}`,
          values,
        );
        return { items: res.rows.map(toChannel) };
      },
    },

    channelMembers: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO channel_members (org_id, channel_id, user_id, role)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [data.orgId, data.channelId, data.userId, data.role ?? "member"],
        );
        return toMember(res.rows[0]);
      },
      async bulkInsert(rows) {
        const out: ChannelMember[] = [];
        for (const row of rows) out.push(await this.insert(row));
        return out;
      },
      async update(id, data) {
        const { fields, values } = buildSet(
          data as Record<string, unknown>,
          [["role", "role"]] as const,
        );
        if (fields.length === 0) {
          const current = await this.byId(id);
          return current as ChannelMember;
        }
        values.push(id);
        const res = await pgPool.query(
          `UPDATE channel_members SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`,
          values,
        );
        return toMember(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM channel_members WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM channel_members WHERE id = $1",
          [id],
        );
        return res.rows[0] ? toMember(res.rows[0]) : null;
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        for (const [key, col] of [
          ["orgId", "org_id"],
          ["channelId", "channel_id"],
          ["userId", "user_id"],
        ] as const) {
          const v = filter?.[key];
          if (v) {
            values.push(v);
            conditions.push(`${col} = $${values.length}`);
          }
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        values.push(pagination?.limit ?? 100);
        const res = await pgPool.query(
          `SELECT * FROM channel_members ${where} ORDER BY created_at ASC LIMIT $${values.length}`,
          values,
        );
        return { items: res.rows.map(toMember) };
      },
    },

    channelMessages: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO channel_messages (org_id, channel_id, user_id, role, content, parent_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            data.orgId,
            data.channelId,
            data.userId ?? null,
            data.role ?? "user",
            data.content ?? "",
            data.parentId ?? null,
          ],
        );
        return toMessage(res.rows[0]);
      },
      async bulkInsert(rows) {
        const out: ChannelMessage[] = [];
        for (const row of rows) out.push(await this.insert(row));
        return out;
      },
      async update(id, data) {
        const { fields, values } = buildSet(
          data as Record<string, unknown>,
          [["content", "content"]] as const,
        );
        if (fields.length === 0) {
          const current = await this.byId(id);
          return current as ChannelMessage;
        }
        values.push(id);
        const res = await pgPool.query(
          `UPDATE channel_messages SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`,
          values,
        );
        return toMessage(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM channel_messages WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM channel_messages WHERE id = $1",
          [id],
        );
        return res.rows[0] ? toMessage(res.rows[0]) : null;
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        for (const [key, col] of [
          ["orgId", "org_id"],
          ["channelId", "channel_id"],
        ] as const) {
          const v = filter?.[key];
          if (v) {
            values.push(v);
            conditions.push(`${col} = $${values.length}`);
          }
        }
        // parentId 는 "키가 있고 값이 null" = 최상위 글만(IS NULL) 이라는 뜻이라
        // 다른 필터와 달리 falsy 스킵을 하면 안 된다.
        if (filter && "parentId" in filter) {
          const parentId = (filter as { parentId?: string | null }).parentId;
          if (parentId === null || parentId === undefined) {
            conditions.push("parent_id IS NULL");
          } else {
            values.push(parentId);
            conditions.push(`parent_id = $${values.length}`);
          }
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        values.push(pagination?.limit ?? 100);
        const res = await pgPool.query(
          `SELECT * FROM channel_messages ${where} ORDER BY created_at ASC LIMIT $${values.length}`,
          values,
        );
        return { items: res.rows.map(toMessage) };
      },
    },

    channelReactions: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO channel_reactions (org_id, message_id, user_id, emoji)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [data.orgId, data.messageId, data.userId, data.emoji ?? ""],
        );
        return toReaction(res.rows[0]);
      },
      async bulkInsert(rows) {
        const out: ChannelReaction[] = [];
        for (const row of rows) out.push(await this.insert(row));
        return out;
      },
      async update(id, data) {
        const { fields, values } = buildSet(
          data as Record<string, unknown>,
          [["emoji", "emoji"]] as const,
        );
        if (fields.length === 0) {
          const current = await this.byId(id);
          return current as ChannelReaction;
        }
        values.push(id);
        const res = await pgPool.query(
          `UPDATE channel_reactions SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`,
          values,
        );
        return toReaction(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM channel_reactions WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM channel_reactions WHERE id = $1",
          [id],
        );
        return res.rows[0] ? toReaction(res.rows[0]) : null;
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        for (const [key, col] of [
          ["orgId", "org_id"],
          ["messageId", "message_id"],
          ["userId", "user_id"],
        ] as const) {
          const v = filter?.[key];
          if (v) {
            values.push(v);
            conditions.push(`${col} = $${values.length}`);
          }
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        values.push(pagination?.limit ?? 100);
        const res = await pgPool.query(
          `SELECT * FROM channel_reactions ${where} ORDER BY created_at ASC LIMIT $${values.length}`,
          values,
        );
        return { items: res.rows.map(toReaction) };
      },
    },
  };
}
