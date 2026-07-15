"use client";

// components/settings/McpServersManager.tsx — 18-FRONTEND-WIREFRAMES § 18.5.6 /settings/mcp
// 의 최소 구현: 등록된 서버 테이블 + "추가" modal. POST 응답의 supportedTools 로
// discovery 성공 여부를 바로 표시(08-SPRINT-PLAN Phase 8 gate: 등록 후 30초 안에 도구 자동 발견).
import React, { useState } from "react";
import { useMcpServers, type McpServerDto } from "../../hooks/useMcpServers";

export function McpServersManager() {
  const { servers, loading, error, create, remove } = useMcpServers();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] =
    useState<McpServerDto["transport"]>("streamable_http");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await create({ name, url, transport });
    setShowModal(false);
    setName("");
    setUrl("");
  }

  return (
    <section>
      <div>
        <button
          type="button"
          className="bg-primary text-primary-fg"
          onClick={() => setShowModal(true)}
        >
          + 추가
        </button>
      </div>

      {error && <p className="text-accent">{error}</p>}

      {loading ? (
        <p>불러오는 중…</p>
      ) : servers.length === 0 ? (
        <p className="text-fg-muted">등록된 MCP 서버가 없습니다.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>URL</th>
              <th>상태</th>
              <th>도구 발견</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.url}</td>
                <td>{s.status}</td>
                <td>
                  {s.supportedTools.length > 0
                    ? `discovery 성공 (${s.supportedTools.length}개 도구)`
                    : "discovery 대기중"}
                </td>
                <td>
                  <button
                    type="button"
                    className="text-accent"
                    onClick={() => remove(s.id)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showModal && (
        <div role="dialog" aria-label="MCP 서버 추가">
          <form onSubmit={handleCreate}>
            <label>
              서버 이름
              <input
                aria-label="서버 이름"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              서버 URL
              <input
                aria-label="서버 URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label>
              transport
              <select
                aria-label="transport"
                value={transport}
                onChange={(e) =>
                  setTransport(e.target.value as McpServerDto["transport"])
                }
              >
                <option value="streamable_http">streamable_http</option>
                <option value="sse">sse</option>
              </select>
            </label>
            <button type="submit" className="bg-primary text-primary-fg">
              등록
            </button>
            <button type="button" onClick={() => setShowModal(false)}>
              취소
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
