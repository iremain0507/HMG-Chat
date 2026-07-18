// channel-registry.test.ts — P22-T6-12 RED: orchestrator/channel-registry.ts 가 없다.
// notification-registry(사용자 단위)와 달리 이쪽은 **채널 단위** in-process pub/sub 버스다.
// acceptance: 같은 채널의 다중 구독자에게 fan-out, 다른 채널로는 누수 없음, unsubscribe 로 종료.
import { describe, expect, it } from "vitest";
import {
  publishChannelEvent,
  subscribeChannel,
  type ChannelEvent,
} from "../channel-registry.js";

async function takeFirst(
  events: AsyncIterable<ChannelEvent>,
): Promise<ChannelEvent | undefined> {
  for await (const e of events) {
    return e;
  }
  return undefined;
}

function messageEvent(id: string, channelId: string): ChannelEvent {
  return {
    type: "channel_message",
    message: {
      id,
      orgId: "org-1",
      channelId,
      userId: "user-1",
      role: "user",
      content: "안녕",
      parentId: null,
      createdAt: new Date(0).toISOString(),
    },
  };
}

describe("channel-registry — 채널 단위 in-process 버스 (P22-T6-12)", () => {
  it("구독자에게 publish 된 이벤트를 전달한다", async () => {
    const sub = subscribeChannel("ch-1");
    const event = messageEvent("m-1", "ch-1");
    publishChannelEvent("ch-1", event);
    expect(await takeFirst(sub.events)).toEqual(event);
    sub.unsubscribe();
  });

  it("한 채널의 다중 구독자에게 모두 fan-out 한다", async () => {
    const sub1 = subscribeChannel("ch-multi");
    const sub2 = subscribeChannel("ch-multi");
    const event = messageEvent("m-2", "ch-multi");
    publishChannelEvent("ch-multi", event);
    expect(await takeFirst(sub1.events)).toEqual(event);
    expect(await takeFirst(sub2.events)).toEqual(event);
    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  it("다른 채널 구독자에게는 가지 않는다 (채널 격리)", async () => {
    const subA = subscribeChannel("ch-A");
    const subB = subscribeChannel("ch-B");
    const event = messageEvent("m-3", "ch-A");
    publishChannelEvent("ch-A", event);

    expect(await takeFirst(subA.events)).toEqual(event);
    subB.unsubscribe();
    expect(await takeFirst(subB.events)).toBeUndefined();
    subA.unsubscribe();
  });

  it("reaction 이벤트도 동일하게 전달된다", async () => {
    const sub = subscribeChannel("ch-react");
    const event: ChannelEvent = {
      type: "channel_reaction",
      messageId: "m-4",
      emoji: "👍",
      userId: "user-9",
      op: "add",
    };
    publishChannelEvent("ch-react", event);
    expect(await takeFirst(sub.events)).toEqual(event);
    sub.unsubscribe();
  });

  it("unsubscribe 후 publish 는 아무 곳에도 전달되지 않는다 (누수 없음)", async () => {
    const sub = subscribeChannel("ch-gone");
    sub.unsubscribe();
    expect(() =>
      publishChannelEvent("ch-gone", messageEvent("m-5", "ch-gone")),
    ).not.toThrow();
    expect(await takeFirst(sub.events)).toBeUndefined();
  });
});
