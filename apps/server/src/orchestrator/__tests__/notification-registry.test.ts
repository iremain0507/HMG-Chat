// notification-registry.test.ts — P22-T2-02 acceptance: per-user in-process notification bus
// (message-run-registry.ts SubscriberQueue 패턴)이 사용자 단위로 이벤트를 fan-out 하고,
// cross-user 격리(A 의 이벤트는 B 에게 가지 않음)와 unsubscribe(스트림 종료) 를 보장하는지 검증.
import { describe, expect, it } from "vitest";
import type { NotificationEvent } from "@wchat/interfaces";
import {
  publishNotification,
  subscribeNotifications,
} from "../notification-registry.js";

async function takeFirst(
  events: AsyncIterable<NotificationEvent>,
): Promise<NotificationEvent | undefined> {
  for await (const e of events) {
    return e;
  }
  return undefined;
}

describe("notification-registry — per-user bus (P22-T2-02)", () => {
  it("구독자에게 publish 된 이벤트를 전달한다", async () => {
    const sub = subscribeNotifications("user-1");
    const event: NotificationEvent = {
      type: "document_indexed",
      documentId: "doc-1",
      projectId: "proj-1",
      indexStatus: "indexed",
    };
    publishNotification("user-1", event);
    const received = await takeFirst(sub.events);
    expect(received).toEqual(event);
    sub.unsubscribe();
  });

  it("다른 사용자에게는 이벤트가 가지 않는다 (cross-user 격리)", async () => {
    const subA = subscribeNotifications("user-A");
    const subB = subscribeNotifications("user-B");
    const event: NotificationEvent = {
      type: "document_indexed",
      documentId: "doc-A",
      projectId: "proj-A",
      indexStatus: "indexed",
    };
    publishNotification("user-A", event);

    const receivedA = await takeFirst(subA.events);
    expect(receivedA).toEqual(event);

    // B 는 이벤트가 없어 unsubscribe 로 스트림을 닫으면 done(undefined) 이어야 한다.
    subB.unsubscribe();
    const receivedB = await takeFirst(subB.events);
    expect(receivedB).toBeUndefined();

    subA.unsubscribe();
  });

  it("한 사용자의 다중 구독자에게 모두 fan-out 한다", async () => {
    const sub1 = subscribeNotifications("user-multi");
    const sub2 = subscribeNotifications("user-multi");
    const event: NotificationEvent = { type: "ping" };
    publishNotification("user-multi", event);
    expect(await takeFirst(sub1.events)).toEqual(event);
    expect(await takeFirst(sub2.events)).toEqual(event);
    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  it("unsubscribe 후 publish 는 아무 곳에도 전달되지 않는다 (누수 없음)", async () => {
    const sub = subscribeNotifications("user-gone");
    sub.unsubscribe();
    // 던지지 않아야 한다.
    expect(() =>
      publishNotification("user-gone", { type: "ping" }),
    ).not.toThrow();
    expect(await takeFirst(sub.events)).toBeUndefined();
  });
});
